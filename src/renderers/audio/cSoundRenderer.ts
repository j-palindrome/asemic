import { Csound } from '@csound/browser'
import AsemicAudio from '../AsemicAudio'
import { AsemicPt } from '../../blocks/AsemicPt'

export default class CSoundRenderer<
  T extends Record<string, any>
> extends AsemicAudio {
  csound: Awaited<ReturnType<typeof Csound>> | null = null
  variables: T
  rendered = false
  orchestra: string

  async render(curves: AsemicPt[][]) {
    this.rendered = true
  }

  async setup() {
    this.ctx = new AudioContext()
    this.rendered = false

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

    // Initialize Csound
    this.csound = (await Csound({
      audioContext: this.ctx,
      inputChannelCount: 1,
      outputChannelCount: 2
    }))!

    // Set up microphone input
    // const mic = await navigator.mediaDevices.getUserMedia({
    //   audio: {
    //     deviceId: 'default',
    //     echoCancellation: false,
    //     noiseSuppression: false,
    //     autoGainControl: false,
    //     backgroundBlur: false,
    //     sampleRate: 44100,
    //     sampleSize: 16,
    //     channelCount: 1
    //   }
    // })

    await this.csound.compileCsdText(this.orchestra)
    await this.csound!.start()

    this.isSetup = true
  }

  async stop() {
    if (this.csound) {
      await this.csound.stop()
    }
    super.stop()
  }

  constructor(orchestra: string) {
    super()
    this.orchestra = orchestra
    // Variables will be initialized after csound is created
    this.variables = {} as T
  }

  async start() {
    await super.start()
  }
}
