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

fn traverse_tree(node: &SyntaxNode, source: &str, depth: usize) {
    let indent = "  ".repeat(depth);
    let text = &source[node.from..node.to];
    println!("{}Node: {} [{}-{}]: {:?}", indent, node.name, node.from, node.to, text);
    
    for child in &node.children {
        traverse_tree(child, source, depth + 1);
    }
}

#[tauri::command]
async fn parser_setup(input: ParserInput) -> Result<ParserState, String> {
    println!("Received syntax tree with {} top-level children", input.tree.children.len());
    
    // Traverse the syntax tree
    traverse_tree(&input.tree, &input.source, 0);
    
    // TODO: Implement actual parser logic based on tree traversal
    Ok(ParserState {
        total_length: 0.0,
        scene_count: 0,
    })
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
