import { range, sum, sumBy } from 'lodash'
import { Color } from 'pts'
import { AsemicPt } from 'src/blocks/AsemicPt'
import invariant from 'tiny-invariant'
import AsemicVisual from '../AsemicVisual'
import { AsemicGroup } from 'src/Parser'

const wgslRequires = /*wgsl*/ `
  fn normalCoords(position: vec2<f32>) -> vec2<f32> {
    // Convert coordinates from [0, 1] to [-1, 1] on x
    let x = position.x * 2.0 - 1.0;
    let aspect_ratio = canvas_dimensions.y / canvas_dimensions.x;
    // Convert coordinates from [0, 0.5] to [1, -1] on y
    let y = 1.0 - position.y * (2. / aspect_ratio);
    return vec2<f32>(x, y);
  }

  fn bezierCurve(t: f32, p0: vec2<f32>, p1: vec2<f32>, p2: vec2<f32>, side: bool, width: f32) -> vec2<f32> {
    let u = 1.0 - t;
    let tt = t * t;
    let uu = u * u;
    
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

  fn hueToRgb(p: f32, q: f32, t: f32) -> f32 {
    var t_adj = t;
    if (t_adj < 0.0) { t_adj += 1.0; }
    if (t_adj > 1.0) { t_adj -= 1.0; }
    if (t_adj < 1.0/6.0) { return p + (q - p) * 6.0 * t_adj; }
    if (t_adj < 1.0/2.0) { return q; }
    if (t_adj < 2.0/3.0) { return p + (q - p) * (2.0/3.0 - t_adj) * 6.0; }
    return p;
  }

  fn hslaToRgba(hsla: vec4<f32>) -> vec4<f32> {
    let h = hsla.x;
    let s = hsla.y;
    let l = hsla.z;
    let a = hsla.w;
    
    var r: f32 = 0.0;
    var g: f32 = 0.0;
    var b: f32 = 0.0;
    
    if (s == 0.0) {
      // Achromatic (gray)
      r = l;
      g = l;
      b = l;
    } else {
      let q = select(
        l * (1.0 + s),
        l + s - l * s,
        l < 0.5
      );
      let p = 2.0 * l - q;
      
      r = hueToRgb(p, q, h + 1.0/3.0);
      g = hueToRgb(p, q, h);
      b = hueToRgb(p, q, h - 1.0/3.0);
    }
    
    return vec4<f32>(r, g, b, a);
  }
`

const calcPosition = /*wgsl*/ `
  const VERTEXCOUNT = 100.;
  let progress = f32(vertex_index / 2u) / VERTEXCOUNT;
  let single_curve_progress = min(fract(progress), 0.9999);
  let point_progress = floor(progress) + single_curve_progress;
  let side = vertex_index % 2u > 0;
  let curve = u32(progress);

  let curve_length = curve_starts[curve + 1] - curve_starts[curve];
  let start_at_point = curve_starts[curve] 
    + u32(fract(point_progress) * f32(curve_length - 2));
  let t = fract(fract(point_progress) * f32(curve_length - 2));

  var p0: vec2<f32> = (select(
    vertices[start_at_point], 
    (vertices[start_at_point] + vertices[start_at_point + 1]) / 2.,
    start_at_point > curve_starts[curve]));
  var p1: vec2<f32> = (vertices[start_at_point + 1]);
  var p2: vec2<f32> = (select(
    vertices[start_at_point + 2],
    (vertices[start_at_point + 1] + vertices[start_at_point + 2]) / 2.,
    start_at_point < curve_starts[curve] + curve_length - 3));
  
  let width0 = select(
    widths[start_at_point], 
    (widths[start_at_point] + widths[start_at_point + 1]) / 2., 
    start_at_point > curve_starts[curve]);
  let width1 = widths[start_at_point + 1];
  let width2 = select(
    widths[start_at_point + 2],
    (widths[start_at_point + 1] + widths[start_at_point + 2]) / 2.,
    start_at_point < curve_starts[curve] + curve_length - 3);
  
  var width = select(
    mix(width1, width0, pow(1 - t * 2, 2)), 
    mix(width1, width2, pow((t - 0.5) * 2, 2)), 
    t > 0.5);
  width /= canvas_dimensions.x / 2;

  let bezier_position = normalCoords(bezierCurve(t, p0, p1, p2, side, width));
  let uv = vec2<f32>(single_curve_progress, select(0., 1., side));

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
  `

export default class WebGPURenderer extends AsemicVisual {
  private brushes: WebGPUBrush[] = []
  ctx: GPUCanvasContext
  device: GPUDevice
  isSetup = false

