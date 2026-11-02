//! Zenoh glue for the engine + mixer: restore from storage, follow `asemic/state/**`,
//! run the frame loop, run routes.

use std::{
    collections::BTreeMap,
    sync::{Arc, Mutex},
    time::{Duration, Instant},
};

use anyhow::Result;
use tokio::sync::mpsc::unbounded_channel;
use zenoh::{
    Session,
    bytes::Encoding,
    qos::{CongestionControl, Priority},
    sample::{Sample, SampleKind},
};

use asemic_schema::{Combine, Component, Route, keys};

use crate::engine::{Engine, Out};

pub const FPS: f64 = asemic_draw::host::FPS as f64;

type Shared = Arc<Mutex<Engine>>;

fn json_f64(bytes: &[u8], field: Option<&str>) -> Option<f64> {
    let v: serde_json::Value = serde_json::from_slice(bytes).ok()?;
    match field {
        Some(f) => v.get(f)?.as_f64(),
        None => v.as_f64(),
    }
}

/// `[[phase, time], ...]` (JSON) -> loop envelope `Multi` (dims `phase`, `time`); None if malformed.
fn envelope_json(v: &serde_json::Value) -> Option<asemic_schema::Multi> {
    let arr = v.as_array()?;
    let mut line = Vec::with_capacity(arr.len() * 2);
    for p in arr {
        let pair = p.as_array()?;
        line.push(pair.first()?.as_f64()? as f32);
        line.push(pair.get(1)?.as_f64()? as f32);
    }
    (line.len() >= 4).then(|| asemic_schema::Multi {
        attrs: vec!["phase".into(), "time".into()],
        lines: vec![line],
    })
}

/// Apply one state sample to the engine; returns outputs (deletes) to publish.
fn apply(engine: &Shared, routes: &mut Routes, session: &Session, s: &Sample) -> Vec<Out> {
    let key = s.key_expr().as_str();
    let put = s.kind() == SampleKind::Put;
    let bytes = s.payload().to_bytes();
    let mut e = engine.lock().unwrap();
    if let Some(id) = key.strip_prefix(keys::COMPONENT_PREFIX) {
        if !put {
            return e.delete_component(id);
        }
        match Component::from_json(&bytes) {
            Ok(c) if c.id == id => return e.put_component(c),
            Ok(c) => tracing::warn!("{key}: id {:?} != key", c.id),
            Err(err) => tracing::warn!("{key}: {err:#}"),
        }
    } else if let Some(rest) = key.strip_prefix(keys::PARAM_PREFIX) {
        // `<slash id>.<k>` (keys::param)
        let (comp, k) = asemic_schema::ids::split_field(rest);
        let Some(k) = k.strip_prefix('.') else {
            return vec![];
        };
        if !put {
            e.delete_param(comp, k);
        } else if let Some(v) = json_f64(&bytes, None) {
            e.put_param(comp, k, v);
        } else {
            tracing::warn!("{key}: not a number");
        }
    } else if let Some(rest) = key.strip_prefix(keys::BLOCK_PREFIX) {
        if let Some(label) = rest.strip_suffix(keys::TIMESTRETCH_SUFFIX) {
            if !put {
                e.clear_timestretch(label);
            } else if let Some(v) = json_f64(&bytes, None) {
                e.set_timestretch(label, v);
            }
        } else if let Some(label) = rest.strip_suffix(keys::BLOCK_LENGTH_SUFFIX) {
            if !put {
                e.clear_block_length(label);
            } else if let Some(v) = json_f64(&bytes, None) {
                e.set_block_length(label, v);
            }
        } else if let Some(label) = rest.strip_suffix(keys::BLOCK_LOOP_SUFFIX) {
            if !put {
                e.clear_block_loop(label);
            } else {
                match serde_json::from_slice::<serde_json::Value>(&bytes) {
                    // preset name -> curve preset
                    Ok(serde_json::Value::String(name)) => e.set_block_loop_preset(label, &name),
                    // curve data [[phase, time], ...] -> envelope (wrapped)
                    Ok(v) => match envelope_json(&v) {
                        Some(m) => e.set_block_loop(label, m, true),
                        None => tracing::warn!("{key}: loop: expected [[phase,time],..] or a name"),
                    },
                    Err(err) => tracing::warn!("{key}: {err:#}"),
                }
            }
        } else if let Some(label) = rest.strip_suffix(keys::BLOCK_TIME_SUFFIX) {
            // seek input (the *live* playhead is published at `asemic/block/<label>.time`)
            if put && let Some(v) = json_f64(&bytes, None) {
                e.seek_block(label, v);
            }
        }
    } else if let Some(id) = key.strip_prefix(keys::ROUTE_PREFIX) {
        drop(e);
        if !put {
            routes.remove(id);
        } else {
            match Route::from_json(&bytes) {
                Ok(r) if r.id == id => routes.insert(session.clone(), engine.clone(), r),
                Ok(r) => tracing::warn!("{key}: id {:?} != key", r.id),
                Err(err) => tracing::warn!("{key}: {err:#}"),
            }
        }
    }
    vec![]
}

