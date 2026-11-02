//! Texture node kind `ascii`: per cell, the input's luma (lygia `luma3`) picks a glyph from
//! an atlas strip (ramp dark -> light). Atlas = ASCII chars (`font8x8` bitmaps) or asemic
//! glyphs (asemic-repl font through the same brush the draw host uses).
//! glyphs (asemic-repl font through the same brush the draw host uses) or `atlas="text:<path>"`
//! (font outlines at routable `axes`, coverage-sorted ramp; see [`TextAtlas`]).
//! Params: `param(0)` = columns, `param(1)` = colour (0 = white glyphs, 1 = input colour).

use std::collections::BTreeMap;

use anyhow::{Result, bail};
use asemic_font::glam::{Affine2, vec2};
use asemic_font::outline::{FontFile, location, shape};
use asemic_schema::Multi;

use crate::graph::{BrushSlots, Shader};
use crate::host::{Look, brush, curves, draw_with};

pub const RAMP: &str = " .:-=+*#%@";
pub const DEFAULT_PARAMS: [f32; 2] = [80.0, 0.0];
/// asemic atlas cell (font units: 1 wide, 2 tall)
const CELL: u32 = 16;
/// text atlas cell (px)
const TEXT_CELL: (u32, u32) = (32, 64);

pub struct Ascii {
    /// per-cell glyph index pass + its (cols x rows) target, for the terminal text preview
    cells: Shader,
    cells_tex: Option<wgpu::Texture>,
    /// text preview grid (viewer's terminal box); None = the node's own grid (params[0])
    pub preview_grid: Option<(u32, u32)>,
    /// atlas cell size (px)
    cell: (u32, u32),
    /// ramp glyphs by atlas index
    chars: Vec<char>,
    shader: Shader,
    atlas: wgpu::Texture,
    /// N x 1: texel k = atlas cell drawn for luma bucket k (r = index / 255)
    order: wgpu::Texture,
    text: Option<TextAtlas>,
}

/// `atlas="text:<path>"`: ramp glyphs filled (lyon via mesh.rs) from the font's outlines at the
/// `axes` location; rebuilt on axis change / font file change; the luma -> glyph ramp is
/// sorted by per-glyph mean coverage (GPU reduce, one texel per cell).
struct TextAtlas {
    font: FontFile,
    ramp: Vec<char>,
    axes: BTreeMap<String, f32>,
    mesh: crate::mesh::Mesh,
    slots: BrushSlots,
    reduce: Shader,
    coverage: Vec<f32>,
}

