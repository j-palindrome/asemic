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

extend(SpriteNodeMaterial)

declare module '@react-three/fiber' {
  interface ThreeElements {
    spriteNodeMaterial: SpriteNodeMaterial
  }
}

const shape = (points: 2 | 3 | 4 | 5 | 8, midPointScale: number = 0.5) => {
  let group =
    points === 2
      ? new GroupBuilder([0, 0], [1, 0])
      : points === 3
      ? new GroupBuilder([0, 0], [midPointScale, 1], [1, 1])
      : points === 4
      ? new GroupBuilder(
          [0, 0],
          [0.5 - midPointScale, 1],
          [0.5 + midPointScale, 1],
          [1, 0]
        )
      : points === 5
      ? new GroupBuilder(
          [0, 0],
          [-midPointScale, 0.5],
          [0.5, 1],
          [1 + midPointScale, 0.5],
          [1, 0]
        )
      : new GroupBuilder(
          [0, 0],
          [-0.5, 0],
          [-0.5, 0.5],
          [-0.5, 1],
          [0, 1],
          [0.5, 1],
          [0.5, 0.5],
          [0, 0]
        )

  return group
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
  controlPoint?: ({
    pointI,
    curveI
  }: {
    pointI: ShaderNodeObject<OperatorNode>
    curveI: ShaderNodeObject<OperatorNode>
  }) => ReturnType<typeof vec3>
}) {
  const textureFont: GroupBuilder[][] = [
    [
      shape(5, 0.2).scale([1, -1]).rad(-0.25).add([0.5, 0.5]),
      shape(3)
        .scale([1, -0.2])
        .rad(-0.25)
        .add([0.5, 0.5])
        .concat([
          [0, 0],
          [0, 0]
        ])
    ]
  ]
  const fontWidth = _.max(textureFont.flat().map(x => x.length))
  const fontHeight = _.max(textureFont.map(x => x.length))
  const fontDepth = textureFont.length
  const texturePack = new Array(fontWidth * fontHeight * fontDepth)
  for (let letterI = 0; letterI < fontDepth; letterI++) {
    for (let curveI = 0; curveI < fontHeight; curveI++) {
      for (let pointI = 0; pointI < fontWidth; pointI++) {
        texturePack[
          letterI * fontHeight * fontWidth + curveI * fontWidth + pointI
        ] =
          new Vector2(...textureFont[letterI][curveI]?.[pointI]) ??
          new Vector2(0, 0)
      }
    }
  }

  const letters = uniformArray(texturePack)
  const letterIndexes = uniformArray([0, 1])
  console.log(texturePack)

  // @ts-ignore
  const gl = useThree(({ gl }) => gl as WebGPURenderer)

  const storageTexture = new StorageTexture(points, curves)
  storageTexture.type = FloatType
  // storageTexture.format = RGBFormat

  const advanceControlPoints = Fn(
    ({ storageTexture }: { storageTexture: StorageTexture }) => {
      const pointI = instanceIndex.modInt(points)
      const curveI = instanceIndex.div(points)
      const fontCurveIndex = letterIndexes.element(curveI)
      const xyz = letters.element(fontCurveIndex.mul(fontWidth).add(pointI))

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
  }).compute(points * curves)

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
    const length = uniform(points, 'int')
    const degree = 2
    const knotLength = points + degree + 1
    const generateKnotVector = () => {
      return _.range(degree + 1)
        .map(x => 0)
        .concat(_.range(1, points - degree).map(i => i / (points - degree)))
        .concat(_.range(degree + 1).map(x => 1))
    }

    const processText = Fn(() => {
      const rationalBezierCurve = Fn(
        ({ t }: { t: ShaderNodeObject<VarNode> }) => {
          let numerator = vec3(0, 0, 0).toVar()
          let denominator = float(0).toVar()

          const basisFunction = wgslFn(/*wgsl*/ `
fn basisFunction(i:i32, t:f32) -> f32 {
  var N : array<f32, ${knotLength}>;
  let knotVector = array<f32, ${knotLength}>(${generateKnotVector()});
  let degree : i32 = ${degree};

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
            const N = basisFunction({ i, t })
            numerator.addAssign(
              mul(
                N,
                weights.element(i),
                texture(
                  storageTexture,
                  vec2(
                    i
                      .toFloat()
                      .div(points)
                      .add(0.5 / points),
                    curveI.add(0.5 / curves)
                  )
                )
              )
            )
            denominator.addAssign(mul(N, weights.element(i)))
          })

          return numerator.div(denominator)
        }
      )

      const curveI = instanceIndex.div(arcLength).toFloat().div(curves)
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
      <instancedMesh material={material} count={arcLength * curves}>
        <planeGeometry attach='geometry' />
      </instancedMesh>
    </>
  )
}

export default function Text() {
  const points = 5,
    curves = 2,
    size = 10,
    spacing = 0.25
  return <Scene {...{ points, curves, size, spacing }} />
}
