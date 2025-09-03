import { range, sum, sumBy } from 'lodash'
import { AsemicPt, BasicPt } from '../../blocks/AsemicPt'
import invariant from 'tiny-invariant'
import AsemicVisual from '../AsemicVisual'
import { AsemicGroup } from '../../parser/Parser'
import { Glsl } from '../../hydra-compiler/src/glsl/Glsl'
import { compileWithContext, src } from '../../hydra-compiler'
import { utilityFunctions } from '../../hydra-compiler/src/glsl/utilityFunctions'
import { CompiledTransform } from '../../hydra-compiler/src/compiler/compileWithContext'

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
  if (start_at_point == curve_starts[curve]) {
    let direction = normalize(p1 - p0);
    p0 = p0 - direction * width0 * .9 / canvas_dimensions.x;
  }
  if (start_at_point == curve_starts[curve] + curve_length - 3) {
    let direction = normalize(p1 - p2);
    p2 = p2 - direction * width2 * .9 / canvas_dimensions.x;
  }
  
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
  private textureDebugger: Background | null = null
  ctx: GPUCanvasContext
  device: GPUDevice
  isSetup = false
  private postProcess: PostProcessQuad | null = null
  private offscreenTexture: GPUTexture | null = null
  private offscreenView: GPUTextureView | null = null
  fragmentGenerator: (src: Glsl) => Glsl

  constructor(
    ctx: GPUCanvasContext,
    fragmentGenerator: (src: Glsl) => Glsl = src => src
  ) {
    super()
    this.ctx = ctx
    this.fragmentGenerator = fragmentGenerator

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
    // Create postprocess quad
    this.createOffscreenTexture()

    // Create offscreen texture
    this.isSetup = true
  }

  private createOffscreenTexture() {
    const width = this.ctx.canvas.width
    const height = this.ctx.canvas.height
    this.offscreenTexture = this.device.createTexture({
      size: [width, height, 1],
      format: navigator.gpu.getPreferredCanvasFormat(),
      usage: GPUTextureUsage.RENDER_ATTACHMENT | GPUTextureUsage.TEXTURE_BINDING
    })
    this.offscreenView = this.offscreenTexture.createView()
    this.postProcess = new PostProcessQuad(
      this.ctx,
      this.device,
      this.offscreenView!,
      {
        fragmentGenerator: this.fragmentGenerator
      }
    )
  }

  protected generateBrush(group: AsemicGroup) {
    let brush: WebGPUBrush
    switch (group.settings.mode) {
      case 'line':
        brush = new WebGPULineBrush(this.ctx, this.device)
        break
      case 'fill':
        brush = new WebGPUFillBrush(this.ctx, this.device)
        break
    }
    return brush
  }

  render(groups: AsemicGroup[]): void {
    if (!this.isSetup) return

    // Recreate offscreen texture if canvas size changed
    if (
      !this.offscreenTexture ||
      this.ctx.canvas.width !== this.offscreenTexture.width ||
      this.ctx.canvas.height !== this.offscreenTexture.height
    ) {
      this.createOffscreenTexture()
    }

    const commandEncoder = this.device.createCommandEncoder()

    // Render groups to offscreen texture
    const offscreenPass = commandEncoder.beginRenderPass({
      colorAttachments: [
        {
          view: this.offscreenView!,
          loadOp: 'clear',
          clearValue: { r: 0, g: 0, b: 0, a: 1 },
          storeOp: 'store'
        }
      ]
    })

    for (let i = 0; i < groups.length; i++) {
      if (!this.brushes[i]) {
        this.brushes.push(this.generateBrush(groups[i]))
      } else if (this.brushes[i].mode !== groups[i].settings.mode) {
        this.brushes[i].destroy()
        this.brushes[i] = this.generateBrush(groups[i])
        this.brushes[i].load(groups[i])
      }
      // Render to offscreen pass
      this.brushes[i].render(groups[i], offscreenPass)
    }
    offscreenPass.end()

    // Postprocess: render screen quad with offscreen texture to canvas
    this.postProcess!.render(commandEncoder)

    this.device.queue.submit([commandEncoder.finish()])
  }
}

