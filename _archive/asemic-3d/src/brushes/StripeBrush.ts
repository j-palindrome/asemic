import * as THREE from 'three'
import { float, Fn, varying, vec2, vec4, vertexIndex } from 'three/tsl'
import {
  MeshBasicNodeMaterial,
  StorageInstancedBufferAttribute
} from 'three/webgpu'
import BrushBuilder from './BrushBuilder'

export class StripeBrush extends BrushBuilder<'stripe'> {
  protected getDefaultBrushSettings(): {
    type: 'stripe'
  } {
    return { type: 'stripe' }
  }
  protected onFrame() {}
  protected onDraw() {}
  protected onInit() {
    const geometry = new THREE.BufferGeometry()
    geometry.setAttribute('position', new THREE.Float32BufferAttribute([], 3))
    const indexes: number[] = []

    for (let curveI = 0; curveI < this.settings.maxCurves; curveI += 2) {
      for (let i = 0; i < this.info.instancesPerCurve; i++) {
        const indexTemplate = [
          0,
          this.info.instancesPerCurve,
          1,
          1,
          this.info.instancesPerCurve,
          this.info.instancesPerCurve + 1
        ]
        indexes.push(
          ...indexTemplate.map(
            x => x + i + curveI * this.info.instancesPerCurve
          )
        )
      }
    }

    geometry.setIndex(indexes)
    const material = new MeshBasicNodeMaterial({
      transparent: true,
      depthWrite: false,
      blending: THREE.NormalBlending,
      side: THREE.DoubleSide,
      color: 'white'
    })
    material.mrtNode = this.settings.renderTargets

    const position = vec2().toVar('thisPosition')
    const color = varying(vec4(), 'color')
    const progress = varying(float(), 'progress')
    const vUv = varying(vec2(), 'vUv')

    const main = Fn(() => {
      this.getBezier(
        vertexIndex.toFloat().div(this.info.instancesPerCurve - 0.999),
        position,
        {
          color,
          progress
        }
      )
      vUv.assign(
        vec2(vertexIndex.toFloat().div(this.info.instancesPerCurve - 0.999), 1)
      )

      return vec4(position, 0, 1)
    })

    material.positionNode = main()

    material.colorNode = Fn(() =>
      this.settings.pointColor(varying(vec4(), 'color'), {
        progress,
        builder: this.group,
        uv: vUv
      })
    )()

    material.needsUpdate = true

    const mesh = new THREE.Mesh(geometry, material)
    this.scene.add(mesh)

    Object.assign(this.info, {
      material,
      geometry,
      mesh
    })
  }
  protected onDispose() {
    this.scene.remove(this.info.mesh)
    this.info.material.dispose()
    this.info.geometry.dispose()
  }
}
