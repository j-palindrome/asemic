//! Adapter host: loads `adapters/<n>/adapter.toml`, owns child processes, serves
//! `asemic/adapter/<n>/{schema,status,build,start,stop}` queryables (plan §5).
//! Wildcard names fan out for read verbs (`schema`, `status`); mutating verbs need a concrete name.
//! An adapter starts when its parent block starts: the block whose last label segment is the
//! adapter's name (`<project>.affinity` -> `affinity`) playing or stepping, itself or via an
//! ancestor ([`follow_blocks`]); `start` is idempotent, so an already-running adapter is left be.

use std::{
    collections::BTreeMap,
    path::{Path, PathBuf},
    sync::Arc,
};

use anyhow::{Context, Result};
use serde_json::{Value, json};
use tokio::{
    process::{Child, Command},
    sync::Mutex,
};
use zenoh::{Session, bytes::Encoding, key_expr::KeyExpr, query::Query};

use asemic_schema::{AdapterManifest, keys};

pub const VERBS: [&str; 5] = ["schema", "status", "build", "start", "stop"];
const READ_VERBS: [&str; 2] = ["schema", "status"];

pub struct Adapter {
    pub manifest: AdapterManifest,
    pub dir: PathBuf,
    root: PathBuf,
    /// label of the block that started it (`ASEMIC_BLOCK`): the adapter's scope
    block: Option<String>,
    child: Option<Child>,
    bridges: Option<crate::bridges::Bridges>,
    cli: Option<crate::cli::Cli>,
}

/// `kind = "python"`: resolved interpreter (`ASEMIC_PYTHON` env, else `<repo root>/.venv/bin/python`).
/// Manifests write the bare script (`start = "adapter.py"`), never an interpreter path, so moving
/// or renaming the venv is a one-place fix.
fn python_interpreter(root: &Path) -> PathBuf {
    std::env::var_os("ASEMIC_PYTHON").map(PathBuf::from).unwrap_or_else(|| root.join(".venv/bin/python"))
}

impl Adapter {
    fn status(&mut self) -> Value {
        let mut exit = None;
        if let Some(child) = &mut self.child
            && let Ok(Some(code)) = child.try_wait() {
                exit = Some(code.code());
                self.child = None;
            }
        json!({
            "name": self.manifest.adapter.name,
            "kind": self.manifest.adapter.kind,
            "running": self.child.is_some() || self.bridges.is_some() || self.cli.is_some(),
            "pid": self.child.as_ref().and_then(|c| c.id()),
            "exit": exit,
        })
    }

    fn command(&self, script: &str) -> Command {
        let mut cmd = Command::new("sh");
        let script = if self.manifest.adapter.kind == asemic_schema::AdapterKind::Python {
            format!("{} {script}", python_interpreter(&self.root).display())
        } else {
            script.to_string()
        };
        cmd.arg("-c").arg(script).current_dir(&self.dir).envs(&self.manifest.lifecycle.env);
        cmd.env("ASEMIC_ADAPTER", &self.manifest.adapter.name);
        // own process group (start) -> a SIGKILLed brain never TERMs us: adapters watch this pid
        cmd.env("ASEMIC_BRAIN_PID", std::process::id().to_string());
        if let Some(b) = &self.block {
            cmd.env("ASEMIC_BLOCK", b);
        }
        cmd
    }

    async fn build(&mut self) -> Result<Value> {
        let Some(script) = self.manifest.lifecycle.build.clone() else {
            return Ok(json!({"built": false, "reason": "no build step"}));
        };
        let out = self.command(&script).output().await?;
        Ok(json!({
            "built": out.status.success(),
            "code": out.status.code(),
            "stderr": String::from_utf8_lossy(&out.stderr).lines().rev().take(20).collect::<Vec<_>>(),
        }))
    }

