import { now } from 'three/examples/jsm/libs/tween.module.js'
import Asemic from '../../src/Asemic'
import Brush from '../../src/Brush'

export default function SimpleTest() {
  return (
    <Asemic>
      <Brush
        key={now()}
        render={b => b.newGroup().newCurve([-1, 0], [0.5, 0], [0.5, -0.5])}
      />
    </Asemic>
  )
}
