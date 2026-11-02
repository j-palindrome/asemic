//! Draw look `brush="mesh"`: lyon tessellates the gen multiarray into triangles: every line
//! is stroked (StrokeTessellator, variable width from the per-point `width` attr), closed
//! lines (last point = first) are also filled (FillTessellator). Every dim reaches the
//! modifiers as `attr(info, DIM_<name>)` (info.line = line, info.point = 0..1 along it). Rendered by a plain wgpu
//! pipeline; the Look's alpha / brightness / position modifiers (WGSL bodies over upstream
//! `ModifierInfo`) and `tex0(uv)`..`tex3(uv)` inputs stay usable (WESL-linked, lygia ok).

use anyhow::{Result, bail};
use asemic_schema::Multi;
use lyon::math::point;
use lyon::path::Path;
use lyon::tessellation::{BuffersBuilder, FillOptions, FillTessellator, FillVertex, StrokeOptions, StrokeTessellator, StrokeVertex, VertexBuffers};

use crate::host::Look;

/// stroke width (px) for width attr 1
pub const BASE_WIDTH: f32 = 4.0;

#[repr(C)]
#[derive(Clone, Copy, bytemuck::Pod, bytemuck::Zeroable)]
pub struct V {
    /// engine coords (0..1, y down)
    pos: [f32; 2],
    line: f32,
    point: f32,
}

/// lyon tessellation of `ms` in pixel space (w x h) -> vertices in engine coords.
pub fn tessellate<'a>(ms: impl IntoIterator<Item = &'a Multi>, w: u32, h: u32) -> Result<VertexBuffers<V, u32>> {
    let (sx, sy) = (w as f32, h as f32);
    let mut out = VertexBuffers::new();
    let (mut stroke, mut fill) = (StrokeTessellator::new(), FillTessellator::new());
    let mut line = 0f32;
    for m in ms {
        // renderer reads named dims: position = x, y; stroke = width (if present)
        let (Some(xa), Some(ya), wa) = (m.attr("x"), m.attr("y"), m.attr("width")) else {
            // keep line indices aligned with the dims line table (Multi::union)
            line += (0..m.lines.len()).filter(|&i| m.lines[i].len() >= 2 * m.stride()).count() as f32;
            continue;
        };
        for i in 0..m.lines.len() {
            let pts: Vec<&[f32]> = m.points(i).collect();
            if pts.len() < 2 {
                continue;
            }
            let closed = pts.len() > 2 && (pts[0][xa] - pts[pts.len() - 1][xa]).abs() < 1e-5 && (pts[0][ya] - pts[pts.len() - 1][ya]).abs() < 1e-5;
            // lyon attrs: [width px, position along the line 0..1]
            let mut b = Path::builder_with_attributes(2);
            let at = |j: usize| point(pts[j][xa] * sx, pts[j][ya] * sy);
            let along = |j: usize| j as f32 / (pts.len() - 1) as f32;
            let attrs = |j: usize| [BASE_WIDTH * wa.map_or(1.0, |a| pts[j][a]), along(j)];
            let last = if closed { pts.len() - 1 } else { pts.len() };
            b.begin(at(0), &attrs(0));
            for j in 1..last {
                b.line_to(at(j), &attrs(j));
            }
            b.end(closed);
            let path = b.build();
            let l = line;
            let norm = move |p: lyon::math::Point, k: f32| V { pos: [p.x / sx, p.y / sy], line: l, point: k };
            if closed {
                fill.tessellate_path(&path, &FillOptions::default(), &mut BuffersBuilder::new(&mut out, |mut v: FillVertex| {
                    let k = v.interpolated_attributes()[1];
                    norm(v.position(), k)
                }))?;
            }
            stroke.tessellate_path(&path, &StrokeOptions::default().with_variable_line_width(0), &mut BuffersBuilder::new(&mut out, |mut v: StrokeVertex| {
                let k = v.interpolated_attributes()[1];
                norm(v.position(), k)
            }))?;
            line += 1.0;
        }
    }
    Ok(out)
}

