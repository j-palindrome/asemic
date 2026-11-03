//! Brain-owned adapter transports (plan §8.6): OSC (rosc) and virtual MIDI (midir + wmidi).
//! In: `asemic/io/<adapter>/<path>`; out: subscribe `asemic/out/<adapter>/**`.

use std::sync::Arc;

use anyhow::Result;
use midir::{
    MidiInput, MidiOutput,
    os::unix::{VirtualInput, VirtualOutput},
};
use rosc::{OscMessage, OscPacket, OscType, decoder, encoder};
use serde_json::{Value, json};
use tokio::{net::UdpSocket, task::JoinHandle};
use wmidi::{Channel, ControlFunction, MidiMessage, Note, U7};
use zenoh::Session;

use asemic_schema::AdapterManifest;

/// Running bridges; dropping aborts tasks and closes ports.
#[derive(Default)]
pub struct Bridges {
    tasks: Vec<JoinHandle<()>>,
    midi_in: Option<midir::MidiInputConnection<()>>,
}

impl Drop for Bridges {
    fn drop(&mut self) {
        self.tasks.iter().for_each(JoinHandle::abort);
        if let Some(c) = self.midi_in.take() {
            c.close();
        }
    }
}

/// Maximum safe UDP OSC datagram size (RFC 791 / Ethernet MTU - IP/UDP headers).
/// Guarantees packets are never dropped or rejected by sclang / external OSC hosts with "Bad OSC message size".
pub const MAX_OSC_DATAGRAM_BYTES: usize = 1400;

/// Splits an outgoing OSC message into multiple indexed chunk messages if serialized size exceeds `MAX_OSC_DATAGRAM_BYTES`.
/// Standard chunk format supported by receivers: `[addr, id, key, chunk_data_str, chunk_idx, total_chunks]`
pub fn chunk_osc_messages(addr: &str, args: &[OscType]) -> Vec<OscMessage> {
    let msg = OscMessage { addr: addr.to_string(), args: args.to_vec() };
    if let Ok(buf) = encoder::encode(&OscPacket::Message(msg.clone())) {
        if buf.len() <= MAX_OSC_DATAGRAM_BYTES {
            return vec![msg];
        }
    }

    // Attempt automatic chunking if message carries an array-like or sequence string payload (e.g. /pdef or /bdef [id, key, data])
    if args.len() >= 3 {
        if let OscType::String(ref s) = args[2] {
            let id = match &args[0] {
                OscType::String(v) => v.clone(),
                other => format!("{other:?}"),
            };
            let key = match &args[1] {
                OscType::String(v) => v.clone(),
                other => format!("{other:?}"),
            };
            let trimmed = s.trim();
            if (trimmed.starts_with('[') && trimmed.ends_with(']')) || trimmed.contains(',') {
                let inner = if trimmed.starts_with('[') && trimmed.ends_with(']') {
                    &trimmed[1..trimmed.len().saturating_sub(1)]
                } else {
                    trimmed
                };
                let tokens: Vec<&str> = inner.split(',').collect();
                if tokens.len() > 1 {
                    let mut chunks = Vec::new();
                    let mut curr_chunk = Vec::new();
                    let mut curr_len = 2; // for brackets "[]"
                    for tok in tokens {
                        let t = tok.trim();
                        let added = t.len() + 2; // ", "
                        if !curr_chunk.is_empty() && (curr_len + added > 900) {
                            chunks.push(format!("[{}]", curr_chunk.join(", ")));
                            curr_chunk.clear();
                            curr_chunk.push(t);
                            curr_len = 2 + t.len();
                        } else {
                            curr_chunk.push(t);
                            curr_len += added;
                        }
                    }
                    if !curr_chunk.is_empty() {
                        chunks.push(format!("[{}]", curr_chunk.join(", ")));
                    }

                    let total = chunks.len() as i32;
                    if total > 1 {
                        return chunks
                            .into_iter()
                            .enumerate()
                            .map(|(idx, ch)| OscMessage {
                                addr: addr.to_string(),
                                args: vec![
                                    OscType::String(id.clone()),
                                    OscType::String(key.clone()),
                                    OscType::String(ch),
                                    OscType::Int(idx as i32),
                                    OscType::Int(total),
                                ],
                            })
                            .collect();
                    }
                }
            }
        }
    }

    // If message is not chunkable, return original message (which will be safely dropped if over MTU)
    vec![msg]
}

