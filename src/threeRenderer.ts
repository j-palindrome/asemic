import { OrthographicCamera, Scene } from 'three'
import Renderer from './renderer'
import { WebGPURenderer } from 'three/src/Three.WebGPU.js'
import { AsemicGroup, AsemicPt } from './AsemicPt'
import { LineBrush } from './asemic-3d/src'

export default class ThreeRenderer extends Renderer {
  protected scene: Scene
  protected renderer: WebGPURenderer
  protected camera: OrthographicCamera
  protected brush: LineBrush
  protected inited = false

  protected update(curves: AsemicGroup[]) {}

  protected init(curves: AsemicGroup[]) {
    this.inited = true
    this.brush = new LineBrush(
      {},
      { renderer: this.renderer, group: curves, scene: this.scene }
    )
  }

  render(curves: AsemicGroup[]): void {
    if (!this.inited) this.init(curves)
    else this.update(curves)
  }

  constructor(canvas: HTMLCanvasElement) {
    super()
    this.renderer = new WebGPURenderer({
      canvas
    })
    this.scene = new Scene()
    this.camera = new OrthographicCamera(-1, 1, 1, -1, 0, 1000)
  }
}
