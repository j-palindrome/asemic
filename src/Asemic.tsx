import WebAudioRenderer from '@elemaudio/web-renderer'
import { Canvas, extend, useFrame, useThree } from '@react-three/fiber'
import { useContext, useEffect, useRef, useState } from 'react'
import { HalfFloatType, OrthographicCamera, RenderTarget, Vector2 } from 'three'
import { Fn, pass, texture } from 'three/tsl'
import { PostProcessing, QuadMesh, WebGPURenderer } from 'three/webgpu'
import SceneBuilder from './Builder'
import { AsemicContext } from './util/asemicContext'
import { SettingsInput, useBuilderEvents, useEvents } from './util/useEvents'
import { el } from '@elemaudio/core'

extend({
  QuadMesh
})

declare module '@react-three/fiber' {
  interface ThreeElements {
    quadMesh: Object3DNode<QuadMesh, typeof QuadMesh>
  }
}

export function AsemicCanvas({
  children,
  className,
  dimensions: [width, height] = ['100%', '100%'],
  style,
  outputChannel = 0,
  useAudio = false,
  highBitDepth = true
}: {
  className?: string
  dimensions?: [number | string, number | string]
  style?: React.CSSProperties
  useAudio?: boolean
  outputChannel?: number
  highBitDepth?: boolean
} & React.PropsWithChildren) {
  const [audio, setAudio] = useState<SceneBuilder<any>['audio']>(null)
  const canvasRef = useRef<HTMLCanvasElement>(null!)
  const [started, setStarted] = useState(useAudio ? false : true)
  // const [recording, setRecording] = useState(false)
  const [frameloop, setFrameloop] = useState<'never' | 'always'>('never')
  const coords: [number, number][] = []

  return !started ? (
    <button className='text-white' onClick={() => setStarted(true)}>
      start
    </button>
  ) : (
    <>
      <Canvas
        onClick={ev => {
          if (ev.shiftKey) {
            coords.splice(0, coords.length - 1)
          } else if (ev.metaKey) {
            coords.splice(0, coords.length)
          }
          coords.push([
            ev.clientX / canvasRef.current.clientWidth,
            (canvasRef.current.clientHeight - ev.clientY) /
              canvasRef.current.clientHeight
          ])
          navigator.clipboard.writeText(
            coords
              .map(x => `[${x[0].toFixed(2)}, ${x[1].toFixed(2)}]`)
              .join(', ')
          )
          console.log(
            coords.map(x => `${x[0].toFixed(2)}, ${x[1].toFixed(2)}`).join(', ')
          )
        }}
        ref={canvasRef}
        style={{ height, width, ...style }}
        frameloop={frameloop}
        className={className}
        orthographic
        camera={{
          near: 0,
          far: 1,
          left: 0,
          right: 1,
          top: 1,
          bottom: 0,
          position: [0, 0, 0]
        }}
        gl={canvas => {
          const renderer = new WebGPURenderer({
            canvas: canvas as HTMLCanvasElement,
            powerPreference: 'high-performance',
            antialias: true,
            depth: false,
            stencil: false,
            alpha: true
          })

          const initAudio = async () => {
            if (!useAudio) return null

            const audioContext = new AudioContext()

            const core = new WebAudioRenderer()
            const elNode = await core.initialize(audioContext, {
              numberOfInputs: 0,
              numberOfOutputs: 2,
              outputChannelCount: [1, 1]
            })
            const channelMerger = audioContext.createChannelMerger(
              audioContext.destination.maxChannelCount
            )
            audioContext.destination.channelCount =
              audioContext.destination.maxChannelCount
            audioContext.destination.channelCountMode = 'explicit'
            audioContext.destination.channelInterpretation = 'discrete'

            channelMerger.connect(audioContext.destination)
            elNode.connect(channelMerger, 0, outputChannel)
            elNode.connect(channelMerger, 1, outputChannel + 1)
            return { ctx: audioContext, elCore: core, elNode }
          }

          if (highBitDepth) {
            renderer.backend.utils.getPreferredCanvasFormat = () => {
              return 'rgba16float'
            }
          }

          Promise.all([renderer.init(), initAudio()]).then(async result => {
            if (highBitDepth) {
              const context = renderer.getContext()
              context.configure({
                device: renderer.backend.device,
                format: renderer.backend.utils.getPreferredCanvasFormat()
              })
            }

            setAudio(result[1])
            setFrameloop('always')
          })
          return renderer
        }}>
        {frameloop === 'always' && (audio || !useAudio) && (
          <AsemicContext.Provider value={{ audio }}>
            {children}
          </AsemicContext.Provider>
        )}
        {frameloop === 'always' && <Adjust />}
      </Canvas>
    </>
  )
}

