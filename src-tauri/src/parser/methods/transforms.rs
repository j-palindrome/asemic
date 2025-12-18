use super::expressions::ExpressionParser;
use serde::{Deserialize, Serialize};

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct BasicPt {
    pub x: f64,
    pub y: f64,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(untagged)]
pub enum NumOrFn {
    Num(f64),
    Fn(String), // Expression string to be evaluated
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Transform {
    #[serde(rename = "*")]
    pub scale: BasicPt,
    #[serde(rename = "+")]
    pub translate: BasicPt,
    #[serde(rename = "@")]
    pub rotation: f64,
    pub add: Option<String>,
    pub rotate: Option<String>,
    pub w: String,
    pub h: String,
    pub s: String,
    pub l: String,
    pub a: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
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
