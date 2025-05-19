import { sum } from 'lodash'
import { AsemicGroup, AsemicPt } from 'src/AsemicPt'
import {
  BufferAttribute,
  BufferGeometry,
  DoubleSide,
  Float32BufferAttribute,
  InstancedBufferAttribute,
  Mesh,
  NormalBlending,
  Scene,
  Vector2
} from 'three'
import {
  array,
  atan,
  float,
  Fn,
  If,
  instancedArray,
  int,
  mix,
  select,
  ShaderNodeObject,
  uniformArray,
  vec2,
  vec4,
  floor,
  vertexIndex,
  rotateUV,
  PI2,
  wgslFn
} from 'three/tsl'
import { MeshBasicNodeMaterial, StorageBufferNode, VarNode } from 'three/webgpu'
import { bezierPosition, bezierRotation } from '../util/bezier'

const INSTANCES_PER_CURVE = 100
export default class NewLineBrush {
  constructor(curves: AsemicGroup[], scene: Scene) {}
}
