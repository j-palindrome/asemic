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
              .setting({
                thickness: 1,
                color: [1, 1, 1],
                alpha: 0.05
              })
              .newGroup()
              .newCurve(
                [0.2, 0.2, { color: [0, 1, 0] }],
                [0.8, 0.8, { color: [1, 0, 1], thickness: 50 }]
              )
              .newCurve(
                [1, 0, { thickness: 10 }],
                [0.5, 0.5, { thickness: 1 }],
                [0, 1, { thickness: 30 }]
              )
        }
      />
    </Asemic>
  )
}
