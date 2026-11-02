//! One MCP session to Affinity (Settings -> MCP Server, SSE :6767) via `rmcp`; `draw` runs
//! `scripts/asemic-render.js` on the current document, then grabs the page (`render_spread`).

use anyhow::{Result, anyhow, bail};
use base64::Engine;
use rmcp::{
    RoleClient, ServiceExt,
    model::{CallToolRequestParam, ClientInfo, ProtocolVersion, RawContent},
    service::RunningService,
    transport::SseClientTransport,
};
use serde_json::{Value, json};

pub const URL: &str = "http://localhost:6767/sse";
/// Affinity's server accepts only this MCP revision; rmcp 0.10 (last with an SSE client) defaults
/// to 2025-03-26 and hangs on the server's "Unsupported protocol version" reply
const PROTOCOL: &str = "2025-11-25";
const JS: &str = include_str!("../../scripts/asemic-render.js");
const TEMPLATE_AF: &[u8] = include_bytes!("../../template.af");

#[derive(Default)]
pub struct Affinity {
    s: Option<RunningService<RoleClient, ClientInfo>>,
}

impl Affinity {
    async fn tool(&self, name: &str, args: Value) -> Result<Vec<RawContent>> {
        let s = self.s.as_ref().ok_or_else(|| anyhow!("no session"))?;
        let r = s
            .call_tool(CallToolRequestParam { name: name.to_string().into(), arguments: args.as_object().cloned() })
            .await?;
        let content: Vec<RawContent> = r.content.into_iter().map(|c| c.raw).collect();
        if r.is_error == Some(true) {
            bail!("{name}: {}", text(&content));
        }
        Ok(content)
    }

    async fn connect(&mut self) -> Result<()> {
        if self.s.is_none() {
            let version: ProtocolVersion = serde_json::from_value(json!(PROTOCOL))?;
            let info = ClientInfo { protocol_version: version, ..Default::default() };
            self.s = Some(info.serve(SseClientTransport::start(URL).await?).await?);
            // execute_script refuses until the preamble was read this session
            self.tool("read_sdk_documentation_topic", json!({"filename": "preamble"})).await?;
        }
        Ok(())
    }

    /// Ensure the target document is created (if missing) and open in Affinity.
    /// If `target_file` is None, verifies that at least one document inside `root` is open.
    pub async fn ensure_open(&mut self, root: &str, target_file: Option<&str>) -> Result<()> {
        let Some(target) = target_file else {
            // No specific file requested: verify at least one doc inside root is open
            self.connect().await?;
            let script = format!(
                r#"const {{ Document }} = require('/document.js');
const openInRoot = Document.all.some(d => String(d.path || '').startsWith({root} + '/'));
console.log('asemic-open: ' + openInRoot);"#,
                root = json!(root)
            );
            let log = text(&self.tool("execute_script", json!({"script": script})).await?).trim().to_string();
            if log.lines().any(|l| l == "asemic-open: true") {
                return Ok(());
            }
            bail!("no Affinity document open inside {root}");
        };

        let target_path = std::path::Path::new(target);
        if !target_path.exists() {
            if let Some(parent) = target_path.parent() {
                std::fs::create_dir_all(parent)?;
            }
            std::fs::write(target_path, TEMPLATE_AF)?;
            tracing::info!("created initial document: {target}");
        }

        // Check if target is already open in Affinity
        self.connect().await?;
        let script = format!(
            r#"const {{ Document }} = require('/document.js');
const target = {target};
const isOpen = Document.all.some(d => String(d.path || '') === target);
console.log('asemic-target-open: ' + isOpen);"#,
            target = json!(target)
        );
        let log = text(&self.tool("execute_script", json!({"script": script})).await?).trim().to_string();
        if log.lines().any(|l| l == "asemic-target-open: true") {
            return Ok(());
        }

        // Open in Affinity via `open -a Affinity <target>`
        tracing::info!("opening document in Affinity: {target}");
        let status = tokio::process::Command::new("open")
            .args(["-a", "Affinity", target])
            .status()
            .await?;
        if !status.success() {
            bail!("failed to launch Affinity with open command for {target}");
        }

        // Wait up to 5 seconds for Affinity to register the document
        for _ in 0..10 {
            tokio::time::sleep(std::time::Duration::from_millis(500)).await;
            let check_script = format!(
                r#"const {{ Document }} = require('/document.js');
const target = {target};
const isOpen = Document.all.some(d => String(d.path || '') === target);
console.log('asemic-target-open: ' + isOpen);"#,
                target = json!(target)
            );
            if let Ok(content) = self.tool("execute_script", json!({"script": check_script})).await {
                let out = text(&content).trim().to_string();
                if out.lines().any(|l| l == "asemic-target-open: true") {
                    return Ok(());
                }
            }
        }
        bail!("timed out waiting for Affinity to open {target}");
    }