class Background {
  ctx: GPUCanvasContext
  device: GPUDevice
  pipeline: GPURenderPipeline | null = null
  bindGroup: GPUBindGroup | null = null
  texture: GPUTexture | null = null

  constructor(ctx: GPUCanvasContext, device: GPUDevice) {
    this.ctx = ctx
    this.device = device
  }

  private createPipeline() {
    const shaderModule = this.device.createShaderModule({
      code: /*wgsl*/ `
      struct VertexOutput {
        @builtin(position) position: vec4<f32>,
        @location(0) uv: vec2<f32>
      };
      
      @group(0) @binding(0) var textureSampler: sampler;
      @group(0) @binding(1) var tex: texture_2d<f32>;
      
      @vertex
      fn vertexMain(@builtin(vertex_index) vertex_index: u32) -> VertexOutput {
        var output: VertexOutput;
        var positions = array<vec2<f32>, 6>(
        vec2<f32>(-1.0, -1.0), // Bottom left
        vec2<f32>( 1.0, -1.0), // Bottom right
        vec2<f32>(-1.0,  1.0), // Top left
        vec2<f32>( 1.0, -1.0), // Bottom right
        vec2<f32>( 1.0,  1.0), // Top right
        vec2<f32>(-1.0,  1.0)  // Top left
        );
        var uvs = array<vec2<f32>, 6>(
        vec2<f32>(0.0, 1.0), // Bottom left
        vec2<f32>(1.0, 1.0), // Bottom right
        vec2<f32>(0.0, 0.0), // Top left
        vec2<f32>(1.0, 1.0), // Bottom right
        vec2<f32>(1.0, 0.0), // Top right
        vec2<f32>(0.0, 0.0)  // Top left
        );
        
        output.position = vec4<f32>(positions[vertex_index], 0.0, 1.0);
        output.uv = uvs[vertex_index];
        
        return output;
      }
      
      @fragment
      fn fragmentMain(input: VertexOutput) -> @location(0) vec4<f32> {
        let texColor = textureSample(tex, textureSampler, input.uv);
        // Make it semi-transparent so we can see curves on top
        return vec4<f32>(texColor.rgb, texColor.a);
      }
      `
    })

    const bindGroupLayout = this.device.createBindGroupLayout({
      entries: [
        {
          binding: 0,
          visibility: GPUShaderStage.FRAGMENT,
          sampler: {}
        },
        {
          binding: 1,
          visibility: GPUShaderStage.FRAGMENT,
          texture: {}
        }
      ]
    })

    this.pipeline = this.device.createRenderPipeline({
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
      }
    })

