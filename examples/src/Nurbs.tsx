import { Canvas, extend } from '@react-three/fiber'
import _ from 'lodash'
import { useMemo, useState } from 'react'
import { AdditiveBlending, Color, Vector2 } from 'three'
import {
  float,
  Fn,
  If,
  instanceIndex,
  Loop,
  mul,
  ShaderNodeObject,
  textureStore,
  uniform,
  uniformArray,
  uv,
  uvec2,
  vec2,
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
import Drawing from '../../src/ptsSystem/Drawing'
import { Pt } from 'pts'

extend(SpriteNodeMaterial)

declare module '@react-three/fiber' {
  interface ThreeElements {
    spriteNodeMaterial: SpriteNodeMaterial
  }
}

function App() {
  const width = 10,
    height = 1

  const storageTexture = new StorageTexture(width, height)

  // @ts-ignore
  const pointProgress = Fn(({ storageTexture }) => {
    const posX = instanceIndex.modInt(width)
    const posY = instanceIndex.div(width)
    const indexUV = uvec2(posX, posY)

    const processIndex = wgslFn(/*wgsl*/ `
fn processIndex(posX: i32, posY: i32) -> vec2<f32> {
  
}
`)
    const xy = processIndex(posX, posY)

    textureStore(storageTexture, indexUV, vec4(xy, 0, 1)).toWriteOnly()
  })

  const groups = new Drawing(d => [
    [
      [0, 0],
      [1, 1],
      [1, -1],
      [-1, -1],
      [-1, 1]
    ],
    [
      [0, 0],
      [1, 1],
      [1, -1],
      [-1, -1]
    ],
    new GroupBuilder([0, 0], [-1, -1], [-1, 1], [1, 1]).scale(0.3).add(0.2, 0.3)
  ]).groups

  let arcLengths: number[] = groups.map(
    x =>
      (x.getArcLength() / 10) *
      new Pt(window.innerWidth, window.innerHeight).magnitude()
  )

  const materials = useMemo(() => {
    return groups.map((points, i) => {
      const material = new SpriteNodeMaterial({
        transparent: true,
        depthWrite: false,
        blending: AdditiveBlending
      })

      const size = uniform(0.08)
      material.scaleNode = size

      const controlPoints = uniformArray(points, 'vec2')
      const weights = uniformArray([1, 1, 1, 1, 1], 'float')
      const count = uniform(arcLengths[i], 'float')
      const length = uniform(points.length, 'int')
      const degree = 2
      const knotLength = points.length + degree + 1
      const generateKnotVector = () => {
        return _.range(degree + 1)
          .map(x => 0)
          .concat(
            _.range(1, points.length - degree).map(
              i => i / (points.length - degree)
            )
          )
          .concat(_.range(degree + 1).map(x => 1))
      }

      const processText = Fn(() => {
        const rationalBezierCurve = Fn(
          ({ t }: { t: ShaderNodeObject<VarNode> }) => {
            let numerator = vec2(0, 0).toVar()
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
                mul(N, weights.element(i), controlPoints.element(i))
              )
              denominator.addAssign(mul(N, weights.element(i)))
            })

            return numerator.div(denominator)
          }
        )

        let position = vec4(0, 0, 0, 1).toVar()
        const t = instanceIndex.toFloat().div(count).toVar()
        position.xyz.assign(rationalBezierCurve({ t }))
        return position
      })

      material.positionNode = processText()

      const alpha = float(0.1).sub(uv().sub(0.5).length())
      material.colorNode = vec4(1, 1, 1, alpha)
      return material
    })
  }, [])

  const [frameloop, setFrameloop] = useState<
    'never' | 'always' | 'demand' | undefined
  >('never')

  return (
    <>
      <Canvas
        frameloop={frameloop}
        style={{ height: '100vh', width: '100vw' }}
        orthographic
        camera={{
          near: 0,
          far: 1,
          left: -1,
          right: 1,
          top: 1,
          bottom: -1,
          position: [0, 0, 0]
        }}
        scene={{ background: new Color(0x000000) }}
        gl={canvas => {
          const renderer = new WebGPURenderer({
            canvas: canvas as HTMLCanvasElement,
            powerPreference: 'high-performance',
            antialias: true,
            alpha: true
          })
          renderer.init().then(() => {
            setFrameloop('always')
          })
          return renderer
        }}>
        {_.range(groups.length).map(i => (
          <instancedMesh key={i} material={materials[i]} count={arcLengths[i]}>
            <planeGeometry attach='geometry' />
          </instancedMesh>
        ))}
      </Canvas>
    </>
  )
}

export default App
