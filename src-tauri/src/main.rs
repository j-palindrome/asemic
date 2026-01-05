// Prevents additional console window on Windows in release, DO NOT REMOVE!!
#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

use app_lib::parser::{
    parsing::text::TextMethods, ExpressionEval, ParseSourceResult, SceneMetadata, TextParser,
};
use serde::{Deserialize, Serialize};

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
    scene_metadata: SceneMetadata,
) -> Result<Vec<f64>, String> {
    // Create parser with dimensions
    let mut parser = app_lib::parser::ExpressionParser::new();

    if let Some(param) = scene_metadata.params.get(&expr) {
        parser.send_osc(&osc_address, param.to_vec(), &osc_host, osc_port)?;
        return Ok(param.clone());
    }

    // Set scene metadata if available
    parser.set_scene_metadata(scene_metadata);

    if expr.contains(",") {
        let results = parser.expr_list(&expr)?;
        parser.send_osc(&osc_address, results.clone(), &osc_host, osc_port)?;
        return Ok(results);
    }

    // Evaluate expression
    let result = parser.expr(&expr)?;
    // println!("Evaluated expression '{}' to {:?}", expr, result);

    // Send OSC message

    parser.send_osc(&osc_address, vec![result], &osc_host, osc_port)?;

    Ok(vec![result])
}

// Tauri command for parsing and evaluating Asemic source code
#[tauri::command]
async fn parse_asemic_source(
    source: String,
    metadata: SceneMetadata,
) -> Result<ParseSourceResult, String> {
    let mut parser = TextParser::new();

    // Load the default font
    parser.load_default_font()?;
    parser.expression_parser.set_scene_metadata(metadata);

    // Parse the source code
    parser.text(&source)?;

    Ok(ParseSourceResult {
        groups: parser.groups.clone(),
        errors: parser.errors.clone(),
    })
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
            parse_asemic_source
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
