import { isEqual, now } from 'lodash'
import { useCallback, useEffect, useRef, useState } from 'react'
import * as THREE from 'three'
import { Vector2 } from 'three'
import { bezierPoint, multiBezierProgress } from '../../util/src/shaders/bezier'
import { rotate2d } from '../../util/src/shaders/manipulation'
import { useEventListener } from '../utilities/react'
import Builder from './drawingSystem/Builder'
import { useFrame } from '@react-three/fiber'
import { useInterval } from '@/util/src/dom'
import { Group } from 'pts'

type VectorList = [number, number]
type Vector3List = [number, number, number]
export type Jitter = {
  size?: VectorList
  position?: VectorList
  hsl?: Vector3List
  a?: number
  rotation?: number
}

const packToTexture = (keyframes: Group[], resolution: Vector2) => {
  this.keyframe.groups = this.keyframe.groups
    .map(x => ({
      ...x,
      curves: x.curves
        .filter(x => x.length)
        .map(x => {
          if (x.length == 2) this.interpolateCurve(x, 3)
          return x
        })
    }))
    .filter(x => x.curves.length)
  const hypotenuse = resolution.length()

  this.reset(true)

  const width = max(
    this.keyframe.groups.flatMap(x => x.curves.flatMap(x => x.length))
  )!
  const height = sum(this.keyframe.groups.map(x => x.curves.length))
  const dimensions = new Vector2(width, height)
  let curveIndex = 0

  const groups = this.keyframe.groups.map((group, groupIndex) => {
    const curveEnds = new Float32Array(group.curves.length)
    const curveIndexes = new Float32Array(group.curves.length)
    const controlPointCounts = new Float32Array(group.curves.length)
    let totalCurveLength = 0
    group.curves.forEach((curve, i) => {
      // shortcut for Bezier lengths
      let curveLength = 0
      for (let i = 1; i < curve.length; i++) {
        curveLength += curve[i - 1].distanceTo(curve[i])
      }

      curveLength *=
        (hypotenuse / 1.414) * (group.transform.scale.length() / 1.414)
      totalCurveLength += curveLength
      curveEnds[i] = totalCurveLength
      curveIndexes[i] = curveIndex
      controlPointCounts[i] = curve.length
      curveIndex++
    })
    return {
      transform: this.keyframe.groups[groupIndex].transform,
      curveEnds,
      curveIndexes,
      controlPointCounts,
      totalCurveLength
    }
  })

  const createTexture = (array: Float32Array, format: AnyPixelFormat) => {
    const tex = new DataTexture(array, width, height)
    tex.format = format
    tex.type = FloatType
    tex.minFilter = tex.magFilter = NearestFilter
    tex.wrapS = tex.wrapT = ClampToEdgeWrapping
    tex.needsUpdate = true
    return tex
  }

  const keyframesTex = createTexture(
    new Float32Array(
      this.keyframe.groups.flatMap(x =>
        x.curves.flatMap(c =>
          range(width).flatMap(i => {
            return c[i]
              ? [c[i].x, c[i].y, c[i].strength ?? this.settings.strength, 1]
              : [0, 0, 0, 0]
          })
        )
      )
    ),
    RGBAFormat
  )

  const colorTex = createTexture(
    new Float32Array(
      this.keyframe.groups.flatMap(group =>
        group.curves.flatMap(c =>
          range(width).flatMap(i => {
            const point = c[i]

            return point
              ? [
                  ...this.colorToArray(point.color ?? this.settings.color),
                  point.alpha ?? this.settings.alpha
                ]
              : [0, 0, 0, 0]
          })
        )
      )
    ),
    RGBAFormat
  )

  const thicknessTex = createTexture(
    new Float32Array(
      this.keyframe.groups.flatMap(group =>
        group.curves.flatMap(c =>
          range(width).flatMap(i => {
            const point = c[i]
            return point ? [point.thickness ?? this.settings.thickness] : [0]
          })
        )
      )
    ),
    RedFormat
  )

  const curveCounts = groups.map(x => x.curveIndexes.length)

  return {
    keyframesTex,
    colorTex,
    thicknessTex,
    transform: this.keyframe.transform,
    groups,
    dimensions,
    curveCounts,
    settings: this.settings
  }
}

export default function Brush({ keyframe }: { keyframe: Group[] }) {
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

  const [lastData, setLastData] = useState(packToTexture())
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

  useEffect(() => {
    updateChildren(lastData)
  }, [lastData])

  useEffect(() => {
    let timeout
    const reinit = () => {
      reInitialize()
      timeout = window.setTimeout(reinit, Math.random() ** 2 * 300)
    }
    reinit()
    return () => window.clearTimeout(timeout)
  }, [])

  return (
    <group
      ref={meshRef}
      scale={[...transform.scale.toArray(), 1]}
      rotation={[0, 0, transform.rotate]}
      position={[...transform.translate.toArray(), 0]}>
      {groups.map((group, i) => (
        <instancedMesh
          position={[...group.transform.translate.toArray(), 0]}
          scale={[...group.transform.scale.toArray(), 1]}
          rotation={[0, 0, group.transform.rotate]}
          key={i + now()}
          args={[undefined, undefined, maxCurveLength]}>
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
