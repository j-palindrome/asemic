import { Canvas } from '@react-three/fiber'
import { useState } from 'react'
import { WebGPURenderer } from 'three/webgpu'
import Brush from './Brush'

export default function Asemic({
  source,
  children
}: { source?: string } & React.PropsWithChildren) {
  const [frameloop, setFrameloop] = useState<
    'never' | 'always' | 'demand' | undefined
  >('never')

  return (
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
      {source
        ?.split('\n')
        .filter(x => x)
        .map((x, i) => (
          <Brush key={i} render={b => b.parse(x)} />
        ))}
      {children}
    </Canvas>
  )
}
