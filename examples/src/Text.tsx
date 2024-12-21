import { extend, useThree } from '@react-three/fiber'
import _ from 'lodash'
import { Pt } from 'pts'
import { useMemo } from 'react'
import {
  AdditiveBlending,
  ClampToEdgeWrapping,
  FloatType,
  NearestFilter
} from 'three'
import OperatorNode from 'three/src/nodes/math/OperatorNode.js'
import {
  float,
  Fn,
  hash,
  If,
  instanceIndex,
  Loop,
  mul,
  mx_noise_float,
  rand,
  range,
  select,
  ShaderNodeObject,
  texture,
  textureStore,
  time,
  uniform,
  uniformArray,
  uvec2,
  vec2,
  vec3,
  vec4,
  wgslFn
} from 'three/tsl'
import {
  Node,
  SpriteNodeMaterial,
  StackNode,
  StorageTexture,
  VarNode,
  WebGPURenderer
} from 'three/webgpu'
import { useInterval } from '../../util/src/dom'
import { bezierPoint } from '../../util/src/shaders/bezier'

extend(SpriteNodeMaterial)

declare module '@react-three/fiber' {
  interface ThreeElements {
    spriteNodeMaterial: SpriteNodeMaterial
  }
}

function Scene({
  controlPoint,
  points,
  curves,
  size = 1,
  spacing = 2
}: {
  points: number
  curves: number
  size: number
  spacing: number
  controlPoint: ({
    pointI,
    curveI
  }: {
    pointI: ShaderNodeObject<OperatorNode>
    curveI: ShaderNodeObject<OperatorNode>
  }) => Node
}) {
  // @ts-ignore
  const gl = useThree(({ gl }) => gl as WebGPURenderer)

  const storageTexture = new StorageTexture(points, curves)
  storageTexture.type = FloatType
  storageTexture.wrapS = storageTexture.wrapT = ClampToEdgeWrapping
  // storageTexture.minFilter = NearestFilter
  // storageTexture.magFilter = NearestFilter
  // storageTexture.format = RGBFormat

  const advanceControlPoints = Fn(
    ({ storageTexture }: { storageTexture: StorageTexture }) => {
      const pointI = instanceIndex.modInt(points)
      const curveI = instanceIndex.div(points)
      const indexUV = uvec2(pointI, curveI)

      const xyz = controlPoint({ pointI, curveI })
      return textureStore(storageTexture, indexUV, vec4(xyz, 1)).toWriteOnly()
    }
  )

  // @ts-ignore
  const computeNode = advanceControlPoints({ storageTexture }).compute(
    points * curves
  )

  let arcLength =
    new Pt(
      window.innerWidth * devicePixelRatio,
      window.innerHeight * devicePixelRatio
    ).magnitude() /
    (size * spacing)

  const material = useMemo(() => {
    const material = new SpriteNodeMaterial({
      transparent: true,
      depthWrite: false,
      blending: AdditiveBlending
    })

    material.scaleNode = uniform(
      (1 / window.innerWidth / devicePixelRatio) * size
    )

    const processText = Fn(() => {
      const bezier2 = Fn(
        ({
          t,
          p0,
          p1,
          p2
        }: {
          t: ReturnType<typeof float>
          p0: ReturnType<typeof vec3>
          p1: ReturnType<typeof vec3>
          p2: ReturnType<typeof vec3>
        }): ReturnType<typeof vec2> => {
          //         float tInverse = 1. - t;
          // return tInverse * tInverse * p0
          //   + 2. * tInverse * t * p1
          //   + t * t * p2;
          const tInverse = t.oneMinus().toVar()
          return p0
            .mul(tInverse.pow(2))
            .add(p1.mul(tInverse.mul(t).mul(2)))
            .add(p2.mul(t.pow(2)))
        }
      )
      const curveI = instanceIndex.toFloat().div(arcLength).floor().div(curves)
      const t = instanceIndex.toFloat().mod(arcLength).div(arcLength).toVar()
      //     int start = int(floor(t * subdivisions));
      // float cycle = fract(t * subdivisions);
      const bezierStart = t.mul(points - 2).floor()
      const bezierT = t.mul(points - 2).fract()
      const p0 = texture(
        storageTexture,
        vec2(bezierStart.div(points), curveI)
      ).xy
      const p1 = texture(
        storageTexture,
        vec2(bezierStart.add(1).div(points), curveI)
      ).xy
      const p2 = texture(
        storageTexture,
        vec2(bezierStart.add(2).div(points), curveI)
      ).xy
      // p0.assign(p0.mix(p1, 0.5))
      // p2.assign(p2.mix(p1, 0.5))
      return vec4(bezier2({ t: bezierT, p0, p1, p2 }), 0, 1)
      // return vec4(0, 0, 0, 1)
    })

    material.positionNode = processText()

    // const alpha = float(0.1).sub(uv().sub(0.5).length())
    material.colorNode = vec4(1, 1, 1, 1)
    return material
  }, [])

  useInterval(() => {
    gl.computeAsync(computeNode)
  }, 1000)

  return (
    <>
      <instancedMesh material={material} count={arcLength * curves}>
        <planeGeometry attach='geometry' />
      </instancedMesh>
    </>
  )
}

export default function Text() {
  const points = 5,
    curves = 1,
    size = 1,
    spacing = 2
  return (
    <Scene
      {...{ points, curves, size, spacing }}
      controlPoint={({
        pointI,
        curveI
      }: {
        pointI: ShaderNodeObject<OperatorNode>
        curveI: ShaderNodeObject<OperatorNode>
      }) => {
        return select(
          pointI.lessThan(1),
          vec3(0, 0, 0),
          select(
            pointI.lessThan(2),
            vec3(1, 1, 0),
            select(
              pointI.lessThan(3),
              vec3(1, -1, 0),
              select(pointI.lessThan(4), vec3(-1, -1, 0), vec3(-1, 1, 0))
            )
          )
        )
      }}
    />
  )
}