    /// Draw `doc` on the current document (only one saved inside `root`) into the group
    /// tagged `tag` (replacing only that group) -> (log, page RGBA).
    pub async fn draw(
        &mut self,
        doc: &Value,
        root: &str,
        tag: &str,
        page: Option<usize>,
        on: Option<&str>,
    ) -> (String, Option<image::RgbaImage>) {
        match self.try_draw(doc, root, tag, page, on).await {
            Ok(r) => r,
            Err(e) => {
                self.s = None; // Affinity closed / MCP off: reconnect next draw
                (format!("affinity: {e}"), None)
            }
        }
    }

    async fn try_draw(
        &mut self,
        doc: &Value,
        root: &str,
        tag: &str,
        page: Option<usize>,
        on: Option<&str>,
    ) -> Result<(String, Option<image::RgbaImage>)> {
        self.connect().await?;
        let script = format!(
            "const ASEMIC = {};\n{JS}",
            json!({
                "doc": doc,
                "root": root,
                "tag": tag,
                "page": page,
                "on": on,
            })
        );
        let log = text(&self.tool("execute_script", json!({"script": script})).await?).trim().to_string();
        let Some(uuid) = log.lines().find_map(|l| l.strip_prefix("asemic-grab: ")) else {
            return Ok((log, None));
        };
        let grab = self.tool("render_spread", json!({"document_session_uuid": uuid, "spread_index": 0})).await?;
        let data = match grab.first() {
            Some(RawContent::Image(i)) => i.data.clone(),
            Some(RawContent::Text(t)) => t.text.clone(),
            _ => return Ok((log, None)),
        };
        let b64 = data.rsplit(',').next().unwrap_or_default();
        let png = base64::engine::general_purpose::STANDARD.decode(b64)?;
        Ok((log.clone(), Some(image::load_from_memory(&png)?.to_rgba8())))
    }

    /// Page size (px) + the document's dpi: the marker box (if `on` is set), else the row's p0 artboard,
    /// else the first artboard, else the document size — the same box the renderer maps page units onto.
    /// `None` when no document is open / it isn't saved inside `root` / the query fails.
    pub async fn page_size(&mut self, root: &str, tag: &str, on: Option<&str>) -> Option<(f64, f64, f64)> {
        match self.try_page_size(root, tag, on).await {
            Ok(s) => s,
            Err(e) => {
                self.s = None; // Affinity closed / MCP off
                tracing::warn!("affinity: page size: {e}");
                None
            }
        }
    }

    async fn try_page_size(&mut self, root: &str, tag: &str, on: Option<&str>) -> Result<Option<(f64, f64, f64)>> {
        self.connect().await?;
        let script = format!(
            r#"const {{ Document }} = require('/document.js');
const doc = Document.current;
if (!doc || !String(doc.path || '').startsWith({root} + '/')) {{ console.log('asemic-size: none'); return; }}
const onName = {on};
let markerBox = null;
if (onName) {{
    const marker = [...doc.layers.all].find(n => String(n.userDescription) === onName);
    if (marker) markerBox = marker.exactSpreadBaseBox;
}}
const targetSpread = doc.currentSpread;
const spreadExtents = targetSpread?.getSpreadExtents ? targetSpread.getSpreadExtents({{ includeSpread: true }}) : null;
const boards = [...doc.layers.all].filter(n => n.isArtboardEnabled);
const tagged = boards.find(n => String(n.userDescription) === {tag} + ' p0');
const first = tagged || boards.find(n => !String(n.userDescription).startsWith({tag}));
const box = markerBox || spreadExtents || (first ? first.exactSpreadBaseBox : null);
const w = box ? box.width : doc.widthPixels;
const h = box ? box.height : doc.heightPixels;
console.log('asemic-size: ' + w + ' ' + h + ' ' + (doc.dpi || 96));"#,
            root = json!(root),
            tag = json!(tag),
            on = json!(on)
        );
        let log = text(&self.tool("execute_script", json!({"script": script})).await?).trim().to_string();
        Ok(log
            .lines()
            .find_map(|l| l.strip_prefix("asemic-size: "))
            .and_then(|s| {
                let v: Vec<&str> = s.trim().split_whitespace().collect();
                Some((v.first()?.parse::<f64>().ok()?, v.get(1)?.parse::<f64>().ok()?, v.get(2)?.parse::<f64>().ok()?))
            })
            .filter(|(w, h, _)| *w > 0.0 && *h > 0.0))
    }
}

fn text(c: &[RawContent]) -> String {
    c.iter().filter_map(|c| if let RawContent::Text(t) = c { Some(t.text.as_str()) } else { None }).collect()
}
