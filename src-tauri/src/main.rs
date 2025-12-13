// Prevents additional console window on Windows in release, DO NOT REMOVE!!
#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

use serde::{Deserialize, Serialize};
use app_lib::parser::SceneMetadata;

// CodeMirror syntax tree node structure
#[derive(Debug, Clone, Serialize, Deserialize)]
struct SyntaxNode {
    name: String,
    from: usize,
    to: usize,
    #[serde(default)]
    children: Vec<SyntaxNode>,
}

#[derive(Debug, Serialize, Deserialize)]
struct ParserInput {
    source: String,
    tree: SyntaxNode,
}

#[derive(Debug, Serialize, Deserialize)]
struct ParserSetupResult {
    total_length: f64,
    scene_count: usize,
}

#[derive(Debug, Serialize, Deserialize)]
struct OscMessageStruct {
    name: String,
    value: f64,
}

#[derive(Debug, Serialize, Deserialize)]
struct SceneSettings {
    #[serde(default)]
    length: Option<f64>,
    #[serde(default)]
    offset: Option<f64>,
    #[serde(default)]
    pause: Option<f64>,
    #[serde(default)]
    params: Option<std::collections::HashMap<String, f64>>,
    #[serde(default)]
    osc: Option<Vec<OscMessageStruct>>,
}

#[derive(Debug, Serialize, Deserialize)]
struct DrawInput {
    progress: f64,
    scene_index: usize,
    scene_settings: SceneSettings,
}

#[derive(Debug, Serialize, Deserialize)]
struct DrawOutput {
    groups: Vec<Vec<[f64; 2]>>,
    errors: Vec<String>,
    progress: f64,
}

#[tauri::command]
async fn parser_eval_expression(
    expr: String,
    osc_address: String,
    osc_host: String,
    osc_port: u16,
    width: f64,
    height: f64,
    current_scene: usize,
    scene_metadata: Vec<SceneMetadata>,
) -> Result<f64, String> {
    // Create parser with dimensions
    let mut parser = app_lib::parser::ExpressionParser::with_dimensions(
        width,
        height,
    );
    
    // Set scene metadata if available
    if !scene_metadata.is_empty() {
        parser.set_current_scene(current_scene);
        parser.set_scene_metadata(scene_metadata);
    }
    
    // Evaluate expression
    let result = parser.expr(&expr)?;
    
    // Send OSC message
    parser.send_osc(&osc_address, result, &osc_host, osc_port)?;
    
    Ok(result)
}


#[derive(Debug, Serialize, Deserialize)]
pub struct ParsedJsonResult {
    pub success: bool,
    pub data: Option<serde_json::Value>,
    pub error: Option<String>,
    pub file_name: String,
    pub preview: Option<String>,
}

fn main() {
    tauri::Builder::default()
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_fs::init())
        .invoke_handler(tauri::generate_handler![
            parser_eval_expression,
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
