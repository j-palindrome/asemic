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
            blend: this.settings.blend
              ? {
                  color: {
                    srcFactor: 'one',
                    dstFactor: 'one-minus-src-alpha',
                    operation: 'add'
                  },
                  alpha: {
                    srcFactor: 'one',
                    dstFactor: 'one-minus-src-alpha',
                    operation: 'add'
                  }
                }
              : {
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

    // if (this.settings.close) debugger
    // Define indices to form two triangles
    const indices = new Uint32Array(
      range(curves.length).flatMap(i => {
        const map = range(this.settings.count - 1).flatMap(x => [
          i * (this.settings.count * 2) + x * 2,
          i * (this.settings.count * 2) + x * 2 + 1,
          i * (this.settings.count * 2) + x * 2 + 2,
          i * (this.settings.count * 2) + x * 2 + 1,
          i * (this.settings.count * 2) + x * 2 + 2,
          i * (this.settings.count * 2) + x * 2 + 3
        ])
        if (this.settings.close) {
          map[map.length - 4] = map[0]
          map[map.length - 2] = map[0]
          map[map.length - 1] = map[1]
        }
        return map
      })
    )

    return indices
  }
}
