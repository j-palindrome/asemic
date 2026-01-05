import { isEqual, range, sumBy } from 'lodash'
import invariant from 'tiny-invariant'
import { compileWithContext, src } from '../../hydra-compiler'
import { Glsl } from '../../hydra-compiler/src/glsl/Glsl'
import WebGPUBrush, { AsemicGroup } from './WebGPUBrush'
import PostProcessQuad from './PostProcessQuad'
import WebGPULineBrush from './WebGPULineBrush'
import WebGPUFillBrush from './WebGPUFillBrush'
import { Scene } from '@/lib/types'

export default class WebGPURenderer {
  private brushes: (WebGPUBrush | undefined)[] = []
  ctx: GPUCanvasContext
  device: GPUDevice
  isSetup = false
  private postProcess: PostProcessQuad | null = null
  private offscreenTexture: GPUTexture | null = null
  private offscreenView: GPUTextureView | null = null
  fragmentGenerator?: (src: Glsl) => Glsl

  constructor(ctx: GPUCanvasContext) {
    this.ctx = ctx

    this.setup()
  }

  async setup() {
    const adapter = await navigator.gpu.requestAdapter()
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
      this.offscreenView!
    )
  }

  protected generateBrush(group: AsemicGroup) {
    let brush: WebGPUBrush
    switch (group.settings.mode) {
      case 'line':
        brush = new WebGPULineBrush(this.ctx, this.device, group.settings)
        break
      case 'fill':
        brush = new WebGPUFillBrush(this.ctx, this.device, group.settings)
        break
      case 'blank':
        return
    }
    return brush!
  }

  render(groups: any, scene: Scene): void {
    if (!this.isSetup) return

    for (let group of groups) {
      for (let curve of group.points) {
        if (curve.length === 0) continue
        if (curve.length < 3) {
          const lerp = (c0: any, c1: any, t: number) => {
            let newKey = {} as any
            for (let key in c0) {
              if (!c1[key]) {
                newKey[key] = c0[key]
              } else newKey[key] = c0[key] * (1 - t) + c1[key] * t
            }
            return newKey
          }
          curve.splice(1, 0, lerp(curve[0], curve[1], 0.5))
        }
      }
    }

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
          clearValue: { r: 0, g: 0, b: 0, a: 0 },
          storeOp: 'store'
        }
      ]
    })

    for (let i = 0; i < groups.length; i++) {
      if (!this.brushes[i]) {
        this.brushes.push(this.generateBrush(groups[i]))
      } else if (
        this.brushes[i]?.mode !== groups[i].settings.mode ||
        !isEqual(this.brushes[i]!, groups[i])
      ) {
        this.brushes[i]?.destroy()
        this.brushes[i] = this.generateBrush(groups[i])
        this.brushes[i]?.load(groups[i])
      }
      // Render to offscreen pass
      this.brushes[i]?.render(groups[i], offscreenPass, scene)
    }
    offscreenPass.end()

    // Postprocess: render screen quad with offscreen texture to canvas
    this.postProcess!.render(commandEncoder)

    this.device.queue.submit([commandEncoder.finish()])
  }

  // render(groups: AsemicGroup[]): void {
  //   if (!this.isSetup) return

  //   for (let group of groups) {
  //     for (let curve of group) {
  //       if (curve.length === 0) return
  //       if (curve.length < 3) {
  //         curve.splice(1, 0, curve[0].clone(true).lerp(curve[1], 0.5))
  //       }
  //     }
  //   }

  //   // Recreate offscreen texture if canvas size changed
  //   if (
  //     !this.offscreenTexture ||
  //     this.ctx.canvas.width !== this.offscreenTexture.width ||
  //     this.ctx.canvas.height !== this.offscreenTexture.height
  //   ) {
  //     this.createOffscreenTexture()
  //   }

  //   const commandEncoder = this.device.createCommandEncoder()

  //   // Render groups to offscreen texture
  //   const offscreenPass = commandEncoder.beginRenderPass({
  //     colorAttachments: [
  //       {
  //         view: this.offscreenView!,
  //         loadOp: 'clear',
  //         clearValue: { r: 0, g: 0, b: 0, a: 0 },
  //         storeOp: 'store'
  //       }
  //     ]
  //   })

  //   for (let i = 0; i < groups.length; i++) {
  //     if (!this.brushes[i]) {
  //       this.brushes.push(this.generateBrush(groups[i]))
  //     } else if (
  //       this.brushes[i]?.mode !== groups[i].settings.mode ||
  //       !isEqual(this.brushes[i]!.settings, groups[i].settings)
  //     ) {
  //       this.brushes[i]?.destroy()
  //       this.brushes[i] = this.generateBrush(groups[i])
  //       this.brushes[i]?.load(groups[i])
  //     }
  //     // Render to offscreen pass
  //     this.brushes[i]?.render(groups[i], offscreenPass)
  //   }
  //   offscreenPass.end()

  //   // Postprocess: render screen quad with offscreen texture to canvas
  //   this.postProcess!.render(commandEncoder)

  //   this.device.queue.submit([commandEncoder.finish()])
  // }
}
