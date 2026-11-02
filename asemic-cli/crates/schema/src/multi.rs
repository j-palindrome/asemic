//! Point multiarray (`asemic/gen/<id>`): lines × points × D dims. One format: every dim is
//! treated alike (interpolation, resampling, offsets, compute in/out); names only label dim
//! indices and resolve once (declare / link time). Renderers read the dims named `x`, `y`
//! (0..1, y down) as position and `width` (if present) as stroke scale; nodes append dims
//! (lsys `depth`) and never reinterpret existing ones. x/y-only = the D = 2 case.
//!
//! Wire (`ASP1`, mirrored in asemic_py/points.py): header `<4sIIHH` = magic, frame, n points
//! (incl. NaN separators), dims (= attr count), flags. flags & 1 = attr names follow: u16 byte
//! length + comma-joined UTF-8, zero-padded to 4 bytes. Then n × dims f32 LE; an all-NaN point splits
//! lines. Unnamed payloads label dims x, y, a2, a3.. (so dims 2, flags 0 = x, y).
//!
//! `asemic_py/_wire.py`'s `P_HEAD`/`F_HEAD` struct layouts and magics are generated from the
//! constants below and from [`crate::wire::FRAME_MAGIC`]/[`crate::wire::FRAME_HEAD_LEN`] by
//! `crates/schema/tests/gen_python_wire.rs`; regen with `UPDATE_WIRE=1 cargo test -p
//! asemic-schema`, plain `cargo test` golden-file-checks the file on disk.

pub const MAGIC: &[u8; 4] = b"ASP1";
/// Header size before any attr-name block (magic + frame + n + dims + flags: 4+4+4+2+2).
pub const HEAD_LEN: usize = 16;
const NAMES: u16 = 1;

#[derive(Debug, Clone, PartialEq)]
pub struct Multi {
    pub attrs: Vec<String>,
    /// one flat `[p0 attrs.., p1 attrs.., ..]` per line
    pub lines: Vec<Vec<f32>>,
}

impl Default for Multi {
    fn default() -> Self {
        Self::new(&[])
    }
}

impl Multi {
    /// x, y + `extra` attrs, no lines.
    pub fn new(extra: &[&str]) -> Self {
        Self { attrs: ["x", "y"].iter().chain(extra).map(|s| s.to_string()).collect(), lines: vec![] }
    }

    pub fn from_xy<L: IntoIterator<Item = [f32; 2]>>(lines: impl IntoIterator<Item = L>) -> Self {
        Self { attrs: vec!["x".into(), "y".into()], lines: lines.into_iter().map(|l| l.into_iter().flatten().collect()).collect() }
    }

    /// 1 line × 1 point × 1 dim scalar wrapper (e.g. attrs: `["value"]`).
    pub fn from_scalar(name: &str, v: f32) -> Self {
        Self {
            attrs: vec![name.to_string()],
            lines: vec![vec![v]],
        }
    }

