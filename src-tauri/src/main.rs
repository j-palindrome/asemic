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

struct RustParser {
    source: String,
    tree: SyntaxNode,
    total_length: f64,
    scene_count: usize,
    #[allow(dead_code)]
    errors: Vec<String>,
}

impl RustParser {
    fn new(input: ParserInput) -> Self {
        Self {
            source: input.source,
            tree: input.tree,
            total_length: 0.0,
            scene_count: 0,
            errors: Vec::new(),
        }
    }

    fn parse(&mut self) -> Result<ParserSetupResult, String> {
        println!("\n=== Syntax Tree ===");
        println!("Root: {} [{}-{}]", self.tree.name, self.tree.from, self.tree.to);
        
        // Traverse and parse the syntax tree
        self.traverse_node(&self.tree.clone(), 0)?;
        
        println!("=== End Syntax Tree ===\n");
        
        Ok(ParserSetupResult {
            total_length: self.total_length,
            scene_count: self.scene_count,
        })
    }

    fn traverse_node(&mut self, node: &SyntaxNode, depth: usize) -> Result<(), String> {
        let indent = "  ".repeat(depth);
        let text = &self.source[node.from..node.to];
        
        // Enhanced logging with more details
        println!(
            "{}├─ {} [{}-{}] (len: {}) text: {:?}", 
            indent, 
            node.name, 
            node.from, 
            node.to,
            node.to - node.from,
            if text.len() > 50 { 
                format!("{}...", &text[..50]) 
            } else { 
                text.to_string() 
            }
        );
        
        // TODO: Handle different node types based on node.name
        match node.name.as_str() {
            "Scene" => {
                self.scene_count += 1;
                println!("{}   └─ Found scene #{}", indent, self.scene_count);
                // TODO: Parse scene length
            }
            "Command" => {
                println!("{}   └─ Found command: {:?}", indent, text);
                // TODO: Parse commands
            }
            "Expression" => {
                println!("{}   └─ Found expression: {:?}", indent, text);
                // TODO: Parse expressions
            }
            _ => {}
        }
        
        // Recursively traverse children
        for child in &node.children {
            self.traverse_node(child, depth + 1)?;
        }
        
        Ok(())
    }
}

#[tauri::command]
async fn parser_setup(input: ParserInput) -> Result<ParserSetupResult, String> {
    // println!("\n{}", "=".repeat(60));
    println!("RUST PARSER INVOKED");
    println!("{}", "=".repeat(60));
    println!("Source length: {} characters", input.source.len());
    println!("Tree root: {} with {} children", input.tree.name, input.tree.children.len());
    println!("{}\n", "=".repeat(60));
    
    let mut parser = RustParser::new(input);
    let result = parser.parse()?;
    
    println!("\n{}", "=".repeat(60));
    println!("PARSER RESULT");
    println!("{}", "=".repeat(60));
    println!("Total length: {}", result.total_length);
    println!("Scene count: {}", result.scene_count);
    println!("{}\n", "=".repeat(60));
    
    Ok(result)
}

#[tauri::command]
async fn parser_draw(input: DrawInput) -> Result<DrawOutput, String> {
    println!("\n=== PARSER DRAW FRAME ===");
    println!("Progress: {}", input.progress);
    println!("Scene index: {}", input.scene_index);
    println!("Scene settings: {:?}", input.scene_settings);
    
    // Send OSC messages if any are defined
    if let Some(osc_messages) = &input.scene_settings.osc {
        println!("\n📡 OSC Messages to send:");
        for msg in osc_messages {
            println!("  {} -> {}", msg.name, msg.value);
            // TODO: Actually send OSC messages here
            // This would require integrating an OSC library
        }
    }
    
    println!("=== END FRAME ===\n");
    
    // TODO: Implement actual drawing logic
    // For now, just return empty output
    Ok(DrawOutput {
        groups: vec![],
        errors: vec![],
        progress: input.progress,
    })
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
pub struct JsonFileData {
    pub content: String,
    pub file_name: String,
}

#[tauri::command]
async fn load_json_file(file_path: String) -> Result<JsonFileData, String> {
    use std::fs;
    use std::path::Path;

    let path = Path::new(&file_path);
    
    // Verify the file exists and is a JSON file
    if !path.exists() {
        return Err(format!("File not found: {}", file_path));
    }

    if let Some(ext) = path.extension() {
        if ext.to_string_lossy() != "json" {
            return Err(format!("File must be a JSON file, got: {:?}", ext));
        }
    } else {
        return Err("File has no extension".to_string());
    }

    // Read the file content
    let content = fs::read_to_string(&path)
        .map_err(|e| format!("Failed to read file: {}", e))?;

    // Validate JSON
    serde_json::from_str::<serde_json::Value>(&content)
        .map_err(|e| format!("Invalid JSON: {}", e))?;

    // Get file name
    let file_name = path
        .file_name()
        .and_then(|n| n.to_str())
        .unwrap_or("unknown.json")
        .to_string();

    Ok(JsonFileData { content, file_name })
}

#[derive(Debug, Serialize, Deserialize)]
pub struct ParsedJsonResult {
    pub success: bool,
    pub data: Option<serde_json::Value>,
    pub error: Option<String>,
    pub file_name: String,
    pub preview: Option<String>,
}

#[tauri::command]
fn parse_json_file(json_content: String, file_name: String) -> ParsedJsonResult {
    match serde_json::from_str::<serde_json::Value>(&json_content) {
        Ok(data) => {
            let preview = match &data {
                serde_json::Value::Array(arr) => {
                    Some(format!("Array with {} elements", arr.len()))
                }
                serde_json::Value::Object(obj) => {
                    let keys: Vec<_> = obj.keys().take(5).cloned().collect();
                    Some(format!("Object with keys: {}", keys.join(", ")))
                }
                _ => Some(format!("Value: {:?}", data)),
            };

            ParsedJsonResult {
                success: true,
                data: Some(data),
                error: None,
                file_name,
                preview,
            }
        }
        Err(e) => ParsedJsonResult {
            success: false,
            data: None,
            error: Some(format!("JSON parsing error: {}", e)),
            file_name,
            preview: None,
        },
    }
}

#[tauri::command]
async fn save_json_file(file_path: String, json_content: String) -> Result<String, String> {
    use std::fs;

    // Validate JSON before saving
    serde_json::from_str::<serde_json::Value>(&json_content)
        .map_err(|e| format!("Invalid JSON: {}", e))?;

    // Write to file
    fs::write(&file_path, json_content)
        .map_err(|e| format!("Failed to save file: {}", e))?;

    Ok(format!("File saved: {}", file_path))
}

fn main() {
    tauri::Builder::default()
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_fs::init())
        .invoke_handler(tauri::generate_handler![
            parser_setup,
            parser_draw,
            parser_eval_expression,
            load_json_file,
            parse_json_file,
            save_json_file,
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