/// lyon fill of every line of `ms` as ONE path (non-zero winding: glyph counters stay holes),
/// no stroke; `line` = 0, `point` = 0 — for filled outlines (ascii text atlas).
pub fn fill<'a>(ms: impl IntoIterator<Item = &'a Multi>, w: u32, h: u32) -> Result<VertexBuffers<V, u32>> {
    let (sx, sy) = (w as f32, h as f32);
    let mut b = Path::builder();
    for m in ms {
        let (Some(xa), Some(ya)) = (m.attr("x"), m.attr("y")) else { continue };
        for i in 0..m.lines.len() {
            let mut pts = m.points(i).map(|p| point(p[xa] * sx, p[ya] * sy));
            let Some(p0) = pts.next() else { continue };
            b.begin(p0);
            pts.for_each(|p| {
                b.line_to(p);
            });
            b.end(true);
        }
    }
    let mut out = VertexBuffers::new();
    FillTessellator::new().tessellate_path(&b.build(), &FillOptions::non_zero(), &mut BuffersBuilder::new(&mut out, |v: FillVertex| V { pos: [v.position().x / sx, v.position().y / sy], line: 0.0, point: 0.0 }))?;
    Ok(out)
}

pub struct Mesh {
    pipeline: wgpu::RenderPipeline,
    uniform: wgpu::Buffer,
    bind: wgpu::BindGroup,
}

impl Mesh {
    /// `dims` = point layout the modifiers link against (`attr(info, DIM_<name>)`).
    pub fn new(device: &wgpu::Device, look: &Look, dims: &[String]) -> Result<Self> {
        if look.width.is_some() {
            bail!("mesh: width modifier unsupported (width = per-point `width` attr, tessellated on CPU)");
        }
        let body = |m: &Option<String>, d: &str| m.clone().unwrap_or_else(|| d.into());
        let src = format!(
            "struct MeshU {{ time: f32, aspect_ratio: f32, size: vec2f }}
@group(0) @binding(0) var<uniform> uniforms: MeshU;
{shared}
fn process_alpha(info: ModifierInfo) -> f32 {{ {alpha} }}
fn process_position(info: ModifierInfo) -> vec2<f32> {{ {position} }}
fn process_brightness(info: ModifierInfo) -> f32 {{ {brightness} }}
struct O {{ @builtin(position) clip: vec4f, @location(0) uv: vec2f, @location(1) lp: vec2f }}
fn info_of(pos: vec2f, lp: vec2f) -> ModifierInfo {{
    return ModifierInfo(lp.x, lp.y, pos, vec2f(0.0), vec2f(0.0), pos, pos);
}}
@vertex fn vs(@location(0) pos: vec2f, @location(1) line: f32, @location(2) point: f32) -> O {{
    let p = process_position(info_of(pos, vec2f(line, point)));
    return O(vec4f(p.x * 2.0 - 1.0, 1.0 - p.y * 2.0, 0.0, 1.0), p, vec2f(line, point));
}}
@fragment fn fs(o: O) -> @location(0) vec4f {{
    let info = info_of(o.uv, o.lp);
    let b = process_brightness(info);
    return vec4f(vec3f(b), process_alpha(info));
}}
",
            shared = asemic_font::SHARED_WGSL,
            alpha = body(&look.alpha, "return 1.0;"),
            position = body(&look.position, "return info.position;"),
            brightness = body(&look.brightness, "return 1.0;"),
        );
        let wgsl = asemic_font::link::with_dims(dims, || asemic_font::link_shader(src));
        if let Some(e) = asemic_font::link::LINK_ERROR.with(|l| l.borrow_mut().take()) {
            bail!("mesh wesl: {e}");
        }
        let scope = device.push_error_scope(wgpu::ErrorFilter::Validation);
        let module = device.create_shader_module(wgpu::ShaderModuleDescriptor { label: Some("asemic mesh"), source: wgpu::ShaderSource::Wgsl(wgsl.into()) });
        let layout0 = device.create_bind_group_layout(&wgpu::BindGroupLayoutDescriptor {
            label: None,
            entries: &[wgpu::BindGroupLayoutEntry { binding: 0, visibility: wgpu::ShaderStages::VERTEX_FRAGMENT, ty: wgpu::BindingType::Buffer { ty: wgpu::BufferBindingType::Uniform, has_dynamic_offset: false, min_binding_size: None }, count: None }],
        });
        let slots = asemic_font::brush_extra_layout(device);
        let pl = device.create_pipeline_layout(&wgpu::PipelineLayoutDescriptor { label: None, bind_group_layouts: &[Some(&layout0), slots.as_ref()], immediate_size: 0 });
        let pipeline = device.create_render_pipeline(&wgpu::RenderPipelineDescriptor {
            label: Some("asemic mesh"),
            layout: Some(&pl),
            vertex: wgpu::VertexState {
                module: &module,
                entry_point: Some("vs"),
                buffers: &[Some(wgpu::VertexBufferLayout { array_stride: size_of::<V>() as u64, step_mode: wgpu::VertexStepMode::Vertex, attributes: &wgpu::vertex_attr_array![0 => Float32x2, 1 => Float32, 2 => Float32] })],
                compilation_options: Default::default(),
            },
            fragment: Some(wgpu::FragmentState {
                module: &module,
                entry_point: Some("fs"),
                targets: &[Some(wgpu::ColorTargetState { format: crate::FORMAT, blend: Some(wgpu::BlendState::ALPHA_BLENDING), write_mask: wgpu::ColorWrites::ALL })],
                compilation_options: Default::default(),
            }),
            primitive: Default::default(),
            depth_stencil: None,
            multisample: Default::default(),
            multiview_mask: None,
            cache: None,
        });
        if let Some(e) = pollster::block_on(scope.pop()) {
            bail!("mesh shader: {e}");
        }
        let uniform = device.create_buffer(&wgpu::BufferDescriptor { label: None, size: 16, usage: wgpu::BufferUsages::UNIFORM | wgpu::BufferUsages::COPY_DST, mapped_at_creation: false });
        let bind = device.create_bind_group(&wgpu::BindGroupDescriptor { label: None, layout: &layout0, entries: &[wgpu::BindGroupEntry { binding: 0, resource: uniform.as_entire_binding() }] });
        Ok(Self { pipeline, uniform, bind })
    }

