import { InputSchema } from './inputSchema'
declare global {
  type ReceiveMap = {
    schema: (obj: InputSchema) => void
    'osc:message': (data: { address: string; data: any[] }) => void
    'schema:reset': () => void
  }
  type SendMap = {
    schema: (obj: InputSchema) => void
    'osc:message': (data: { address: string; data: any[] }) => void
  }
}