impl Ascii {
    /// `font` = "ascii" (default) | "asemic"; `atlas` = "text:<font path>" overrides `font`,
    /// drawn at axis location `axes` (tag -> value; missing = font default).
    pub fn new(device: &wgpu::Device, queue: &wgpu::Queue, ramp: &str, font: &str, atlas: &str, axes: &BTreeMap<String, f32>) -> Result<Self> {
        let ramp: Vec<char> = if ramp.is_empty() { RAMP.chars().collect() } else { ramp.chars().collect() };
        let n = ramp.len();
        if n > 256 {
            bail!("ascii: ramp of {n} glyphs (max 256)");
        }
        let (tex, text) = match atlas.split_once(':') {
            Some(("text", path)) => {
                let (cw, ch) = TEXT_CELL;
                let reduce = Shader::new(device, &format!(
                    "const CW: u32 = {cw}u;
const CH: u32 = {ch}u;
fn shade(uv: vec2f) -> vec4f {{
    let cell = u32(uv.x * {n}.0);
    var sum = 0.0;
    for (var y = 0u; y < CH; y++) {{
        for (var x = 0u; x < CW; x++) {{
            sum += textureLoad(tex0, vec2i(i32(cell * CW + x), i32(y)), 0).r;
        }}
    }}
    return vec4f(vec3f(sum / f32(CW * CH)), 1.0);
}}"
                ), 1)?;
                let t = TextAtlas {
                    font: FontFile::open(path)?,
                    ramp: ramp.clone(),
                    axes: axes.clone(),
                    mesh: crate::mesh::Mesh::new(device, &Look::default(), &Multi::default().attrs)?,
                    slots: BrushSlots::new(device),
                    reduce,
                    coverage: vec![],
                };
                (crate::target(device, cw * n as u32, ch), Some(t))
            }
            Some((k, _)) => bail!("ascii: atlas {k:?} (text:<font path>)"),
            None => (match font {
                "" | "ascii" => bitmap_atlas(device, queue, &ramp)?,
                "asemic" => asemic_atlas(device, queue, &ramp)?,
                f => bail!("ascii: font {f:?} (ascii, asemic)"),
            }, None),
        };
        let (cw, ch) = (tex.width() / n as u32, tex.height());
        // shared: cell -> atlas glyph index (cell-mean luma -> ramp bucket -> coverage order)
        let common = format!(
            "import lygia::color::luma::luma3;
const N: f32 = {n}.0;
const CW: u32 = {cw}u;
const CH: u32 = {ch}u;
const S: u32 = 4u;
fn glyph(cell: vec2f, grid: vec2f) -> u32 {{
    let k = min(floor(clamp(luma3(mean(cell, grid).rgb), 0.0, 1.0) * N), N - 1.0);
    return u32(textureLoad(tex2, vec2i(i32(k), 0), 0).r * 255.0 + 0.5);
}}
// cell mean over S x S sub-samples (!centre point-sample: thin strokes fell between centres -> all ' ')
fn mean(cell: vec2f, grid: vec2f) -> vec4f {{
    var c = vec4f(0.0);
    for (var j = 0u; j < S; j++) {{
        for (var i = 0u; i < S; i++) {{
            c += in0((cell + (vec2f(f32(i), f32(j)) + 0.5) / f32(S)) / grid);
        }}
    }}
    return c / f32(S * S);
}}
"
        );
        let wesl = format!(
            "{common}
fn shade(uv: vec2f) -> vec4f {{
    let cols = max(param(0u), 1.0);
    let grid = vec2f(cols, max(floor(cols * info.size.y / info.size.x * f32(CW) / f32(CH)), 1.0));
    let cell = floor(uv * grid);
    let g_i = glyph(cell, grid);
    let f = fract(uv * grid);
    let g = textureLoad(tex1, vec2i(i32(g_i * CW + min(u32(f.x * f32(CW)), CW - 1u)), i32(min(u32(f.y * f32(CH)), CH - 1u))), 0).r;
    return vec4f(mix(vec3f(1.0), mean(cell, grid).rgb, param(1u)) * g, 1.0);
}}"
        );
        // 1 texel per cell (grid = params 2, 3 from `run`): r = glyph index / 255 -> `text()`
        let cells_wesl = format!(
            "{common}
fn shade(uv: vec2f) -> vec4f {{
    let grid = vec2f(param(2u), param(3u));
    return vec4f(f32(glyph(floor(uv * grid), grid)) / 255.0, 0.0, 0.0, 1.0);
}}"
        );
        let mut a = Self {
            shader: Shader::new(device, &wesl, 3)?,
            cells: Shader::new(device, &cells_wesl, 3)?,
            cells_tex: None,
            preview_grid: None,
            cell: (cw, ch),
            chars: ramp.clone(),
            atlas: tex,
            order: crate::target(device, n as u32, 1),
            text,
        };
        match &a.text {
            Some(_) => a.rebuild(device, queue),
            None => a.write_order(queue, &(0..n).collect::<Vec<_>>()),
        }
        Ok(a)
    }

    fn write_order(&self, queue: &wgpu::Queue, order: &[usize]) {
        let px: Vec<u8> = order.iter().flat_map(|&i| [i as u8; 4]).collect();
        queue.write_texture(self.order.as_image_copy(), &px, wgpu::TexelCopyBufferLayout { offset: 0, bytes_per_row: Some(order.len() as u32 * 4), rows_per_image: None }, self.order.size());
    }