  constructor(ctx: GPUCanvasContext) {
    super()
    this.ctx = ctx
    this.setup()
  }

  async setup() {
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
    this.isSetup = true
  }

  render(groups: AsemicGroup[]): void {
    if (!this.isSetup) return
    const commandEncoder = this.device.createCommandEncoder()
    for (let i = 0; i < groups.length; i++) {
      if (!this.brushes[i]) {
        let brush: WebGPUBrush
        switch (groups[i].settings.mode) {
          case 'curve':
            brush = new WebGPULineBrush(this.ctx, this.device)
            break
          case 'fill':
            brush = new WebGPUFillBrush(this.ctx, this.device)
            break
        }
        this.brushes.push(brush)
      }
      this.brushes[i].render(groups[i], commandEncoder)
    }
    this.device.queue.submit([commandEncoder.finish()])
  }
}

abstract class WebGPUBrush {
  ctx: GPUCanvasContext
  device: GPUDevice
  pipeline: GPURenderPipeline
  bindGroup: GPUBindGroup
  shaderModule: GPUShaderModule
  dimensions: { buffer: GPUBuffer; size: number }
  widths: { buffer: GPUBuffer; size: number }
  curveStarts: { buffer: GPUBuffer; size: number; array: Uint32Array }
  vertex: { buffer: GPUBuffer; size: number }
  index: { buffer: GPUBuffer; size: number }
  colors: { buffer: GPUBuffer; size: number }

  protected abstract loadIndex(curves: AsemicGroup): Uint32Array
  protected abstract loadPipeline(
    bindGroupLayout: GPUBindGroupLayout
  ): GPURenderPipeline
  protected abstract loadShader(): GPUShaderModule

  protected reload(curves: AsemicPt[][]) {
    const vertices = new Float32Array(
      curves.flatMap(x => x.flatMap(x => [x.x, x.y]))
    )

    this.device.queue.writeBuffer(this.vertex.buffer, 0, vertices)

    const widths = new Float32Array(curves.flatMap(x => x.flatMap(x => x.w)))
    this.device.queue.writeBuffer(this.widths.buffer, 0, widths)

    const colors = new Float32Array(
      curves.flatMap(x => x.flatMap(x => [x.h, x.s, x.l, x.a]))
    )

    this.device.queue.writeBuffer(this.colors.buffer, 0, colors)

    // Create a buffer for canvas dimensions
    const canvasDimensions = new Float32Array([
      this.ctx.canvas.width,
      this.ctx.canvas.height
    ])

    this.device.queue.writeBuffer(this.dimensions.buffer, 0, canvasDimensions)
  }

