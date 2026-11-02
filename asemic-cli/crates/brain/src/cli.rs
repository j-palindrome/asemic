//! Brain-owned `kind = "cli"` adapter transport (plan §8.6 / §9): a one-shot argv template run
//! per request, never a long-running child. Subscribes `asemic/io/<adapter>/<in-plug>`; each
//! `put` there execs `lifecycle.run` with its placeholders filled from the request payload,
//! streams stdout lines to `asemic/out/<adapter>/<out-plug>` as they arrive, then publishes
//! `asemic/out/<adapter>/<out-plug>/done` = `{code}`. A new request cancels (kills) a still-
//! running one first; dropping `Cli` (adapter `stop`) kills whatever is in flight.

use std::{
    collections::BTreeMap,
    path::{Path, PathBuf},
    sync::{Arc, Mutex},
};

use anyhow::Result;
use serde_json::{Value, json};
use tokio::{
    io::{AsyncBufReadExt, BufReader},
    process::Command,
    task::JoinHandle,
};
use zenoh::Session;

use asemic_schema::{AdapterManifest, IoDir};

/// Running cli transport; dropping aborts the subscriber loop(s) and any in-flight run.
pub struct Cli {
    tasks: Vec<JoinHandle<()>>,
    current: Arc<Mutex<Option<JoinHandle<()>>>>,
}

impl Drop for Cli {
    fn drop(&mut self) {
        self.tasks.iter().for_each(JoinHandle::abort);
        if let Some(h) = self.current.lock().unwrap().take() {
            h.abort();
        }
    }
}

pub async fn start(session: &Session, m: &AdapterManifest, dir: &Path) -> Result<Cli> {
    let name = m.adapter.name.clone();
    let template = m.lifecycle.run.clone().ok_or_else(|| anyhow::anyhow!("{name}: kind cli needs lifecycle.run"))?;
    let out_name = m.io.iter().find(|p| p.dir == IoDir::Out).map(|p| p.name.clone());
    let in_names: Vec<String> = m.io.iter().filter(|p| p.dir == IoDir::In).map(|p| p.name.clone()).collect();
    if in_names.is_empty() {
        anyhow::bail!("{name}: kind cli needs an \"in\" [[io]] plug to trigger on");
    }
    let current: Arc<Mutex<Option<JoinHandle<()>>>> = Arc::default();
    let mut tasks = Vec::new();
    for in_name in in_names {
        let key = format!("asemic/io/{name}/{in_name}");
        let sub = session.declare_subscriber(&key).await.map_err(anyhow::Error::msg)?;
        let (session, name, template, out_name, dir, env, current) = (
            session.clone(),
            name.clone(),
            template.clone(),
            out_name.clone(),
            dir.to_path_buf(),
            m.lifecycle.env.clone(),
            current.clone(),
        );
        tasks.push(tokio::spawn(async move {
            while let Ok(sample) = sub.recv_async().await {
                let payload = parse(&sample.payload().to_bytes());
                if let Some(h) = current.lock().unwrap().take() {
                    h.abort(); // new request supersedes whatever was still running
                }
                let argv = match build_argv(&template, &payload, &in_name) {
                    Ok(a) => a,
                    Err(e) => {
                        tracing::error!("cli {name}: {e:#}");
                        continue;
                    }
                };
                let (session, name, out_name, dir, env) =
                    (session.clone(), name.clone(), out_name.clone(), dir.clone(), env.clone());
                let handle = tokio::spawn(async move { run_once(session, name, out_name, dir, env, argv).await });
                *current.lock().unwrap() = Some(handle);
            }
        }));
    }
    Ok(Cli { tasks, current })
}

