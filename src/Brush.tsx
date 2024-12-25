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
        const controlPointCounts = uniformArray(
          group.controlPointCounts as any,
          'int'
        )
        const curveIndexes = uniformArray(group.curveIndexes as any, 'int')
        const dimensionsU = uniform(dimensions, 'vec2')

        // Define the Bezier functions
        const bezier2 = ({ t, p0, p1, p2 }) => {
          return p0
            .mul(t.oneMinus().pow(2))
            .add(p1.mul(t.oneMinus().mul(t).mul(2)))
            .add(p2.mul(t.pow(2)))
        }

        const bezier2Tangent = ({ t, p0, p1, p2 }) => {
          return p1
            .sub(p0)
            .mul(float(2).mul(t.oneMinus()))
            .add(p2.sub(p1).mul(float(2).mul(t)))
        }

        const polyLine = ({ t, p0, p1, p2 }) => {
          return p0.mul(t.oneMinus()).add(p2.mul(t))
        }

        // Function to calculate a point on a Bezier curve
        const bezierPoint = ({ t, p0, p1, p2, strength, aspectRatio }) => {
          const positionCurve = bezier2({ t, p0, p1, p2 })
          const positionStraight = polyLine({ t, p0, p1, p2 })
          const position = mix(
            positionCurve,
            positionStraight,
            pow(strength, 2)
          )
          const tangent = bezier2Tangent({ t, p0, p1, p2 }).mul(aspectRatio)
          const rotation = atan2(tangent.y, tangent.x)
          return { position, rotation }
        }

        const multiBezierProgress = ({ t, controlPointsCount }) => {
          const subdivisions = float(controlPointsCount).sub(2)
          const start = t.mul(subdivisions).toInt()
          const cycle = t.mul(subdivisions).fract()
          return vec2(start, cycle)
        }

        const main = Fn(() => {
          const id = instanceIndex
          let curveIndex = int(0).toVar()
          Loop(curveEnds.getElementLength(), ({ i }) => {
            If(id.greaterThan(curveEnds.element(curveIndex)), () => {
              If(
                curveIndex.greaterThanEqual(curveEnds.getElementLength()),
                () => {
                  Break()
                }
              )
              curveIndex.addAssign(int(1))
            })
          })

          const curveProgress = float(curveIndexes.element(curveIndex))
            .add(0.5)
            .div(dimensionsU.y)
          const controlPointsCount = controlPointCounts.element(curveIndex)

          let pointProgress = float(0).toVar()
          If(curveIndex.greaterThan(int(0)), () => {
            pointProgress.assign(
              float(id.sub(curveEnds.element(curveIndex.sub(int(1))))).div(
                float(
                  curveEnds
                    .element(curveIndex)
                    .sub(curveEnds.element(curveIndex.sub(int(1))))
                )
              )
            )
          }).Else(() => {
            pointProgress.assign(
              float(id).div(float(curveEnds.element(curveIndex)))
            )
          })

          let point = {
            position: vec2(0, 0).toVar(),
            rotation: float(0).toVar()
          }

          If(controlPointsCount.equal(int(2)), () => {
            const p0 = texture(
              keyframesTex,
              vec2(float(0.5).div(dimensionsU.x), curveProgress)
            ).xy
            const p1 = texture(
              keyframesTex,
              vec2(float(1).add(0.5).div(dimensionsU.x), curveProgress)
            ).xy
            const progressPoint = mix(p0, p1, pointProgress)
            point.position.assign(progressPoint)
            point.rotation.assign(atan2(progressPoint.y, progressPoint.x))
          }).Else(() => {
            const pointCurveProgress = multiBezierProgress({
              t: pointProgress,
              controlPointsCount
            })
            const getTex = Fn(({ i }: { i: number }) => {
              const textureVec = vec2(
                pointCurveProgress.x.add(i).add(0.5).div(dimensionsU.x),
                curveProgress
              )
              const samp = texture(keyframesTex, textureVec)
              return samp
            })
            const p0 = getTex({ i: 0 }).toVar()
            const p1 = getTex({ i: 1 }).toVar()
            const p2 = getTex({ i: 2 }).toVar()
            let strength = float(0)

            If(pointCurveProgress.x.greaterThan(float(0)), () => {
              p0.assign(mix(p0, p1, float(0.5)))
            })
            If(
              pointCurveProgress.x.lessThan(float(controlPointsCount).sub(3)),
              () => {
                p2.assign(mix(p1, p2, 0.5))
              }
            )
            const thisPoint = bezierPoint({
              t: pointCurveProgress.y,
              p0,
              p1,
              p2,
              strength,
              aspectRatio
            })
            point.position.assign(thisPoint.position)
            point.rotation.assign(thisPoint.rotation)
          })
          return vec4(point.position, 0, 1)
        })

        material.colorNode = vec4(
          instanceIndex.toFloat().div(group.totalCurveLength),
          1,
          1,
          1
        )
        material.positionNode = main()
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

  return (
    <group
      ref={meshRef}
      position={[...transform.translate.toArray(), 0]}
      scale={[...transform.scale.toArray(), 1]}
      rotation={[0, 0, transform.rotate]}>
      {groups.map((group, i) => (
        <instancedMesh
          position={[...group.transform.translate.toArray(), 0]}
          scale={[...group.transform.scale.toArray(), 1]}
          rotation={[0, 0, group.transform.rotate]}
          key={i + now()}
          args={[undefined, undefined, maxCurveLength]}
          material={materials[i]}>
          <planeGeometry args={lastData.settings.defaults.size} />
        </instancedMesh>
      ))}
    </group>
  )
}