    /// Text atlas: fill every ramp glyph into its cell, reduce coverage on the GPU, sort the ramp.
    fn rebuild(&mut self, device: &wgpu::Device, queue: &wgpu::Queue) {
        let Some(t) = &mut self.text else { return };
        let (n, (cw, ch)) = (t.ramp.len(), TEXT_CELL);
        let (w, h) = ((cw * n as u32) as f32, ch as f32);
        let vars = location(&t.font.data, |tag| t.axes.get(tag).copied());
        let mut m = Multi::default();
        // probe metrics: ascent..descent fills 90% of the cell height (px space)
        if let Ok(probe) = shape(&t.font.data, "", &vars, [0.0; 2], 1.0, 1.0) {
            let s = 0.9 * h / (probe.ascent - probe.descent).max(1.0);
            let base = 0.05 * h + probe.ascent * s;
            for (i, c) in t.ramp.iter().enumerate() {
                let Ok(g) = shape(&t.font.data, &c.to_string(), &vars, [0.0, base], s, 0.25) else { continue };
                let dx = i as f32 * cw as f32 + (cw as f32 - g.advance * s) / 2.0;
                // px -> atlas 0..1
                m.lines.extend(g.lines.into_iter().map(|l| l.as_chunks::<2>().0.iter().flat_map(|p| [(p[0] + dx) / w, p[1] / h]).collect::<Vec<_>>()));
            }
        }
        match crate::mesh::fill([&m], w as u32, h as u32) {
            Ok(geo) => t.mesh.draw_geo(device, queue, &self.atlas, &geo, 0.0, &t.slots.bind(device, &[], None)),
            Err(e) => tracing::warn!("ascii atlas fill: {e:#}"),
        }
        let cov = crate::target(device, n as u32, 1);
        t.reduce.run(device, queue, &[Some(&self.atlas)], &cov, 0.0, &[]);
        t.coverage = crate::host::readback(device, queue, &cov).as_chunks::<4>().0.iter().map(|p| p[2] as f32 / 255.0).collect();
        let mut order: Vec<usize> = (0..n).collect();
        order.sort_by(|&a, &b| t.coverage[a].total_cmp(&t.coverage[b]));
        self.write_order(queue, &order);
    }

    /// Text atlas: ramp sorted dark -> light as (glyph, mean coverage); empty for fixed atlases.
    pub fn ramp(&self) -> Vec<(char, f32)> {
        let Some(t) = &self.text else { return vec![] };
        let mut r: Vec<(char, f32)> = t.ramp.iter().copied().zip(t.coverage.iter().copied()).collect();
        r.sort_by(|a, b| a.1.total_cmp(&b.1));
        r
    }

    pub fn atlas(&self) -> &wgpu::Texture {
        &self.atlas
    }

    /// Chars first: the per-cell glyph pass always runs (text preview); the glyph raster into
    /// `out` only when `raster` (= a sink or downstream node consumes the texture).
    #[expect(clippy::too_many_arguments, reason = "wgpu device/queue/texture plumbing; a params struct would only rename them")]
    pub fn run(&mut self, device: &wgpu::Device, queue: &wgpu::Queue, input: Option<&wgpu::Texture>, out: &wgpu::Texture, t: f32, params: &[f32], axes: &BTreeMap<String, f32>, raster: bool) {
        if let Some(ta) = &mut self.text
            && ta.font.reload() | (ta.axes != *axes) {
                ta.axes = axes.clone();
                self.rebuild(device, queue);
            }
        let mut p = DEFAULT_PARAMS.to_vec();
        p.iter_mut().zip(params).for_each(|(d, s)| *d = *s);
        if raster {
            self.shader.run(device, queue, &[input, Some(&self.atlas), Some(&self.order)], out, t, &p);
        }
        // text preview: re-sampled per cell at the viewer's grid, else the main pass's grid
        let (cols, rows) = match self.preview_grid {
            Some((c, r)) => (c as f32, r as f32),
            None => {
                let cols = p[0].max(1.0).floor();
                (cols, (cols * out.height() as f32 / out.width() as f32 * self.cell.0 as f32 / self.cell.1 as f32).floor().max(1.0))
            }
        };
        if self.cells_tex.as_ref().is_none_or(|c| (c.width(), c.height()) != (cols as u32, rows as u32)) {
            self.cells_tex = Some(crate::target(device, cols as u32, rows as u32));
        }
        p.resize(p.len().max(4), 0.0);
        (p[2], p[3]) = (cols, rows);
        self.cells.run(device, queue, &[input, Some(&self.atlas), Some(&self.order)], self.cells_tex.as_ref().unwrap(), t, &p);
    }

