import wgslRequires from './wgsl/wgslRequires.wgsl?raw'
import { sumBy } from 'lodash'
import calcPosition from './wgsl/calcPosition'
import { Scene } from '@/lib/types'

export type AsemicGroup = {
  points: any[][]
  settings: any
}

export default abstract class WebGPUBrush {
  ctx: GPUCanvasContext
  device: GPUDevice
  pipeline: GPURenderPipeline
  bindGroup: GPUBindGroup
  bindGroup2: GPUBindGroup
  shaderModule: GPUShaderModule
  dimensions: { buffer: GPUBuffer; size: number }
  time: { buffer: GPUBuffer; size: number }
  scrub: { buffer: GPUBuffer; size: number }
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
  settings: any

  abstract get mode(): string

  destroy() {
    this.vertex?.buffer.destroy()
    this.index?.buffer.destroy()
    this.dimensions?.buffer.destroy()
    this.time?.buffer.destroy()
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
    @location(1) uv: vec2<f32>,
    @location(2) tangent: vec2<f32>,
    @location(3) t: f32,
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

    @group(0) @binding(5)
    var<uniform> time: f32;

    @group(0) @binding(6)
    var<uniform> scrub: f32;

    ${
      includeTexture
        ? /*wgsl*/ `@group(1) @binding(0) var textureSampler: sampler;
      @group(1) @binding(1) var tex: texture_2d<f32>;
      @group(1) @binding(2)
      var<uniform> texture_transform: vec4<f32>; // xy offset, wh scale`
        : ''
    }

    ${wgslRequires}

    @vertex
    fn vertexMain(@builtin(vertex_index) vertex_index: u32) -> VertexOutput {
    var output: VertexOutput;
    ${calcPosition(this)}
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
    // const vertices = new Float32Array(
    //   curves.flatMap(x => x.flatMap(x => [x.x, x.y]))
    // )
    const vertices = new Float32Array(
      curves.points.flatMap(x => x.flatMap(x => [x.x, x.y]))
    )

    this.device.queue.writeBuffer(this.vertex.buffer, 0, vertices)

    const widths = new Float32Array(
      curves.points.flatMap(x => x.flatMap(x => x.w))
    )
    this.device.queue.writeBuffer(this.widths.buffer, 0, widths)

    const colors = new Float32Array(
      curves.points.flatMap(x => x.flatMap(x => [x.h, x.s, x.l, x.a]))
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
      size:
        Float32Array.BYTES_PER_ELEMENT * sumBy(group.points, x => x.length * 2),
      usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_DST,
      mappedAtCreation: false,
      label: 'vertex'
    })

    // Create an index buffer
    const widthsBuffer = this.device.createBuffer({
      size:
        Float32Array.BYTES_PER_ELEMENT * sumBy(group.points, x => x.length * 2),
      usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_DST,
      mappedAtCreation: false,
      label: 'widths'
    })

    const colorsBuffer = this.device.createBuffer({
      size:
        Float32Array.BYTES_PER_ELEMENT * sumBy(group.points, x => x.length * 4),
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
    const curveStarts = new Uint32Array(group.points.length + 1)
    let total = 0
    for (let i = 0; i < group.points.length; i++) {
      curveStarts[i] = total
      total += group.points[i].length
    }
    curveStarts[group.points.length] = total

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

    const timeBuffer = this.device.createBuffer({
      size: Float32Array.BYTES_PER_ELEMENT * 1,
      usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST,
      mappedAtCreation: false,
      label: 'time'
    })

    const scrubBuffer = this.device.createBuffer({
      size: Float32Array.BYTES_PER_ELEMENT * 1,
      usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST,
      mappedAtCreation: false,
      label: 'scrub'
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
      },
      {
        binding: 5,
        visibility: GPUShaderStage.VERTEX | GPUShaderStage.FRAGMENT,
        buffer: { type: 'uniform' }
      },
      {
        binding: 6,
        visibility: GPUShaderStage.VERTEX | GPUShaderStage.FRAGMENT,
        buffer: { type: 'uniform' }
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
      },
      {
        binding: 5,
        resource: { buffer: timeBuffer }
      },
      {
        binding: 6,
        resource: { buffer: scrubBuffer }
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

      const bindGroup2 = this.device.createBindGroup({
        layout: this.device.createBindGroupLayout({
          entries: [
            {
              binding: 6,
              visibility: GPUShaderStage.FRAGMENT,
              sampler: {}
            },
            {
              binding: 7,
              visibility: GPUShaderStage.FRAGMENT,
              texture: {}
            },
            {
              binding: 8,
              visibility: GPUShaderStage.FRAGMENT,
              buffer: { type: 'uniform' }
            }
          ]
        }),
        entries: [
          {
            binding: 6,
            resource: this.device.createSampler({
              addressModeU: 'repeat',
              addressModeV: 'repeat',
              magFilter: 'linear',
              minFilter: 'linear'
            })
          },
          {
            binding: 7,
            resource: texture.createView()
          },
          {
            binding: 8,
            resource: { buffer: textureTransformBuffer }
          }
        ]
      })
      this.bindGroup2 = bindGroup2

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
      size: sumBy(group.points, x => x.length * 4)
    }

    this.index = { buffer: indexBuffer, size: indices.length }

    this.dimensions = { buffer: dimensionsBuffer, size: 2 }
    this.time = { buffer: timeBuffer, size: 1 }
    this.scrub = { buffer: scrubBuffer, size: 1 }
    this.widths = {
      buffer: widthsBuffer,
      size: sumBy(group.points, x => x.length * 2)
    }
    this.curveStarts = {
      buffer: curveStartsBuffer,
      size: curveStarts.length,
      array: curveStarts
    }
    this.vertex = {
      buffer: vertexBuffer,
      size: sumBy(group.points, x => x.length * 2)
    }
  }

  render(curves: AsemicGroup, renderPass: GPURenderPassEncoder, scene: Scene) {
    if (
      curves.points.length === 0 ||
      (curves.points.length < 2 && curves.points[0].length < 2)
    ) {
      return
    }
    // debugger

    if (!this.vertex) {
      this.load(curves)
    } else if (
      !this.texture &&
      curves.imageDatas &&
      curves.imageDatas[0].data.find(x => x > 0)
    ) {
      this.shaderModule = this.loadShader({ includeTexture: true })
      this.load(curves)
    } else if (this.curveStarts.size !== curves.points.length + 1) {
      this.load(curves)
    } else {
      let total = 0
      for (let i = 0; i < curves.points.length + 1; i++) {
        if (this.curveStarts.array[i] !== total) {
          this.load(curves)
          break
        }
        if (!curves.points[i]) break
        total += curves.points[i].length
      }
    }
    this.reload(curves)

    this.device.queue.writeBuffer(
      this.time.buffer,
      0,
      new Float32Array([performance.now() / 1000])
    )

    this.device.queue.writeBuffer(
      this.scrub.buffer,
      0,
      new Float32Array([scene.scrub])
    )

    // These operations could all be done once during init
    renderPass.setBindGroup(0, this.bindGroup)
    renderPass.setPipeline(this.pipeline)
    renderPass.setIndexBuffer(this.index.buffer, 'uint32')
    // This needs to stay in the render method
    renderPass.drawIndexed(this.index.size)
  }

  constructor(
    ctx: GPUCanvasContext,
    device: GPUDevice,
    settings: AsemicGroup['settings']
  ) {
    this.ctx = ctx
    this.device = device
    this.settings = settings
    this.shaderModule = this.loadShader()
  }
}
