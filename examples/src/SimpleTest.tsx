import { now } from 'three/examples/jsm/libs/tween.module.js'
import Asemic from '../../src/Asemic'
import Brush from '../../src/Brush'
import { thickness } from 'three/tsl'

export default function SimpleTest() {
  return (
    <Asemic>
      <Brush
        key={now()}
        render={
          //           b =>
          //             b.text(
          //               `based on "relevance, which
          //           represents some combination of the web page's
          // presence in links
          //           from other sites
          //   and its popularity with
          // users searching similar terms.`,
          //               { translate: [0, 0.5] }
          //             )
          b =>
            b
              .setting({ thickness: 10, spacing: 20 })
              .newGroup()
              .newCurve([0.2, 0.2], [0.8, 0.8])
              .newCurve([1, 0], [0, 1])
        }
      />
    </Asemic>
  )
}
