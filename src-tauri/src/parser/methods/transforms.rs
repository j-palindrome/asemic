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
}

impl Transform {
    pub fn new() -> Self {
        Self {
            scale: BasicPt { x: 1.0, y: 1.0 },
            translate: BasicPt { x: 0.0, y: 0.0 },
            rotation: 0.0,
            add: None,
            rotate: None,
            w: "1.0".to_string(),
            h: "1.0".to_string(),
            s: "1.0".to_string(),
            l: "1.0".to_string(),
            a: "0.0".to_string(),
        }
    }

    pub fn apply_transform(
        &self,
        point: &mut BasicPt,
        randomize: bool,
        parser: &mut ExpressionParser,
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
        basic_pt.add(super::asemic_pt::BasicPt::new(
            self.translate.x,
            self.translate.y,
        ));

        let this_transform = self.solve(parser)?;

        Ok(AsemicPt::new(
            basic_pt.x,
            basic_pt.y,
            this_transform.w,
            this_transform.h,
            this_transform.s,
            this_transform.l,
            this_transform.a,
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
    fn push_transform(&mut self, transform: Transform);
    fn pop_transform(&mut self) -> Option<Transform>;
    fn peek_transform(&self) -> Option<&Transform>;
}

impl Transforms for ExpressionParser {
    fn push_transform(&mut self, transform: Transform) {
        if !self.transforms.iter().any(|t| std::ptr::eq(t, &transform)) {
            self.transforms.push(transform);
        }
    }

    fn pop_transform(&mut self) -> Option<Transform> {
        self.transforms.pop()
    }

    fn peek_transform(&self) -> Option<&Transform> {
        self.transforms.last()
    }
}
