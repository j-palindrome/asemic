import { AsemicGroup } from '@/lib/parser/Parser'
import WebGPUBrush from './WebGPUBrush'
import { range } from 'lodash'

export default class WebGPUFillBrush extends WebGPUBrush {
  get mode() {
    return 'fill'
  }
  protected loadIndex(curves: AsemicGroup) {
    // Create a buffer to store vertex data

    const indices = new Uint32Array(
      range(curves.points.length).flatMap(i =>
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
