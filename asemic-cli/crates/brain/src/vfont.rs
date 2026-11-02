//! `vfont` verb: variable font from glyph-proc masters. Per master and char the asemic-repl
//! glyph (proc::Glyph at the master's seed/params, dt 0) is stroked into outlines (kurbo
//! stroke, round caps/joins, width = master param `stroke` in font units), each outline
//! resampled to [`POINTS`] on-curve points by arclength (kurbo inv_arclen) so all masters are
//! interpolation-compatible, written as UFOs + designspace (norad, axis `ASMC` 0..n-1) and
//! compiled with fontc (library). A `text` proc with `path=` the .ttf hot-reloads it.

use std::path::{Path, PathBuf};

use anyhow::{Context, Result, bail, ensure};
use asemic_schema::ProcKind;
use kurbo::{BezPath, Cap, Join, ParamCurve, ParamCurveArclen, PathEl, Stroke, StrokeOpts};
use norad::designspace::{Axis, DesignSpaceDocument, Dimension, Source};

use crate::node::{Gen, Params};
use crate::proc::{Glyph, defaults, get};

pub const POINTS: usize = 48;
pub const AXIS: (&str, &str) = ("Asemic", "ASMC");
const UPEM: f64 = 1000.0;
/// asemic-repl font units: 1 char wide, y 0..2 → em (y up)
const UNIT: f64 = UPEM / 2.0;
const ACC: f64 = 1e-3;

pub struct Master {
    pub seed: u32,
    pub params: Params,
}

impl Master {
    pub fn new(seed: u32, params: &Params) -> Self {
        let mut p = defaults(ProcKind::Glyph);
        p.extend(params.clone());
        // one char at the origin, unit size → font units
        p.extend([("x", 0.0), ("y", 0.0), ("size", 1.0), ("rotate", 0.0), ("scan", 0.0)].map(|(k, v)| (k.to_string(), v)));
        Self { seed, params: p }
    }

    /// Resampled closed outlines (font units, y up) of `c`.
    fn outlines(&self, c: char) -> Vec<Vec<(f64, f64)>> {
        let mut g = Glyph::new(&c.to_string(), self.seed);
        g.step(0.0, &self.params);
        let m = g.points().unwrap_or_default();
        let style = Stroke::new(get(&self.params, "stroke", 60.0)).with_caps(Cap::Round).with_join(Join::Round);
        m.xy().flat_map(|line| {
            let pts: Vec<_> = line.map(|[x, y]| ((x as f64 + 0.5) * UNIT, (1.0 - y as f64) * UNIT)).collect();
            let center: BezPath = pts.iter().enumerate().map(|(i, p)| if i == 0 { PathEl::MoveTo((*p).into()) } else { PathEl::LineTo((*p).into()) }).collect();
            let outline = kurbo::stroke(center, &style, &StrokeOpts::default(), 0.5);
            subpaths(&outline).into_iter().map(|s| resample(&s, POINTS)).collect::<Vec<_>>()
        }).collect()
    }
}

fn subpaths(p: &BezPath) -> Vec<BezPath> {
    let mut out: Vec<BezPath> = vec![];
    for el in p.elements() {
        if matches!(el, PathEl::MoveTo(_)) {
            out.push(BezPath::new());
        }
        if let Some(s) = out.last_mut() {
            s.push(*el);
        }
    }
    out
}

/// `n` points evenly spaced by arclength along the closed subpath.
fn resample(p: &BezPath, n: usize) -> Vec<(f64, f64)> {
    let segs: Vec<_> = p.segments().map(|s| (s, s.arclen(ACC))).collect();
    let total: f64 = segs.iter().map(|s| s.1).sum();
    let (mut i, mut acc) = (0, 0.0);
    (0..n).map(|k| {
        let d = total * k as f64 / n as f64;
        while i + 1 < segs.len() && acc + segs[i].1 < d {
            acc += segs[i].1;
            i += 1;
        }
        let (s, len) = segs[i];
        let pt = s.eval(s.inv_arclen((d - acc).min(len), ACC));
        (pt.x, pt.y)
    }).collect()
}

fn ufo(name: &str, chars: &str, m: &Master) -> Result<norad::Font> {
    let mut f = norad::Font::new();
    f.font_info.family_name = Some(name.into());
    f.font_info.style_name = Some(format!("m{}", m.seed));
    f.font_info.units_per_em = Some((UPEM as u32).into());
    f.font_info.ascender = Some(UPEM * 0.8);
    f.font_info.descender = Some(-UPEM * 0.2);
    let advance = UNIT * (1.0 + get(&m.params, "spacing", 0.15));
    for c in chars.chars().chain([' ']).collect::<std::collections::BTreeSet<_>>() {
        let mut g = norad::Glyph::new(&format!("uni{:04X}", c as u32));
        g.codepoints.insert(c);
        g.width = advance;
        g.contours = m.outlines(c).into_iter().map(|o| norad::Contour::new(
            o.into_iter().map(|(x, y)| norad::ContourPoint::new(x.round(), y.round(), norad::PointType::Line, false, None, None)).collect(), None)).collect();
        f.default_layer_mut().insert_glyph(g);
    }
    Ok(f)
}

