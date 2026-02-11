use super::expressions::ExpressionParser;
use crate::parser::methods::{
    asemic_pt::{AsemicPt, BasicPt},
    expression_eval::ExpressionEval,
};

#[derive(Debug, Clone)]
pub struct Transform {
    pub scale: BasicPt,
    pub translate: BasicPt,
    pub rotation: f64,
    pub add: Option<String>,
    pub rotate: Option<String>,
    pub w: String,
    pub h: String,
    pub s: String,
    pub l: String,
    pub a: String,
    pub attrs: [String; 4],
    pub constants: std::collections::HashMap<String, String>,
}

#[derive(Debug, Clone)]
pub struct SolvedTransform {
    pub scale: BasicPt,
    pub translate: BasicPt,
    pub rotation: f64,
    pub add: Option<String>,
    pub rotate: Option<String>,
    pub w: f64,
    pub h: f64,
    pub s: f64,
    pub l: f64,
    pub a: f64,
    pub attrs: [f64; 4],
}

impl Transform {
    pub fn new() -> Self {
        Self {
            scale: BasicPt { x: 1.0, y: 1.0 },
            translate: BasicPt { x: 0.0, y: 0.0 },
            rotation: 0.0,
            add: None,
            rotate: None,
            w: "px".to_string(),
            h: "1.0".to_string(),
            s: "0.0".to_string(),
            l: "1.0".to_string(),
            a: "1.0".to_string(),
            attrs: [
                "0.0".to_string(),
                "0.0".to_string(),
                "0.0".to_string(),
                "0.0".to_string(),
            ],
            constants: std::collections::HashMap::new(),
        }
    }

    pub fn apply_transform(
        &self,
        point: &mut BasicPt,
        randomize: bool,
        parser: &mut ExpressionParser,
        relative: Option<bool>,
    ) -> Result<AsemicPt, String> {
        // Scale the point
        let mut basic_pt = point.clone();
        basic_pt.scale(
            super::asemic_pt::BasicPt::new(self.scale.x, self.scale.y),
            None,
        );

        // Rotate the point
        basic_pt.rotate(self.rotation, None);

        // Apply rotate transform if present and randomize is true
        if let Some(ref rotate_expr) = self.rotate {
            if randomize {
                let rotation_amount = parser.expr(rotate_expr)?;
                basic_pt.rotate(rotation_amount, None);
            }
        }

        // Apply add transform if present and randomize is true
        if let Some(ref add_expr) = self.add {
            if randomize {
                // Note: evalPoint is not yet implemented in Rust parser
                // This would need to be added to ExpressionParser
                return Err("evalPoint not yet implemented in Rust parser".to_string());
            }
        }

        // Apply translation
        // Note: relative parameter handling would need to be added
        if relative != Some(true) {
            basic_pt.add(super::asemic_pt::BasicPt::new(
                self.translate.x,
                self.translate.y,
            ));
        }

        let this_transform = self.solve(parser)?;

        Ok(AsemicPt::new(
            basic_pt.x,
            basic_pt.y,
            this_transform.w,
            this_transform.h,
            this_transform.s,
            this_transform.l,
            this_transform.a,
            this_transform.attrs,
        ))
    }

    pub fn solve(&self, parser: &mut ExpressionParser) -> Result<SolvedTransform, String> {
        // Use parser to evaluate expressions, falling back to parse_or_default on error
        let w = parser
            .expr(&self.w)
            .ok()
            .and_then(|v| if v.is_nan() { None } else { Some(v) })
            .unwrap_or_else(|| parse_or_default(&self.w, 1.0));
        let h = parser
            .expr(&self.h)
            .ok()
            .and_then(|v| if v.is_nan() { None } else { Some(v) })
            .unwrap_or_else(|| parse_or_default(&self.h, 1.0));
        let s = parser
            .expr(&self.s)
            .ok()
            .and_then(|v| if v.is_nan() { None } else { Some(v) })
            .unwrap_or_else(|| parse_or_default(&self.s, 1.0));
        let l = parser
            .expr(&self.l)
            .ok()
            .and_then(|v| if v.is_nan() { None } else { Some(v) })
            .unwrap_or_else(|| parse_or_default(&self.l, 1.0));
        let a = parser
            .expr(&self.a)
            .ok()
            .and_then(|v| if v.is_nan() { None } else { Some(v) })
            .unwrap_or_else(|| parse_or_default(&self.a, 0.0));

        Ok(SolvedTransform {
            scale: self.scale.clone(),
            translate: self.translate.clone(),
            rotation: self.rotation,
            add: self.add.clone(),
            rotate: self.rotate.clone(),
            w,
            h,
            s,
            l,
            a,
            attrs: [
                parse_or_default(&self.attrs[0], 0.0),
                parse_or_default(&self.attrs[1], 0.0),
                parse_or_default(&self.attrs[2], 0.0),
                parse_or_default(&self.attrs[3], 0.0),
            ],
        })
    }
}

impl Default for Transform {
    fn default() -> Self {
        Self::new()
    }
}

fn parse_or_default(s: &str, default: f64) -> f64 {
    s.parse::<f64>().unwrap_or(default)
}

pub trait Transforms {
    fn push_transform(&mut self);
    fn pop_transform(&mut self) -> Option<Transform>;
    fn peek_transform(&mut self) -> Transform;
    fn modify_transform<F>(&mut self, f: F) -> Result<(), String>
    where
        F: FnOnce(&mut Transform);
}

impl Transforms for ExpressionParser {
    fn push_transform(&mut self) {
        let transform = self.peek_transform();
        self.transforms.push(transform);
    }

    fn pop_transform(&mut self) -> Option<Transform> {
        let pop = self.transforms.pop();
        if self.transforms.is_empty() {
            self.transforms.push(Transform::new());
        }
        pop
    }

    fn peek_transform(&mut self) -> Transform {
        self.transforms.last_mut().cloned().unwrap_or_default()
    }

    fn modify_transform<F>(&mut self, f: F) -> Result<(), String>
    where
        F: FnOnce(&mut Transform),
    {
        self.transforms
            .last_mut()
            .ok_or("modify_transform: No transform in stack".to_string())
            .map(|transform| f(transform))
    }
}