    return bindGroupLayout
  }

  render(group: AsemicGroup, commandEncoder: GPUCommandEncoder) {
    if (!group.imageDatas || group.imageDatas.length === 0) return

    // Create or update texture
    const imageData = group.imageDatas[0]
    if (!this.texture || !this.pipeline) {
      const bindGroupLayout = this.createPipeline()

      this.texture = this.device.createTexture({
        size: [imageData.width, imageData.height, 1],
        format: 'rgba8unorm',
        usage: GPUTextureUsage.TEXTURE_BINDING | GPUTextureUsage.COPY_DST
      })

      this.bindGroup = this.device.createBindGroup({
        layout: bindGroupLayout,
        entries: [
          {
            binding: 0,
            resource: this.device.createSampler({
              addressModeU: 'repeat',
              addressModeV: 'repeat',
              magFilter: 'linear',
              minFilter: 'linear'
            })
          },
          {
            binding: 1,
            resource: this.texture.createView()
          }
        ]
      })
    }

    // Update texture data
    this.device.queue.writeTexture(
      { texture: this.texture },
      imageData.data,
      { bytesPerRow: imageData.width * 4 },
      [imageData.width, imageData.height]
    )

    // Render the texture
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

    renderPass.setBindGroup(0, this.bindGroup!)
    renderPass.setPipeline(this.pipeline!)
    renderPass.draw(6) // Draw 6 vertices (2 triangles)
    renderPass.end()
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
  texture: {
    src: GPUTexture
    imageData: ImageData[]
    transformBuffer: GPUBuffer
  } | null = null

  abstract get mode(): string

  destroy() {
    this.vertex?.buffer.destroy()
    this.index?.buffer.destroy()
    this.dimensions?.buffer.destroy()
    this.widths?.buffer.destroy()
    this.curveStarts?.buffer.destroy()
    this.colors?.buffer.destroy()
    this.texture?.src.destroy()
    this.texture?.transformBuffer.destroy()
  }

  protected abstract loadIndex(curves: AsemicGroup): Uint32Array
  protected abstract loadPipeline(
    bindGroupLayout: GPUBindGroupLayout
  ): GPURenderPipeline
  protected loadShader({ includeTexture = false } = {}) {
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

    ${
      includeTexture
        ? /*wgsl*/ `@group(0) @binding(5) var textureSampler: sampler;
      @group(0) @binding(6) var tex: texture_2d<f32>;
      @group(0) @binding(7)
      var<uniform> texture_transform: vec4<f32>; // xy offset, wh scale`
        : ''
    }

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
    var texColor = input.color;
    // Sample texture if present, otherwise use white
    ${
      includeTexture
        ? /*wgsl*/ `
        // Get screen-space UV coordinates
        let screenUV = input.position.xy / canvas_dimensions;
        
        // Apply texture offset and scale transformation
        // offset.xy is in 0-1 range, scale it to canvas dimensions
        let offsetPixels = texture_transform.xy * canvas_dimensions;
        let scaleFactors = texture_transform.zw;
        
        // Transform UV coordinates: offset and scale
        let transformedUV = (screenUV * canvas_dimensions - offsetPixels) / (scaleFactors * canvas_dimensions);
        
        // Sample with wrapping (fract provides the wrapping behavior)
        texColor = texColor * textureSample(tex, textureSampler, fract(transformedUV));`
        : ''
    }
    return texColor;
    }
    `
    })
  }

  protected reload(curves: AsemicGroup) {
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

    if (this.texture) {
      const texture = this.texture.src
      const imageData = this.texture.imageData
      this.device.queue.writeTexture(
        { texture },
        imageData[0].data,
        { bytesPerRow: imageData[0].width * 4 },
        [imageData[0].width, imageData[0].height]
      )
      const xy = curves.xy
      const wh = curves.wh
      const textureTransform = new Float32Array([xy[0], xy[1], wh[0], wh[1]])
      this.device.queue.writeBuffer(
        this.texture.transformBuffer,
        0,
        textureTransform
      )
    }
  }

  load(group: AsemicGroup) {
    const vertexBuffer = this.device.createBuffer({
      size: Float32Array.BYTES_PER_ELEMENT * sumBy(group, x => x.length * 2),
      usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_DST,
      mappedAtCreation: false,
      label: 'vertex'
    })

    // Create an index buffer
    const widthsBuffer = this.device.createBuffer({
      size: Float32Array.BYTES_PER_ELEMENT * sumBy(group, x => x.length * 2),
      usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_DST,
      mappedAtCreation: false,
      label: 'widths'
    })

    const colorsBuffer = this.device.createBuffer({
      size: Float32Array.BYTES_PER_ELEMENT * sumBy(group, x => x.length * 4),
      usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_DST,
      mappedAtCreation: false,
      label: 'colors'
    })

    const indices = this.loadIndex(group)

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
    const curveStarts = new Uint32Array(group.length + 1)
    let total = 0
    for (let i = 0; i < group.length; i++) {
      curveStarts[i] = total
      total += group[i].length
    }
    curveStarts[group.length] = total

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

    const bindGroupLayoutEntries: Array<GPUBindGroupLayoutEntry> = [
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
        visibility: GPUShaderStage.VERTEX | GPUShaderStage.FRAGMENT,
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
    const bindGroupEntries: Array<GPUBindGroupEntry> = [
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

    if (group.settings.texture && group.imageDatas) {
      const imageData = group.imageDatas[0] as ImageData
      const texture = this.device.createTexture({
        size: [imageData.width, imageData.height, 1],
        format: 'rgba8unorm',
        usage:
          GPUTextureUsage.TEXTURE_BINDING |
          GPUTextureUsage.COPY_DST |
          GPUTextureUsage.RENDER_ATTACHMENT
      })

      // Create texture transform buffer
      const textureTransformBuffer = this.device.createBuffer({
        size: Float32Array.BYTES_PER_ELEMENT * 4, // xy offset + wh scale
        usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST,
        mappedAtCreation: false,
        label: 'texture transform'
      })

      bindGroupEntries.push(
        {
          binding: 5,
          resource: this.device.createSampler({
            addressModeU: 'repeat',
            addressModeV: 'repeat',
            magFilter: 'linear',
            minFilter: 'linear'
          })
        },
        {
          binding: 6,
          resource: texture.createView()
        },
        {
          binding: 7,
          resource: { buffer: textureTransformBuffer }
        }
      )
      bindGroupLayoutEntries.push(
        {
          binding: 5,
          visibility: GPUShaderStage.VERTEX | GPUShaderStage.FRAGMENT,
          sampler: {}
        },
        {
          binding: 6,
          visibility: GPUShaderStage.VERTEX | GPUShaderStage.FRAGMENT,
          texture: {}
        },
        {
          binding: 7,
          visibility: GPUShaderStage.FRAGMENT,
          buffer: { type: 'uniform' }
        }
      )

      // Set texture transform data (xy offset, wh scale)
      this.texture = {
        src: texture,
        transformBuffer: textureTransformBuffer,
        imageData: [imageData]
      }
    } else {
      this.texture = null
    }

    // Update bind group layout to include dimensions uniform
    const bindGroupLayout = this.device.createBindGroupLayout({
      entries: bindGroupLayoutEntries
    })
    const bindGroup = this.device.createBindGroup({
      layout: bindGroupLayout,
      entries: bindGroupEntries
    })

    // Texture support: add bindings for texture and sampler if textures are available
    const pipeline = this.loadPipeline(bindGroupLayout)
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
      size: sumBy(group, x => x.length * 4)
    }

    this.index = { buffer: indexBuffer, size: indices.length }

    this.dimensions = { buffer: dimensionsBuffer, size: 2 }
    this.widths = {
      buffer: widthsBuffer,
      size: sumBy(group, x => x.length * 2)
    }
    this.curveStarts = {
      buffer: curveStartsBuffer,
      size: curveStarts.length,
      array: curveStarts
    }
    this.vertex = {
      buffer: vertexBuffer,
      size: sumBy(group, x => x.length * 2)
    }
  }

  render(curves: AsemicGroup, renderPass: GPURenderPassEncoder) {
    if (curves.length === 0 || (curves.length < 2 && curves[0].length < 2)) {
      return
    }

    if (!this.vertex) {
      this.load(curves)
    } else if (
      !this.texture &&
      curves.imageDatas &&
      curves.imageDatas[0].data.find(x => x > 0)
    ) {
      this.shaderModule = this.loadShader({ includeTexture: true })
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

    // These operations could all be done once during init
    renderPass.setBindGroup(0, this.bindGroup)
    renderPass.setPipeline(this.pipeline)
    renderPass.setIndexBuffer(this.index.buffer, 'uint32')
    // This needs to stay in the render method
    renderPass.drawIndexed(this.index.size)
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
  get mode() {
    return 'line'
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
  get mode() {
    return 'fill'
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

// --- PostProcessQuad class ---
class PostProcessQuad {
  ctx: GPUCanvasContext
  device: GPUDevice
  pipeline: GPURenderPipeline
  bindGroup: GPUBindGroup
  timeBuffer: GPUBuffer
  sizeBuffer: GPUBuffer
  textureView: GPUTextureView
  time: number = 0

  constructor(
    ctx: GPUCanvasContext,
    device: GPUDevice,
    textureView: GPUTextureView,
    { fragmentGenerator }: { fragmentGenerator: (src: Glsl) => Glsl }
  ) {
    this.ctx = ctx
    this.device = device

    const code = compileWithContext(fragmentGenerator(src()).transforms, {
      defaultUniforms: {
        time: 0,
        resolution: [1080, 1080]
      },
      precision: 'highp'
    }).frag

    const shaderModule = device.createShaderModule({
      code
    })

    const bindGroupLayout = device.createBindGroupLayout({
      entries: [
        {
          binding: 0,
          visibility: GPUShaderStage.FRAGMENT,
          sampler: {}
        },
        {
          binding: 1,
          visibility: GPUShaderStage.FRAGMENT,
          texture: {}
        },
        {
          binding: 2,
          visibility: GPUShaderStage.FRAGMENT,
          buffer: { type: 'uniform' }
        },
        {
          binding: 3,
          visibility: GPUShaderStage.FRAGMENT,
          buffer: { type: 'uniform' }
        }
      ]
    })

    this.pipeline = device.createRenderPipeline({
      layout: device.createPipelineLayout({
        bindGroupLayouts: [bindGroupLayout]
      }),
      vertex: {
        module: shaderModule,
        entryPoint: 'vertexMain'
      },
      fragment: {
        module: shaderModule,
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
      }
    })

    this.timeBuffer = this.device.createBuffer({
      size: Float32Array.BYTES_PER_ELEMENT,
      usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST,
      mappedAtCreation: false
    })
    this.sizeBuffer = this.device.createBuffer({
      size: Float32Array.BYTES_PER_ELEMENT * 2,
      usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST,
      mappedAtCreation: false
    })
    this.textureView = textureView

    // Create bind group for current texture view
    this.bindGroup = this.device.createBindGroup({
      layout: this.pipeline.getBindGroupLayout(0),
      entries: [
        {
          binding: 0,
          resource: this.device.createSampler({
            addressModeU: 'clamp-to-edge',
            addressModeV: 'clamp-to-edge',
            magFilter: 'linear',
            minFilter: 'linear'
          })
        },
        {
          binding: 1,
          resource: this.textureView
        },
        {
          binding: 2,
          resource: {
            buffer: this.timeBuffer
          }
        },
        {
          binding: 3,
          resource: {
            buffer: this.sizeBuffer
          }
        }
      ]
    })
  }

  render(commandEncoder: GPUCommandEncoder) {
    // Update time buffer with current time in milliseconds
    // Update time buffer with current time in milliseconds
    this.time += 1 / 60
    this.device.queue.writeBuffer(
      this.timeBuffer,
      0,
      new Float32Array([this.time])
    )

    // Update bind group with current texture view
    this.bindGroup = this.device.createBindGroup({
      layout: this.pipeline.getBindGroupLayout(0),
      entries: [
        {
          binding: 0,
          resource: this.device.createSampler({
            addressModeU: 'clamp-to-edge',
            addressModeV: 'clamp-to-edge',
            magFilter: 'linear',
            minFilter: 'linear'
          })
        },
        {
          binding: 1,
          resource: this.textureView
        },
        {
          binding: 2,
          resource: {
            buffer: this.timeBuffer
          }
        },
        {
          binding: 3,
          resource: {
            buffer: this.sizeBuffer
          }
        }
      ]
    })

    const pass = commandEncoder.beginRenderPass({
      colorAttachments: [
        {
          view: this.ctx.getCurrentTexture().createView(),
          loadOp: 'clear',
          clearValue: { r: 0, g: 0, b: 0, a: 1 },
          storeOp: 'store'
        }
      ]
    })
    pass.setPipeline(this.pipeline)
    pass.setBindGroup(0, this.bindGroup)
    pass.draw(6)
    pass.end()
  }
}