/// UFO per master + `<name>.designspace` in `dir`, compiled to `<name>.ttf`; returns its path.
pub fn build(name: &str, chars: &str, masters: &[Master], dir: &Path) -> Result<PathBuf> {
    ensure!(masters.len() >= 2, "vfont: need >= 2 masters");
    ensure!(!chars.is_empty(), "vfont: chars empty");
    std::fs::create_dir_all(dir)?;
    let ufos = masters.iter().map(|m| ufo(name, chars, m)).collect::<Result<Vec<_>>>()?;
    for (g, other) in ufos[0].default_layer().iter().flat_map(|g| ufos[1..].iter().map(move |u| (g, u))) {
        let o = other.default_layer().get_glyph(g.name()).context("vfont: glyph missing")?;
        if o.contours.len() != g.contours.len() {
            bail!("vfont: masters not compatible at {} ({} vs {} contours)", g.name(), g.contours.len(), o.contours.len());
        }
    }
    let mut ds = DesignSpaceDocument { format: 5.0, ..Default::default() };
    ds.axes.push(Axis { name: AXIS.0.into(), tag: AXIS.1.into(), default: 0.0, minimum: Some(0.0), maximum: Some((masters.len() - 1) as f64), ..Default::default() });
    for (i, u) in ufos.iter().enumerate() {
        let file = format!("{name}-m{i}.ufo");
        let p = dir.join(&file);
        if p.exists() {
            std::fs::remove_dir_all(&p)?;
        }
        u.save(&p).with_context(|| format!("vfont: write {}", p.display()))?;
        ds.sources.push(Source {
            filename: file, familyname: Some(name.into()), stylename: Some(format!("m{i}")), name: Some(format!("m{i}")),
            location: vec![Dimension { name: AXIS.0.into(), xvalue: Some(i as f64), ..Default::default() }], ..Default::default()
        });
    }
    let dsp = dir.join(format!("{name}.designspace"));
    ds.save(&dsp).context("vfont: write designspace")?;
    let src = fontc::Input::new(&dsp).and_then(|i| i.create_source()).map_err(|e| anyhow::anyhow!("fontc: {e}"))?;
    let bytes = fontc::generate_font(src, fontc::Options::default()).map_err(|e| anyhow::anyhow!("fontc: {e}"))?;
    let ttf = dir.join(format!("{name}.ttf"));
    // atomic replace: text procs watching the dir reload a complete file
    let tmp = ttf.with_extension("ttf.tmp");
    std::fs::write(&tmp, bytes)?;
    std::fs::rename(&tmp, &ttf)?;
    Ok(ttf)
}

#[cfg(test)]
mod tests {
    use super::*;
    use skrifa::{FontRef, MetadataProvider};

    #[test]
    fn two_masters_compile_to_fvar_axis() {
        let dir = std::env::temp_dir().join(format!("asemic-vfont-{}", std::process::id()));
        let thin = Master::new(1, &Params::from([("stroke".into(), 30.0)]));
        let bold = Master::new(1, &Params::from([("stroke".into(), 120.0), ("wobble".into(), 0.05)]));
        let ttf = build("Test", "AB", &[thin, bold], &dir).unwrap();
        let data = std::fs::read(&ttf).unwrap();
        let font = FontRef::new(&data).unwrap();
        let axes: Vec<_> = font.axes().iter().map(|a| (a.tag().to_string(), a.max_value())).collect();
        assert_eq!(axes, vec![(AXIS.1.to_string(), 1.0)]);
        assert!(font.charmap().map('A').is_some());
        // text proc shapes it, axis param moves the outline
        let mut t = crate::proc::Text::new(ttf.to_str().unwrap(), "AB").unwrap();
        let mut p: Params = crate::proc::text::DEFAULTS.iter().map(|(k, v)| (k.to_string(), *v)).collect();
        t.step(0.0, &p);
        let m0 = t.points().unwrap();
        assert!(!m0.lines.is_empty());
        p.insert(AXIS.1.into(), 1.0);
        t.step(0.0, &p);
        assert_ne!(t.points().unwrap(), m0);
        std::fs::remove_dir_all(dir).ok();
    }