    async fn start(&mut self, session: &Session) -> Result<Value> {
        if self.status()["running"] == true {
            return Ok(self.status());
        }
        // re-read adapter.toml on every cold start: a manifest edited since the brain loaded it
        // applies without restarting the brain (the name stays the registry key)
        let path = self.dir.join("adapter.toml");
        self.manifest = std::fs::read_to_string(&path)
            .map_err(anyhow::Error::from)
            .and_then(|s| AdapterManifest::from_toml(&s))
            .with_context(|| format!("reload {}", path.display()))?;
        let bridges = crate::bridges::start(session, &self.manifest).await?;
        if let Some(script) = self.manifest.lifecycle.start.clone() {
            // New process group (pgid = the child's own pid): `stop` signals the whole group, so
            // a process-kind adapter that forks its own children (sclang -> scsynth) takes them
            // down too, scoped to just this adapter's tree (never other processes on the machine).
            // ready = the adapter's liveliness token `asemic/adapter/<n>/ready` (declared once its
            // subscriptions are up): `start` returns only then, so a COOK that started it renders
            // its own frame; a child that exits first fails the start (no timer)
            let ready = session
                .liveliness()
                .declare_subscriber(format!("asemic/adapter/{}/ready", self.manifest.adapter.name))
                .history(true)
                .await
                .map_err(anyhow::Error::msg)?;
            let mut child = self.command(&script).kill_on_drop(true).process_group(0).spawn()?;
            if self.manifest.adapter.ready {
                tokio::select! {
                    _ = ready.recv_async() => {}
                    st = child.wait() => anyhow::bail!("{} exited before ready: {st:?}", self.manifest.adapter.name),
                }
            }
            self.child = Some(child);
        } else if self.manifest.adapter.kind == asemic_schema::AdapterKind::Cli {
            self.cli = Some(crate::cli::start(session, &self.manifest, &self.dir).await?);
        } else if self.manifest.adapter.kind != asemic_schema::AdapterKind::Bridge {
            anyhow::bail!("{}: no lifecycle.start", self.manifest.adapter.name);
        }
        self.bridges = Some(bridges);
        Ok(self.status())
    }

    async fn stop(&mut self) -> Result<Value> {
        if let Some(script) = self.manifest.lifecycle.stop.clone() {
            self.command(&script).status().await?;
        }
        if let Some(mut child) = self.child.take() {
            // `start` put it in its own process group (pgid = its pid): signal the whole group
            // first, so children it forked (e.g. sclang's scsynth) exit too, then SIGKILL the
            // group leader itself via the normal tokio path.
            if let Some(pid) = child.id() {
                let _ = Command::new("kill").arg("-TERM").arg(format!("-{pid}")).status().await;
            }
            child.kill().await.ok();
        }
        self.bridges = None;
        self.cli = None;
        Ok(self.status())
    }
}

/// Fixed after `load`; one lock per adapter, so a slow `start` (cargo build, waiting for
/// ready) never stalls queries for the others.
pub type Registry = Arc<BTreeMap<String, Mutex<Adapter>>>;

/// Scan `<root>/adapters/*/adapter.toml`; invalid manifests are logged and skipped.
pub fn load(root: &Path) -> Result<Registry> {
    let mut out = BTreeMap::new();
    let dir = root.join("adapters");
    if !dir.exists() {
        return Ok(Arc::new(out));
    }
    for entry in std::fs::read_dir(&dir).with_context(|| format!("read {}", dir.display()))? {
        let path = entry?.path().join("adapter.toml");
        if !path.exists() {
            continue;
        }
        let parsed = std::fs::read_to_string(&path)
            .map_err(anyhow::Error::from)
            .and_then(|s| AdapterManifest::from_toml(&s));
        match parsed {
            Ok(manifest) => {
                let dir = path.parent().unwrap().to_path_buf();
                tracing::info!("adapter {} ({:?})", manifest.adapter.name, manifest.adapter.kind);
                out.insert(manifest.adapter.name.clone(), Mutex::new(Adapter { manifest, dir, root: root.to_path_buf(), block: None, child: None, bridges: None, cli: None }));
            }
            Err(e) => tracing::error!("{}: {e:#}", path.display()),
        }
    }
    Ok(Arc::new(out))
}

