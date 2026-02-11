use serde::{Deserialize, Serialize};
use std::f64::consts::PI;

/// Represents a 2D point with fast mutable operations
#[derive(Clone, Copy, Debug, Serialize, Deserialize)]
pub struct BasicPt {
    pub x: f64,
    pub y: f64,
}

impl BasicPt {
    pub fn new(x: f64, y: f64) -> Self {
        BasicPt { x, y }
    }

    pub fn from_tuple(pt: (f64, f64)) -> Self {
        BasicPt { x: pt.0, y: pt.1 }
    }

    pub fn add(&mut self, addition: BasicPt) -> &mut Self {
        self.x += addition.x;
        self.y += addition.y;
        self
    }

    pub fn magnitude(&self) -> f64 {
        (self.x * self.x + self.y * self.y).sqrt()
    }

    pub fn angle_0_to_1(&self) -> f64 {
        let angle = self.y.atan2(self.x);
        let normalized = if angle < 0.0 { PI * 2.0 + angle } else { angle };
        normalized / (PI * 2.0)
    }

    pub fn subtract(&mut self, point: BasicPt) -> &mut Self {
        self.x -= point.x;
        self.y -= point.y;
        self
    }

    pub fn rotate(&mut self, amount_0_to_1: f64, around: Option<BasicPt>) -> &mut Self {
        let theta = amount_0_to_1 * PI * 2.0;
        let cos = theta.cos();
        let sin = theta.sin();

        if let Some(center) = around {
            let dx = self.x - center.x;
            let dy = self.y - center.y;
            self.x = dx * cos - dy * sin + center.x;
            self.y = dx * sin + dy * cos + center.y;
        } else {
            let dx = self.x;
            let dy = self.y;
            self.x = dx * cos - dy * sin;
            self.y = dx * sin + dy * cos;
        }
        self
    }

    pub fn exponent(&mut self, exp: BasicPt) -> &mut Self {
        self.x = self.x.powf(exp.x);
        self.y = self.y.powf(exp.y);
        self
    }

    pub fn scale(&mut self, scale: BasicPt, center: Option<BasicPt>) -> &mut Self {
        if let Some(c) = center {
            self.x = c.x + (self.x - c.x) * scale.x;
            self.y = c.y + (self.y - c.y) * scale.y;
        } else {
            self.x *= scale.x;
            self.y *= scale.y;
        }
        self
    }

    pub fn divide(&mut self, divisor: BasicPt) -> &mut Self {
        self.x /= divisor.x;
        self.y /= divisor.y;
        self
    }

    pub fn one_over(&mut self) -> &mut Self {
        self.x = 1.0 / self.x;
        self.y = 1.0 / self.y;
        self
    }

    pub fn lerp(&mut self, target: BasicPt, t: f64) -> &mut Self {
        self.x += (target.x - self.x) * t;
        self.y += (target.y - self.y) * t;
        self
    }

    pub fn clone(&self) -> BasicPt {
        *self
    }

    pub fn to_tuple(&self) -> (f64, f64) {
        (self.x, self.y)
    }
}

/// Extended point with additional drawing properties (width, height, scale, line width, alpha)
#[derive(Clone, Copy, Debug, Serialize, Deserialize)]
pub struct AsemicPt {
    pub x: f64,
    pub y: f64,
    pub w: f64, // width
    pub h: f64, // height
    pub s: f64, // scale
    pub l: f64, // line width
    pub a: f64, // alpha
    pub attrs: [f64; 4],
}

impl AsemicPt {
    pub fn new(x: f64, y: f64, w: f64, h: f64, s: f64, l: f64, a: f64, attrs: [f64; 4]) -> Self {
        AsemicPt {
            x,
            y,
            w,
            h,
            s,
            l,
            a,
            attrs,
        }
    }

    pub fn from_basic_pt(
        pt: BasicPt,
        w: f64,
        h: f64,
        s: f64,
        l: f64,
        a: f64,
        attrs: [f64; 4],
    ) -> Self {
        AsemicPt {
            x: pt.x,
            y: pt.y,
            w,
            h,
            s,
            l,
            a,
            attrs,
        }
    }

    pub fn basic_pt(&self) -> BasicPt {
        BasicPt {
            x: self.x,
            y: self.y,
        }
    }

    pub fn add(&mut self, addition: AsemicPt) -> &mut Self {
        self.x += addition.x;
        self.y += addition.y;
        self.w += addition.w;
        self.h += addition.h;
        self.s += addition.s;
        self.l += addition.l;
        self.a += addition.a;
        self.attrs = [
            self.attrs[0] + addition.attrs[0],
            self.attrs[1] + addition.attrs[1],
            self.attrs[2] + addition.attrs[2],
            self.attrs[3] + addition.attrs[3],
        ];
        self
    }

    pub fn subtract(&mut self, point: AsemicPt) -> &mut Self {
        self.x -= point.x;
        self.y -= point.y;
        self.w -= point.w;
        self.h -= point.h;
        self.s -= point.s;
        self.l -= point.l;
        self.a -= point.a;
        self.attrs = [
            self.attrs[0] - point.attrs[0],
            self.attrs[1] - point.attrs[1],
            self.attrs[2] - point.attrs[2],
            self.attrs[3] - point.attrs[3],
        ];
        self
    }

    pub fn lerp(&mut self, target: AsemicPt, t: f64) -> &mut Self {
        self.x += (target.x - self.x) * t;
        self.y += (target.y - self.y) * t;
        self.w += (target.w - self.w) * t;
        self.h += (target.h - self.h) * t;
        self.s += (target.s - self.s) * t;
        self.l += (target.l - self.l) * t;
        self.a += (target.a - self.a) * t;
        self.attrs = [
            self.attrs[0] + (target.attrs[0] - self.attrs[0]) * t,
            self.attrs[1] + (target.attrs[1] - self.attrs[1]) * t,
            self.attrs[2] + (target.attrs[2] - self.attrs[2]) * t,
            self.attrs[3] + (target.attrs[3] - self.attrs[3]) * t,
        ];
        self
    }

    pub fn clone(&self) -> AsemicPt {
        *self
    }

    pub fn magnitude(&self) -> f64 {
        (self.x * self.x + self.y * self.y).sqrt()
    }

    pub fn angle_0_to_1(&self) -> f64 {
        let angle = self.y.atan2(self.x);
        let normalized = if angle < 0.0 { PI * 2.0 + angle } else { angle };
        normalized / (PI * 2.0)
    }

    pub fn transform() {}
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_basic_pt_creation() {
        let pt = BasicPt::new(3.0, 4.0);
        assert_eq!(pt.x, 3.0);
        assert_eq!(pt.y, 4.0);
    }

    #[test]
    fn test_basic_pt_magnitude() {
        let pt = BasicPt::new(3.0, 4.0);
        assert_eq!(pt.magnitude(), 5.0);
    }

    #[test]
    fn test_asemic_pt_lerp() {
        let mut pt1 = AsemicPt::new(0.0, 0.0, 1.0, 1.0, 1.0, 1.0, 1.0, [0.0; 4]);
        let pt2 = AsemicPt::new(10.0, 10.0, 2.0, 2.0, 2.0, 2.0, 2.0, [0.0; 4]);
        pt1.lerp(pt2, 0.5);
        assert_eq!(pt1.x, 5.0);
        assert_eq!(pt1.w, 1.5);
    }
}
