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

fn main() {
    tauri::Builder::default()
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_fs::init())
        .invoke_handler(tauri::generate_handler![
            parser_setup,
            parser_draw,
            parser_eval_expression,
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
