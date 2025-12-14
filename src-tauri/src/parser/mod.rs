// Module organization mirroring TypeScript structure
// pub mod core {
//     pub mod asemic_group;
//     pub mod output;
//     pub mod utilities;
// }

pub mod methods {
    // pub mod data;
    // pub mod drawing;
    pub mod expressions;
    // pub mod osc;
    // pub mod parsing;
    // pub mod scenes;
    // pub mod text;
    // pub mod transforms;
    // pub mod utilities;
}

// pub mod types;

// Re-export the expression parser for easy access
pub use methods::expressions::ExpressionParser;
pub use methods::expressions::SceneMetadata;

use serde::{Deserialize, Serialize};
// use std::collections::HashMap;

// Tauri command for evaluating Asemic expressions
#[tauri::command]
pub async fn eval_asemic_expression(expr: String) -> Result<f64, String> {
    let mut parser = ExpressionParser::new();
    parser.expr(&expr)
}

#[derive(Debug, Serialize, Deserialize)]
pub struct ExpressionResult {
    value: f64,
}