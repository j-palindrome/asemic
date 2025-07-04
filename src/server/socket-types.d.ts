import { InputSchema } from './constants'
declare global {
  type ReceiveMap = {
    params: (obj: InputSchema) => void
    'osc:message': (data: { address: string; data: any[] }) => void
  }
  type SendMap = {
    params: (obj: InputSchema) => void
  }
}
