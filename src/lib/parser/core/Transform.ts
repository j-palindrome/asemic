import { BasicPt } from '../../blocks/AsemicPt'
import { Transform } from '../../types'

export const defaultTransform: () => Transform = () => ({
  '+': new BasicPt(0, 0),
  '*': new BasicPt(1, 1),
  '@': 0,
  w: 1,
  h: 0,
  s: 0,
  l: 1,
  a: 1
})

export function cloneTransform(transform: Transform): Transform {
  const newTransform = {} as Transform
  for (let key of Object.keys(transform)) {
    if (transform[key] instanceof BasicPt) {
      newTransform[key] = transform[key].clone()
    } else {
      newTransform[key] = transform[key]
    }
  }
  return newTransform
}
