import { OrthographicCamera, Scene } from 'three'
import Renderer from './renderer'
import { WebGPURenderer } from 'three/src/Three.WebGPU.js'
import { AsemicGroup, AsemicPt } from './AsemicPt'
import { LineBrush } from './asemic-3d/src'
import NewLineBrush from './asemic-3d/src/brushes/NewLineBrush'

export default class ThreeRenderer extends Renderer {
  protected scene: Scene
  protected renderer: WebGPURenderer
  protected camera: OrthographicCamera
  protected brushes: any[] = []
  protected inited = false
  protected ready = false

  protected update(curves: AsemicGroup[]) {}

  protected init(curves: AsemicGroup[]) {
    if (!this.ready) {
      setTimeout(() => {
        this.init(curves)
      }, 100)
      return
    }
    this.inited = true
    this.brushes.push(new NewLineBrush(curves, this.scene))
  }

  render(curves: AsemicGroup[]): void {
    if (!this.inited) this.init(curves)
    else this.update(curves)

    this.renderer.render(this.scene, this.camera)
  }

  constructor(canvas: OffscreenCanvas) {
    super()
    this.renderer = new WebGPURenderer({
      canvas: canvas as any
    })
    this.scene = new Scene()
    this.camera = new OrthographicCamera(-1, 1, 1, -1, 0, 1000)
    this.renderer.init().then(() => {
      this.ready = true
    })
  }
}
