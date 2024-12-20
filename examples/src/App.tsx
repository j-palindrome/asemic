import { Canvas, extend } from '@react-three/fiber'
import { useMemo, useState } from 'react'
import { AdditiveBlending, Color, Vector2 } from 'three'
import {
  float,
  Fn,
  If,
  instanceIndex,
  int,
  Loop,
  mul,
  select,
  textureStore,
  uniform,
  uniformArray,
  uv,
  uvec2,
  vec2,
  vec4,
  workgroupArray,
  wgslFn
} from 'three/tsl'
import {
  SpriteNodeMaterial,
  StorageTexture,
  WebGPURenderer
} from 'three/webgpu'

extend(SpriteNodeMaterial)

declare module '@react-three/fiber' {
  interface ThreeElements {
    spriteNodeMaterial: SpriteNodeMaterial
  }
}

function App() {
  // compute beginning of curves, then

  const width = 10,
    height = 1

  const storageTexture = new StorageTexture(width, height)
  // create function

  // @ts-ignore
  const pointProgress = Fn(({ storageTexture }) => {
    const posX = instanceIndex.modInt(width)
    const posY = instanceIndex.div(width)
    const indexUV = uvec2(posX, posY)

    // https://www.shadertoy.com/view/Xst3zN

    const x = float(posX).div(50.0)
    const y = float(posY).div(50.0)

    const v1 = x.sin()
    const v2 = y.sin()
    const v3 = x.add(y).sin()
    const v4 = x.mul(x).add(y.mul(y)).sqrt().add(5.0).sin()
    const v = v1.add(v2, v3, v4)

    const r = v.sin()
    const g = v.add(Math.PI).sin()
    const b = v.add(Math.PI).sub(0.5).sin()

    textureStore(storageTexture, indexUV, vec4(r, g, b, 1)).toWriteOnly()
  })

  // compute

  // @ts-ignore
  const pointProgressNode = pointProgress({ storageTexture }).compute(
    width * height
  )

  const material = useMemo(() => {
    const material = new SpriteNodeMaterial({
      transparent: true,
      depthWrite: false,
      blending: AdditiveBlending
    })

    const size = uniform(0.08)
    material.scaleNode = size

    const points = [
      new Vector2(0, 0),
      new Vector2(1, 1),
      new Vector2(-1, 0),
      new Vector2(1, -1)
    ]
    const controlPoints = uniformArray(points)
    const weights = uniformArray([1, 1, 1, 1], 'float')
    const length = uniform(4, 'int')
    // const knots = [0, 0, 0, 1, 2, 3, 3, 3]
    // const knotVector = uniformArray(knots, 'float')

    const processText = Fn(() => {
      const rationalBezierCurve = Fn(({ t }) => {
        let numerator = vec2(0, 0).toVar()
        let denominator = float(0).toVar()

        const basisFunction = wgslFn(/*wgsl*/ `
fn basisFunction(i:i32, t:f32) -> f32 {
  var N : array<f32, 8>;
  let knotVector = array<f32, 8>(0., 0., 0., 1., 2., 3., 3., 3.);
  let degree : i32 = 3;

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
      })

      let position = vec4(0, 0, 0, 1).toVar()
      const t = int(300).sub(instanceIndex).toFloat().div(300).toVar()
      position.xyz.assign(rationalBezierCurve({ t }))
      return position
    })

    material.positionNode = processText()

    const alpha = float(0.1).sub(uv().sub(0.5).length())
    material.colorNode = vec4(1, 1, 1, alpha)
    return material
  }, [])

  // debug

  // const gui = new GUI()

  // gui.add(size, 'value', 0, 1, 0.001).name('size')

  // gui
  //   .addColor({ color: colorInside.value.getHex(SRGBColorSpace) }, 'color')
  //   .name('colorInside')
  //   .onChange(function (value) {
  //     colorInside.value.set(value)
  //   })

  // gui
  //   .addColor({ color: colorOutside.value.getHex(SRGBColorSpace) }, 'color')
  //   .name('colorOutside')
  //   .onChange(function (value) {
  //     colorOutside.value.set(value)
  //   })

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
            renderer.computeAsync(pointProgressNode)
            setFrameloop('always')
          })
          return renderer
        }}>
        <instancedMesh material={material} count={20000}>
          <planeGeometry attach='geometry' />
        </instancedMesh>
      </Canvas>
    </>
  )
}

export default App
