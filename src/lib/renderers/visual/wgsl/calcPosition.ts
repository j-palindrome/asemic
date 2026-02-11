import WebGPUBrush from '../WebGPUBrush'

export default function calcPosition(parser: WebGPUBrush) {
  return /*wgsl*/ `
    const VERTEXCOUNT = ${parser.settings.count}.;
    const CORRECTION = ${parser.settings.correction}.;
    var progress = f32(vertex_index / 2u) / VERTEXCOUNT;
    let curve_progress = fract(progress) * ((VERTEXCOUNT + 1.) / VERTEXCOUNT);
    let point_progress = floor(progress) + curve_progress;
    let side = vertex_index % 2u == 0;
    let curve = u32(progress);

    let curve_length = curve_starts[curve + 1] - curve_starts[curve];

    ${
      parser.settings.curve === 'true'
        ? /*wgsl*/ `
    let start_at_point = curve_starts[curve] 
      + u32(fract(point_progress) * f32(curve_length - 2));
    let t = fract(fract(point_progress) * f32(curve_length - 2));
    
    let width0 = select(
      widths[start_at_point], 
      (widths[start_at_point] + widths[start_at_point + 1]) / 2., 
      start_at_point > curve_starts[curve]);
    let width1 = widths[start_at_point + 1];
    let width2 = select(
      widths[start_at_point + 2],
      (widths[start_at_point + 1] + widths[start_at_point + 2]) / 2.,
      start_at_point < curve_starts[curve] + curve_length - 3);
    var p0: vec2<f32> = (select(
      vertices[start_at_point], 
      (vertices[start_at_point] + vertices[start_at_point + 1]) / 2.,
      start_at_point > curve_starts[curve]));
    var p1: vec2<f32> = (vertices[start_at_point + 1]);
    var p2: vec2<f32> = (select(
      vertices[start_at_point + 2],
      (vertices[start_at_point + 1] + vertices[start_at_point + 2]) / 2.,
      start_at_point < curve_starts[curve] + curve_length - 3));
    if (start_at_point == curve_starts[curve]) {
      let direction = normalize(p1 - p0);
      p0 = p0 - direction * (width0 / 2) / canvas_dimensions.x;
    }
    if (start_at_point == curve_starts[curve] + curve_length - 3) {
      let direction = normalize(p1 - p2);
      p2 = p2 - direction * (width2 / 2) / canvas_dimensions.x;
    }
    
    var width = select(
      mix(width1, width0, 1 - t * 2), 
      mix(width1, width2, (t - 0.5) * 2),      
      t > 0.5);
    
    let bezier_position = normalCoords(bezierCurve(t, p0, p1, p2, side, width));
    let bezier_tangent = bezierTangent(t, p0, p1, p2);
    
    // Lerp color with the next color
    let color0 = select(
      colors[start_at_point], 
      (colors[start_at_point] + colors[start_at_point + 1]) / 2., 
      start_at_point > curve_starts[curve]);
    let color1 = colors[start_at_point + 1];
    let color2 = select(
      colors[start_at_point + 2],
      (colors[start_at_point + 1] + colors[start_at_point + 2]) / 2.,
      start_at_point < curve_starts[curve] + curve_length - 3);
    let color = select(
      mix(color0, color1, t * 2), 
      mix(color1, color2, (t - 0.5) * 2), 
      t > 0.5);
    output.position = vec4<f32>(bezier_position.x, bezier_position.y, 0.0, 1.0);
    output.tangent = bezier_tangent;`
        : /*wgsl*/ `
    let start_at_point = curve_starts[curve] + u32(fract(point_progress) * f32(curve_length - 1));
    let t = fract(fract(point_progress) * f32(curve_length - 1));
    var p0 = vertices[start_at_point];
    var p1 = vertices[start_at_point + 1];

    let direction = normalize(p1 - p0);
    p0 = p0 - direction * (widths[start_at_point] / canvas_dimensions.x);
    p1 = p1 + direction * ((widths[start_at_point + 1] + CORRECTION) / canvas_dimensions.x);

    let width = mix(widths[start_at_point], widths[start_at_point + 1], t);
    
    let tangent = p1 - p0;
    let normal = normalize(vec2<f32>(-tangent.y, tangent.x));
    
    var point_on_line = mix(p0, p1, t);
    if (side) {
      point_on_line = point_on_line + normal * width / 2.;
    } else {
      point_on_line = point_on_line - normal * width / 2.;
    }

    let position = normalCoords(point_on_line);
    let color0 = colors[start_at_point];
    let color1 = colors[start_at_point + 1];
    let color = mix(color0, color1, t);

    output.position = vec4<f32>(position.x, position.y, 0.0, 1.0);
    output.tangent = tangent;
      `
    }
    
    let uv = vec2<f32>(curve_progress, select(0., 1., side));
    output.uv = uv; // Pass the UV coordinates to the fragment shader
    output.color = hslaToRgba(color);
    output.attr = attrs[start_at_point];

    let P = curve_progress;
    let C = f32(curve);
    let N = curve_length;
    let T = time;
    let S = scrub;
    ${
      parser.settings.a
        ? /*wgsl*/ `
      output.color.a = ${parser.settings.a};
    `
        : /*wgsl*/ ``
    }
    output.t = progress;
    let offset = vec2<f32>(${parser.settings.vert});
    output.position.x += offset.x;
    output.position.y += offset.y;
    `
}
