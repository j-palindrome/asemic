//! affinity adapter: the Affinity backend `affinity(...)` rows call (asemic_py/namespace.py).
//!
//! A row puts `asemic/in/<NAME>/row/<id>` = {input, opts, root} (empty = row gone). Per row: each
//! new multiarray on `asemic/gen/<input>` -> `score::document` -> drawn on Affinity's current
//! document (must be saved inside `root`); doc saved at `<root>/<id last segment>.json`; page grab
//! -> ASF1 on `asemic/preview/<id>`; render log -> `asemic/out/<NAME>/<id>/log`. Event-driven: draws
//! when a gen's bytes change, !poll. Ready token once subscribed (`start` awaits it).

mod affinity;
mod score;

use std::collections::HashMap;

use anyhow::Result;
use asemic_schema::{Multi, keys, wire::FRAME_MAGIC};
use serde::Deserialize;
use tokio::{sync::mpsc, task::JoinHandle};
use zenoh::Session;

#[derive(Debug, Clone, Deserialize)]
struct Row {
    input: String,
    #[serde(default)]
    file: Option<String>,
    #[serde(default)]
    opts: score::Opts,
    root: Option<String>,
    /// row's `preview=` kw (dots|image|ascii); absent -> this adapter's own `image`
    preview: Option<String>,
    #[serde(default)]
    paused: bool,
    #[serde(default)]
    page: Option<usize>,
    #[serde(default)]
    on: Option<String>,
}

/// (row id, row, gen id, ASP1)
type Job = (String, Row, String, Vec<u8>);

/// Stable group tag per row (survives restarts) -> each redraw replaces only this row's group.
fn tag_for(rid: &str) -> String {
    format!("asemic {}", uuid::Uuid::new_v5(&uuid::Uuid::NAMESPACE_OID, rid.as_bytes()))
}

/// Per row: forward each changed gen payload to the draw loop; a cook of the row's block
/// forces the next one (unchanged data still redraws on COOK).
fn follow(session: Session, rid: String, row: Row, tx: mpsc::UnboundedSender<Job>) -> JoinHandle<()> {
    tokio::spawn(async move {
        let Ok(sub) = session.declare_subscriber(format!("asemic/gen/{}", row.input)).await else { return };
        let Ok(cooks) = session.declare_subscriber(keys::BLOCK_COOK).await else { return };
        let mut last = None;
        loop {
            tokio::select! {
                Ok(c) = cooks.recv_async() => {
                    let Some(label) = keys::id_of(c.key_expr().as_str(), keys::BLOCK_TIME_PREFIX, keys::BLOCK_COOK_SUFFIX) else { continue };
                    if asemic_schema::ids::under(label, &row.input) {
                        last = None;
                    }
                }
                r = sub.recv_async() => {
                    let Ok(s) = r else { break };
                    let raw = s.payload().to_bytes().to_vec();
                    // gens republish every frame with a new frame counter: draw on data change only
                    let m = Multi::decode(&raw).map(|(_, m)| m);
                    if m.is_none() || m != last {
                        last = m;
                        let gen_id = s.key_expr().as_str().trim_start_matches("asemic/gen/").to_string();
                        let _ = tx.send((rid.clone(), row.clone(), gen_id, raw));
                    }
                }
            }
        }
    })
}

fn frame(img: &image::RgbaImage, n: u32) -> Vec<u8> {
    let mut b = Vec::with_capacity(12 + img.as_raw().len());
    b.extend(FRAME_MAGIC);
    b.extend(n.to_le_bytes());
    b.extend((img.width() as u16).to_le_bytes());
    b.extend((img.height() as u16).to_le_bytes());
    b.extend(img.as_raw());
    b
}

/// A row config put (or stored): (re)follow its input gen; empty payload = row gone.
async fn on_row(
    session: &Session,
    name: &str,
    follows: &mut HashMap<String, JoinHandle<()>>,
    tx: &mpsc::UnboundedSender<Job>,
    s: &zenoh::sample::Sample,
) {
    let rid = s.key_expr().as_str().trim_start_matches(&format!("asemic/in/{name}/row/")).to_string();
    if let Some(old) = follows.remove(&rid) {
        old.abort();
    }
    let raw = s.payload().to_bytes();
    if raw.is_empty() {
        // row gone: clear any stale error so a re-added row starts clean
        let _ = session.put(format!("asemic/err/{name}/{rid}"), "").await;
        return;
    }
    match serde_json::from_slice::<Row>(&raw) {
        Ok(row) => {
            tracing::info!("{rid}: row {row:?}");
            // re-config clears the previous draw's error; the next draw re-sets it only if the
            // new opts still fail. (Without this, an edit that doesn't republish the gen — e.g.
            // a pause/unpause or identical-data change — leaves the old error stuck under the row.)
            let _ = session.put(format!("asemic/err/{name}/{rid}"), "").await;
            let look = row.preview.as_deref().unwrap_or("image");
            let _ = session.put(keys::preview_kind(&rid), serde_json::to_vec(look).unwrap_or_default()).await;
            follows.insert(rid.clone(), follow(session.clone(), rid, row, tx.clone()));
        }
        Err(e) => {
            let _ = session.put(format!("asemic/err/{name}/{rid}"), format!("bad row: {e}")).await;
        }
    }
}

