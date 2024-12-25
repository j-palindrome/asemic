import { now } from 'three/examples/jsm/libs/tween.module.js'
import Asemic from '../../src/Asemic'
import Brush from '../../src/Brush'

export default function SimpleTest() {
  return (
    <Asemic>
      <Brush
        key={now()}
        render={
          // b => b.text('e')
          b =>
            b
              .newGroup()
              .newCurve([0.2, 0.2], [0.8, 0.8])
              .newCurve([1, 0], [0, 1])
        }
      />
    </Asemic>
  )
}