    /// Last frame's glyphs as text: (cols, rows, rows joined by '\n').
    pub fn text(&self, device: &wgpu::Device, queue: &wgpu::Queue) -> Option<(u32, u32, String)> {
        let c = self.cells_tex.as_ref()?;
        let (w, h) = (c.width(), c.height());
        let px = crate::host::readback(device, queue, c);
        // target is BGRA: r = byte 2
        let s = px.chunks_exact(4 * w as usize).map(|row| row.as_chunks::<4>().0.iter().map(|p| self.chars.get(p[2] as usize).copied().unwrap_or(' ')).collect::<String>()).collect::<Vec<_>>().join("\n");
        Some((w, h, s))
    }
}

/// 8x8 bitmap glyphs side by side (font8x8: bit i of row = column i).
fn bitmap_atlas(device: &wgpu::Device, queue: &wgpu::Queue, ramp: &[char]) -> Result<wgpu::Texture> {
    use font8x8::UnicodeFonts;
    let glyphs: Vec<[u8; 8]> = ramp.iter().map(|c| font8x8::BASIC_FONTS.get(*c).ok_or_else(|| anyhow::anyhow!("ascii: no glyph for {c:?}"))).collect::<Result<_>>()?;
    let w = 8 * glyphs.len() as u32;
    let mut px = vec![0u8; (w * 8 * 4) as usize];
    for (g, rows) in glyphs.iter().enumerate() {
        for (y, row) in rows.iter().enumerate() {
            for x in 0..8 {
                if row >> x & 1 == 1 {
                    let i = (y * w as usize + g * 8 + x) * 4;
                    px[i..i + 4].copy_from_slice(&[255; 4]);
                }
            }
        }
    }
    let tex = crate::target(device, w, 8);
    queue.write_texture(
        tex.as_image_copy(),
        &px,
        wgpu::TexelCopyBufferLayout { offset: 0, bytes_per_row: Some(w * 4), rows_per_image: None },
        tex.size(),
    );
    Ok(tex)
}

/// asemic-repl glyphs, one per CELL x 2*CELL cell, drawn by the host's line brush.
fn asemic_atlas(device: &wgpu::Device, queue: &wgpu::Queue, ramp: &[char]) -> Result<wgpu::Texture> {
    let mut font = asemic_font::Font::new();
    let n = ramp.len() as f32;
    let mut m = Multi::default();
    for (i, c) in ramp.iter().enumerate() {
        // font units (x 0..1, y up 0..2) -> cell i of the strip (0..1, y down), 10% margin
        let xf = Affine2::from_scale_angle_translation(vec2(0.8 / n, -0.4), 0.0, vec2((i as f32 + 0.1) / n, 0.9));
        let paths = font.to_paths(&c.to_string(), asemic_font::TextOptions { transform: xf, width: 1.0, align: None, char_spacing: None });
        m.lines.extend(Multi::from_xy(paths.paths.iter().map(|l| l.iter().map(|v| [v.x, v.y]))).lines);
    }
    let (w, h) = (CELL * ramp.len() as u32, 2 * CELL);
    let tex = crate::target(device, w, h);
    let mut br = brush(device, w, h, &Look::default(), &Multi::default().attrs)?;
    let aspect = h as f32 / w as f32;
    draw_with(device, queue, &tex, br.as_mut(), curves([&m], aspect, w).as_ref(), 0.0, aspect, Some(&crate::graph::BrushSlots::new(device).bind(device, &[], None)));
    Ok(tex)
}