    /// 1 line × 1 point × N dims.
    pub fn from_point<'a>(attrs: impl IntoIterator<Item = &'a str>, vals: &[f32]) -> Self {
        let attrs: Vec<String> = attrs.into_iter().map(|s| s.to_string()).collect();
        assert_eq!(attrs.len(), vals.len(), "attrs len must match vals len");
        Self {
            attrs,
            lines: vec![vals.to_vec()],
        }
    }

    pub fn stride(&self) -> usize {
        self.attrs.len()
    }

    pub fn attr(&self, name: &str) -> Option<usize> {
        self.attrs.iter().position(|a| a == name)
    }

    /// Points of line `i` (each = its attrs).
    pub fn points(&self, i: usize) -> std::slice::ChunksExact<'_, f32> {
        self.lines[i].chunks_exact(self.stride())
    }

    /// Valid attr name: a WGSL identifier (attrs become `Point` fields / `ATTR_<name>` consts).
    pub fn valid_name(name: &str) -> bool {
        let mut c = name.chars();
        c.next().is_some_and(|f| f.is_ascii_alphabetic() || f == '_') && c.all(|ch| ch.is_ascii_alphanumeric() || ch == '_') && name != "_"
    }

    /// Ensure attr `name` exists (new column = `fill`); returns its index.
    pub fn with_attr(&mut self, name: &str, fill: f32) -> usize {
        if let Some(a) = self.attr(name) {
            return a;
        }
        let d = self.stride();
        self.lines = self.lines.iter().map(|l| l.chunks_exact(d).flat_map(|p| p.iter().copied().chain([fill])).collect()).collect();
        self.attrs.push(name.into());
        d
    }

    /// Add `v` to attr `name` of every point (no-op if absent).
    pub fn offset(&mut self, name: &str, v: f32) {
        if let (Some(a), d) = (self.attr(name), self.stride()) {
            self.lines.iter_mut().flat_map(|l| l.chunks_exact_mut(d)).for_each(|p| p[a] += v);
        }
    }

    /// One layout for several multiarrays (x, y, then extra attrs in first-seen order;
    /// a dim a source lacks = 0, like every dim); lines with < 2 points dropped (drawable lines only).
    pub fn union<'a>(ms: impl IntoIterator<Item = &'a Multi>) -> Multi {
        let ms: Vec<&Multi> = ms.into_iter().collect();
        let mut out = Multi::new(&[]);
        for m in &ms {
            for a in &m.attrs {
                if out.attr(a).is_none() {
                    out.attrs.push(a.clone());
                }
            }
        }
        for m in ms {
            let map: Vec<Option<usize>> = out.attrs.iter().map(|a| m.attr(a)).collect();
            for i in (0..m.lines.len()).filter(|&i| m.lines[i].len() >= 2 * m.stride()) {
                out.lines.push(m.points(i).flat_map(|p| map.iter().map(|k| k.map_or(0.0, |k| p[k])).collect::<Vec<_>>()).collect());
            }
        }
        out
    }

    /// Point-wise pairing / cross-operation between `self` and `other`.
    /// Traverses lines and points in `self`, wrapping through `other` cyclically.
    /// Shared attrs are combined via `op(val_self, val_other)`.
    /// Dimensions present only in `self` or `other` are preserved (using identity/0.0 for missing values).
    pub fn pair_with<F>(&self, other: &Multi, mut op: F) -> Multi
    where
        F: FnMut(f32, f32) -> f32,
    {
        if self.is_empty() || other.is_empty() {
            return self.clone();
        }

        let mut attrs = self.attrs.clone();
        for a in &other.attrs {
            if !attrs.contains(a) {
                attrs.push(a.clone());
            }
        }

        let total_other = other.len();
        let other_stride = other.stride();
        let self_stride = self.stride();
        let out_stride = attrs.len();

        let self_map: Vec<Option<usize>> = attrs.iter().map(|a| self.attr(a)).collect();
        let other_map: Vec<Option<usize>> = attrs.iter().map(|a| other.attr(a)).collect();

        // Flatten points of other for fast cyclic lookup
        let other_flat: Vec<&[f32]> = (0..other.lines.len())
            .flat_map(|i| other.lines[i].chunks_exact(other_stride))
            .collect();

        let mut other_idx = 0;
        let mut out_lines = Vec::with_capacity(self.lines.len());

        for line in &self.lines {
            let mut out_line = Vec::new();
            for pt in line.chunks_exact(self_stride) {
                let other_pt = other_flat[other_idx % total_other];
                other_idx += 1;

                for k in 0..out_stride {
                    let v_self = self_map[k].map_or(0.0, |idx| pt[idx]);
                    let v_other = other_map[k].map_or(0.0, |idx| other_pt[idx]);
                    let v = match (self_map[k], other_map[k]) {
                        (Some(_), Some(_)) => op(v_self, v_other),
                        (Some(_), None) => v_self,
                        (None, Some(_)) => v_other,
                        (None, None) => 0.0,
                    };
                    out_line.push(v);
                }
            }
            out_lines.push(out_line);
        }

        Multi {
            attrs,
            lines: out_lines,
        }
    }

    /// Point-wise cross-multiplication with cyclic wrapping across lines and points.
    pub fn cross_mul(&self, other: &Multi) -> Multi {
        self.pair_with(other, |a, b| a * b)
    }

    /// Point at phase 0..1 along all points in sequence (lines concatenated), every dim
    /// interpolated linearly between neighbours; None if empty.
    pub fn sample(&self, phase: f32) -> Option<Vec<f32>> {
        (0..self.stride()).map(|k| self.sample_dim(phase, k)).collect()
    }

    /// Dim `k` of [`Multi::sample`] (no allocation: audio callbacks; O(lines) lookup).
    pub fn sample_dim(&self, phase: f32, k: usize) -> Option<f32> {
        let d = self.stride();
        let last = self.len().checked_sub(1)?;
        let at = |mut i: usize| {
            for l in &self.lines {
                if i < l.len() / d {
                    return l[i * d + k];
                }
                i -= l.len() / d;
            }
            0.0
        };
        let f = phase.clamp(0.0, 1.0) * last as f32;
        let (i, t) = (f as usize, f.fract());
        let (a, b) = (at(i), at((i + 1).min(last)));
        Some(a + (b - a) * t)
    }

    /// Per line (first point index, point count) into the flat point list.
    pub fn line_table(&self) -> Vec<[u32; 2]> {
        let mut at = 0u32;
        self.lines.iter().map(|l| {
            let n = (l.len() / self.stride()) as u32;
            at += n;
            [at - n, n]
        }).collect()
    }

    /// Position = dims named x, y (renderers / scope); a missing one reads 0.
    pub fn xy(&self) -> impl Iterator<Item = impl Iterator<Item = [f32; 2]> + '_> + '_ {
        let (x, y) = (self.attr("x"), self.attr("y"));
        let at = move |p: &[f32], k: Option<usize>| k.map_or(0.0, |k| p[k]);
        (0..self.lines.len()).map(move |i| self.points(i).map(move |p| [at(p, x), at(p, y)]))
    }

    /// Per-point values of `name` (None = attr absent).
    pub fn column(&self, name: &str) -> Option<Vec<Vec<f32>>> {
        let a = self.attr(name)?;
        Some((0..self.lines.len()).map(|i| self.points(i).map(|p| p[a]).collect()).collect())
    }

    pub fn len(&self) -> usize {
        self.lines.iter().map(|l| l.len() / self.stride()).sum()
    }

    pub fn is_empty(&self) -> bool {
        self.len() == 0
    }

    /// Scalar channels derived from the arrays: `<dim>` = mean of every dim (x, y included,
    /// same as any other), `count` = points (tanh-squashed).
    pub fn channels(&self) -> Vec<(String, f64)> {
        let n = self.len();
        if n == 0 {
            return vec![];
        }
        let mut sums = vec![0.0f64; self.stride()];
        for i in 0..self.lines.len() {
            for p in self.points(i) {
                sums.iter_mut().zip(p).for_each(|(s, v)| *s += *v as f64);
            }
        }
        let mut ch = vec![("count".into(), (n as f64 / 256.0).tanh())];
        ch.extend(self.attrs.iter().zip(&sums).map(|(k, s)| (k.clone(), s / n as f64)));
        ch
    }

    pub fn encode(&self, frame: u32) -> Vec<u8> {
        let d = self.stride();
        let n = self.lines.iter().map(|l| l.len() / d).sum::<usize>() + self.lines.len().saturating_sub(1);
        let extra = self.attrs != ["x", "y"];
        let mut b = Vec::with_capacity(24 + n * d * 4);
        b.extend(MAGIC);
        b.extend(frame.to_le_bytes());
        b.extend((n as u32).to_le_bytes());
        b.extend((d as u16).to_le_bytes());
        b.extend((if extra { NAMES } else { 0 }).to_le_bytes());
        if extra {
            let names = self.attrs.join(",");
            b.extend((names.len() as u16).to_le_bytes());
            b.extend(names.as_bytes());
            b.resize(b.len().next_multiple_of(4), 0);
        }
        for (i, l) in self.lines.iter().enumerate() {
            if i > 0 {
                b.extend(std::iter::repeat_n(f32::NAN.to_le_bytes(), d).flatten());
            }
            l.iter().for_each(|v| b.extend(v.to_le_bytes()));
        }
        b
    }

    /// (frame, multiarray); lines with < 2 points dropped only by consumers that need it.
    pub fn decode(b: &[u8]) -> Option<(u32, Self)> {
        let head = b.get(..HEAD_LEN)?;
        if &head[..4] != MAGIC {
            return None;
        }
        let u32_at = |i: usize| u32::from_le_bytes(head[i..i + 4].try_into().unwrap());
        let (frame, n, d) = (u32_at(4), u32_at(8) as usize, u16::from_le_bytes([head[12], head[13]]) as usize);
        let flags = u16::from_le_bytes([head[14], head[15]]);
        let mut at = HEAD_LEN;
        let attrs: Vec<String> = if flags & NAMES != 0 {
            let len = u16::from_le_bytes(b.get(at..at + 2)?.try_into().ok()?) as usize;
            let names = std::str::from_utf8(b.get(at + 2..at + 2 + len)?).ok()?;
            at = (at + 2 + len).next_multiple_of(4);
            names.split(',').map(String::from).collect()
        } else {
            (0..d).map(|i| ["x", "y"].get(i).map_or(format!("a{i}"), |s| s.to_string())).collect()
        };
        if d < 2 || attrs.len() != d {
            return None;
        }
        let body = b.get(at..at + n * d * 4)?;
        let mut m = Self { attrs, lines: vec![vec![]] };
        for p in body.chunks_exact(d * 4) {
            let p: Vec<f32> = p.as_chunks::<4>().0.iter().map(|c| f32::from_le_bytes(*c)).collect();
            if p.iter().all(|v| v.is_nan()) {
                m.lines.push(vec![]);
            } else {
                m.lines.last_mut()?.extend(p);
            }
        }
        m.lines.retain(|l| !l.is_empty());
        Some((frame, m))
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn roundtrip_with_attrs_and_reads_plain_xy() {
        let mut m = Multi::new(&["width"]);
        m.lines = vec![vec![0.1, 0.2, 1.0, 0.3, 0.4, 2.0], vec![0.5, 0.5, 3.0, 0.6, 0.6, 4.0]];
        let (f, back) = Multi::decode(&m.encode(7)).unwrap();
        assert_eq!((f, &back), (7, &m));
        assert_eq!(back.column("width").unwrap(), vec![vec![1.0, 2.0], vec![3.0, 4.0]]);
        let ch: std::collections::BTreeMap<_, _> = back.channels().into_iter().collect();
        assert_eq!(ch["width"], 2.5);
        // old payload: dims 2, flags 0
        let old = Multi::from_xy([[[0.0f32, 0.0], [1.0, 1.0]]]);
        let b = old.encode(0);
        assert_eq!(u16::from_le_bytes([b[14], b[15]]), 0);
        assert_eq!(Multi::decode(&b).unwrap().1, old);
    }

    #[test]
    fn union_fills_and_offsets() {
        let mut a = Multi::from_xy([[[0.0f32, 0.0], [1.0, 1.0]]]);
        assert_eq!(a.with_attr("hue", 0.5), 2);
        a.offset("hue", 0.25);
        let mut b = Multi::new(&["width"]);
        b.lines = vec![vec![0.0, 0.0, 2.0, 1.0, 1.0, 3.0], vec![0.5, 0.5, 1.0]]; // 1-point line dropped
        let u = Multi::union([&a, &b]);
        assert_eq!(u.attrs, ["x", "y", "hue", "width"]);
        assert_eq!(u.column("hue").unwrap(), vec![vec![0.75, 0.75], vec![0.0, 0.0]]);
        assert_eq!(u.column("width").unwrap(), vec![vec![0.0, 0.0], vec![2.0, 3.0]]);
        assert_eq!(u.line_table(), vec![[0, 2], [2, 2]]);
        assert!(Multi::valid_name("hue_2") && !Multi::valid_name("2x") && !Multi::valid_name("a-b"));
    }

    #[test]
    fn cross_mul_and_pairing_wraps() {
        let a = Multi::from_xy([[[1.0f32, 2.0], [3.0, 4.0]]]);
        let b = Multi::from_scalar("x", 2.0);
        let c = a.cross_mul(&b);
        assert_eq!(c.column("x").unwrap(), vec![vec![2.0, 6.0]]);
        assert_eq!(c.column("y").unwrap(), vec![vec![2.0, 4.0]]);
    }
}
