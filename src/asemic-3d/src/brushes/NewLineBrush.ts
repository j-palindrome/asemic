import { range } from 'lodash'
import { AsemicGroup } from 'src/AsemicPt'
import invariant from 'tiny-invariant'

export default class NewLineBrush {
  ctx: GPUCanvasContext
  device: GPUDevice

  async render(curves: AsemicGroup[]) {
    // Create vertex shader
    // Define the vertex data
    // Define the vertex data - just 4 corners of the line
    const vertices = new Float32Array(curves[0].flatMap(x => [x.x, x.y]))
    // console.log(vertices, 'vertices')

    // Create a buffer to store vertex data
    const vertexBuffer = this.device.createBuffer({
      size: vertices.byteLength,
      usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_DST,
      mappedAtCreation: true
    })

    // Write data to the buffer
    new Float32Array(vertexBuffer.getMappedRange()).set(vertices)
    vertexBuffer.unmap()

    const widths = new Float32Array(curves[0].map(x => x.width))
    // Create an index buffer
    const widthsBuffer = this.device.createBuffer({
      size: widths.byteLength,
      usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_DST,
      mappedAtCreation: true
    })
    new Float32Array(widthsBuffer.getMappedRange()).set(widths)
    widthsBuffer.unmap()

    // Define indices to form two triangles
    const indices = new Uint16Array(
      range(100).flatMap(x => [
        x * 2,
        x * 2 + 1,
        x * 2 + 2,
        x * 2 + 1,
        x * 2 + 2,
        x * 2 + 3
      ])
    )

    // Create an index buffer
    const indexBuffer = this.device.createBuffer({
      size: indices.byteLength,
      usage: GPUBufferUsage.INDEX,
      mappedAtCreation: true
    })

    // Write index data
    new Uint16Array(indexBuffer.getMappedRange()).set(indices)
    indexBuffer.unmap()
    // Define curve start indices
    const curveStarts = new Uint16Array(curves.length + 1)
    let total = 0
    for (let i = 0; i < curves.length; i++) {
      curveStarts[i] = total
      total += curves[i].length
    }
    curveStarts[curves.length] = total

    // Create a buffer for curve starts
    const curveStartsBuffer = this.device.createBuffer({
      size: curveStarts.byteLength,
      usage: GPUBufferUsage.STORAGE,
      mappedAtCreation: true
    })

    // Write curve starts data
    new Uint16Array(curveStartsBuffer.getMappedRange()).set(curveStarts)
    curveStartsBuffer.unmap()

    // Create a buffer for canvas dimensions
    const canvasDimensions = new Float32Array([
      this.ctx.canvas.width,
      this.ctx.canvas.height
    ])

    const dimensionsBuffer = this.device.createBuffer({
      size: canvasDimensions.byteLength,
      usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST,
      mappedAtCreation: true
    })

    new Float32Array(dimensionsBuffer.getMappedRange()).set(canvasDimensions)
    dimensionsBuffer.unmap()

    // Update bind group layout to include dimensions uniform
    const bindGroupLayout = this.device.createBindGroupLayout({
      entries: [
        {
          binding: 0,
          visibility: GPUShaderStage.VERTEX,
          buffer: { type: 'read-only-storage' }
        },
        {
          binding: 1,
          visibility: GPUShaderStage.VERTEX,
          buffer: { type: 'read-only-storage' }
        },
        {
          binding: 2,
          visibility: GPUShaderStage.VERTEX,
          buffer: { type: 'uniform' }
        },
        {
          binding: 3,
          visibility: GPUShaderStage.VERTEX,
          buffer: { type: 'read-only-storage' }
        }
      ]
    })

    const bindGroup = this.device.createBindGroup({
      layout: bindGroupLayout,
      entries: [
        {
          binding: 0,
          resource: { buffer: vertexBuffer }
        },
        {
          binding: 1,
          resource: { buffer: widthsBuffer }
        },
        {
          binding: 2,
          resource: { buffer: dimensionsBuffer }
        },
        {
          binding: 3,
          resource: { buffer: curveStartsBuffer }
        }
      ]
    })

    const shaderModule = this.device.createShaderModule({
      code: /*wgsl*/ `
      struct VertexOutput {
      @builtin(position) position: vec4<f32>,
      @location(0) color: vec4<f32>,
      };
      
      @group(0) @binding(0)
      var<storage, read> vertices: array<vec2<f32>>;

      @group(0) @binding(1)
      var<storage, read> widths: array<f32>;

      @group(0) @binding(2)
      var<uniform> canvas_dimensions: vec2<f32>;

      @group(0) @binding(3)
      var<storage, read> curve_starts: array<u32>;

      fn normalCoords(position: vec2<f32>) -> vec2<f32> {
      // Convert coordinates from [0, 1] to [-1, 1] on x
      let x = position.x * 2.0 - 1.0;
      // Convert coordinates from [0, 1] to [-(height/width), -(height/width)] on y
      let aspect_ratio = canvas_dimensions.y / canvas_dimensions.x;
      let y = (1.0 - position.y * 2.0) / aspect_ratio;
      return vec2<f32>(x, y);
      }

      fn bezierCurve(t: f32, p0: vec2<f32>, p1: vec2<f32>, p2: vec2<f32>, side: bool) -> vec2<f32> {
      let u = 1.0 - t;
      let tt = t * t;
      let uu = u * u;

      let width = 50. / canvas_dimensions.x;
      
      // Position on the curve
      var p = (uu * p0) + (2.0 * u * t * p1) + (tt * p2);
      
      // Derivative (tangent) vector
      let dx = 2.0 * (u * (p1.x - p0.x) + t * (p2.x - p1.x));
      let dy = 2.0 * (u * (p1.y - p0.y) + t * (p2.y - p1.y));
      
      // Tangent vector
      let tangent = vec2<f32>(dx, dy);
      
      // Normal vector (perpendicular to tangent)
      // Rotate tangent 90 degrees to get normal
      let normal = normalize(vec2<f32>(-tangent.y, tangent.x));

      if (side) {
      p = p + normal * width / 2.;
      } else {
      p = p - normal * width / 2.;
      }
      
      return p;
      }

      @vertex
      fn vertexMain(@builtin(vertex_index) vertex_index: u32) -> VertexOutput {
      var output: VertexOutput;
      const VERTEXCOUNT = 100.;
      let point_progress = f32(vertex_index / 2u) / VERTEXCOUNT;
      let side = vertex_index % 2u > 0;
      let curve = u32(point_progress);
      let curve_length = curve_starts[curve + 1] - curve_starts[curve];
      let start_at_point = u32(fract(point_progress) * f32(curve_length));

      var p0: vec2<f32> = normalCoords(vertices[start_at_point]);
      var p1: vec2<f32> = normalCoords(vertices[start_at_point + 1]);
      var p2: vec2<f32> = normalCoords(vertices[start_at_point + 2]);
      // var p0: vec2<f32> = vertices[0];
      // var p1: vec2<f32> = vertices[1];
      // var p2: vec2<f32> = vertices[2];
      
      let bezier_vertex = bezierCurve(point_progress, p0, p1, p2, side);
      
      output.position = vec4<f32>(bezier_vertex, 0.0, 1.0);
      output.color = vec4<f32>(1.0, 1.0, 1.0, 1.0); // Set the color value
      return output;
      }

      @fragment
      fn fragmentMain(input: VertexOutput) -> @location(0) vec4<f32> {
      return input.color; // Use the color passed from vertex shader
      }
      `
    })

    // const computeLayout = this.device.createComputePipeline({
    //   layout: this.device.createPipelineLayout({
    //     bindGroupLayouts: [bindGroupLayout]
    //   }),
    //   compute: {
    //     module: shaderModule,
    //     entryPoint: 'computeMain'
    //   }
    // })

    const pipeline = this.device.createRenderPipeline({
      layout: this.device.createPipelineLayout({
        bindGroupLayouts: [bindGroupLayout]
      }),
      vertex: {
        module: shaderModule,
        entryPoint: 'vertexMain'
      },
      fragment: {
        module: shaderModule,
        entryPoint: 'fragmentMain',
        targets: [{ format: navigator.gpu.getPreferredCanvasFormat() }]
      },
      primitive: {
        topology: 'triangle-list', // Using triangles instead of lines
        cullMode: 'none' // Disables face culling to render both sides
      },
      multisample: {
        count: 1
      }
    })

    // Create a method to render the line
    const commandEncoder = this.device.createCommandEncoder()
    const renderPass = commandEncoder.beginRenderPass({
      colorAttachments: [
        {
          view: this.ctx.getCurrentTexture().createView(),
          loadOp: 'clear',
          clearValue: { r: 0, g: 0, b: 0, a: 1 },
          storeOp: 'store'
        }
      ]
    })
    // Set the bind group for rendering
    renderPass.setBindGroup(0, bindGroup)
    renderPass.setPipeline(pipeline)

    // Set the index buffer and draw indexed
    renderPass.setIndexBuffer(indexBuffer, 'uint16')
    renderPass.drawIndexed(indices.length) // Draw 6 indices (2 triangles)

    renderPass.end()
    console.log('finishing')

    this.device.queue.submit([commandEncoder.finish()])
  }

  async init() {
    const adapter = await navigator.gpu.requestAdapter({
      featureLevel: 'compatibility'
    })
    invariant(adapter)
    const device = await adapter.requestDevice()
    invariant(device)
    this.device = device
    this.ctx.configure({
      device,
      format: navigator.gpu.getPreferredCanvasFormat()
    })
  }

  constructor(ctx: GPUCanvasContext) {
    this.ctx = ctx
  }
}
