// Module organization mirroring TypeScript structure
pub mod core {
    pub mod asemic_group;
    pub mod output;
    pub mod utilities;
}

pub mod methods {
    pub mod data;
    pub mod drawing;
    pub mod expressions;
    pub mod osc;
    pub mod parsing;
    pub mod scenes;
    pub mod text;
    pub mod transforms;
    pub mod utilities;
}

pub mod types;

use serde::{Deserialize, Serialize};
use std::collections::HashMap;

// Core Parser struct
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Parser {
    raw_source: String,
    presets: HashMap<String, serde_json::Value>,
    mode: ParserMode,
    groups: Vec<AsemicGroup>,
    settings: Settings,
    current_transform: Transform,
    transform_stack: Vec<Transform>,
    named_transforms: HashMap<String, Transform>,
    total_length: f64,
    pause_at: Option<String>,
    scene_list: Vec<Scene>,
    progress: Progress,
    fonts: HashMap<String, AsemicFont>,
    noise_table: HashMap<String, NoiseEntry>,
    images: HashMap<String, Vec<ImageData>>,
    // Method instances would be separate structs
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub enum ParserMode {
    Normal,
    Blank,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Progress {
    current_line: String,
    noise_index: usize,
    point: usize,
    time: f64,
    curve: usize,
    seeds: Vec<f64>,
    indexes: Vec<usize>,
    count_nums: Vec<usize>,
    scrub: f64,
    scrub_time: f64,
    progress: f64,
    scene: usize,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Scene {
    start: f64,
    length: f64,
    pause: Option<f64>,
    offset: f64,
    is_setup: bool,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Transform {
    h: f64,
    w: f64,
    a: f64,
    s: f64,
    l: f64,
    // ...other transform properties
}

impl Parser {
    pub fn new() -> Self {
        // Initialize with default values
        Self {
            raw_source: String::new(),
            presets: HashMap::new(),
            mode: ParserMode::Normal,
            groups: Vec::new(),
            settings: Settings::default(),
            current_transform: Transform::default(),
            transform_stack: Vec::new(),
            named_transforms: HashMap::new(),
            total_length: 0.0,
            pause_at: None,
            scene_list: Vec::new(),
            progress: Progress::default(),
            fonts: HashMap::new(),
            noise_table: HashMap::new(),
            images: HashMap::new(),
        }
    }

    pub fn setup(&mut self, source: String) -> Result<(), String> {
        // Parse source and setup scenes
        self.raw_source = source;
        // Initialize seeds
        // Parse text
        // Reset noise table
        Ok(())
    }

    pub fn draw(&mut self) -> Result<Output, String> {
        // Main drawing loop
        self.reset(true)?;
        
        for (i, scene) in self.scene_list.iter().enumerate() {
            if self.progress.progress >= scene.start 
                && self.progress.progress < scene.start + scene.length {
                self.progress.scene = i;
                // Execute scene drawing
            }
        }
        
        Ok(Output::default())
    }

    fn reset(&mut self, new_frame: bool) -> Result<(), String> {
        if new_frame {
            self.groups.clear();
            self.progress.time = current_time();
            // Update progress
        }
        // Reset transforms and state
        Ok(())
    }

    // Expression evaluation
    pub fn eval_expression(&self, expr: &str) -> Result<f64, String> {
        // Parse and evaluate mathematical expressions
        // Handle constants, functions, operators
        Ok(0.0)
    }
}

// Tauri command functions
#[tauri::command]
pub async fn parser_setup(source: String) -> Result<ParserState, String> {
    let mut parser = Parser::new();
    parser.setup(source)?;
    Ok(ParserState {
        total_length: parser.total_length,
        scene_count: parser.scene_list.len(),
    })
}

#[tauri::command]
pub async fn parser_draw(progress: f64) -> Result<DrawOutput, String> {
    // Global parser instance would need state management
    // Could use Tauri's State management or Arc<Mutex<Parser>>
    Ok(DrawOutput::default())
}

#[tauri::command]
pub async fn parser_eval_expression(expr: String) -> Result<f64, String> {
    let parser = Parser::new();
    parser.eval_expression(&expr)
}

#[derive(Debug, Serialize, Deserialize)]
pub struct ParserState {
    total_length: f64,
    scene_count: usize,
}

#[derive(Debug, Serialize, Deserialize)]
pub struct DrawOutput {
    groups: Vec<Vec<Point>>,
    errors: Vec<String>,
    progress: f64,
}
