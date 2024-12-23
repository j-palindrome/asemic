import { extend, useThree } from '@react-three/fiber'
import _ from 'lodash'
import { Pt } from 'pts'
import { useMemo } from 'react'
import { AdditiveBlending, FloatType, Vector2 } from 'three'
import OperatorNode from 'three/src/nodes/math/OperatorNode.js'
import {
  float,
  Fn,
  instanceIndex,
  Loop,
  mul,
  ShaderNodeObject,
  texture,
  textureStore,
  uniform,
  uniformArray,
  uvec2,
  vec2,
  vec3,
  vec4,
  wgslFn
} from 'three/tsl'
import {
  SpriteNodeMaterial,
  StorageTexture,
  VarNode,
  WebGPURenderer
} from 'three/webgpu'
import { GroupBuilder } from '../../src/ptsSystem/GroupBuilder'
import { useInterval } from '../../util/src/dom'
import { sum } from 'lodash'

extend(SpriteNodeMaterial)

declare module '@react-three/fiber' {
  interface ThreeElements {
    spriteNodeMaterial: SpriteNodeMaterial
  }
}

const shape = (
  points: 2 | 3 | 4 | 5 | 6,
  { out = 0.5, width = 1, height = 1, up = 0, into = 0 } = {}
) => {
  let group =
    points === 2
      ? new GroupBuilder([0, 0], [width, height])
      : points === 3
      ? new GroupBuilder([0, 0], [out, height * 2], [width, up])
      : points === 4
      ? new GroupBuilder(
          [0, 0],
          [width / 2 - out, height - up],
          [width / 2 + out, height],
          [width, 0]
        )
      : points === 5
      ? new GroupBuilder(
          [0, 0],
          [-out, up + height / 2],
          [width / 2, height],
          [width + out, up + height / 2],
          [width, 0]
        )
      : new GroupBuilder(
          [0, 0],
          [-out, up],
          [-out + into, height],
          [width + out - into, height],
          [width + out, up],
          [width, 0]
        )

  return group
}

