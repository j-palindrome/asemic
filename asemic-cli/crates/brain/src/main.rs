//! asemic-brain: Zenoh peer owning clock, adapter host, noisegens, components, mixer.
//!
//!   asemic-brain [--root DIR] [--config FILE]   run
//!   asemic-brain --schema                       print the JSON Schema bundle (-> asemic_py/_schema.json)
//!   asemic-brain --verbs                        print the REPL verb table (-> asemic_py/_api.pyi)

mod adapters;
mod bridges;
mod cli;
mod engine;
mod live;
mod node;
mod proc;
mod verbs;
mod vfont;

use std::{path::PathBuf, time::Instant};

use anyhow::Result;
use serde_json::json;
use zenoh::bytes::Encoding;

use asemic_schema::keys;

struct Args {
    root: PathBuf,
    config: PathBuf,
    schema: bool,
    verbs: bool,
}

fn args() -> Result<Args> {
    let mut root = std::env::var("ASEMIC_ROOT")
        .map(PathBuf::from)
        .unwrap_or(std::env::current_dir()?);
    let mut config = None;
    let mut schema = false;
    let mut verbs = false;
    let mut it = std::env::args().skip(1);
    while let Some(a) = it.next() {
        match a.as_str() {
            "--root" => {
                root = it
                    .next()
                    .map(PathBuf::from)
                    .ok_or_else(|| anyhow::anyhow!("--root DIR"))?
            }
            "--config" => config = it.next().map(PathBuf::from),
            "--schema" => schema = true,
            "--verbs" => verbs = true,
            other => anyhow::bail!("unknown arg {other}"),
        }
    }
    let config = config.unwrap_or_else(|| root.join("config/peer.json5"));
    Ok(Args {
        root,
        config,
        schema,
        verbs,
    })
}

/// Main thread = macOS run loop (Syphon discovery, asemic-draw); brain = tokio on worker
/// threads. Brain exit stops the run loop; process exits with the brain's result.
fn main() -> Result<()> {
    let rt = tokio::runtime::Builder::new_multi_thread()
        .enable_all()
        .build()?;
    let brain = rt.spawn(async {
        let r = run().await;
        asemic_draw::stop_main_run_loop();
        r
    });
    asemic_draw::park_main_in_run_loop();
    rt.block_on(brain)?
}

