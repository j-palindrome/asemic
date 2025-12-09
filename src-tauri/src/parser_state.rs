use std::sync::Mutex;
use serde::{Deserialize, Serialize};

/// Shared parser state accessible across the application
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ParserState {
    pub time: f64,
    pub scrub: f64,
    pub width: f64,
    pub height: f64,
    pub scene: usize,
    pub total_length: f64,
}

impl Default for ParserState {
    fn default() -> Self {
        Self {
            time: 0.0,
            scrub: 0.0,
            width: 1920.0,
            height: 1080.0,
            scene: 0,
            total_length: 0.0,
        }
    }
}

/// Thread-safe wrapper for parser state
pub struct AppState {
    pub parser_state: Mutex<ParserState>,
}

impl AppState {
    pub fn new() -> Self {
        Self {
            parser_state: Mutex::new(ParserState::default()),
        }
    }
}

impl Default for AppState {
    fn default() -> Self {
        Self::new()
    }
}