  load(curves: AsemicGroup) {
    const vertexBuffer = this.device.createBuffer({
      size: Float32Array.BYTES_PER_ELEMENT * sumBy(curves, x => x.length * 2),
      usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_DST,
      mappedAtCreation: false,
      label: 'vertex'
    })

    // Create an index buffer
    const widthsBuffer = this.device.createBuffer({
      size: Float32Array.BYTES_PER_ELEMENT * sumBy(curves, x => x.length * 2),
      usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_DST,
      mappedAtCreation: false,
      label: 'widths'
    })

    const colorsBuffer = this.device.createBuffer({
      size: Float32Array.BYTES_PER_ELEMENT * sumBy(curves, x => x.length * 4),
      usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_DST,
      mappedAtCreation: false,
      label: 'colors'
    })

    const indices = this.loadIndex(curves)

    // Create an index buffer
    const indexBuffer = this.device.createBuffer({
      size: indices.byteLength,
      usage: GPUBufferUsage.INDEX,
      mappedAtCreation: true,
      label: 'index buffer'
    })

    // Write index data
    new Uint32Array(indexBuffer.getMappedRange()).set(indices)
    indexBuffer.unmap()

    // Define curve start indices
    const curveStarts = new Uint32Array(curves.length + 1)
    let total = 0
    for (let i = 0; i < curves.length; i++) {
      curveStarts[i] = total
      total += curves[i].length
    }
    curveStarts[curves.length] = total

    // Create a buffer for curve starts
    const curveStartsBuffer = this.device.createBuffer({
      size: curveStarts.byteLength,
      usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_DST,
      mappedAtCreation: true,
      label: 'curve starts'
    })

    // Write curve starts data
    new Uint32Array(curveStartsBuffer.getMappedRange()).set(curveStarts)
    curveStartsBuffer.unmap()

    const dimensionsBuffer = this.device.createBuffer({
      size: Float32Array.BYTES_PER_ELEMENT * 2,
      usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST,
      mappedAtCreation: false,
      label: 'canvas dimensions'
    })

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
        },
        {
          binding: 4,
          visibility: GPUShaderStage.VERTEX,
          buffer: { type: 'read-only-storage' }
        }
      ]
    })

    const pipeline = this.loadPipeline(bindGroupLayout)

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
        },
        {
          binding: 4,
          resource: { buffer: colorsBuffer }
        }
      ]
    })

    // Store pipeline and resources as instance properties
    this.pipeline = pipeline
    this.bindGroup = bindGroup
    if (this.index) {
      this.index.buffer.destroy()
      this.dimensions.buffer.destroy()
      this.widths.buffer.destroy()
      this.curveStarts.buffer.destroy()
      this.vertex.buffer.destroy()
      this.colors.buffer.destroy()
    }
    this.colors = {
      buffer: colorsBuffer,
      size: sumBy(curves, x => x.length * 4)
    }

    this.index = { buffer: indexBuffer, size: indices.length }

    this.dimensions = { buffer: dimensionsBuffer, size: 2 }
    this.widths = {
      buffer: widthsBuffer,
      size: sumBy(curves, x => x.length * 2)
    }
    this.curveStarts = {
      buffer: curveStartsBuffer,
      size: curveStarts.length,
      array: curveStarts
    }
    this.vertex = {
      buffer: vertexBuffer,
      size: sumBy(curves, x => x.length * 2)
    }
  }

  render(curves: AsemicGroup, commandEncoder: GPUCommandEncoder) {
    if (curves.length === 0 || (curves.length < 2 && curves[0].length < 2)) {
      return
    }

    if (!this.vertex) {
      this.load(curves)
    } else if (this.curveStarts.size !== curves.length + 1) {
      this.load(curves)
    } else {
      let total = 0
      for (let i = 0; i < curves.length + 1; i++) {
        if (this.curveStarts.array[i] !== total) {
          this.load(curves)
          break
        }
        if (!curves[i]) break
        total += curves[i].length
      }
    }
    this.reload(curves)
    const renderPass = commandEncoder.beginRenderPass({
      colorAttachments: [
        {
          view: this.ctx.getCurrentTexture().createView(), // This needs to be fresh each frame
          loadOp: 'load',
          clearValue: { r: 0, g: 0, b: 0, a: 1 },
          storeOp: 'store'
        }
      ]
    })

    // These operations could all be done once during init
    renderPass.setBindGroup(0, this.bindGroup)
    renderPass.setPipeline(this.pipeline)
    renderPass.setIndexBuffer(this.index.buffer, 'uint32')
    // This needs to stay in the render method
    renderPass.drawIndexed(this.index.size)
    renderPass.end()
  }

  async log() {
    // Create a storage buffer for logging
    const logBufferSize = 600 // Adjust size as needed
    const SIZE = Float32Array.BYTES_PER_ELEMENT * logBufferSize * 4
    const logBuffer = this.device.createBuffer({
      size: SIZE,
      usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_SRC,
      mappedAtCreation: false,
      label: 'log buffer'
    })

    // Create readback buffer for retrieving results
    const readbackBuffer = this.device.createBuffer({
      size: SIZE,
      usage: GPUBufferUsage.COPY_DST | GPUBufferUsage.MAP_READ,
      mappedAtCreation: false,
      label: 'readback buffer'
    })

    // Create compute shader module
    const computeShaderModule = this.device.createShaderModule({
      code: /*wgsl*/ `
        @group(0) @binding(0)
        var<storage, read> vertices: array<vec2<f32>>;
        
        @group(0) @binding(1)
        var<storage, read> widths: array<f32>;
        
        @group(0) @binding(2)
        var<uniform> canvas_dimensions: vec2<f32>;
        
        @group(0) @binding(3)
        var<storage, read> curve_starts: array<u32>;
        
        @group(0) @binding(4)
        var<storage, read> colors: array<vec4<f32>>;
        
        @group(0) @binding(5)
        var<storage, read_write> log_output: array<vec4<f32>>;
        
        ${wgslRequires}
        
        @compute @workgroup_size(100)
        fn main(@builtin(global_invocation_id) global_id: vec3<u32>) {
          let vertex_index = global_id.x * 200;
          
          ${calcPosition}
          
          // Log the curve index for this vertex
          log_output[global_id.x] = vec4<f32>(bezier_position.x, bezier_position.y, 0., 0.);
        }
      `
    })

    // Create compute pipeline
    const computePipeline = this.device.createComputePipeline({
      layout: this.device.createPipelineLayout({
        bindGroupLayouts: [
          this.device.createBindGroupLayout({
            entries: [
              {
                binding: 0,
                visibility: GPUShaderStage.COMPUTE,
                buffer: { type: 'read-only-storage' }
              },
              {
                binding: 1,
                visibility: GPUShaderStage.COMPUTE,
                buffer: { type: 'read-only-storage' }
              },
              {
                binding: 2,
                visibility: GPUShaderStage.COMPUTE,
                buffer: { type: 'uniform' }
              },
              {
                binding: 3,
                visibility: GPUShaderStage.COMPUTE,
                buffer: { type: 'read-only-storage' }
              },
              {
                binding: 4,
                visibility: GPUShaderStage.COMPUTE,
                buffer: { type: 'read-only-storage' }
              },
              {
                binding: 5,
                visibility: GPUShaderStage.COMPUTE,
                buffer: { type: 'storage' }
              }
            ]
          })
        ]
      }),
      compute: {
        module: computeShaderModule,
        entryPoint: 'main'
      }
    })

    // Function to run the compute shader and log the results

    const computeBindGroup = this.device.createBindGroup({
      layout: computePipeline.getBindGroupLayout(0),
      entries: [
        { binding: 0, resource: { buffer: this.vertex.buffer } },
        { binding: 1, resource: { buffer: this.widths.buffer } },
        { binding: 2, resource: { buffer: this.dimensions.buffer } },
        { binding: 3, resource: { buffer: this.curveStarts.buffer } },
        { binding: 4, resource: { buffer: this.colors.buffer } },
        { binding: 5, resource: { buffer: logBuffer } }
      ]
    })

    const commandEncoder = this.device.createCommandEncoder()
    const computePass = commandEncoder.beginComputePass()
    computePass.setPipeline(computePipeline)
    computePass.setBindGroup(0, computeBindGroup)
    computePass.dispatchWorkgroups(Math.ceil(600 / 100))
    computePass.end()

    // Copy results to readback buffer
    commandEncoder.copyBufferToBuffer(logBuffer, 0, readbackBuffer, 0, SIZE)

    this.device.queue.submit([commandEncoder.finish()])

    // Read back the results
    await readbackBuffer.mapAsync(GPUMapMode.READ)
    const results = new Float32Array(readbackBuffer.getMappedRange())
    console.log('LOG:', [...results])
    readbackBuffer.unmap()
  }

  constructor(ctx: GPUCanvasContext, device: GPUDevice) {
    this.ctx = ctx
    this.device = device
    this.shaderModule = this.loadShader()
  }
}

