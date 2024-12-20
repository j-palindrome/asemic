import { OrbitControls } from '@react-three/drei'
import { Canvas, extend } from '@react-three/fiber'
import { useEffect, useMemo, useState } from 'react'
import { AdditiveBlending, Color, PerspectiveCamera, Vector3 } from 'three'
import {
  float,
  Fn,
  If,
  instanceIndex,
  int,
  Loop,
  mul,
  pow,
  range,
  textureStore,
  uniform,
  uniformArray,
  uv,
  uvec2,
  vec3,
  vec4,
  wgslFn
} from 'three/tsl'
import {
  SpriteNodeMaterial,
  StorageTexture,
  WebGPURenderer
} from 'three/webgpu'
import { GroupBuilder } from '../../src/ptsSystem/GroupBuilder'

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

    const controlPoints = uniformArray([
      new Vector3(0, 0, 0),
      new Vector3(1, 1, 0),
      new Vector3(-1, 0, 0),
      new Vector3(1, -1, 0)
    ])
    const weights = uniformArray([1, 3, 5, 1])
    const length = uniform(4)

    const processText = Fn(() => {
      const rationalBezierCurve = ({ t }: { t: ReturnType<typeof float> }) => {
        let numerator = vec3(0, 0, 0).toVar()
        let denominator = float(0).toVar()

        Loop({ start: 0, end: length }, ({ i }: { i: number }) => {
          const binomialCoeff = float(1).toVar()
          const term = mul(
            binomialCoeff,
            pow(t, float(i)),
            pow(t.oneMinus(), length.sub(i))
          )
          numerator.addAssign(
            mul(term, weights.element(i), controlPoints.element(i))
          )
          denominator.addAssign(mul(term, weights.element(i)))
        })

        return numerator.div(denominator)
      }

      let position = vec4(0, 0, 0, 1).toVar()
      If(instanceIndex.lessThan(300), () => {
        const t = int(300).sub(instanceIndex).toFloat().div(300)

        position.xyz.assign(rationalBezierCurve({ t }))
      }).ElseIf(instanceIndex.lessThan(600), () => {})
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
