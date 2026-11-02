use std::collections::HashMap;

pub fn assemble_params(params: Option<&HashMap<String, f32>>) -> String {
    let mut assemble_params = "struct Uniforms {
  time: f32,
  aspect_ratio: f32,
  fade: f32,
  width: f32,
  custom: vec4<f32>,"
        .to_string();
    if let Some(params) = params {
        let mut sorted_params: Vec<_> = params.iter().collect();
        sorted_params.sort_by_key(|(name, _)| *name);
        for (name, _value) in sorted_params {
            assemble_params.push_str(&format!("\n  {}: f32,", name));
        }
    }
    assemble_params.push_str("\n}\n");
    assemble_params
}

/// `get_mapped_range_mut` returns `BufferViewMut` (wgpu 29) or `Result<BufferViewMut, _>`
/// (wgpu 30); `.mapped()` accepts both so asemic-repl and asemic-cli share brush.rs.
pub trait MappedMut {
    fn mapped(self) -> wgpu::BufferViewMut;
}
impl MappedMut for wgpu::BufferViewMut {
    fn mapped(self) -> wgpu::BufferViewMut {
        self
    }
}
impl<E: std::fmt::Debug> MappedMut for Result<wgpu::BufferViewMut, E> {
    fn mapped(self) -> wgpu::BufferViewMut {
        self.expect("buffer mapped at creation")
    }
}

/// Hook for assembled brush WGSL before `create_shader_module`. Identity here;
/// asemic-cli shadows it with a WESL linker (lygia imports).
pub fn link_shader(src: String) -> String {
    src
}

/// Hook for an extra brush bind group (@group(1)) layout. None here; asemic-cli shadows
/// it with texture-node slots sampled by shader modifiers.
pub fn brush_extra_layout(_device: &wgpu::Device) -> Option<wgpu::BindGroupLayout> {
    None
}