async fn publish(session: &Session, outs: Vec<Out>) {
    for o in outs {
        let r = match o {
            Out::Put(k, v) => {
                session
                    .put(k, serde_json::to_vec(&v).unwrap_or_default())
                    .encoding(Encoding::APPLICATION_JSON)
                    .priority(Priority::Data)
                    .congestion_control(CongestionControl::Drop)
                    .await
            }
            Out::Delete(k) => session.delete(k).await,
            Out::Bytes(k, b) => {
                session
                    .put(k, b)
                    .encoding(Encoding::APPLICATION_OCTET_STREAM)
                    .priority(Priority::DataHigh)
                    .congestion_control(CongestionControl::Drop)
                    .await
            }
            Out::Call(id, b) => {
                // async: the reply (or its absence) lands as `asemic/py/<id>.out` -> engine.py_reply
                tracing::info!("py {id}: call");
                let session = session.clone();
                tokio::spawn(async move {
                    let mut out = Vec::new(); // empty = no queryable: frees the call, no retry
                    if let Ok(replies) = session.get(keys::py(&id)).payload(b).await {
                        while let Ok(r) = replies.recv_async().await {
                            if let Ok(s) = r.result() {
                                out = s.payload().to_bytes().to_vec();
                            }
                        }
                    }
                    tracing::info!("py {id}: call answered with {} B", out.len());
                    let _ = session.put(keys::py_out(&id), out).await;
                });
                Ok(())
            }
        };
        if let Err(e) = r {
            tracing::warn!("publish: {e}");
        }
    }
}