class WebGPULineBrush extends WebGPUBrush {
  loadShader() {
    return this.device.createShaderModule({
      code: /*wgsl*/ `
      struct VertexOutput {
      @builtin(position) position: vec4<f32>,
      @location(0) color: vec4<f32>,
      @location(1) uv: vec2<f32>
      };
      
      @group(0) @binding(0)
      var<storage, read> vertices: array<vec2<f32>>;

      @group(0) @binding(1)
      var<storage, read> widths: array<f32>;

      @group(0) @binding(2)
      var<uniform> canvas_dimensions: vec2<f32>;

      @group(0) @binding(3)
      var<storage, read> curve_starts: array<u32>;

      @group(0) @binding(4)
      var<storage, read> colors: array<vec4<f32>>;

      ${wgslRequires}

      @vertex
      fn vertexMain(@builtin(vertex_index) vertex_index: u32) -> VertexOutput {
      var output: VertexOutput;
      ${calcPosition}
      
      output.position = vec4<f32>(bezier_position.x, bezier_position.y, 0.0, 1.0);

      output.uv = uv; // Pass the UV coordinates to the fragment shader
      output.color = hslaToRgba(color);
      return output;
      }

      @fragment
      fn fragmentMain(input: VertexOutput) -> @location(0) vec4<f32> {
      // Gaussian function parameters
      // let mean = 0.5;
      // let sigma = 0.15;
      // let y = input.uv.y;
      
      // // Gaussian curve: f(x) = exp(-(x-mean)²/(2*sigma²))
      // let gaussian = exp(-pow(y - mean, 2.0) / (2.0 * pow(sigma, 2.0)));
      
      return input.color;
      }
      `
    })
  }