async fn run() -> Result<()> {
    let args = args()?;
    if args.schema {
        print!("{}", schema_bundle());
        return Ok(());
    }
    if args.verbs {
        print!("{}", verbs_bundle());
        return Ok(());
    }
    tracing_subscriber::fmt()
        .with_env_filter(
            tracing_subscriber::EnvFilter::try_from_default_env()
                .unwrap_or_else(|_| "info,zenoh=warn".into()),
        )
        .init();

    let config = zenoh::Config::from_file(&args.config).map_err(anyhow::Error::msg)?;
    let session = zenoh::open(config).await.map_err(anyhow::Error::msg)?;
    tracing::info!("zenoh {} via {}", session.zid(), args.config.display());

    let registry = adapters::load(&args.root)?;
    let adapter_names: Vec<String> = registry.keys().cloned().collect();

    // single brain per machine (Syphon names are global): held for process lifetime
    let lock = std::fs::File::create(std::env::temp_dir().join("asemic-brain.lock"))?;
    if lock.try_lock().is_err() {
        anyhow::bail!("another asemic-brain is already running");
    }

    let started = Instant::now();
    let status = session
        .declare_queryable(keys::BRAIN_STATUS)
        .await
        .map_err(anyhow::Error::msg)?;
    let status_task = tokio::spawn(async move {
        while let Ok(q) = status.recv_async().await {
            let body = json!({
                "version": env!("CARGO_PKG_VERSION"),
                "uptime": started.elapsed().as_secs_f64(),
                "adapters": adapter_names,
            });
            let _ = q
                .reply(keys::BRAIN_STATUS, body.to_string())
                .encoding(Encoding::APPLICATION_JSON)
                .await;
        }
    });

    let host = tokio::spawn(adapters::serve(session.clone(), registry.clone()));
    tokio::spawn(adapters::follow_blocks(session.clone(), registry.clone()));
    let live = tokio::spawn(live::run(session.clone()));
    let (draw, mut frames) = asemic_draw::host::Host::spawn()?;
    // terminal preview frames (only produced while someone subscribes; verbs.rs matching)
    let fz = session.clone();
    tokio::spawn(async move {
        while let Some((name, b)) = frames.recv().await {
            // `err/tex/<id>` = draw-graph runtime error (reliable, "" = cleared); else a preview frame
            if name.starts_with("err/") {
                let _ = fz.put(format!("asemic/{name}"), b).await;
            } else {
                let _ = fz
                    .put(asemic_schema::keys::preview(verbs::preview_id(&name)), b)
                    .congestion_control(zenoh::qos::CongestionControl::Drop)
                    .await;
            }
        }
    });
    // draw prep input: every gen point buffer (in-brain or external) -> draw host
    // unbounded + newest-per-id: a bounded FIFO here back-pressures the live loop's own
    // `put` (local delivery is synchronous) whenever draw feed lags -> brain deadlock
    let (gens_tx, mut gens) = tokio::sync::mpsc::unbounded_channel();
    let _gens = session
        .declare_subscriber(asemic_schema::keys::GENS)
        .callback(move |s| {
            let _ = gens_tx.send(s);
        })
        .await
        .map_err(anyhow::Error::msg)?;
    let feed = draw.clone();
    tokio::spawn(async move {
        while let Some(s) = gens.recv().await {
            let mut newest = std::collections::BTreeMap::new();
            newest.insert(s.key_expr().as_str().to_owned(), s);
            while let Ok(s) = gens.try_recv() {
                newest.insert(s.key_expr().as_str().to_owned(), s);
            }
            for (k, s) in newest {
                feed.feed(k.trim_start_matches(asemic_schema::keys::GEN_PREFIX), &s.payload().to_bytes());
            }
        }
    });
    let v = verbs::Verbs::new(session.clone(), draw).await?;
    tokio::spawn(v.clone().params());
    tokio::spawn(v.clone().sync_timestretch());
    tokio::spawn(v.clone().sync_step());
    tokio::spawn(v.clone().sync_block_time());
    let verbs = tokio::spawn(v.serve());

    let mut term = tokio::signal::unix::signal(tokio::signal::unix::SignalKind::terminate())?;
    tokio::select! {
        _ = tokio::signal::ctrl_c() => tracing::info!("shutdown"),
        _ = term.recv() => tracing::info!("shutdown (SIGTERM)"),
        r = host => tracing::error!("adapter host exited: {r:?}"),
        r = live => tracing::error!("engine exited: {r:?}"),
        r = verbs => tracing::error!("verbs exited: {r:?}"),
    }
    status_task.abort();
    adapters::stop_all(&registry).await;
    session.close().await.map_err(anyhow::Error::msg)?;
    Ok(())
}

/// Every brain-state wire type as one JSON Schema doc (schema crate's types + draw's tex
/// `NodeInfo`): `--schema` output, golden-checked as `asemic_py/_schema.json`
/// (input to `scripts/gen_types.sh` -> `_types.py`).
fn schema_bundle() -> String {
    let extra = [(
        "tex",
        serde_json::to_value(schemars::schema_for!(asemic_draw::graph::NodeInfo)).unwrap(),
    )];
    serde_json::to_string_pretty(&asemic_schema::json_schema_bundle(&extra)).unwrap() + "\n"
}

/// REPL verb table (`verbs::TABLE` = `[name, [arg names], doc]` per verb) as JSON: `--verbs`,
/// consumed by `scripts/gen_api.py` to generate `asemic_py/_api.pyi` (typed signatures giving
/// the embedded nvim editor completion for every livecode verb).
fn verbs_bundle() -> String {
    serde_json::to_string_pretty(&verbs::TABLE).unwrap() + "\n"
}

#[cfg(test)]
mod schema_golden {
    /// `UPDATE_WIRE=1 cargo test -p asemic-brain schema_golden` regenerates (scripts/gen_types.sh does).
    #[test]
    fn python_schema_bundle_matches() {
        let path =
            std::path::Path::new(env!("CARGO_MANIFEST_DIR")).join("../../asemic_py/_schema.json");
        let generated = super::schema_bundle();
        if std::env::var("UPDATE_WIRE").is_ok() {
            std::fs::write(&path, &generated).unwrap();
            return;
        }
        let on_disk = std::fs::read_to_string(&path).unwrap_or_default();
        assert_eq!(
            on_disk, generated,
            "asemic_py/_schema.json stale: run scripts/gen_types.sh"
        );
    }
}
