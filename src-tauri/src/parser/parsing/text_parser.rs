use crate::parser::methods::expressions::ExpressionParser;
use crate::parser::Tokenizer;
use crate::parser::{methods::asemic_pt::AsemicPt, TokenizeOptions};
use serde::{Deserialize, Serialize};

#[derive(Debug, Serialize, Deserialize, Clone)]
pub struct Group {
    pub points: Vec<Vec<AsemicPt>>,
    pub mode: String, // 'line' | 'fill' | 'blank'
    pub texture: Option<String>,
    pub a: Option<String>,
    pub synth: Option<String>,
    pub xy: Option<String>,
    pub wh: Option<String>,
    pub vert: String,
    pub curve: String, // 'true' | 'false'
    pub count: i32,
    pub correction: f64,
    pub close: Option<bool>,
    pub blend: Option<bool>,
}

/// Master parser for Asemic code
/// Holds all parsing state including groups, curves, and an expression parser
pub struct TextParser {
    /// Child expression parser for evaluating expressions
    pub expression_parser: ExpressionParser,

    /// Collection of curve groups organized by rendering mode
    pub groups: Vec<Group>,

    /// Current curve being built (before being added to a group)
    pub current_curve: Vec<AsemicPt>,

    /// Point accumulation counter (for curve point distribution)
    pub adding: f64,

    /// Error messages accumulated during parsing
    pub errors: Vec<String>,

    /// Last point parsed (for reference in point expressions)
    pub last_point: Option<AsemicPt>,

    pub tokenizer: Tokenizer,
}

/// Noise state for stateful functions
#[derive(Debug, Clone)]
pub enum NoiseValue {
    SampleAndHold { value: f64, sampling: bool },
    FmSynthesis { phase: f64 },
}

impl TextParser {
    /// Create a new TextParser with default settings
    pub fn new() -> Self {
        TextParser {
            expression_parser: ExpressionParser::new(),
            groups: Vec::new(),
            current_curve: Vec::new(),
            adding: 0.0,
            errors: Vec::new(),
            last_point: None,
            tokenizer: Tokenizer::new(),
        }
    }

    /// Reset parser state for a new frame/scene
    pub fn reset(&mut self, new_frame: bool) {
        if new_frame {
            self.groups.clear();
            self.errors.clear();
        }

        self.current_curve.clear();
        self.adding = 0.0;

        self.last_point = None;
    }

    /// Finalize current curve and add to groups
    ///
    /// # Arguments
    /// * `close` - Whether to close the curve by connecting last point to first
    pub fn end_curve(&mut self, close: bool) -> Result<(), String> {
        if self.current_curve.len() < 2 {
            return Err("Cannot end a curve with less than 2 points".to_string());
        }

        if close && !self.current_curve.is_empty() {
            if let Some(first) = self.current_curve.first() {
                self.current_curve.push(*first);
            }
        }

        // Add curve to groups (default to single group)
        if self.groups.is_empty() {
            let mut new_points = Vec::new();
            new_points.push(Vec::new());
            self.groups.push(Group {
                points: new_points,
                mode: "line".to_string(),
                texture: None,
                a: None,
                synth: None,
                xy: None,
                wh: None,
                vert: "0,0".to_string(),
                curve: "true".to_string(),
                count: 100,
                correction: 0.0,
                close: Some(false),
                blend: None,
            });
        }

        if let Some(group) = self.groups.last_mut() {
            if group.points.is_empty() {
                return Err("No curves in the last group".to_string());
            }

            if let Some(last_curve) = group.points.last_mut() {
                last_curve.extend(self.current_curve.drain(..));
                if let Some(point) = last_curve.last() {
                    self.last_point = Some(*point);
                }
                return Ok(());
            }
        }

        self.adding = 0.0;
        println!("Ended curve with {} points", self.current_curve.len());
        Ok(())
    }

    /// Add a point to the current curve
    pub fn add_point(&mut self, point: AsemicPt) {
        self.current_curve.push(point);
        self.last_point = Some(point);
    }

    /// Record an error message
    pub fn error(&mut self, message: String) {
        if !self.errors.contains(&message) {
            self.errors.push(message);
        }
    }

    /// Get the total number of curves across all groups
    pub fn total_curves(&self) -> usize {
        self.groups.iter().map(|g| g.points.len()).sum()
    }
}

impl Default for TextParser {
    fn default() -> Self {
        Self::new()
    }
}