#[tokio::main]
async fn main() -> Result<()> {
    tracing_subscriber::fmt().with_env_filter(tracing_subscriber::EnvFilter::from_default_env()).init();
    let name = std::env::var("ASEMIC_ADAPTER")?; // brain-set (adapters.rs)
    // brain gone without stopping us (SIGKILL / hang -> killed) -> exit, !orphan
    if let Ok(pid) = std::env::var("ASEMIC_BRAIN_PID") {
        tokio::spawn(async move {
            loop {
                tokio::time::sleep(std::time::Duration::from_secs(2)).await;
                let alive = tokio::process::Command::new("kill").args(["-0", &pid]).stderr(std::process::Stdio::null()).status().await;
                if !alive.is_ok_and(|s| s.success()) {
                    tracing::warn!("brain {pid} gone -> exit");
                    std::process::exit(0);
                }
            }
        });
    }
    // env, else the repo `<root>/config/peer.json5` found by walking up from the cwd (start runs
    // in this adapter's folder) -- a CARGO_MANIFEST_DIR-based path bakes the crate's depth and
    // breaks when the source tree moves
    let config = std::env::var_os("ASEMIC_ZENOH_CONFIG")
        .map(Into::into)
        .unwrap_or_else(|| {
            let mut dir = std::env::current_dir().unwrap_or_else(|_| concat!(env!("CARGO_MANIFEST_DIR"), "/..").into());
            loop {
                let c = dir.join("config").join("peer.json5");
                if c.exists() || !dir.pop() {
                    return c;
                }
            }
        });
    let session = zenoh::open(zenoh::Config::from_file(config).map_err(anyhow::Error::msg)?)
        .await
        .map_err(anyhow::Error::msg)?;

    let (tx, mut jobs) = mpsc::unbounded_channel::<Job>();
    let rows = session
        .declare_subscriber(format!("asemic/in/{name}/row/**"))
        .await
        .map_err(anyhow::Error::msg)?;
    let mut follows: HashMap<String, JoinHandle<()>> = HashMap::new();
    // rows put before this (re)start: the router stores `asemic/in/*/row/**` (config/router.json5)
    let stored = session.get(format!("asemic/in/{name}/row/**")).await.map_err(anyhow::Error::msg)?;
    while let Ok(r) = stored.recv_async().await {
        if let Ok(s) = r.result() {
            on_row(&session, &name, &mut follows, &tx, s).await;
        }
    }
    // ready once live + stored rows are followed (`start` awaits this token)
    let _ready = session
        .liveliness()
        .declare_token(format!("asemic/adapter/{name}/ready"))
        .await
        .map_err(anyhow::Error::msg)?;
    let mut aff = affinity::Affinity::default();
    let mut term = tokio::signal::unix::signal(tokio::signal::unix::SignalKind::terminate())?;

    loop {
        tokio::select! {
            _ = term.recv() => break,
            Ok(s) = rows.recv_async() => on_row(&session, &name, &mut follows, &tx, &s).await,
            Some((rid, row, gen_id, raw)) = jobs.recv() => {
                tracing::info!("{rid}: gen {gen_id} ({} B)", raw.len());
                if row.paused {
                    continue;
                }
                let (Some(root), Some((n, m))) = (row.root.as_deref(), Multi::decode(&raw)) else {
                    let _ = session.put(format!("asemic/err/{name}/{rid}"), "no root (unsaved file?) or undecodable gen").await;
                    continue;
                };
                if !follows.contains_key(&rid) {
                    continue;
                }
                let target_doc = row.file.as_deref().map(|f| {
                    let p = std::path::Path::new(f);
                    let full = if p.is_absolute() {
                        p.to_path_buf()
                    } else {
                        std::path::Path::new(root).join(p)
                    };
                    std::fs::canonicalize(&full).unwrap_or(full).to_string_lossy().into_owned()
                });
                if let Err(e) = aff.ensure_open(root, target_doc.as_deref()).await {
                    let err = format!("affinity doc error: {e}");
                    let _ = session.put(format!("asemic/err/{name}/{rid}"), &err).await;
                    let _ = session.put(format!("asemic/out/{name}/{rid}/log"), serde_json::to_vec(&err)?).await;
                    continue;
                }
                // the page size (px) drives the layout: a quarter note is at least
                // settings.quarter_px wide, so the system length rounds to whole bars and
                // notes never overlap. Unknown page (no document / Affinity closed) -> the
                // default width.
                let page = aff.page_size(root, &tag_for(&rid), row.on.as_deref()).await.map_or_else(score::Page::default, |(w, h, dpi)| score::Page { width_px: w, height_px: h, dpi });
                let doc = score::document(&m, &gen_id, n, &row.opts, page);
                let file = asemic_schema::ids::name(&rid);
                if let Err(e) = std::fs::write(format!("{root}/{file}.json"), doc.to_string()) {
                    tracing::warn!("{rid}: {e}");
                }
                // stable per row (survives restarts) -> each redraw replaces only this row's group
                let tag = tag_for(&rid);
                let (log, img) = aff.draw(&doc, root, &tag, row.page, row.on.as_deref()).await;
                tracing::info!("{rid}: drew (page: {}) {log}", img.is_some());
                // no page = skipped/failed: log -> error view under the row ("" clears)
                let has_err = log.lines().any(|l| l.contains("asemic-render: error:"));
                let err = if has_err {
                    log.lines().find(|l| l.contains("asemic-render: error:")).unwrap_or(log.as_str())
                } else if img.is_some() {
                    ""
                } else {
                    log.as_str()
                };
                let _ = session.put(format!("asemic/err/{name}/{rid}"), err).await;
                if let Some(img) = img {
                    let _ = session.put(format!("asemic/preview/{rid}"), frame(&img, n)).await;
                }
                let _ = session.put(format!("asemic/out/{name}/{rid}/log"), serde_json::to_vec(&log)?).await;
            }
        }
    }
    session.close().await.map_err(anyhow::Error::msg)?;
    Ok(())
}
