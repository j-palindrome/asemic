import { Font, Form, GroupLike, PtLike, Space, VisualForm } from 'pts'
import { PtBuilder } from './PtBuilder'

export default class AsemicSpace extends Space {
  resize() {
    return this
  }

  clear() {
    return this
  }

  getForm() {
    return new AsemicForm()
  }

  constructor() {
    super()
  }
}

export class AsemicForm extends VisualForm {
  reset() {
    return this
  }

  point(p: PtLike, radius?: number, shape?: string) {
    return this
  }

  circle(pts: GroupLike | number[][]) {
    return this
  }

  arc(
    pt: PtLike,
    radius: number,
    startAngle: number,
    endAngle: number,
    cc?: boolean
  ) {
    return this
  }

  line(pts: GroupLike | number[][]) {
    return this
  }

  polygon(pts: GroupLike | number[][]) {
    return this
  }

  rect(pts: number[][] | PtBuilder[]) {
    return this
  }

  text(pt: PtLike, txt: string, maxWidth?: number) {
    return this
  }

  font(
    sizeOrFont: number | Font,
    weight?: string,
    style?: string,
    lineHeight?: number,
    family?: string
  ) {
    return this
  }

  constructor() {
    super()
  }
}
