@vertex
fn main(@builtin(vertex_index) vertex_index: u32, @builtin(instance_index) instance_index: u32) -> VertexOutput {
    // Each instance represents a point to render as a square
    var line_pos = vertices[instance_index];
    line_pos += get_particle_offset(instance_index);
    let modifier_info = ModifierInfo(f32(instance_index), 0.0, line_pos, vec2<f32>(0.0), vec2<f32>(0.0), line_pos, calculate_uv(line_pos, vec2<f32>(0.0)));
    line_pos = process_position(modifier_info);
    let dot_size = process_width(modifier_info) * 0.05; // Normalized size
    
    // Generate square vertices based on vertex_index (0-5 for 2 triangles)
    var vertex_pos = vec2<f32>(0.0);
    switch (vertex_index % 6u) {
        case 0u : {
            // Bottom-left
            vertex_pos = vec2<f32>(-0.5, -0.5);
        }
        case 1u : {
            // Bottom-right
            vertex_pos = vec2<f32>(0.5, -0.5);
        }
        case 2u : {
            // Top-right
            vertex_pos = vec2<f32>(0.5, 0.5);
        }
        case 3u : {
            // Top-left
            vertex_pos = vec2<f32>(-0.5, 0.5);
        }
        case 4u : {
            // Top-right (second triangle)
            vertex_pos = vec2<f32>(0.5, 0.5);
        }
        case 5u : {
            // Bottom-left (second triangle)
            vertex_pos = vec2<f32>(-0.5, -0.5);
        }
        default : {
            vertex_pos = vec2<f32>(0.0);
        }
    }

    // Scale and position the square
    let scaled_pos = normalCoords(vertex_pos * dot_size + line_pos);

    // UV mapping: map vertex_pos from [-0.5, 0.5] to [0, 1]
    let uv = vertex_pos + vec2<f32>(0.5);

    var output: VertexOutput;
    output.position = vec4<f32>(scaled_pos, 0.0, 1.0);
    output.uv = uv;
    output.alpha = process_alpha(modifier_info);
    return output;
}

@fragment
fn mainFrag(@location(0) uv: vec2<f32>, @location(1) alpha: f32) -> @location(0) vec4<f32> {
    // Simple square fragment with optional brightness modulation
    let modifier_info = ModifierInfo(0.0, 0.0, vec2<f32>(0.0), vec2<f32>(0.0), vec2<f32>(0.0), uv, uv);
    let brightness = process_brightness(modifier_info);
    return vec4<f32>(brightness, brightness, brightness, alpha);
}
