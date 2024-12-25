import { isEqual, now } from 'lodash'
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import * as THREE from 'three'
import { Vector2 } from 'three'
import { rotate2d } from '../../util/src/shaders/manipulation'
import { useEventListener } from '../util/src/dom'
import { bezierPoint, multiBezierProgress } from '../util/src/shaders/bezier'
import Builder from './Builder'
import _ from 'lodash'
import {
  atan,
  atan2,
  Break,
  cameraProjectionMatrix,
  cos,
  float,
  Fn,
  hash,
  If,
  instanceIndex,
  int,
  Loop,
  mix,
  modelViewMatrix,
  mul,
  mx_noise_float,
  mx_worley_noise_vec2,
  positionLocal,
  pow,
  range,
  Return,
  select,
  ShaderNodeObject,
  sin,
  texture,
  textureStore,
  time,
  uniform,
  uniformArray,
  uv,
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

type VectorList = [number, number]
type Vector3List = [number, number, number]
export type Jitter = {
  size?: VectorList
  position?: VectorList
  hsl?: Vector3List
  a?: number
  rotation?: number
}

export default function Brush({
  render
}: {
  render: ConstructorParameters<typeof Builder>[0]
}) {
  const keyframes = new Builder(render)

  useEventListener(
    'resize',
    () => {
      reInitialize()
    },
    []
  )
  const resolution = new Vector2(
    window.innerWidth * window.devicePixelRatio,
    window.innerHeight * window.devicePixelRatio
  )

  const [lastData, setLastData] = useState(keyframes.reInitialize(resolution))
  const {
    keyframesTex,
    colorTex,
    thicknessTex,
    groups,
    transform,
    dimensions,
    settings
  } = lastData

  const { modifyIncludes, modifyPosition, modifyColor } = settings
  const meshRef = useRef<THREE.Group>(null!)
  const maxCurveLength = resolution.length() * 2

  // const updateChildren = (newData: typeof lastData) => {
  //   if (!meshRef.current) return
  //   meshRef.current.rotation.set(0, 0, newData.transform.rotate)
  //   meshRef.current.scale.set(...newData.transform.scale.toArray(), 1)
  //   meshRef.current.position.set(...newData.transform.translate.toArray(), 0)

  //   meshRef.current.children.forEach((c, i) => {
  //     const child = c as THREE.InstancedMesh<
  //       THREE.PlaneGeometry,
  //       THREE.ShaderMaterial
  //     >
  //     if (!newData.groups[i]) return
  //     child.material.uniforms.keyframesTex.value = newData.keyframesTex
  //     child.material.uniforms.colorTex.value = newData.colorTex
  //     child.material.uniforms.thicknessTex.value = newData.thicknessTex
  //     child.material.uniforms.curveEnds.value = newData.groups[i].curveEnds
  //     child.material.uniforms.curveIndexes.value =
  //       newData.groups[i].curveIndexes
  //     child.material.uniforms.controlPointCounts.value =
  //       newData.groups[i].controlPointCounts

  //     child.material.uniforms.resolution.value = resolution
  //     child.material.uniforms.dimensions.value = newData.dimensions
  //     child.count = newData.groups[i].totalCurveLength
  //     child.material.uniformsNeedUpdate = true

  //     const { translate, scale, rotate } = newData.groups[i].transform
  //     child.material.uniforms.scaleCorrection.value = scale
  //     child.position.set(translate.x, translate.y, 0)
  //     child.scale.set(scale.x, scale.y, 1)
  //     child.rotation.set(0, 0, rotate)
  //   })
  // }

  const reInitialize = useCallback(() => {
    const resolution = new Vector2(
      window.innerWidth * window.devicePixelRatio,
      window.innerHeight * window.devicePixelRatio
    )
    const newData = keyframes.reInitialize(resolution)
    if (!isEqual(newData.curveCounts, lastData.curveCounts)) {
      console.log('reinit')

      setLastData(newData)
    } else {
      // updateChildren(newData)
    }
  }, [lastData])

  // useEffect(() => {
  //   updateChildren(lastData)
  // }, [lastData])

  useEffect(() => {
    let timeout: number
    const reinit = () => {
      reInitialize()
      timeout = window.setTimeout(reinit, Math.random() ** 2 * 300)
    }
    reinit()
    return () => window.clearTimeout(timeout)
  }, [])

  const size = 1
  const materials = useMemo(
    () =>
      groups.map(group => {
        const material = new SpriteNodeMaterial({
          transparent: true,
          depthWrite: false,
          blending: THREE.AdditiveBlending
        })

        material.scaleNode = uniform(
          (1 / window.innerWidth / devicePixelRatio) * size
        )

        const aspectRatio = uniform(
          vec2(1, window.innerHeight / window.innerWidth)
        )
        const curveEnds = uniformArray(group.curveEnds as any, 'int')
        const pointCounts = uniformArray(group.controlPointCounts as any, 'int')
        const curveIndexes = uniformArray(group.curveIndexes as any, 'int')
        const dimensionsU = uniform(dimensions, 'vec2')

        const weights = uniformArray([1, 1, 1, 1, 1], 'float')
        const degree = 2

        const main = Fn(() => {
          const rationalBezierCurve = Fn(
            ({ t }: { t: ShaderNodeObject<VarNode> }) => {
              let numerator = vec3(0, 0, 0).toVar()
              let denominator = float(0).toVar()

              const basisFunction = wgslFn(/*wgsl*/ `
              fn basisFunction(i:i32, t:f32, pointCount:i32) -> f32 {
                let degree: i32 = ${degree};
                var N: array<f32, ${dimensions.x + degree + 1}>;
                var knotVector: array<f32, ${dimensions.x + degree + 1}>;
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
                      keyframesTex,
                      vec2(
                        i.toFloat().add(0.5).div(dimensionsU.x),
                        curveIndexes
                          .element(curveI)
                          .toFloat()
                          .add(0.5)
                          .div(dimensionsU.y)
                      )
                    )
                  )
                )
                denominator.addAssign(mul(N, weights.element(i)))
              })

              return numerator.div(denominator)
            }
          )

          const arcLength = 100
          const curveI = instanceIndex.div(arcLength).toFloat()
          const t = instanceIndex
            .toFloat()
            .mod(arcLength)
            .div(arcLength)
            .toVar()
          // let position = vec4(0, 0, 0, 1).toVar()
          // position.xy.assign(rationalBezierCurve({ t }))
          // return position
          return vec4(instanceIndex.toFloat().div(1236), 0, 0, 1)
        })

        material.colorNode = vec4(
          instanceIndex.toFloat().div(group.totalCurveLength),
          1,
          1,
          1
        )
        material.positionNode = vec4(instanceIndex.toFloat().div(100), 0, 0, 1)
        return material
      }),
    []
  )
  console.log(lastData)

  // const resolution = uniform(vec2(0, 0))
  // const scaleCorrection = uniform(vec2(0, 0))
  // const progress = uniform(float(0))
  // const aspectRatio = vec2(1, resolution.y.div(resolution.x))
  // const pixel = vec2(1).div(resolution)
  // const rotate2d = Fn(({ v, angle }) => {
  //   const c = cos(angle)
  //   const s = sin(angle)
  //   return vec2(v.x.mul(c).sub(v.y.mul(s)), v.x.mul(s).add(v.y.mul(c)))
  // })
  // ROTATION
  // .add(
  //   rotate2d({
  //     v: position.xy.mul(pixel).mul(vec2(thickness)),
  //     angle: point.rotation.add(float(1.5707))
  //   })
  // )
  // .div(aspectRatio)
  // .div(scaleCorrection)
  console.log(lastData)

  return (
    <group
      ref={meshRef}
      position={[...transform.translate.toArray(), 0]}
      scale={[...transform.scale.toArray(), 1]}
      rotation={[0, 0, transform.rotate]}>
      {groups.map((group, i) => (
        <instancedMesh
          key={i + now()}
          position={[...group.transform.translate.toArray(), 0]}
          scale={[...group.transform.scale.toArray(), 1]}
          rotation={[0, 0, group.transform.rotate]}
          args={[undefined, undefined, group.totalCurveLength]}
          material={materials[i]}>
          <planeGeometry args={lastData.settings.defaults.size} />
        </instancedMesh>
      ))}
    </group>
  )
}
