struct ViewportUniforms {
    width: f32,
    height: f32
}

@group(0) @binding(0)
var input_texture: texture_2d<f32>;

@group(0) @binding(1)
var input_sampler: sampler;

@group(0) @binding(2)
var previous_texture: texture_2d<f32>;

@group(0) @binding(3)
var<uniform> viewport: ViewportUniforms;

@vertex
fn vs_main(@builtin(vertex_index) vertex_index: u32) -> @builtin(position) vec4<f32> {
    var pos = array(vec2(-1.0, -1.0), vec2(3.0, -1.0), vec2(-1.0, 3.0));
    return vec4(pos[vertex_index], 0.0, 1.0);
}

@fragment
fn fs_main(@builtin(position) position: vec4<f32>) -> @location(0) vec4<f32> {
    let viewport_dims = vec2<f32>(viewport.width, viewport.height);
    var uv = vec2(position.x / viewport_dims.x, 1.0 - position.y / viewport_dims.y);
    var camera_uv = vec2(position.x / viewport_dims.x, 1.0 - position.y / viewport_dims.y);
    let color = textureSample(input_texture, input_sampler, uv);
    let previous_texture_color = textureSample(previous_texture, input_sampler, camera_uv);
    let blended = vec4((color.rgb + previous_texture_color.rgb) * 0.5, color.a);
    return blended;
}