/// Start each adapter whose parent block starts (timestretch 0 -> !0 or a COOK step), itself or
/// via an ancestor. Labels come from every `asemic/state/block/<label>/*` key seen.
pub async fn follow_blocks(session: Session, registry: Registry) -> Result<()> {
    let sub = session
        .declare_subscriber(format!("{}**", keys::BLOCK_PREFIX))
            .with(flume::unbounded())
        .await
        .map_err(anyhow::Error::msg)?;
    let step = session
        .declare_subscriber(keys::BLOCK_STEP)
            .with(flume::unbounded())
        .await
        .map_err(anyhow::Error::msg)?;
    let mut ts: BTreeMap<String, f64> = BTreeMap::new();
    let mut labels: std::collections::BTreeSet<String> = Default::default();
    let effective = |ts: &BTreeMap<String, f64>, b: &str| {
        asemic_schema::ids::ancestors(b)
            .find_map(|l| ts.get(l).copied())
            .or_else(|| ts.get("main").copied())
            .unwrap_or(0.0)
    };
    let start_under = |label: String, labels: Vec<String>| {
        let (session, registry) = (session.clone(), registry.clone());
        async move {
            for b in labels.iter().filter(|b| asemic_schema::ids::under(&label, b)) {
                let name = asemic_schema::ids::name(b);
                let Some(a) = registry.get(name) else { continue };
                let mut a = a.lock().await;
                if a.status()["running"] != true {
                    tracing::info!("adapter {name}: parent block {b} started");
                    a.block = Some(b.clone());
                    if let Err(e) = a.start(&session).await {
                        tracing::error!("start {name}: {e:#}");
                    }
                }
            }
        }
    };
    loop {
        tokio::select! {
            s = sub.recv_async() => {
                let Ok(s) = s else { break };
                // `<slash label>.<field>` (keys::timestretch & co)
                let Some((label, field)) = s.key_expr().as_str()
                    .strip_prefix(keys::BLOCK_PREFIX)
                    .map(|r| asemic_schema::ids::field(r, "")) else { continue };
                let label = label.to_string();
                labels.insert(label.clone());
                let was = effective(&ts, &label);
                if field == "timestretch" {
                    match serde_json::from_slice::<f64>(&s.payload().to_bytes()) {
                        Ok(v) if s.kind() == zenoh::sample::SampleKind::Put => ts.insert(label.clone(), v),
                        _ => ts.remove(&label),
                    };
                }
                // a new label already under a playing block counts as started too
                if effective(&ts, &label) != 0.0 && (was == 0.0 || field != "timestretch") {
                    let live: Vec<String> = labels.iter().filter(|b| effective(&ts, b) != 0.0).cloned().collect();
                    start_under(label, live).await;
                }
            }
            s = step.recv_async() => {
                // COOK, in order: start the adapters under the block (each awaited until ready),
                // then hand the step to the engine (`asemic/block/<label>.cook`, live.rs)
                let Ok(s) = s else { break };
                let Some(label) = keys::id_of(s.key_expr().as_str(), keys::BLOCK_TIME_PREFIX, keys::BLOCK_STEP_SUFFIX).map(str::to_string) else { continue };
                labels.insert(label.clone());
                start_under(label.clone(), labels.iter().cloned().collect()).await;
                if let Err(e) = session.put(keys::block_cook(&label), Vec::<u8>::new()).await {
                    tracing::error!("cook {label}: {e}");
                }
            }
        }
    }
    Ok(())
}

pub async fn serve(session: Session, registry: Registry) -> Result<()> {
    let queryable = session
        .declare_queryable(keys::ADAPTER_VERBS)
        .complete(true)
        .await
        .map_err(anyhow::Error::msg)?;
    while let Ok(query) = queryable.recv_async().await {
        let (registry, session) = (registry.clone(), session.clone());
        tokio::spawn(async move {
            if let Err(e) = handle(&query, &registry, &session).await {
                let _ = query.reply_err(json!({"error": format!("{e:#}")}).to_string()).await;
            }
        });
    }
    Ok(())
}

async fn handle(query: &Query, registry: &Registry, session: &Session) -> Result<()> {
    let qke = query.key_expr().clone();
    for (name, adapter) in registry.iter() {
        for verb in VERBS {
            let ke = KeyExpr::try_from(keys::adapter(name, verb)).map_err(anyhow::Error::msg)?;
            if !qke.intersects(&ke) {
                continue;
            }
            let concrete = qke.as_str() == ke.as_str();
            if !READ_VERBS.contains(&verb) && !concrete {
                continue; // !start/stop everything via wildcard
            }
            // read verbs never wait on an adapter mid-start/stop: answer `busy` instead
            let body = match (verb, adapter.try_lock()) {
                ("schema" | "status", Err(_)) => json!({"name": name, "busy": true}),
                (_, Ok(mut a)) => body(verb, &mut a, session).await?,
                (_, Err(_)) => body(verb, &mut *adapter.lock().await, session).await?,
            };
            tracing::info!("{} {}", verb, name);
            query
                .reply(ke, serde_json::to_vec(&body)?)
                .encoding(Encoding::APPLICATION_JSON)
                .await
                .map_err(anyhow::Error::msg)?;
        }
    }
    Ok(())
}

async fn body(verb: &str, a: &mut Adapter, session: &Session) -> Result<Value> {
    Ok(match verb {
        "schema" => serde_json::to_value(&a.manifest)?,
        "status" => a.status(),
        "build" => a.build().await?,
        "start" => a.start(session).await?,
        "stop" => a.stop().await?,
        _ => unreachable!(),
    })
}

/// Stop every running adapter (brain shutdown).
pub async fn stop_all(registry: &Registry) {
    for adapter in registry.values() {
        let mut adapter = adapter.lock().await;
        if adapter.child.is_some() || adapter.bridges.is_some() || adapter.cli.is_some() {
            let _ = adapter.stop().await;
        }
    }
}
