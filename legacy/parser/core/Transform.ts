import { BasicPt } from '../../blocks/AsemicPt'
import { Transform } from '../../../src/lib/types'

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
