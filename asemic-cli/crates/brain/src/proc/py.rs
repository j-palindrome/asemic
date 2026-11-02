//! `py` proc: a Python fn registered in the REPL frontend (`@proc(id, "py")`). The brain owns
//! timing and inputs: when params or the `input` gen's multiarray change (or on COOK / re-
//! registration) it emits one call = a query on `asemic/py/<id>` ({params, seed, input: {attrs,
//! lines}|null}); the frontend's queryable replies ASP1. Every frame publishes the cached last
//! reply (no per-frame round trip); at most one call is in flight, the newest pending one goes
//! out on reply. No reply (no queryable yet) = idle until the fn registers (event, !retry timer).

use asemic_schema::Multi;
use serde_json::{Value, json};

use crate::node::{Channels, Gen, Params};

pub struct Py {
    seed: u32,
    input: Option<Multi>,
    /// last call sent
    sent: Option<Value>,
    /// a call is awaiting its reply
    flight: bool,
    out: Multi,
    replies: u32,
    params: Params,
}

impl Py {
    pub fn new(seed: u32) -> Self {
        Self { seed, input: None, sent: None, flight: false, out: Multi::new(&[]), replies: 0, params: Params::new() }
    }

    fn call(&self, p: &Params) -> Value {
        let input = self.input.as_ref().map(|m| {
            let d = m.stride().max(1);
            json!({"attrs": m.attrs, "lines": m.lines.iter()
                .map(|l| l.chunks(d).map(<[f32]>::to_vec).collect::<Vec<_>>()).collect::<Vec<_>>()})
        });
        json!({"params": p, "seed": self.seed, "input": input})
    }
}

impl Gen for Py {
    fn step(&mut self, _dt: f64, p: &Params) -> Channels {
        self.params = p.clone();
        let mut ch = Channels::new();
        ch.insert("replies", self.replies as f64);
        ch
    }

    fn feed_points(&mut self, m: &Multi) {
        self.input = Some(m.clone());
    }

    fn request(&mut self) -> Option<Value> {
        let call = self.call(&self.params);
        if self.flight || self.sent.as_ref() == Some(&call) {
            return None;
        }
        self.flight = true;
        self.sent = Some(call.clone());
        Some(call)
    }

    fn reply(&mut self, b: &[u8]) {
        if let Some((_, m)) = Multi::decode(b) {
            self.out = m;
            self.replies += 1;
        }
        self.flight = false;
    }

    fn rerun(&mut self) {
        self.sent = None;
    }

    fn points(&self) -> Option<Multi> {
        // nothing until the first reply (no empty frame ahead of Python)
        (self.replies > 0).then(|| self.out.clone())
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn one_call_in_flight_then_cached() {
        let mut g = Py::new(7);
        let mut p = Params::new();
        p.insert("n".into(), 3.0);
        assert!({ g.step(0.0, &p); g.request() }.is_some(), "first frame calls");
        assert!({ g.step(0.0, &p); g.request() }.is_none(), "in flight: no second call");
        let m = Multi::from_xy([[[0.1f32, 0.2], [0.3, 0.4]]]);
        g.reply(&m.encode(0));
        assert_eq!(g.points().unwrap().lines, m.lines);
        assert!({ g.step(0.0, &p); g.request() }.is_none(), "unchanged: cached, no call");
        p.insert("n".into(), 4.0);
        assert_eq!({ g.step(0.0, &p); g.request() }.unwrap()["params"]["n"], 4.0);
        g.reply(&m.encode(1));
        g.feed_points(&m);
        assert!({ g.step(0.0, &p); g.request() }.unwrap()["input"]["lines"][0][1][0].as_f64().unwrap() > 0.29);
    }
}
