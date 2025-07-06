import { InputSchema } from './inputSchema'
declare global {
  type ReceiveMap = {
    params: (obj: InputSchema) => void
    'osc:message': (data: { address: string; data: any[] }) => void
    'params:reset': () => void
    'presets:reset': () => void
  }
  type SendMap = {
    params: (obj: InputSchema) => void
  }
}
