import { sum } from 'lodash'
import { AsemicGroup, AsemicPt } from 'src/AsemicPt'
import {
  BufferAttribute,
  BufferGeometry,
  DoubleSide,
  Float32BufferAttribute,
  InstancedBufferAttribute,
  Mesh,
  NormalBlending,
  Scene,
  Vector2
} from 'three'
import {
  array,
  atan,
  float,
  Fn,
  If,
  instancedArray,
  int,
  mix,
  select,
  ShaderNodeObject,
  uniformArray,
  vec2,
  vec4,
  floor,
  vertexIndex,
  rotateUV,
  PI2
} from 'three/tsl'
import { MeshBasicNodeMaterial, StorageBufferNode, VarNode } from 'three/webgpu'
import { bezierPosition, bezierRotation } from '../util/bezier'

const INSTANCES_PER_CURVE = 100
export default class NewLineBrush {
  curvePositions: ShaderNodeObject<StorageBufferNode>
  curveCounts: ShaderNodeObject<StorageBufferNode>
  settings = {
    adjustEnds: false as 'loop' | false
  }

  protected getBezier(
    progress: ShaderNodeObject<VarNode>, // float (curveNum.progress)
    position: ShaderNodeObject<VarNode>, // vec2
    rotation?: ShaderNodeObject<VarNode>, // float
    width?: ShaderNodeObject<VarNode>, // float
    color?: ShaderNodeObject<VarNode> // vec4
  ) {
    const progressVar = progress.toVar()
    If(progressVar.equal(-1), () => {
      color?.assign(vec4(0, 0, 0, 0))
    }).Else(() => {
      // progressVar.assign(
      //   floor(progress).add(
      //     this.settings.pointProgress(progress.fract(), {
      //       builder: this.group,
      //       progress
      //     })
      //   )
      // )
      // extra?.progress?.assign(progressVar)
      const controlPointsCount = this.curveCounts.element(int(progressVar))
      const subdivisions = select(
        controlPointsCount.equal(2),
        1,
        this.settings.adjustEnds === 'loop'
          ? controlPointsCount
          : controlPointsCount.sub(2)
      ).toVar()

      //4 points: 4-2 = 2 0->1 1->2 (if it goes to the last value then it starts interpolating another curve)
      const t = vec2(
        progressVar.fract().mul(0.999).mul(subdivisions),
        floor(progressVar)
      )
      const curveIndex = progressVar.floor().mul(INSTANCES_PER_CURVE)
      const pointIndex = progressVar.fract().mul(0.999).mul(subdivisions)
      const index = curveIndex.add(pointIndex).toVar()

      If(controlPointsCount.equal(2), () => {
        const p0 = this.curvePositions.element(index)
        const p1 = this.curvePositions.element(index.add(1))
        const progressPoint = mix(p0, p1, t.x)

        position.assign(progressPoint.xy)

        // const thisIndex = t.y.mul(INSTANCES_PER_CURVE).add(t.x)
        // extra.color?.assign(this.info.curveColorArray.element(index))
        // extra.color?.assign(this.info.curveColorArray.element(0))
        width?.assign(progressPoint.w)
        const rotationCalc = p1.xy.sub(p0.xy).toVar()
        rotation?.assign(atan(rotationCalc.y, rotationCalc.x))
      }).Else(() => {
        const p0 = this.curvePositions.element(index).toVar()
        const p1 = this.curvePositions
          .element(curveIndex.add(pointIndex.add(1).mod(controlPointsCount)))
          .toVar()
        const p2 = this.curvePositions
          .element(curveIndex.add(pointIndex.add(2).mod(controlPointsCount)))
          .toVar()

        // if (this.settings.adjustEnds === true) {
        //   If(t.x.greaterThan(float(1)), () => {
        //     p0.assign(mix(p0, p1, float(0.5)))
        //   })
        //   If(t.x.lessThan(float(controlPointsCount).sub(3)), () => {
        //     p2.assign(mix(p1, p2, 0.5))
        //   })
        // } else {
        p0.assign(mix(p0, p1, float(0.5)))
        p2.assign(mix(p1, p2, 0.5))
        // }

        const strength = p1.z
        const pos = bezierPosition({
          t: t.x.fract(),
          p0: p0.xy,
          p1: p1.xy,
          p2: p2.xy,
          strength
        })

        position.assign(pos)
        width?.assign(
          bezierPosition({
            t: t.x.fract(),
            p0: vec2(0, p0.w),
            p1: vec2(0.5, p1.w),
            p2: vec2(1, p2.w),
            strength
          }).y
        )
        rotation?.assign(
          bezierRotation({
            t: t.x.fract(),
            p0: p0.xy,
            p1: p1.xy,
            p2: p2.xy,
            strength
          })
        )
        // const c0 = this.info.curveColorArray.element(index)
        // const c1 = this.info.curveColorArray.element(index.add(1))

        // extra.color?.assign(mix(c0, c1, t.x.fract()))
      })
    })
    // position.assign(
    //   this.settings.pointPosition(position, { builder: this.group, progress })
    // )
    // if (extra) {
    //   extra.width?.assign(
    //     this.settings
    //       .pointThickness(extra.width, {
    //         progress: progressVar,
    //         builder: this.group
    //       })
    //       .div(screenSize.x)
    //   )
    //   extra.rotation?.assign(
    //     this.settings.pointRotate(extra.rotation!, {
    //       progress: extra.progress!,
    //       builder: this.group
    //     })
    //   )
    // }
  }

