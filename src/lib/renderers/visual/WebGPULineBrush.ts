import { AsemicGroup } from '@/lib/parser/Parser'
import { range } from 'lodash'
import WebGPUBrush from './WebGPUBrush'

export default class WebGPULineBrush extends WebGPUBrush {
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
                srcFactor: 'one',
                dstFactor: 'zero',
                operation: 'add'
              },
              alpha: {
                srcFactor: 'one',
                dstFactor: 'one',
                operation: 'max'
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

  protected loadIndex(curves: AsemicGroup) {
    // Create a buffer to store vertex data

    // Define indices to form two triangles
    const indices = new Uint32Array(
      range(curves.length).flatMap(i =>
        range(this.settings.count - 1).flatMap(x => [
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