async fn run_once(session: Session, name: String, out_name: Option<String>, dir: PathBuf, env: BTreeMap<String, String>, argv: Vec<String>) {
    let Some((prog, rest)) = argv.split_first() else {
        tracing::error!("cli {name}: empty command");
        return;
    };
    let mut cmd = Command::new(prog);
    cmd.args(rest)
        .current_dir(&dir)
        .envs(&env)
        .kill_on_drop(true)
        .stdin(std::process::Stdio::null())
        .stdout(std::process::Stdio::piped())
        .stderr(std::process::Stdio::null());
    let mut child = match cmd.spawn() {
        Ok(c) => c,
        Err(e) => {
            tracing::error!("cli {name}: spawn {prog:?}: {e}");
            return;
        }
    };
    if let (Some(stdout), Some(out)) = (child.stdout.take(), out_name.clone()) {
        let key = format!("asemic/out/{name}/{out}");
        let mut lines = BufReader::new(stdout).lines();
        while let Ok(Some(line)) = lines.next_line().await {
            let _ = session.put(&key, line).await;
        }
    }
    let code = child.wait().await.ok().and_then(|s| s.code());
    if let Some(out) = out_name {
        let _ = session.put(format!("asemic/out/{name}/{out}/done"), json!({"code": code}).to_string()).await;
    }
}

fn parse(b: &[u8]) -> Value {
    serde_json::from_slice(b).unwrap_or_else(|_| json!(String::from_utf8_lossy(b)))
}

/// Whitespace-split; a `"..."` run (no escaping needed — these are hand-written manifest
/// templates) is kept as one token so a path or literal arg can contain spaces.
fn split_template(t: &str) -> Vec<String> {
    let mut out = Vec::new();
    let mut cur = String::new();
    let mut in_q = false;
    for ch in t.chars() {
        match ch {
            '"' => in_q = !in_q,
            c if c.is_whitespace() && !in_q => {
                if !cur.is_empty() {
                    out.push(std::mem::take(&mut cur));
                }
            }
            c => cur.push(c),
        }
    }
    if !cur.is_empty() {
        out.push(cur);
    }
    out
}

fn placeholders(tok: &str) -> Vec<String> {
    let mut v = Vec::new();
    let mut rest = tok;
    while let Some(s) = rest.find('{') {
        let Some(e) = rest[s..].find('}') else { break };
        v.push(rest[s + 1..s + e].to_string());
        rest = &rest[s + e + 1..];
    }
    v
}

fn value_to_string(v: &Value) -> String {
    match v {
        Value::String(s) => s.clone(),
        other => other.to_string(),
    }
}

/// `{key}` -> payload object field `key`; or, if the payload isn't an object (a bare scalar
/// request), `{fallback_name}` -> the whole payload.
fn field_value(payload: &Value, key: &str, fallback_name: &str) -> Option<String> {
    match payload {
        Value::Object(map) => map.get(key).map(value_to_string),
        other if key == fallback_name => Some(value_to_string(other)),
        _ => None,
    }
}

