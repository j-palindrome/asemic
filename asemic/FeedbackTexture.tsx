import { useFBO } from '@react-three/drei'
import { createPortal, useFrame, useThree } from '@react-three/fiber'
import { range } from 'lodash'
import { forwardRef, useMemo, useRef } from 'react'
import * as THREE from 'three'
import { PlaneGeometry } from 'three'
import { ChildComponent } from '../blocks/FrameChildComponents'
import { ChildProps } from '../types'

const vert = /*glsl*/ `
out vec2 vUv;

void main() {
  vUv = uv;
  gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1);
}
`

export type FeedbackTextureRef = {
  texture: THREE.Texture
}

const FeedbackTexture = forwardRef<
  FeedbackTextureRef,
  ChildProps<
    {
      fragmentShader: string
      includes?: string
      width: number
      height: number
      uniforms?: Record<string, { value: any }>
    },
    {},
    {}
  >
>((props, ref) => {
  const { fragmentShader, width, height, uniforms, includes } = props
  const { scene, camera } = useMemo(
    () => ({
      scene: new THREE.Scene(),
      camera: new THREE.OrthographicCamera(0, 1, 1, 0, 0, 1)
    }),
    []
  )

  const renderTargets = range(2).map(i =>
    useFBO(width, height, {
      minFilter: THREE.NearestFilter,
      magFilter: THREE.NearestFilter,
      format: THREE.RGBAFormat,
      stencilBuffer: false,
      type: THREE.FloatType
    })
  )

  const frag = /*glsl*/ `
in vec2 vUv;

uniform sampler2D feedback;
uniform float progress;
uniform float resolution;

${includes ?? ''}
vec3 solveFrag(vec3 lastPoint) {
  ${fragmentShader}
}

void main() {
  vec3 fragColor = solveFrag(texture(feedback, vUv).xyz);
  gl_FragColor = vec4(fragColor, 1);
}
`

  const feedbackMesh = useRef<THREE.Mesh<PlaneGeometry, THREE.ShaderMaterial>>(
    null!
  )

  let currentFrame = useRef(0)
  const { gl } = useThree()
  const draw = (progress: number) => {
    const thisBuffer = renderTargets[currentFrame.current]
    currentFrame.current = currentFrame.current ? 0 : 1
    const lastBuffer = renderTargets[currentFrame.current]

    gl.setRenderTarget(thisBuffer)
    feedbackMesh.current.material.uniforms.feedback.value = lastBuffer.texture
    feedbackMesh.current.material.uniforms.progress.value = progress
    feedbackMesh.current.material.uniformsNeedUpdate = true
    gl.clear()
    gl.render(scene, camera)
    gl.setRenderTarget(null)
    // this gets around the Chrome freakout
    feedbackMesh.current.material.uniforms.feedback.value = null
    const r = ref as React.MutableRefObject<FeedbackTextureRef>
    r.current.texture = lastBuffer.texture
  }

  return (
    <ChildComponent
      options={{ ...props }}
      getSelf={() => {
        return {}
      }}
      defaultDraw={(self, parent, progress, ctx) => {
        draw(progress)
      }}>
      {createPortal(
        <mesh position={[0.5, 0.5, 0]} ref={feedbackMesh}>
          <planeGeometry args={[1, 1]} />
          <shaderMaterial
            fragmentShader={frag}
            vertexShader={vert}
            uniforms={{
              feedback: {
                value: undefined
              },
              resolution: { value: new THREE.Vector2(width, height) },
              progress: { value: 0 },
              ...uniforms
            }}
          />
        </mesh>,
        scene
      )}
    </ChildComponent>
  )
})

export default FeedbackTexture
