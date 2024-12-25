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
  pow,
  range,
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
  console.log(keyframes)

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

  const updateChildren = (newData: typeof lastData) => {
    if (!meshRef.current) return
    meshRef.current.rotation.set(0, 0, newData.transform.rotate)
    meshRef.current.scale.set(...newData.transform.scale.toArray(), 1)
    meshRef.current.position.set(...newData.transform.translate.toArray(), 0)

    meshRef.current.children.forEach((c, i) => {
      const child = c as THREE.InstancedMesh<
        THREE.PlaneGeometry,
        THREE.ShaderMaterial
      >
      if (!newData.groups[i]) return
      child.material.uniforms.keyframesTex.value = newData.keyframesTex
      child.material.uniforms.colorTex.value = newData.colorTex
      child.material.uniforms.thicknessTex.value = newData.thicknessTex
      child.material.uniforms.curveEnds.value = newData.groups[i].curveEnds
      child.material.uniforms.curveIndexes.value =
        newData.groups[i].curveIndexes
      child.material.uniforms.controlPointCounts.value =
        newData.groups[i].controlPointCounts

      child.material.uniforms.resolution.value = resolution
      child.material.uniforms.dimensions.value = newData.dimensions
      child.count = newData.groups[i].totalCurveLength
      child.material.uniformsNeedUpdate = true

      const { translate, scale, rotate } = newData.groups[i].transform
      child.material.uniforms.scaleCorrection.value = scale
      child.position.set(translate.x, translate.y, 0)
      child.scale.set(scale.x, scale.y, 1)
      child.rotation.set(0, 0, rotate)
    })
  }

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
      updateChildren(newData)
    }
  }, [lastData])

  useEffect(() => {
    updateChildren(lastData)
  }, [lastData])

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
  const materials = useMemo(() => {
    groups.map(group => {
      const material = new SpriteNodeMaterial({
        transparent: true,
        depthWrite: false,
        blending: THREE.AdditiveBlending
      })

      material.scaleNode = uniform(
        (1 / window.innerWidth / devicePixelRatio) * size
      )

      const curveEnds = uniformArray(group.curveEnds, 'int')
      const controlPointCounts = uniformArray(group.controlPointCounts, 'int')
      const curveIndexes = uniformArray(group.curveIndexes, 'int')
      const dimensions = uniform(vec2(0, 0))

      // Define the Bezier functions
      const bezier2 = ({ t, p0, p1, p2 }) => {
        const u = float(1).sub(t)
        const tt = t.mul(t)
        const uu = u.mul(u)
        return p0
          .mul(uu)
          .add(p1.mul(u.mul(t).mul(float(2))))
          .add(p2.mul(tt))
      }

      const bezier2Tangent = ({ t, p0, p1, p2 }) => {
        const u = float(1).sub(t)
        return p1
          .sub(p0)
          .mul(float(2).mul(u))
          .add(p2.sub(p1).mul(float(2).mul(t)))
      }

      const polyLine = ({ t, p0, p1, p2 }) => {
        const u = float(1).sub(t)
        return p0.mul(u).add(p2.mul(t))
      }

      // Function to calculate a point on a Bezier curve
      const bezierPoint = ({ t, p0, p1, p2, strength, aspectRatio }) => {
        const positionCurve = bezier2({ t, p0, p1, p2 })
        const positionStraight = polyLine({ t, p0, p1, p2 })
        const position = mix(
          positionCurve,
          positionStraight,
          pow(strength, float(2))
        )
        const tangent = bezier2Tangent({ t, p0, p1, p2 }).mul(aspectRatio)
        const rotation = atan2(tangent.y, tangent.x)
        return { position, rotation }
      }

      const multiBezierProgress = ({
        t,
        controlPointsCount
      }: {
        t: ReturnType<typeof float>
        controlPointsCount: ReturnType<typeof int>
      }) => {
        const segment = float(1).div(float(controlPointsCount).sub(float(1)))
        const index = t.div(segment).floor()
        const localT = t.sub(index.mul(segment)).div(segment)
        return { x: index, y: localT }
      }

      // const modifyPosition = Fn(
      //   ({ position, progress, pointProgress, curveProgress }) => {
      //     // Add your custom modifications here
      //     return position
      //   }
      // )

      const main = Fn(() => {
        const id = instanceIndex
        let curveIndex = int(0)
        Loop(curveEnds.length, ({ i }) => {
          If(id.greaterThan(curveEnds.element(curveIndex)), () => {
            If(curveIndex.greaterThanEqual(curveEnds.length()), () => {
              Break()
            })
            curveIndex.addAssign(int(1))
          })
        })

        const curveProgress = float(curveIndexes.element(curveIndex)).div(
          dimensions.y
        )
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

        let point = { position: vec2(0, 0), rotation: float(0) }
        let thickness = float(0)
        let color = vec4(0, 0, 0, 0)
        If(controlPointsCount.equal(int(2)), () => {
          const p0 = texture(keyframesTex, vec2(0, curveProgress)).xy
          const p1 = texture(
            keyframesTex,
            vec2(float(1).div(dimensions.x), curveProgress)
          ).xy
          const progressPoint = mix(p0, p1, pointProgress)
          point = {
            position: progressPoint,
            rotation: atan2(progressPoint.y, progressPoint.x)
          }
          const t0 = texture(thicknessTex, vec2(0, curveProgress)).x
          const t1 = texture(
            thicknessTex,
            vec2(float(1).div(dimensions.x), curveProgress)
          ).x
          thickness = mix(t0, t1, pointProgress)
          const c0 = texture(colorTex, vec2(0, curveProgress))
          const c1 = texture(
            colorTex,
            vec2(float(1).div(dimensions.x), curveProgress)
          )
          color = mix(c0, c1, pointProgress)
        }).Else(() => {
          const pointCurveProgress = multiBezierProgress({
            t: pointProgress,
            controlPointsCount
          })
          const points = [vec2(0, 0), vec2(0, 0), vec2(0, 0)]
          // const colors = [vec4(0, 0, 0, 0), vec4(0, 0, 0, 0), vec4(0, 0, 0, 0)]
          let strength = float(0)

          Loop(3, ({ pointI }) => {
            const textureVec = vec2(
              pointCurveProgress.x.add(float(pointI)).div(dimensions.x),
              curveProgress
            )
            const samp = texture(keyframesTex, textureVec)
            If(pointI.equal(int(1)), () => {
              strength = samp.z
              thickness = texture(thicknessTex, textureVec).x
            })
            points[pointI] = samp.xy
            // colors[pointI] = texture(colorTex, textureVec)
          })

          If(pointCurveProgress.x.greaterThan(float(0)), () => {
            points[0] = mix(points[0], points[1], float(0.5))
          })
          If(
            pointCurveProgress.x.lessThan(
              float(controlPointsCount).sub(float(3))
            ),
            () => {
              points[2] = mix(points[1], points[2], float(0.5))
            }
          )
          point = bezierPoint({
            t: pointCurveProgress.y,
            p0: points[0],
            p1: points[1],
            p2: points[2],
            strength,
            scale: vec2(1, 1)
          })
          // color = mix(colors[0], colors[1], colors[2])
        })

        return cameraProjectionMatrix.mul(modelViewMatrix).mul(
          vec4(
            point.position,
            // modifyPosition({
            //   position: point.position,
            //   progress,
            //   pointProgress,
            //   curveProgress
            // })
            0,
            1
          )
        )
      })

      material.positionNode = main()
    })
  }, [])

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
          <shaderMaterial
            transparent
            uniforms={{
              colorTex: { value: colorTex },
              thicknessTex: { value: thicknessTex },
              keyframesTex: { value: keyframesTex },
              resolution: { value: resolution },
              progress: { value: 0 },
              dimensions: { value: dimensions },
              curveEnds: { value: group.curveEnds },
              curveIndexes: { value: group.curveIndexes },
              controlPointCounts: { value: group.controlPointCounts },
              scaleCorrection: { value: group.transform.scale }
            }}
            vertexShader={
              /*glsl*/ `
uniform int curveEnds[${group.curveEnds.length}];
uniform int controlPointCounts[${group.controlPointCounts.length}];
uniform int curveIndexes[${group.curveIndexes.length}];
uniform sampler2D keyframesTex;
uniform sampler2D colorTex;
uniform sampler2D thicknessTex;
uniform vec2 dimensions;
uniform vec2 resolution;
uniform vec2 scaleCorrection;
uniform float progress;

out vec2 vUv;
out vec4 vColor;
out float v_test;

${bezierPoint}
${multiBezierProgress}
${rotate2d}
${modifyIncludes}
vec2 modifyPosition(
  vec2 position, 
  float progress, 
  float pointProgress, 
  float curveProgress) {
  ${modifyPosition}
}

void main() {
  vec2 aspectRatio = vec2(1, resolution.y / resolution.x);
  vec2 pixel = vec2(1. / resolution.x, 1. / resolution.y);

  int id = gl_InstanceID;
  int curveIndex = 0;
  while (id > curveEnds[curveIndex]) {
    if (curveIndex >= curveEnds.length()) {
      break;
    }
    curveIndex ++;
  }

  float curveProgress = float(curveIndexes[curveIndex]) / dimensions.y;
  int controlPointsCount = controlPointCounts[curveIndex];

  float pointProgress;
  if (curveIndex > 0) {
    pointProgress = float(id - curveEnds[curveIndex - 1]) 
      / float(curveEnds[curveIndex] - curveEnds[curveIndex - 1]);
  } else {
    pointProgress = float(id) / float(curveEnds[curveIndex]);
  }

  BezierPoint point;
  float thickness;
  vec4 color;
  if (controlPointsCount == 2) {
    vec2 p0 = texture(keyframesTex, vec2(0, curveProgress)).xy;
    vec2 p1 = texture(keyframesTex, vec2(
      1. / dimensions.x, curveProgress)).xy;
    vec2 progressPoint = mix(p0, p1, pointProgress);
    point = BezierPoint(progressPoint,
      atan(progressPoint.y, progressPoint.x));
    float t0 = texture(thicknessTex, vec2(0, curveProgress)).x;
    float t1 = texture(thicknessTex, vec2(
      1. / dimensions.x, curveProgress)).x;
    thickness = mix(t0, t1, pointProgress);
    vec4 c0 = texture(colorTex, vec2(0, curveProgress));
    vec4 c1 = texture(colorTex, vec2(
      1. / dimensions.x, curveProgress));
    color = mix(c0, c1, pointProgress);
  } else {
    vec2 pointCurveProgress = 
      multiBezierProgress(pointProgress, controlPointsCount);
    vec2 points[3];
    vec4 colors[3];
    float thicknesses[3];

    float strength;
    
    for (int pointI = 0; pointI < 3; pointI ++) {
      vec2 textureVec = vec2(
        (pointCurveProgress.x + float(pointI)) 
          / dimensions.x,
        curveProgress);
      vec4 samp = texture(keyframesTex, textureVec);
      if (pointI == 1) {
        strength = samp.z;
        thickness = texture(thicknessTex, textureVec).x;
      }
      points[pointI] = samp.xy;
      colors[pointI] = texture(colorTex, textureVec);
    }

    // adjust to interpolate between things
    if (pointCurveProgress.x > 0.) {
      points[0] = mix(points[0], points[1], 0.5);
    }
    if (pointCurveProgress.x < float(controlPointsCount) - 3.) {
      points[2] = mix(points[1], points[2], 0.5);
    }
    point = bezierPoint(pointCurveProgress.y, 
      points[0], points[1], points[2], strength, vec2(1, 1));
    color = polyLine(pointCurveProgress.y, 
      colors[0], colors[1], colors[2]);
  }

  vColor = color;

  gl_Position = 
    projectionMatrix 
    * modelViewMatrix 
    * vec4(modifyPosition(
        point.position,
        progress,
        pointProgress,
        curveProgress)
      + rotate2d(
        position.xy * pixel
        * vec2(thickness), 
        point.rotation + 1.5707) 
        / aspectRatio 
        / scaleCorrection,
      0, 1);
}
`
            }
            fragmentShader={
              /*glsl*/ `
uniform vec2 resolution;
in vec2 vUv;
in vec4 vColor;
in float v_test;
// flat in int vDiscard;

vec4 processColor (vec4 color, vec2 uv) {
  ${modifyColor}
}
void main() {
  // if (vDiscard == 1) discard;
  gl_FragColor = processColor(vColor, vUv);
  // gl_FragColor = processColor(vec4(v_test, 1,1,1), vUv);
}`
            }
          />
        </instancedMesh>
      ))}
    </group>
  )
}