    /// GPU ascii node, `atlas="text:<vfont>"`: atlas changes with the ASMC axis; the ramp is
    /// monotonic in (CPU-measured) glyph coverage.
    #[test]
    fn ascii_text_atlas_follows_axis_and_sorts_by_coverage() {
        use asemic_draw::ascii::Ascii;
        use std::collections::BTreeMap;
        let dir = std::env::temp_dir().join(format!("asemic-vatlas-{}", std::process::id()));
        let thin = Master::new(1, &Params::from([("stroke".into(), 30.0)]));
        let bold = Master::new(1, &Params::from([("stroke".into(), 160.0)]));
        let ttf = build("Atlas", "ABCD", &[thin, bold], &dir).unwrap();
        let (device, queue) = asemic_draw::device().unwrap();
        let atlas = format!("text:{}", ttf.display());
        let mut a = Ascii::new(&device, &queue, " DCBA", "", &atlas, &BTreeMap::new()).unwrap();
        let out = asemic_draw::target(&device, 64, 64);
        let px = |a: &Ascii| asemic_draw::host::readback(&device, &queue, a.atlas());
        let thin_px = px(&a);
        assert!(thin_px.iter().any(|v| *v > 128), "glyphs filled");
        let ramp = a.ramp();
        assert_eq!(ramp[0].0, ' ', "space = least coverage: {ramp:?}");
        // CPU coverage of each atlas cell, in ramp order, never decreases
        let (w, n) = (a.atlas().width() as usize, 5);
        let cw = w / n;
        let chars: Vec<char> = " DCBA".chars().collect();
        let cpu = |c: char| {
            let i = chars.iter().position(|&x| x == c).unwrap();
            thin_px.as_chunks::<4>().0.iter().enumerate().filter(|(k, _)| (k % w) / cw == i).map(|(_, p)| p[2] as f32 / 255.0).sum::<f32>() / (thin_px.len() / 4 / n) as f32
        };
        let covs: Vec<f32> = ramp.iter().map(|(c, _)| cpu(*c)).collect();
        assert!(covs.windows(2).all(|w| w[1] >= w[0] - 1.0 / 255.0), "monotonic {ramp:?} {covs:?}");
        // routable axis: ASMC 1 (bold master) rebuilds the atlas with more ink
        a.run(&device, &queue, None, &out, 0.0, &[], &BTreeMap::from([(AXIS.1.to_string(), 1.0)]), false);
        let bold_px = px(&a);
        assert_ne!(thin_px, bold_px, "atlas follows ASMC");
        let ink = |b: &[u8]| b.as_chunks::<4>().0.iter().map(|p| p[2] as u64).sum::<u64>();
        assert!(ink(&bold_px) > ink(&thin_px));
        // graph: axis tag routes as a param key
        let mut g = asemic_draw::graph::Graph::default();
        let spec = asemic_draw::graph::NodeSpec { kind: "ascii".into(), w: 64, h: 64, inputs: vec!["src".into()], atlas, ..Default::default() };
        g.open(&device, &queue, "t", spec).unwrap();
        assert!(g.param("t", AXIS.1, 0.5) && g.info("t").unwrap().spec.axes[AXIS.1] == 0.5);
        std::fs::remove_dir_all(dir).ok();
    }

    /// `text` proc hot reload: rebuilding the vfont replaces the .ttf atomically (tmp + rename);
    /// the watcher picks it up and the next step draws the new outline.
    #[test]
    fn text_hot_reloads_atomic_rewrite() {
        let dir = std::env::temp_dir().join(format!("asemic-vreload-{}", std::process::id()));
        let m = |stroke: f64, seed| Master::new(seed, &Params::from([("stroke".into(), stroke)]));
        let ttf = build("Reload", "A", &[m(30.0, 1), m(60.0, 1)], &dir).unwrap();
        let mut t = crate::proc::Text::new(ttf.to_str().unwrap(), "A").unwrap();
        let p: Params = crate::proc::text::DEFAULTS.iter().map(|(k, v)| (k.to_string(), *v)).collect();
        t.step(0.0, &p);
        let before = t.points().unwrap();
        build("Reload", "A", &[m(150.0, 9), m(200.0, 9)], &dir).unwrap();
        let t0 = std::time::Instant::now();
        while t.points().unwrap() == before && t0.elapsed().as_secs_f32() < 2.0 {
            std::thread::sleep(std::time::Duration::from_millis(20));
            t.step(0.0, &p);
        }
        assert_ne!(t.points().unwrap(), before, "outline follows the rewritten file");
        std::fs::remove_dir_all(dir).ok();
    }

    /// Compile time of a full a-z, 2-master set (`cargo test [--release] vfont_az -- --ignored --nocapture`).
    #[test]
    #[ignore]
    fn vfont_az_compile_time() {
        let dir = std::env::temp_dir().join(format!("asemic-vaz-{}", std::process::id()));
        let m = |stroke: f64| Master::new(1, &Params::from([("stroke".into(), stroke)]));
        let t0 = std::time::Instant::now();
        let ttf = build("AZ", "ABCDEFGHIJKLMNOPQRSTUVWXYZ", &[m(30.0), m(120.0)], &dir).unwrap();
        let mut t = crate::proc::Text::new(ttf.to_str().unwrap(), "ABCDEFGHIJKLMNOPQRSTUVWXYZ").unwrap();
        t.step(0.0, &crate::proc::text::DEFAULTS.iter().map(|(k, v)| (k.to_string(), *v)).collect());
        eprintln!("contours: {}", t.points().unwrap().lines.len());
        eprintln!("vfont a-z x2 masters: {:?}", t0.elapsed());
        std::fs::remove_dir_all(dir).ok();
    }
}
