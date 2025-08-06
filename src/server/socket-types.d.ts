import { InputSchema } from './inputSchema'
declare global {
  type ReceiveMap = {
    params: (obj: InputSchema) => void
    'osc:message': (data: { address: string; data: any[] }) => void
    'params:reset': () => void
    'presets:reset': () => void
    'sc:synth': (name: string, synth: string) => void
    'sc:set': (name: string, param: string, value: number) => void
    'sc:off': () => void
    'sc:on': () => void
  }
  type SendMap = {
    params: (obj: InputSchema) => void
  }
}