pub async fn run(session: Session) -> Result<()> {
    let engine: Shared = Arc::default();
    let mut routes = Routes::default();

    // subscribe before restore so no edit falls in the gap; restore replays first.
    // Unbounded hand-off (every handler this loop drains, below too): zenoh delivers local puts synchronously into the subscriber, so a
    // bounded FIFO here blocks every route task's `put` (60 Hz noise -> state/param) once this
    // loop lags -> all tokio workers parked -> this loop never runs again (deadlock).
    let (tx, mut sub) = unbounded_channel();
    let _state_sub = session
        .declare_subscriber(format!("{}/**", keys::STATE))
        .callback(move |s| {
            let _ = tx.send(s);
        })
        .await
        .map_err(anyhow::Error::msg)?;
    let mut restored = 0;
    for sel in [
        keys::COMPONENTS,
        keys::PARAMS,
        keys::ROUTES,
        keys::BLOCK_TIMESTRETCH,
        keys::BLOCK_LENGTH,
        keys::BLOCK_LOOP,
        "asemic/state/block/**/$*.time",
    ] {
        let replies = session
            .get(sel)
            .timeout(Duration::from_secs(2))
            .await
            .map_err(anyhow::Error::msg)?;
        while let Ok(reply) = replies.recv_async().await {
            if let Ok(s) = reply.result() {
                let outs = apply(&engine, &mut routes, &session, s);
                publish(&session, outs).await;
                restored += 1;
            }
        }
    }
    tracing::info!("restored {restored} state keys");

    let (latest_v_tx, mut latest_v) = unbounded_channel();
    let _latest_v = session
        .declare_queryable("asemic/value/**")
        .callback(move |q| {
            let _ = latest_v_tx.send(q);
        })
        .await
        .map_err(anyhow::Error::msg)?;
    let (latest_n_tx, mut latest_n) = unbounded_channel();
    let _latest_n = session
        .declare_queryable("asemic/meta/**")
        .callback(move |q| {
            let _ = latest_n_tx.send(q);
        })
        .await
        .map_err(anyhow::Error::msg)?;
    let (latest_o_tx, mut latest_o) = unbounded_channel();
    let _latest_o = session
        .declare_queryable("asemic/out/**")
        .callback(move |q| {
            let _ = latest_o_tx.send(q);
        })
        .await
        .map_err(anyhow::Error::msg)?;
    // adapter data roundups (§8.1.5): raw f32 LE frames → processors
    let (io_tx, mut io) = unbounded_channel();
    let _io = session
        .declare_subscriber("asemic/io/**")
        .callback(move |s| {
            let _ = io_tx.send(s);
        })
        .await
        .map_err(anyhow::Error::msg)?;

    // `py` proc replies from the REPL frontend (engine caches; never waited on per frame)
    let (py_tx, mut py) = unbounded_channel();
    let _py = session
        .declare_subscriber(keys::PY_OUT)
        .callback(move |s| {
            let _ = py_tx.send(s);
        })
        .await
        .map_err(anyhow::Error::msg)?;
    // COOK = play exactly one frame (event, !state: storage must not replay it)
    let (step_tx, mut step) = unbounded_channel();
    let _step = session
        .declare_subscriber(keys::BLOCK_COOK)
        .callback(move |s| {
            let _ = step_tx.send(s);
        })
        .await
        .map_err(anyhow::Error::msg)?;

    let period = Duration::from_secs_f64(1.0 / FPS);
    let mut tick = tokio::time::interval(period);
    tick.set_missed_tick_behavior(tokio::time::MissedTickBehavior::Skip);
    let mut last = Instant::now();
    loop {
        tokio::select! {
            s = sub.recv() => {
                // drain the backlog; params (60 Hz route writes) coalesce to their newest value
                // so edits behind them (component/route/pause) aren't seconds late
                let mut batch = vec![s.ok_or_else(|| anyhow::anyhow!("state subscriber closed"))?];
                while let Ok(s) = sub.try_recv() {
                    batch.push(s);
                }
                let mut newest = std::collections::HashMap::new();
                for (i, s) in batch.iter().enumerate() {
                    newest.insert(s.key_expr().as_str(), i);
                }
                let mut outs = vec![];
                for (i, s) in batch.iter().enumerate() {
                    let k = s.key_expr().as_str();
                    if k.starts_with(keys::PARAM_PREFIX) && newest[k] != i {
                        continue;
                    }
                    outs.extend(apply(&engine, &mut routes, &session, s));
                }
                publish(&session, outs).await;
            }
            Some(s) = io.recv() => {
                engine.lock().unwrap().feed_io(s.key_expr().as_str(), &s.payload().to_bytes());
            }
            Some(s) = py.recv() => {
                let Some(id) = keys::id_of(s.key_expr().as_str(), "asemic/py/", keys::PY_OUT_SUFFIX) else { continue };
                engine.lock().unwrap().py_reply(id, &s.payload().to_bytes());
            }
            Some(s) = step.recv() => {
                let Some(label) = keys::id_of(s.key_expr().as_str(), keys::BLOCK_TIME_PREFIX, keys::BLOCK_COOK_SUFFIX) else { continue };
                tracing::info!("cook {label}");
                engine.lock().unwrap().step_block(label);
            }
            Some(q) = latest_v.recv() => answer_latest(&engine, q),
            Some(q) = latest_n.recv() => answer_latest(&engine, q),
            Some(q) = latest_o.recv() => answer_latest(&engine, q),
            _ = tick.tick() => {
                let now = Instant::now();
                let dt = (now - last).as_secs_f64().min(0.1);
                last = now;
                let outs = engine.lock().unwrap().step(dt);
                publish(&session, outs).await;
            }
        }
    }
}