function Scene({
  controlPoint,
  points,
  size = 1,
  spacing = 2
}: {
  points: number[]
  size: number
  spacing: number
  controlPoint: ({
    pointI,
    curveI
  }: {
    pointI: ShaderNodeObject<OperatorNode>
    curveI: ShaderNodeObject<OperatorNode>
  }) => ReturnType<typeof vec3>
}) {
  const maxPoints = _.max(points)!
  const curves = points.length
  const pointCounts = uniformArray(points, 'int')

  // @ts-ignore
  const gl = useThree(({ gl }) => gl as WebGPURenderer)

  const storageTexture = new StorageTexture(maxPoints, curves)
  storageTexture.type = FloatType
  // storageTexture.format = RGBFormat

  const advanceControlPoints = Fn(
    ({ storageTexture }: { storageTexture: StorageTexture }) => {
      const pointI = instanceIndex.modInt(maxPoints)
      const curveI = instanceIndex.div(maxPoints)
      const xyz = controlPoint({ pointI, curveI })

      return textureStore(
        storageTexture,
        uvec2(pointI, curveI),
        vec4(xyz, 1, 1)
      ).toWriteOnly()
    }
  )

  // @ts-ignore
  const computeNode = advanceControlPoints({
    storageTexture
    // @ts-ignore
  }).compute(maxPoints * curves)

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

    const weights = uniformArray([1, 1, 1, 1, 1], 'float')
    const length = uniform(maxPoints, 'int')
    const degree = 2

    const processText = Fn(() => {
      const rationalBezierCurve = Fn(
        ({ t }: { t: ShaderNodeObject<VarNode> }) => {
          let numerator = vec3(0, 0, 0).toVar()
          let denominator = float(0).toVar()

          const basisFunction = wgslFn(/*wgsl*/ `
fn basisFunction(i:i32, t:f32, pointCount:i32) -> f32 {
  let degree: i32 = ${degree};
  var N: array<f32, ${maxPoints + degree + 1}>;
  var knotVector: array<f32, ${maxPoints + degree + 1}>;
  for (var j:i32 = 0; j <= degree; j++) {
    knotVector[j] = 0.;
  }
  for (var j:i32 = 1; j < pointCount - degree; j++) {
    knotVector[j + degree] = f32(j) / f32(pointCount - degree);
  }
  for (var j:i32 = 0; j <= degree; j++) {
    knotVector[j + pointCount] = 1.;
  }

  for (var j : i32 = 0; j <= degree; j = j + 1)
  {
    N[j] = select(0.0, 1.0, 
      t >= knotVector[i + j] && t < knotVector[i + j + 1]);
  }

  //Compute higher-degree basis functions iteratively
  for (var k : i32 = 1; k <= degree; k = k + 1)
  {
    for (var j : i32 = 0; j <= degree - k; j = j + 1)
    {
      let d1 = knotVector[i + j + k] - knotVector[i + j];
      let d2 = knotVector[i + j + k + 1] - knotVector[i + j + 1];

      let term1 = select(0.0, 
        (t - knotVector[i + j]) / d1 * N[j], d1 > 0.0);
      let term2 = select(0.0, 
        (knotVector[i + j + k + 1] - t) / d2 * N[j + 1], d2 > 0.0);

      N[j] = term1 + term2;
    }
  }

  return N[0];
}
        `)

          Loop({ start: 0, end: length }, ({ i }) => {
            const N = basisFunction({
              i,
              t,
              pointCount: pointCounts.element(curveI)
            })
            numerator.addAssign(
              mul(
                N,
                weights.element(i),
                texture(
                  storageTexture,
                  vec2(
                    i
                      .toFloat()
                      .div(maxPoints)
                      .add(0.5 / maxPoints),
                    curveI.div(curves).add(0.5 / curves)
                  )
                )
              )
            )
            denominator.addAssign(mul(N, weights.element(i)))
          })

          return numerator.div(denominator)
        }
      )

      const curveI = instanceIndex.div(arcLength).toFloat()
      const t = instanceIndex.toFloat().mod(arcLength).div(arcLength).toVar()
      let position = vec4(0, 0, 0, 1).toVar()
      position.xy.assign(rationalBezierCurve({ t }))
      return position
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
      <instancedMesh material={material} count={arcLength * points.length}>
        <planeGeometry attach='geometry' />
      </instancedMesh>
    </>
  )
}

export default function Text() {
  const size = 10,
    spacing = 0.25

  const textureFont: Record<string, (b: ) = [
    b => 
      b.shape(6, { up: 0.3, out: 0.2, into: 0.2 }).rad(0.25).add([0.5, -0.5]).shape(3, { height: 0.1 }).rad(0.25).add([0.5, -0.5])
    ,
    b => 
      b.shape(2, { width: 0, height: 1 }).shape(4).scale(0.5).rad(-0.25).add([0, 0.5])
    ,
    b => b.shape(6, { height: -1 }).rad(-0.25).within([0, 0], [1, 1])
  ]

  let sum = 0
  const textureLengths = textureFont.map(
    (_, i) => (sum += textureFont[i - 1]?.length ?? 0)
  )
  const letterIndexes = [[2, 0]]
  const letterIndexesFlat = letterIndexes.map(x => textureLengths[x[0]] + x[1])
  const points = letterIndexes.map(i => textureFont[i[0]][i[1]].length)
  const letterIndexesU = uniformArray(letterIndexesFlat)
  console.log(letterIndexes.map(x => textureLengths[x[0]] + x[1]))

  const fontWidth = _.max(textureFont.flat().map(x => x.length))
  const fontHeight = _.max(textureFont.map(x => x.length))
  const fontDepth = textureFont.length
  const texturePack = new Array(fontWidth * fontHeight * fontDepth)
  for (let letterI = 0; letterI < fontDepth; letterI++) {
    for (let curveI = 0; curveI < fontHeight; curveI++) {
      for (let pointI = 0; pointI < fontWidth; pointI++) {
        texturePack[
          letterI * fontHeight * fontWidth + curveI * fontWidth + pointI
        ] = new Vector2(...(textureFont[letterI][curveI]?.[pointI] ?? [0, 0]))
      }
    }
  }
  const letters = uniformArray(texturePack)

  return (
    <Scene
      {...{ points, size, spacing }}
      controlPoint={({ pointI, curveI }) => {
        const fontCurveIndex = letterIndexesU.element(curveI)
        return letters.element(fontCurveIndex.mul(fontWidth).add(pointI))
      }}
    />
  )
}
