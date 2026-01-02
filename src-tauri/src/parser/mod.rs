// Module organization mirroring TypeScript structure
// pub mod core {
//     pub mod asemic_group;
//     pub mod output;
//     pub mod utilities;
// }

pub mod methods {
    pub mod asemic_pt;
    pub mod expression_eval;
    pub mod expressions;
    pub mod tests;
    pub mod transforms;
}

pub mod parsing {
    pub mod drawing;
    pub mod text;
    pub mod text_parser;
    pub mod tokenizer;
    pub mod utilities;
}

// pub mod types;

// Re-export the expression parser for easy access
pub use methods::expression_eval::ExpressionEval;
pub use methods::expressions::ExpressionParser;
pub use methods::expressions::SceneMetadata;
pub use parsing::text_parser::TextParser;
pub use parsing::tokenizer::{CacheStats, TokenizeOptions, Tokenizer};

use serde::{Deserialize, Serialize};

use crate::parser::methods::asemic_pt::AsemicPt;
use crate::parser::parsing::text_parser::Group;
// use std::collections::HashMap;

#[derive(Debug, Serialize, Deserialize)]
pub struct ExpressionResult {
    value: f64,
}

#[derive(Debug, Serialize, Deserialize)]
pub struct ParseSourceResult {
    pub groups: Vec<Group>,
    pub errors: Vec<String>,
}
