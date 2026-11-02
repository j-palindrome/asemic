// const VERTEXCOUNT = 100.0;
@vertex
fn main(@builtin(vertex_index) vertex_index: u32, @builtin(instance_index) instance_index: u32) -> VertexOutput {
    var progress: Progress = scan_for_curve(instance_index);
    // let progress_float = f32(instance_index) / uniforms.vertex_count;
    // progress.curve_progress = fract(progress_float) * (uniforms.vertex_count + 1.0) / uniforms.vertex_count;
    // progress.curve = u32(progress_float);

    let sample = sample_curve(progress);
    var line_pos = sample.line_pos;
    let modifier_info = ModifierInfo(f32(progress.curve), progress.curve_progress, line_pos, vec2<f32>(0.0), vec2<f32>(0.0), line_pos, calculate_uv(line_pos, vec2<f32>(0.0)));
    let line_width = sample.line_width * process_width(modifier_info);
    let rotation = sample.rotation;
    
    // Add particle position offset if particles are active
    line_pos += get_particle_offset(instance_index);
    line_pos = process_position(modifier_info);

    // normalCoords();
    // bezier_pos.x = 0.0;
    // bezier_pos.y = 0.0;
    // let bezier_tangent = bezierTangent(t, p0, p1, p2);

    // // Lerp color with the next color
    // let color0 = select(colors[start_at_point], (colors[start_at_point] + colors[start_at_point + 1]) / 2., start_at_point > curve_starts[curve]);
    // let color1 = colors[start_at_point + 1];
    // let color2 = select(colors[start_at_point + 2], (colors[start_at_point + 1] + colors[start_at_point + 2]) / 2., start_at_point < curve_starts[curve] + curve_length - 3);
    // let color = select(mix(color0, color1, t * 2), mix(color1, color2, (t - 0.5) * 2), t > 0.5);
    //  = vec4<f32>(bezier_position.x, bezier_position.y, 0.0, 1.0);
    // output.tangent = bezier_tangent;
    // output.attr = select(mix(attrs[start_at_point], attrs[start_at_point + 1], t * 2), mix(attrs[start_at_point + 1], attrs[start_at_point + 2], (t - 0.5) * 2), t > 0.5);

    var vertex_pos = vec2<f32>(0.0);
    switch (vertex_index) {
        case 0u : {
            vertex_pos = vec2<f32>(- 0.5, - 0.5);
        }
        // Bottom-right
        case 1u : {
            vertex_pos = vec2<f32>(0.5, - 0.5);
        }
        // Top-right
        case 2u : {
            vertex_pos = vec2<f32>(0.5, 0.5);
        }
        // Top-left
        case 3u : {
            vertex_pos = vec2<f32>(- 0.5, 0.5);
        }
        default : {
            vertex_pos = vec2<f32>(0.0);
        }
    }

    // let scaled_pos = (vertex_pos * line_width + line_pos) * uniforms.aspect_ratio;
    let scaled_pos = normalCoords(rotate2d(vertex_pos, rotation) * line_width + line_pos);

    // UV processing: map vertex_pos from [-0.5, 0.5] to [0, 1]
    let uv = vertex_pos + vec2<f32>(0.5);

    var output: VertexOutput;
    output.position = vec4<f32>(scaled_pos, 0.0, 1.0);
    output.uv = uv;
    output.alpha = process_alpha(modifier_info);
    return output;
}

@fragment
fn mainFrag(@location(0) uv: vec2<f32>, @location(1) alpha: f32) -> @location(0) vec4<f32> {
    // Use UV coordinates for color or texture sampling
    let center = vec2<f32>(0.5, 0.5);
    let dist = distance(uv, center);
    let radius = 0.5;

    let modifier_info = ModifierInfo(0.0, 0.0, vec2<f32>(0.0), vec2<f32>(0.0), vec2<f32>(0.0), uv, uv);
    let brightness = process_brightness(modifier_info);

    // Create a ramped circle (soft edge)
    // let alpha = pow(max(0., (radius - dist) / radius), 4.0);

    return vec4<f32>(brightness, brightness, brightness, alpha);
}