  protected loadPipeline(bindGroupLayout: GPUBindGroupLayout) {
    return this.device.createRenderPipeline({
      layout: this.device.createPipelineLayout({
        bindGroupLayouts: [bindGroupLayout]
      }),
      vertex: {
        module: this.shaderModule,
        entryPoint: 'vertexMain'
      },
      fragment: {
        module: this.shaderModule,
        entryPoint: 'fragmentMain',
        targets: [
          {
            format: navigator.gpu.getPreferredCanvasFormat(),
            blend: {
              color: {
                srcFactor: 'src-alpha',
                dstFactor: 'one-minus-src-alpha',
                operation: 'add'
              },
              alpha: {
                srcFactor: 'one',
                dstFactor: 'one-minus-src-alpha',
                operation: 'add'
              }
            }
          }
        ]
      },
      primitive: {
        topology: 'triangle-list', // Using triangles instead of lines
        cullMode: 'none' // Disables face culling to render both sides
      },
      multisample: {
        count: 1
      }
    })
  }

  protected loadIndex(curves: AsemicGroup) {
    // Create a buffer to store vertex data

    // Define indices to form two triangles
    const indices = new Uint32Array(
      range(curves.length).flatMap(i =>
        range(99).flatMap(x => [
          i * 200 + x * 2,
          i * 200 + x * 2 + 1,
          i * 200 + x * 2 + 2,
          i * 200 + x * 2 + 1,
          i * 200 + x * 2 + 2,
          i * 200 + x * 2 + 3
        ])
      )
    )

    return indices
  }
}

class WebGPUFillBrush extends WebGPUBrush {
  protected loadShader() {
    return this.device.createShaderModule({
      code: /*wgsl*/ `
      struct VertexOutput {
      @builtin(position) position: vec4<f32>,
      @location(0) color: vec4<f32>,
      @location(1) uv: vec2<f32>
      };
      
      @group(0) @binding(0)
      var<storage, read> vertices: array<vec2<f32>>;

      @group(0) @binding(1)
      var<storage, read> widths: array<f32>;

      @group(0) @binding(2)
      var<uniform> canvas_dimensions: vec2<f32>;

      @group(0) @binding(3)
      var<storage, read> curve_starts: array<u32>;

      @group(0) @binding(4)
      var<storage, read> colors: array<vec4<f32>>;

      ${wgslRequires}

      @vertex
      fn vertexMain(@builtin(vertex_index) vertex_index: u32) -> VertexOutput {
      var output: VertexOutput;
      ${calcPosition}
      
      output.position = vec4<f32>(bezier_position.x, bezier_position.y, 0.0, 1.0);

      output.uv = uv; // Pass the UV coordinates to the fragment shader
      output.color = hslaToRgba(color);
      return output;
      }

      @fragment
      fn fragmentMain(input: VertexOutput) -> @location(0) vec4<f32> {
      // Gaussian function parameters
      // let mean = 0.5;
      // let sigma = 0.15;
      // let y = input.uv.y;
      
      // // Gaussian curve: f(x) = exp(-(x-mean)²/(2*sigma²))
      // let gaussian = exp(-pow(y - mean, 2.0) / (2.0 * pow(sigma, 2.0)));
      
      return input.color;
      }
      `
    })
  }

  protected loadIndex(curves: AsemicGroup) {
    // Create a buffer to store vertex data

    const indices = new Uint32Array(
      range(curves.length).flatMap(i =>
        range(99).flatMap(x => [
          i * 200,
          i * 200 + x * 2 + 1,
          i * 200 + x * 2 + 3
        ])
      )
    )

    return indices
  }

  protected loadPipeline(
    bindGroupLayout: GPUBindGroupLayout
  ): GPURenderPipeline {
    return this.device.createRenderPipeline({
      layout: this.device.createPipelineLayout({
        bindGroupLayouts: [bindGroupLayout]
      }),
      vertex: {
        module: this.shaderModule,
        entryPoint: 'vertexMain'
      },
      fragment: {
        module: this.shaderModule,
        entryPoint: 'fragmentMain',
        targets: [
          {
            format: navigator.gpu.getPreferredCanvasFormat(),
            blend: {
              color: {
                srcFactor: 'src-alpha',
                dstFactor: 'one-minus-src-alpha',
                operation: 'add'
              },
              alpha: {
                srcFactor: 'one',
                dstFactor: 'one-minus-src-alpha',
                operation: 'add'
              }
            }
          }
        ]
      },
      primitive: {
        topology: 'triangle-list',
        cullMode: 'none'
      },
      multisample: {
        count: 1
      }
    })
  }
}
