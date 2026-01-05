use crate::parser::fonts::fonts::AsemicFont;
use crate::parser::methods::expressions::ExpressionParser;
use crate::parser::Tokenizer;
use crate::parser::{methods::asemic_pt::AsemicPt, TokenizeOptions};
use serde::{Deserialize, Serialize};
use std::collections::HashMap;

#[derive(Debug, Serialize, Deserialize, Clone)]
pub struct GroupSettings {
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

#[derive(Debug, Serialize, Deserialize, Clone)]
pub struct Group {
    pub points: Vec<Vec<AsemicPt>>,
    pub settings: GroupSettings,
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

    /// Font definitions for character rendering
    pub fonts: HashMap<String, AsemicFont>,

    /// Currently active font
    pub current_font: String,

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
            fonts: HashMap::new(),
            current_font: "default".to_string(),
            tokenizer: Tokenizer::new(),
        }
    }

    /// Load the default font from embedded asset
    pub fn load_default_font(&mut self) -> Result<(), String> {
        let default_font_data = include_str!("../../parser/fonts/defaultFont.asemic");
        self.parse_font("default", default_font_data)?;

        Ok(())
    }

    /// Reset parser state for a new frame/scene
    pub fn reset(&mut self, new_frame: bool) {
        if new_frame {
            self.groups.clear();
            self.errors.clear();
            self.current_font = "default".to_string();
        }

        self.current_curve.clear();
        self.adding = 0.0;
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
            self.groups.push(Group {
                points: new_points,
                settings: GroupSettings {
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
                },
            });
        }

        if let Some(group) = self.groups.last_mut() {
            group.points.push(self.current_curve.clone());
            self.current_curve.clear();

            return Ok(());
        }

        self.adding = 0.0;
        println!("Ended curve with {} points", self.current_curve.len());
        Ok(())
    }

    /// Add a point to the current curve
    pub fn add_point(&mut self, point: AsemicPt) {
        self.current_curve.push(point);
    }

    /// Parse a font definition from text content
    /// Parses character definitions in the format: char = drawing_code or char => drawing_code
    /// Handles pipe-delimited character definitions like: | a = [0 0 1 1] | b => [1 0] |
    ///
    /// # Arguments
    /// * `font_name` - Name of the font
    /// * `content` - Font definition content with pipe-delimited character definitions
    pub fn parse_font(&mut self, font_name: &str, content: &str) -> Result<(), String> {
        // Store the font name as current
        self.current_font = font_name.to_string();

        // Parse pipe-delimited character definitions
        let char_tokens: Vec<&str> = content.split('|').collect();
        let mut chars: HashMap<String, String> = HashMap::new();
        let mut dynamic_chars: HashMap<String, String> = HashMap::new();

        for token in char_tokens {
            let token = token.trim();
            if token.is_empty() {
                continue;
            }

            // Skip reset marker
            if token == "!" {
                // Reset logic would go here if needed
                continue;
            }

            // Parse character definition: "char = code" or "char => code"
            if let Some(eq_pos) = token.find('=') {
                let char_name = token[..eq_pos].trim().to_string();
                let is_dynamic = token[..eq_pos + 1].ends_with("=>");
                let code = if is_dynamic {
                    token[eq_pos + 2..].trim().to_string()
                } else {
                    token[eq_pos + 1..].trim().to_string()
                };

                if char_name.is_empty() {
                    return Err(format!("parse_font: Empty character name in {}", token));
                }

                if code.is_empty() {
                    return Err(format!(
                        "parse_font: Empty code for character '{}'",
                        char_name
                    ));
                }

                if is_dynamic {
                    dynamic_chars.insert(char_name, code);
                } else {
                    chars.insert(char_name, code);
                }
            } else if !token.is_empty() && token != "!" {
                return Err(format!(
                    "parse_font: Invalid character definition: {}",
                    token
                ));
            }
        }

        // Create and store the font
        let font = AsemicFont::new(chars, dynamic_chars);
        self.fonts.insert(font_name.to_string(), font);

        Ok(())
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