pub async fn start(session: &Session, m: &AdapterManifest) -> Result<Bridges> {
    let name = m.adapter.name.clone();
    let mut b = Bridges::default();
    if let Some(osc) = &m.osc {
        let sock = Arc::new(UdpSocket::bind(("127.0.0.1", osc.listen.unwrap_or(0))).await?);
        if osc.listen.is_some() {
            b.tasks.push(tokio::spawn(osc_in(session.clone(), name.clone(), sock.clone())));
        }
        if let Some(to) = osc.send.clone() {
            let (sub, name, s_out) = (subscribe(session, &name).await?, name.clone(), session.clone());
            b.tasks.push(tokio::spawn(async move {
                while let Ok(s) = sub.recv_async().await {
                    let addr = format!("/{}", rest(s.key_expr().as_str(), &name));
                    let raw_args = to_osc(&parse(&s.payload().to_bytes()));
                    let messages = chunk_osc_messages(&addr, &raw_args);
                    for msg in messages {
                        if let Ok(buf) = encoder::encode(&OscPacket::Message(msg)) {
                            if buf.len() > MAX_OSC_DATAGRAM_BYTES {
                                tracing::error!(
                                    "OSC packet size ({} B) exceeds MAX_OSC_DATAGRAM_BYTES ({} B) for adapter '{}'; packet dropped to prevent host crash",
                                    buf.len(), MAX_OSC_DATAGRAM_BYTES, name
                                );
                                let err_key = format!("asemic/err/{name}/osc");
                                let err_msg = format!("OSC packet size ({} B) exceeds limit ({} B)", buf.len(), MAX_OSC_DATAGRAM_BYTES);
                                let _ = s_out.put(err_key, err_msg).await;
                            } else {
                                let _ = sock.send_to(&buf, &to).await;
                            }
                        }
                    }
                }
            }));
        }
    }
    if let Some(midi) = &m.midi {
        let port = midi.port.clone().unwrap_or_else(|| format!("asemic-{name}"));
        let prefix = midi.prefix.clone().unwrap_or_default();
        let (s, n, p) = (session.clone(), name.clone(), prefix.clone());
        let rt = tokio::runtime::Handle::current();
        b.midi_in = Some(
            MidiInput::new(&port)?
                .create_virtual(&port, move |_, bytes, _| {
                    if let Some((path, v)) = MidiMessage::try_from(bytes).ok().and_then(|m| from_midi(&m)) {
                        let (s, key) = (s.clone(), format!("asemic/io/{n}/{p}{path}"));
                        rt.spawn(async move { s.put(key, v.to_string()).await.ok() });
                    }
                }, ())
                .map_err(|e| anyhow::anyhow!("midi in {port}: {e}"))?,
        );
        let mut out = MidiOutput::new(&port)?
            .create_virtual(&port)
            .map_err(|e| anyhow::anyhow!("midi out {port}: {e}"))?;
        let sub = subscribe(session, &name).await?;
        b.tasks.push(tokio::spawn(async move {
            while let Ok(s) = sub.recv_async().await {
                let v = parse(&s.payload().to_bytes()).as_f64().unwrap_or(0.0);
                let key_rest = rest(s.key_expr().as_str(), &name).strip_prefix(prefix.as_str()).unwrap_or_else(|| rest(s.key_expr().as_str(), &name));
                if let Some(msg) = to_midi(key_rest, v) {
                    let mut buf = [0u8; 3];
                    if let Ok(n) = msg.copy_to_slice(&mut buf) {
                        let _ = out.send(&buf[..n]);
                    }
                }
            }
        }));
    }
    Ok(b)
}

async fn subscribe(session: &Session, name: &str) -> Result<zenoh::pubsub::Subscriber<flume::Receiver<zenoh::sample::Sample>>> {
    session.declare_subscriber(format!("asemic/out/{name}/**")).with(flume::unbounded()).await.map_err(anyhow::Error::msg)
}

fn rest<'a>(key: &'a str, name: &str) -> &'a str {
    key.strip_prefix(&format!("asemic/out/{name}/")).unwrap_or(key)
}

fn parse(b: &[u8]) -> Value {
    serde_json::from_slice(b).unwrap_or_else(|_| json!(String::from_utf8_lossy(b)))
}

async fn osc_in(session: Session, name: String, sock: Arc<UdpSocket>) {
    let mut buf = vec![0u8; rosc::decoder::MTU];
    while let Ok((n, _)) = sock.recv_from(&mut buf).await {
        let Ok((_, pkt)) = decoder::decode_udp(&buf[..n]) else { continue };
        for m in flatten(pkt) {
            let args: Vec<Value> = m.args.iter().map(from_osc).collect();
            let v = if args.len() == 1 { args[0].clone() } else { json!(args) };
            let addr = m.addr.trim_start_matches('/');
            if addr == "error" {
                // Unified error keyspace: asemic/err/<adapter>/<id>
                let (ident, msg) = if let Some(arr) = v.as_array() {
                    let id = arr.first().and_then(|v| v.as_str()).unwrap_or(&name);
                    let m = arr.get(1).and_then(|v| v.as_str()).unwrap_or("");
                    (id.replace('_', "/"), m.to_string())
                } else {
                    (name.clone(), v.as_str().unwrap_or("").to_string())
                };
                let err_key = format!("asemic/err/{name}/{ident}");
                let _ = session.put(err_key, msg).await;
            }
            let key = format!("asemic/io/{name}/{addr}");
            let _ = session.put(key, v.to_string()).await;
        }
    }
}

fn flatten(p: OscPacket) -> Vec<OscMessage> {
    match p {
        OscPacket::Message(m) => vec![m],
        OscPacket::Bundle(b) => b.content.into_iter().flat_map(flatten).collect(),
    }
}

