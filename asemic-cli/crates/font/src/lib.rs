#![allow(unused)] // lint debt came with the vendored files
//! asemic-repl `src/font` math, vendored (was `#[path]`-compiled from ../ipad-drawing, retired):
//! the GPU-free files are local now (one source of truth = this crate).
//! brush.rs / drawing.rs / text.rs from upstream (wgpu, winit) stayed behind: brush.rs /
//! util.rs are vendored under `gpu`; drawing.rs / text.rs never made the cut.

pub mod curves;
pub mod default_chars;
pub mod glyphs;
pub mod paths;

pub mod outline;

pub use curves::*;
pub use glyphs::*;
pub use paths::*;
pub use glam;

/// The files import `crate::font::…` (their home module in asemic-repl).
pub mod font {
    pub use super::*;
}

#[cfg(feature = "gpu")]
pub mod brush;
#[cfg(feature = "gpu")]
pub mod util;
#[cfg(feature = "gpu")]
pub use brush::*;
#[cfg(feature = "gpu")]
pub use util::*;
#[cfg(feature = "gpu")]
pub use wgpu;
/// brush.rs imports drawing.rs `DrawGroup` (unused there; drawing.rs = winit/OSC, stays behind).
#[cfg(feature = "gpu")]
pub struct DrawGroup;

/// GPU-free half of brush.rs `Curves` (used when the gpu feature is off).
#[cfg(not(feature = "gpu"))]
#[derive(Debug)]
pub struct Curves {
    pub vertices: Vec<glam::Vec2>,
    pub curve_starts: Vec<u32>,
    pub widths: Vec<f32>,
    pub curve_lengths: Vec<u32>,
    pub total_instances: u32,
}

/// WESL linker (plan T37§3.2): shadows upstream identity `util::link_shader`.
/// `import lygia::…` resolves to vendored lygia `.wesl`; plain WGSL passes through.
#[cfg(feature = "gpu")]
pub mod link;
#[cfg(feature = "gpu")]
pub use link::{brush_extra_layout, link_shader};

/// Upstream `ModifierInfo` + helpers (reads `uniforms.aspect_ratio`), for pipelines outside
/// the asemic-repl brushes (draw mesh look).
pub const SHARED_WGSL: &str = include_str!("shaders/shared_functions.wgsl");
