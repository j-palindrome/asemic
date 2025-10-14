import { compileWithContext, src } from '@/lib/hydra-compiler'
import { Glsl } from '@/lib/hydra-compiler/src/glsl/Glsl'

export default class PostProcessQuad {
  ctx: GPUCanvasContext
  device: GPUDevice
  pipeline: GPURenderPipeline
  bindGroup: GPUBindGroup
  timeBuffer: GPUBuffer
  sizeBuffer: GPUBuffer
  textureView: GPUTextureView
  time: number = 0
  fragmentGenerator: ((src: Glsl) => Glsl) | null = null

  constructor(
    ctx: GPUCanvasContext,
    device: GPUDevice,
    textureView: GPUTextureView
  ) {
    this.ctx = ctx
    this.device = device

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
    this.setupPipeline(this.fragmentGenerator)
  }

  setupPipeline(fragmentGenerator: ((src: Glsl) => Glsl) | null = null) {
    this.fragmentGenerator = fragmentGenerator
    const code = compileWithContext(
      this.fragmentGenerator
        ? this.fragmentGenerator(src()).transforms
        : src().transforms,
      {
        defaultUniforms: {
          time: 0,
          resolution: [1080, 1080]
        }
      }
    ).frag

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

    const shaderModule = this.device.createShaderModule({
      code
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
          clearValue: { r: 0, g: 0, b: 0, a: 0 },
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