/// Reply to `get asemic/{value,meta,out}/**` from the engine's last-published map (late joiners).
fn answer_latest(engine: &Shared, q: zenoh::query::Query) {
    let qke = q.key_expr().clone();
    let hits: Vec<(String, Vec<u8>)> = {
        let e = engine.lock().unwrap();
        e.last()
            .iter()
            .filter(|(k, _)| {
                ["asemic/value/", "asemic/meta/", "asemic/out/"]
                    .iter()
                    .any(|p| k.starts_with(p))
                    && zenoh::key_expr::KeyExpr::try_from(k.as_str())
                        .is_ok_and(|ke| qke.intersects(&ke))
            })
            .map(|(k, v)| (k.clone(), serde_json::to_vec(v).unwrap_or_default()))
            .collect()
    };
    tokio::spawn(async move {
        for (k, v) in hits {
            let _ = q.reply(k, v).encoding(Encoding::APPLICATION_JSON).await;
        }
    });
}

// ---------------------------------------------------------------- mixer

#[derive(Default)]
struct Routes(BTreeMap<String, tokio::task::JoinHandle<()>>);

impl Routes {
    fn insert(&mut self, session: Session, engine: Shared, r: Route) {
        self.remove(&r.id);
        tracing::info!("route {}: {} -> {}", r.id, r.src, r.dst);
        let id = r.id.clone();
        self.0.insert(
            id,
            tokio::spawn(async move {
                if let Err(e) = run_route(session, engine, r).await {
                    tracing::warn!("route: {e:#}");
                }
            }),
        );
    }

    fn remove(&mut self, id: &str) {
        if let Some(h) = self.0.remove(id) {
            h.abort();
        }
    }
}

async fn run_route(session: Session, engine: Shared, r: Route) -> Result<()> {
    // latest-value only: a route never needs stale src samples, and a ring never blocks the putter
    let sub = session
        .declare_subscriber(&r.src)
        .with(zenoh::handlers::RingChannel::new(1))
        .await
        .map_err(anyhow::Error::msg)?;
    let publisher = session
        .declare_publisher(r.dst.clone())
        .encoding(Encoding::APPLICATION_JSON)
        .priority(Priority::Data)
        .congestion_control(CongestionControl::Drop)
        .await
        .map_err(anyhow::Error::msg)?;
    // seed dst with current src so routes made after the value still fire
    let seed = engine
        .lock()
        .unwrap()
        .last()
        .get(&r.src)
        .and_then(|v| match r.field.as_deref() {
            Some(f) => v.get(f)?.as_f64(),
            None => v.as_f64(),
        });
    let emit = |v: f64| {
        let mapped = r.map(v);
        let mut eng = engine.lock().unwrap();
        let out = match r.combine {
            Combine::Replace => mapped,
            Combine::Add => {
                let cur = eng.last().get(&r.dst).and_then(|v| v.as_f64()).unwrap_or(0.0);
                cur + mapped
            }
            Combine::Multiply => {
                let cur = eng.last().get(&r.dst).and_then(|v| v.as_f64()).unwrap_or(1.0);
                cur * mapped
            }
        };
        eng.remember(&r.dst, serde_json::json!(out));
        drop(eng);
        serde_json::to_vec(&out)
    };
    if let Some(v) = seed {
        publisher.put(emit(v)?).await.map_err(anyhow::Error::msg)?;
    }
    while let Ok(s) = sub.recv_async().await {
        if s.kind() != SampleKind::Put {
            continue;
        }
        if let Some(v) = json_f64(&s.payload().to_bytes(), r.field.as_deref()) {
            publisher.put(emit(v)?).await.map_err(anyhow::Error::msg)?;
        }
    }
    Ok(())
}
