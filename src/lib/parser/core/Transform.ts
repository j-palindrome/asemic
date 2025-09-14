import { BasicPt } from '../../blocks/AsemicPt'
import { Transform } from '../../types'

export const defaultTransform: () => Transform = () => ({
  translation: new BasicPt(0, 0),
  scale: new BasicPt(1, 1),
  rotation: 0,
  width: 1,
  h: 0,
  s: 0,
  l: 1,
  a: 1,
  mode: 'line' as 'line' | 'fill'
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
