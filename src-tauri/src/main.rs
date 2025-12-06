// Prevents additional console window on Windows in release, DO NOT REMOVE!!
#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

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
struct ParserState {
    total_length: f64,
    scene_count: usize,
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

    fn parse(&mut self) -> Result<ParserState, String> {
        println!("\n=== Syntax Tree ===");
        println!("Root: {} [{}-{}]", self.tree.name, self.tree.from, self.tree.to);
        
        // Traverse and parse the syntax tree
        self.traverse_node(&self.tree.clone(), 0)?;
        
        println!("=== End Syntax Tree ===\n");
        
        Ok(ParserState {
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
async fn parser_setup(input: ParserInput) -> Result<ParserState, String> {
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
async fn parser_draw(progress: f64) -> Result<DrawOutput, String> {
    // TODO: Implement parser draw
    Ok(DrawOutput {
        groups: vec![],
        errors: vec![],
        progress: 0.0,
    })
}

#[tauri::command]
async fn parser_eval_expression(expr: String) -> Result<f64, String> {
    // TODO: Implement expression evaluation
    println!("Evaluating expression: {}", expr);
    Ok(0.0)
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
