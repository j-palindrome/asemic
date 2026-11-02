//! Trait & type aliases for nodes / signal generators in the brain.

use std::collections::BTreeMap;

pub type Channels = BTreeMap<&'static str, f64>;
pub type Params = BTreeMap<String, f64>;

pub trait Gen: Send {
    fn step(&mut self, dt: f64, p: &Params) -> Channels;
    /// Input samples (processors with an `input`).
    fn feed(&mut self, _samples: &[f32]) {}
    /// Point multiarray of the gen this processor reads (`input` = `asemic/gen/<id>`).
    fn feed_points(&mut self, _m: &asemic_schema::Multi) {}
    /// Point multiarray for `asemic/gen/<id>` (processors).
    fn points(&self) -> Option<asemic_schema::Multi> {
        None
    }
    /// Pending call for an external evaluator (`py`): JSON query on `asemic/py/<id>`.
    fn request(&mut self) -> Option<serde_json::Value> {
        None
    }
    /// External evaluator's reply (ASP1 bytes from `asemic/py/<id>/out`).
    fn reply(&mut self, _b: &[u8]) {}
    /// COOK: the next frame calls again even when its inputs are unchanged.
    fn rerun(&mut self) {}
}