function Adjust() {
  const size = useThree(state => state.size)
  const camera = useThree(state => state.camera as OrthographicCamera)
  useEffect(() => {
    camera.top = size.height / size.width
    camera.updateProjectionMatrix()
  }, [size])
  return <></>
}

export function useAsemic<T extends SettingsInput>({
  controls,
  ...settings
}: {
  controls?: T
} & Partial<SceneBuilder<T>['sceneSettings']> = {}) {
  const { renderer, scene, camera } = useThree(
    ({ gl, scene, camera, invalidate, advance }) => ({
      // @ts-expect-error
      renderer: gl as WebGPURenderer,
      scene,
      camera,
      invalidate,
      advance
    })
  )
  controls = {
    constants: { ...controls?.constants },
    uniforms: { ...controls?.uniforms },
    refs: { ...controls?.refs }
  } as T

  const size = useThree(state => state.gl.getDrawingBufferSize(new Vector2()))

  const { audio } = useContext(AsemicContext)
  useEffect(() => {
    if (audio) {
      const { elCore, elNode, ctx } = audio
      elCore.render(el.cycle(440), el.cycle(445))
      console.log(ctx.destination)

      // elNode.connect(ctx.destination, 0, 18)
      // console.log('this is run')
    }
  }, [audio])
  const renderTarget = new RenderTarget(size.width, size.height, {
    type: HalfFloatType
  })
  const renderTarget2 = new RenderTarget(size.width, size.height, {
    type: HalfFloatType
  })
  const readback = texture(renderTarget.texture)

  const postProcessing = new PostProcessing(renderer)
  const scenePass = pass(scene, camera)

  const controlsBuilt = useEvents(controls)

  const h = size.height / size.width
  const b = new SceneBuilder(
    settings,
    {
      postProcessing: { postProcessing, scenePass, readback },
      audio,
      h,
      size
    },
    controlsBuilt
  )
  useEffect(() => {
    b.h = h
    b.size = size
  }, [h, size])
  useBuilderEvents(b)

  postProcessing.outputNode = Fn(() => {
    const output = b.sceneSettings
      .postProcessing(scenePass.getTextureNode('output') as any, {
        scenePass,
        readback
      })
      .toVar('outputAssign')
    return output
  })()

  let phase = true

  useFrame(() => {
    if (b.sceneSettings.useReadback) {
      phase = !phase
      postProcessing.renderer.setRenderTarget(
        phase ? renderTarget : renderTarget2
      )
      postProcessing.render()
      postProcessing.renderer.setRenderTarget(null)
      postProcessing.render()
      readback.value = phase ? renderTarget.texture : renderTarget2.texture
      readback.needsUpdate = true
    } else {
      postProcessing.render()
    }
  }, 1)

  // # AUDIO ----

  const renderAudio = () => {
    if (!b.audio || !b.sceneSettings.audio) return
    const render = b.sceneSettings.audio()
    if (render instanceof Array) b.audio.elCore.render(...render)
    else b.audio.elCore.render(render, render)
  }

  useEffect(renderAudio, [b])

  return b
}
