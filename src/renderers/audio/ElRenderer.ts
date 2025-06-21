import WebRenderer from '@elemaudio/web-renderer'
import AsemicAudio from '../AsemicAudio'
import { AsemicPt } from 'src/blocks/AsemicPt'
import { el } from '@elemaudio/core'
import type { NodeRepr_t } from '@elemaudio/core'

export default class ElRenderer<
  T extends Record<string, any>
> extends AsemicAudio {
  core = new WebRenderer()
  variables: T
  setupFunction: (elementary: typeof el, core: this['core']) => T
  renderFunction: (
    curves: AsemicPt[][],
    elementary: typeof el,
    variables: T
  ) => [NodeRepr_t, NodeRepr_t]

  async render(curves: AsemicPt[][]) {
    if (!this.isSetup || !this.playing) return
    const channels = this.renderFunction(curves, el, this.variables)
    this.core.render(...channels)
  }

  async setup() {
    this.ctx = new AudioContext()

    // Try to set output to external headphones or audio out
    if (
      'setSinkId' in this.ctx.destination &&
      navigator.mediaDevices.enumerateDevices
    ) {
      try {
        const devices = await navigator.mediaDevices.enumerateDevices()
        const audioOutputs = devices.filter(
          device => device.kind === 'audiooutput'
        )

        // Look for external headphones or audio out (not default speaker)
        const externalDevice = audioOutputs.find(
          device =>
            device.label.toLowerCase().includes('headphone') ||
            device.label.toLowerCase().includes('external') ||
            device.label.toLowerCase().includes('usb') ||
            device.label.toLowerCase().includes('bluetooth')
        )

        if (externalDevice && externalDevice.deviceId !== 'default') {
          await (this.ctx.destination as any).setSinkId(externalDevice.deviceId)
        }
      } catch (error) {
        console.warn('Could not set audio output device:', error)
      }
    }

    let node = await this.core.initialize(this.ctx, {
      numberOfInputs: 1,
      numberOfOutputs: 1,
      outputChannelCount: [2]
    })

    const mic = await navigator.mediaDevices.getUserMedia({ audio: true })
    const source = this.ctx.createMediaStreamSource(mic)
    const gainNode = this.ctx.createGain()
    gainNode.gain.value = 1
    const gainNode2 = this.ctx.createGain()
    gainNode2.gain.value = 1
    source
      .connect(gainNode)
      .connect(node)
      .connect(gainNode2)
      .connect(this.ctx.destination)
    const oscillator = this.ctx.createOscillator()
    oscillator.type = 'sine'
    oscillator.frequency.setValueAtTime(440, this.ctx.currentTime)
    oscillator.connect(gainNode2)
    oscillator.start()
  }

  constructor(
    setupFunction: ElRenderer<T>['setupFunction'],
    renderFunction: ElRenderer<T>['renderFunction']
  ) {
    super()
    this.renderFunction = renderFunction.bind(this)
    this.setupFunction = setupFunction.bind(this)
    const variables: T = this.setupFunction(el, this.core)
    this.variables = variables
  }
}
