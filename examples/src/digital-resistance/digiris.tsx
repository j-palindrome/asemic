import Hydra from 'hydra-synth'
import { useEffect, useRef, useState } from 'react'
import { now } from 'lodash'
import { Color } from 'three'
import { slides } from './slides'
import { useEventListener } from '../../../util/src/dom'
import Builder from '../../../util/src/asemic/Builder'
import Brush from '../../../util/src/asemic/Brush'
import Asemic from '../../../util/src/asemic/Asemic'

export default function DigiRis() {
  const [currentChild, setCurrentChild] = useState(0)
  const canvasRef = useRef<HTMLCanvasElement>(null!)
  const hydraRef = useRef<Hydra>(null!)
  useEffect(() => {
    const hydra = new Hydra({
      canvas: canvasRef.current,
      makeGlobal: false,
      width: window.innerWidth * devicePixelRatio,
      height: window.innerHeight * devicePixelRatio
    })
    hydraRef.current = hydra
  }, [])

  useEventListener('keydown', ev => {
    if (ev.key === 'r') {
      hydraRef.current.synth.s0.initScreen()
    }
  })

  const defaultFunc = (b: Builder) =>
    // @ts-ignore
    b.set({ thickness: 2, color: new Color('pink') })

  // useEffect(() => {
  //   const hydra = hydraRef.current.synth
  //   slides[currentChild]?.(hydra.src(hydra.s0)).out()
  // }, [currentChild])

  useEventListener(
    'keydown',
    ev => {
      switch (ev.key) {
        case 'ArrowLeft':
          setCurrentChild(currentChild - 1)
          break
        case 'ArrowRight':
          setCurrentChild(currentChild + 1)
          break
      }
    },
    [currentChild]
  )

  return (
    <>
      <div className='h-full w-full absolute top-0 left-0'>
        <canvas ref={canvasRef} className='h-full w-full' />
      </div>
      <Asemic>
        {slides[currentChild]?.asemic?.map((c, i) => (
          <Brush key={currentChild + i + now()} render={c} />
        ))}
      </Asemic>
      <div className='text-pink-600 z-10 absolute top-0 left-0 h-full w-full font-mono font-bold'>
        {slides[currentChild]?.slide}
      </div>
    </>
  )
}