    /// Clear `tex` and draw the tessellated `ms`; `slots` = group(1) (`tex0(uv)`..).
    pub fn draw<'a>(&self, device: &wgpu::Device, queue: &wgpu::Queue, tex: &wgpu::Texture, ms: impl IntoIterator<Item = &'a Multi>, t: f32, slots: &wgpu::BindGroup) -> Result<()> {
        let geo = tessellate(ms, tex.width(), tex.height())?;
        self.draw_geo(device, queue, tex, &geo, t, slots);
        Ok(())
    }

    /// Clear `tex` and draw pre-tessellated `geo` ([`tessellate`] / [`fill`]).
    pub fn draw_geo(&self, device: &wgpu::Device, queue: &wgpu::Queue, tex: &wgpu::Texture, geo: &VertexBuffers<V, u32>, t: f32, slots: &wgpu::BindGroup) {
        use wgpu::util::DeviceExt;
        let (w, h) = (tex.width(), tex.height());
        queue.write_buffer(&self.uniform, 0, bytemuck::cast_slice(&[t, h as f32 / w as f32, w as f32, h as f32]));
        let view = tex.create_view(&Default::default());
        let mut enc = device.create_command_encoder(&Default::default());
        {
            let mut pass = enc.begin_render_pass(&wgpu::RenderPassDescriptor {
                label: Some("asemic mesh"),
                color_attachments: &[Some(wgpu::RenderPassColorAttachment {
                    view: &view,
                    resolve_target: None,
                    ops: wgpu::Operations { load: wgpu::LoadOp::Clear(wgpu::Color::BLACK), store: wgpu::StoreOp::Store },
                    depth_slice: None,
                })],
                ..Default::default()
            });
            if !geo.indices.is_empty() {
                let vb = device.create_buffer_init(&wgpu::util::BufferInitDescriptor { label: None, contents: bytemuck::cast_slice(&geo.vertices), usage: wgpu::BufferUsages::VERTEX });
                let ib = device.create_buffer_init(&wgpu::util::BufferInitDescriptor { label: None, contents: bytemuck::cast_slice(&geo.indices), usage: wgpu::BufferUsages::INDEX });
                pass.set_pipeline(&self.pipeline);
                pass.set_bind_group(0, &self.bind, &[]);
                pass.set_bind_group(1, slots, &[]);
                pass.set_vertex_buffer(0, vb.slice(..));
                pass.set_index_buffer(ib.slice(..), wgpu::IndexFormat::Uint32);
                pass.draw_indexed(0..geo.indices.len() as u32, 0, 0..1);
            }
        }
        queue.submit([enc.finish()]);
    }
}