  constructor(curves: AsemicGroup[], scene: Scene) {
    this.curvePositions = instancedArray(sum(curves.map(x => x.length)), 'vec2')
    this.curveCounts = instancedArray(
      Int16Array.from(curves.map(x => x.length)),
      'int'
    )

    // let total = 0
    // for (let i = 0; i < curves.length; i++) {
    //   this.curveCounts.value.array.set([total], i)
    //   for (let j = 0; j < curves[i].length; j++) {
    //     // console.log(j + i)
    //     this.curvePositions.value.array.set(
    //       [curves[i].at(j).x, curves[i].at(j).y],
    //       (total + j) * 2
    //     )
    //   }
    //   total += curves[i].length
    // }
    const geometry = new BufferGeometry()
    geometry.setAttribute('position', new Float32BufferAttribute([], 3))
    const indexGuide = [0, 1, 2, 1, 2, 3]

    let currentIndex = 0
    const indexes: number[] = []

    for (let i = 0; i < curves.length * INSTANCES_PER_CURVE; i++) {
      if (this.settings.adjustEnds === 'loop') {
        const curveStart = currentIndex
        for (let i = 0; i < INSTANCES_PER_CURVE - 2; i++) {
          indexes.push(...indexGuide.map(x => x + currentIndex))
          currentIndex += 2
        }
        indexes.push(
          currentIndex,
          currentIndex + 1,
          curveStart,
          currentIndex + 1,
          curveStart,
          curveStart + 1
        )
        currentIndex += 2
      } else {
        for (let i = 0; i < INSTANCES_PER_CURVE - 1; i++) {
          indexes.push(...indexGuide.map(x => x + currentIndex))
          currentIndex += 2
        }
      }
      currentIndex += 2
    }
    geometry.setIndex(indexes)
    const material = new MeshBasicNodeMaterial({
      transparent: true,
      depthWrite: false,
      blending: NormalBlending,
      side: DoubleSide,
      color: 'white'
    })
    // material.mrtNode = this.settings.renderTargets

    material.positionNode = Fn(() => {
      const position = vec2().toVar()
      const width = float().toVar()
      const rotation = float().toVar()
      this.getBezier(
        vertexIndex
          .div(2)
          .toFloat()
          .div(INSTANCES_PER_CURVE - 0.001)
          .toVar(),
        position,
        rotation,
        width,
        vec4().toVar()
      )

      // vUv.assign(
      //   vec2(
      //     vertexIndex.div(2).toFloat().div(this.info.instancesPerCurve),
      //     select(vertexIndex.modInt(2).equal(0), 0, 1)
      //   )
      // )

      // thickness.assign(0.1)
      position.addAssign(
        rotateUV(
          vec2(width.mul(select(vertexIndex.modInt(2).equal(0), -0.5, 0.5)), 0),
          rotation.add(PI2.mul(0.25)),
          vec2(0, 0)
        )
      )
      return vec4(position, 0, 1)
    })()
    const mesh = new Mesh(geometry, material)
    scene.add(mesh)
    // console.log(this.curvePositions.value, this.curveStarts.value)
  }
}