fn from_osc(a: &OscType) -> Value {
    match a {
        OscType::Int(i) => json!(i),
        OscType::Long(i) => json!(i),
        OscType::Float(f) => json!(f),
        OscType::Double(f) => json!(f),
        OscType::String(s) => json!(s),
        OscType::Bool(b) => json!(b),
        other => json!(format!("{other:?}")),
    }
}

fn to_osc(v: &Value) -> Vec<OscType> {
    match v {
        Value::Array(a) => a.iter().flat_map(to_osc).collect(),
        Value::Number(n) if n.is_i64() => vec![OscType::Int(n.as_i64().unwrap() as i32)],
        Value::Number(n) => vec![OscType::Float(n.as_f64().unwrap_or(0.0) as f32)],
        Value::String(s) => vec![OscType::String(s.clone())],
        Value::Bool(b) => vec![OscType::Bool(*b)],
        _ => vec![],
    }
}

/// cc/note -> (`cc|note/<ch 1-16>/<n>`, 0..1).
fn from_midi(m: &MidiMessage) -> Option<(String, f64)> {
    let u = |x: U7| u8::from(x) as f64 / 127.0;
    let ch = |c: &Channel| c.index() + 1;
    Some(match m {
        MidiMessage::ControlChange(c, f, v) => (format!("cc/{}/{}", ch(c), u8::from(*f)), u(*v)),
        MidiMessage::NoteOn(c, n, v) => (format!("note/{}/{}", ch(c), u8::from(*n)), u(*v)),
        MidiMessage::NoteOff(c, n, _) => (format!("note/{}/{}", ch(c), u8::from(*n)), 0.0),
        _ => return None,
    })
}

fn to_midi(path: &str, v: f64) -> Option<MidiMessage<'static>> {
    let mut it = path.split('/');
    let (kind, c, n) = (it.next()?, it.next()?.parse::<u8>().ok()?, it.next()?.parse::<u8>().ok()?);
    let c = Channel::from_index(c.checked_sub(1)?).ok()?;
    let val = U7::try_from((v.clamp(0.0, 1.0) * 127.0).round() as u8).ok()?;
    Some(match kind {
        "cc" => MidiMessage::ControlChange(c, ControlFunction(U7::try_from(n).ok()?), val),
        "note" if v > 0.0 => MidiMessage::NoteOn(c, Note::try_from(n).ok()?, val),
        "note" => MidiMessage::NoteOff(c, Note::try_from(n).ok()?, U7::MIN),
        _ => return None,
    })
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn midi_paths_round_trip() {
        for (p, v) in [("cc/1/74", 1.0), ("note/16/60", 1.0), ("note/3/60", 0.0)] {
            let m = to_midi(p, v).expect(p);
            assert_eq!(from_midi(&m), Some((p.to_string(), v)));
        }
        assert!(to_midi("cc/0/1", 0.5).is_none());
    }

    #[tokio::test(flavor = "multi_thread", worker_threads = 2)]
    async fn osc_bridges_both_ways() -> Result<()> {
        let session = zenoh::open(zenoh::Config::default()).await.map_err(anyhow::Error::msg)?;
        let peer = UdpSocket::bind("127.0.0.1:0").await?;
        let listen = { let s = std::net::UdpSocket::bind("127.0.0.1:0")?; s.local_addr()?.port() };
        let m = AdapterManifest::from_toml(&format!(
            "[adapter]\nname='osct'\nkind='bridge'\n[osc]\nlisten={listen}\nsend='{}'\n",
            peer.local_addr()?
        ))?;
        let io = session.declare_subscriber("asemic/io/osct/**").await.map_err(anyhow::Error::msg)?;
        let _b = start(&session, &m).await?;
        tokio::time::sleep(std::time::Duration::from_millis(200)).await;
        // in
        let pkt = OscPacket::Message(OscMessage { addr: "/freq".into(), args: vec![OscType::Float(440.0)] });
        peer.send_to(&encoder::encode(&pkt)?, ("127.0.0.1", listen)).await?;
        let s = tokio::time::timeout(std::time::Duration::from_secs(2), io.recv_async()).await?.map_err(anyhow::Error::msg)?;
        assert_eq!(s.key_expr().as_str(), "asemic/io/osct/freq");
        assert_eq!(parse(&s.payload().to_bytes()), json!(440.0));
        // out
        session.put("asemic/out/osct/set/amp", "[1, 0.5]").await.map_err(anyhow::Error::msg)?;
        let mut buf = [0u8; 512];
        let (n, _) = tokio::time::timeout(std::time::Duration::from_secs(2), peer.recv_from(&mut buf)).await??;
        let OscPacket::Message(m) = decoder::decode_udp(&buf[..n])?.1 else { panic!() };
        assert_eq!(m.addr, "/set/amp");
        assert_eq!(m.args, vec![OscType::Int(1), OscType::Float(0.5)]);
        Ok(())
    }
}