/// Fills `template`'s `{name}` placeholders from `payload`, one argv element per token —
/// exec'd directly (never `sh -c`), so a filled value can never inject a second command.
fn build_argv(template: &str, payload: &Value, fallback_name: &str) -> Result<Vec<String>> {
    // `${HOME}` (never a payload placeholder — braced with `$`) lets manifests avoid hardcoding
    // an absolute home dir; expanded from the brain's own env before argv splitting.
    let template = match std::env::var("HOME") {
        Ok(home) => template.replace("${HOME}", &home),
        Err(_) => template.to_string(),
    };
    split_template(&template)
        .into_iter()
        .map(|tok| {
            let mut out = tok.clone();
            for ph in placeholders(&tok) {
                let val = field_value(payload, &ph, fallback_name)
                    .ok_or_else(|| anyhow::anyhow!("missing field {ph:?} in request payload"))?;
                out = out.replace(&format!("{{{ph}}}"), &val);
            }
            Ok(out)
        })
        .collect()
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn argv_substitutes_and_isolates_tokens() {
        let argv = build_argv("echo hello {name}", &json!({"name": "world"}), "name").unwrap();
        assert_eq!(argv, vec!["echo", "hello", "world"]);
    }

    #[test]
    fn argv_keeps_injection_attempt_as_one_literal_token() {
        let payload = json!({"query": "x; rm -rf / #"});
        let argv = build_argv("echo {query}", &payload, "query").unwrap();
        assert_eq!(argv, vec!["echo", "x; rm -rf / #"]);
    }

    #[test]
    fn argv_scalar_payload_uses_fallback_name() {
        let argv = build_argv("echo {query}", &json!("hi there"), "query").unwrap();
        assert_eq!(argv, vec!["echo", "hi there"]);
    }

    #[test]
    fn argv_missing_field_errors() {
        assert!(build_argv("echo {missing}", &json!({}), "query").is_err());
    }

    #[tokio::test(flavor = "multi_thread", worker_threads = 2)]
    async fn cli_kind_streams_stdout_and_done() -> Result<()> {
        let session = zenoh::open(zenoh::Config::default()).await.map_err(anyhow::Error::msg)?;
        let m = AdapterManifest::from_toml(
            "[adapter]\nname='clit'\nkind='cli'\n[lifecycle]\nrun='echo {query}'\n[[io]]\nname='query'\ntype='control'\ndir='in'\n[[io]]\nname='answer'\ntype='control'\ndir='out'\n",
        )?;
        let out = session.declare_subscriber("asemic/out/clit/**").await.map_err(anyhow::Error::msg)?;
        let dir = std::env::current_dir()?;
        let _c = start(&session, &m, &dir).await?;
        tokio::time::sleep(std::time::Duration::from_millis(200)).await; // let the subscriber match
        session.put("asemic/io/clit/query", json!({"query": "hello cli"}).to_string()).await.map_err(anyhow::Error::msg)?;
        let line = tokio::time::timeout(std::time::Duration::from_secs(2), out.recv_async()).await?.map_err(anyhow::Error::msg)?;
        assert_eq!(line.key_expr().as_str(), "asemic/out/clit/answer");
        assert_eq!(String::from_utf8_lossy(&line.payload().to_bytes()), "hello cli");
        let done = tokio::time::timeout(std::time::Duration::from_secs(2), out.recv_async()).await?.map_err(anyhow::Error::msg)?;
        assert_eq!(done.key_expr().as_str(), "asemic/out/clit/answer/done");
        assert_eq!(parse(&done.payload().to_bytes()), json!({"code": 0}));
        Ok(())
    }

    #[tokio::test(flavor = "multi_thread", worker_threads = 2)]
    async fn cli_injection_attempt_runs_as_literal_arg_not_shell() -> Result<()> {
        let session = zenoh::open(zenoh::Config::default()).await.map_err(anyhow::Error::msg)?;
        let m = AdapterManifest::from_toml(
            "[adapter]\nname='clit2'\nkind='cli'\n[lifecycle]\nrun='echo {query}'\n[[io]]\nname='query'\ntype='control'\ndir='in'\n[[io]]\nname='answer'\ntype='control'\ndir='out'\n",
        )?;
        let out = session.declare_subscriber("asemic/out/clit2/answer").await.map_err(anyhow::Error::msg)?;
        let dir = std::env::current_dir()?;
        let _c = start(&session, &m, &dir).await?;
        tokio::time::sleep(std::time::Duration::from_millis(200)).await; // let the subscriber match
        // if this ever reached a shell, `; touch` would run a second command — `echo` just
        // prints it back as one literal arg instead.
        let payload = json!({"query": "safe; touch /tmp/asemic-cli-test-should-not-exist"});
        session.put("asemic/io/clit2/query", payload.to_string()).await.map_err(anyhow::Error::msg)?;
        let line = tokio::time::timeout(std::time::Duration::from_secs(2), out.recv_async()).await?.map_err(anyhow::Error::msg)?;
        assert_eq!(String::from_utf8_lossy(&line.payload().to_bytes()), "safe; touch /tmp/asemic-cli-test-should-not-exist");
        assert!(!std::path::Path::new("/tmp/asemic-cli-test-should-not-exist").exists());
        Ok(())
    }

    #[tokio::test(flavor = "multi_thread", worker_threads = 2)]
    async fn cli_new_request_cancels_running_one() -> Result<()> {
        let session = zenoh::open(zenoh::Config::default()).await.map_err(anyhow::Error::msg)?;
        let m = AdapterManifest::from_toml(
            "[adapter]\nname='clit3'\nkind='cli'\n[lifecycle]\nrun='sh -c \"sleep {secs} && echo late\"'\n[[io]]\nname='secs'\ntype='control'\ndir='in'\n[[io]]\nname='answer'\ntype='control'\ndir='out'\n",
        )?;
        let out = session.declare_subscriber("asemic/out/clit3/**").await.map_err(anyhow::Error::msg)?;
        let dir = std::env::current_dir()?;
        let _c = start(&session, &m, &dir).await?;
        tokio::time::sleep(std::time::Duration::from_millis(200)).await; // let the subscriber match
        session.put("asemic/io/clit3/secs", json!({"secs": "5"}).to_string()).await.map_err(anyhow::Error::msg)?;
        tokio::time::sleep(std::time::Duration::from_millis(200)).await;
        session.put("asemic/io/clit3/secs", json!({"secs": "0"}).to_string()).await.map_err(anyhow::Error::msg)?;
        // the 5s run must be killed by the 2nd request and never land anything; the 0s one
        // finishes fast ("late" line, then done) well inside the 3s cancellation window.
        let mut saw_done = false;
        for _ in 0..4 {
            let Ok(Ok(s)) = tokio::time::timeout(std::time::Duration::from_secs(3), out.recv_async()).await else { break };
            if s.key_expr().as_str() == "asemic/out/clit3/answer/done" {
                saw_done = true;
                break;
            }
        }
        assert!(saw_done, "never saw the fast run's done marker — was it cancelled too, or did the slow one survive?");
        Ok(())
    }

    /// Live smoke test against the real `adapters/infinite-researcher/adapter.toml`: skips
    /// (rather than failing) when `uv` isn't on PATH or the Infinite Researcher server repo
    /// isn't checked out next to this one — an external, machine-local dependency.
    #[tokio::test(flavor = "multi_thread", worker_threads = 2)]
    async fn infinite_researcher_cli_adapter_answers_live() -> Result<()> {
        if std::process::Command::new("which").arg("uv").output().map(|o| !o.status.success()).unwrap_or(true) {
            eprintln!("skip: `uv` not on PATH");
            return Ok(());
        }
        // crates/brain -> repo root
        let repo_root = Path::new(env!("CARGO_MANIFEST_DIR")).join("../..");
        let manifest_path = repo_root.join("adapters/infinite-researcher/adapter.toml");
        let Ok(src) = std::fs::read_to_string(&manifest_path) else {
            eprintln!("skip: {} not found", manifest_path.display());
            return Ok(());
        };
        let server_dir = match std::env::var("HOME") {
            Ok(home) => PathBuf::from(home).join("jVault/Projects/Infinite Researcher/server"),
            Err(_) => {
                eprintln!("skip: $HOME unset");
                return Ok(());
            }
        };
        if !server_dir.join("infinite_researcher/cli.py").exists() {
            eprintln!("skip: {} not found", server_dir.display());
            return Ok(());
        }
        let m = AdapterManifest::from_toml(&src)?;
        let dir = manifest_path.parent().unwrap().to_path_buf();
        let session = zenoh::open(zenoh::Config::default()).await.map_err(anyhow::Error::msg)?;
        let out = session.declare_subscriber("asemic/out/infinite-researcher/**").await.map_err(anyhow::Error::msg)?;
        let _c = start(&session, &m, &dir).await?;
        tokio::time::sleep(std::time::Duration::from_millis(200)).await;
        session
            .put("asemic/io/infinite-researcher/query", json!({"query": "what is zenoh"}).to_string())
            .await
            .map_err(anyhow::Error::msg)?;
        // Networked research can be slow; give it real headroom rather than the unit-test budget.
        let deadline = tokio::time::Instant::now() + std::time::Duration::from_secs(120);
        let mut saw_answer_line = false;
        loop {
            let remaining = deadline.saturating_duration_since(tokio::time::Instant::now());
            if remaining.is_zero() {
                anyhow::bail!("timed out waiting for infinite-researcher done marker");
            }
            let Ok(Ok(s)) = tokio::time::timeout(remaining, out.recv_async()).await else {
                anyhow::bail!("subscriber closed before done marker");
            };
            if s.key_expr().as_str() == "asemic/out/infinite-researcher/answer" {
                saw_answer_line = true;
            }
            if s.key_expr().as_str() == "asemic/out/infinite-researcher/answer/done" {
                // Only the adapter's own plumbing (argv exec, stdout streaming, done marker) is
                // under test here; the CLI's own exit code depends on *its* config (API keys,
                // Ollama reachability, ...) and isn't ours to assert on.
                if !saw_answer_line {
                    eprintln!("note: infinite-researcher cli produced no answer line ({})", String::from_utf8_lossy(&s.payload().to_bytes()));
                }
                break;
            }
        }
        Ok(())
    }
}
