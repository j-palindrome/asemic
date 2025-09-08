import _, { pick } from 'lodash'
import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useRef,
  useState
} from 'react'
import { z } from 'zod'
import { inputSchema, InputSchema } from './inputSchema'
import { Socket } from 'socket.io-client'
import { ReceiveMap, SendMap } from '@/lib/types'

export const SocketContext = createContext<{
  socket: Socket<SendMap, ReceiveMap>
  schema: InputSchema
  setSchema: (schema: Partial<InputSchema>, silent?: boolean) => void
}>({} as any)

export const useSocket = () => {
  const socketParams = useContext(SocketContext)
  return (
    socketParams ?? { socket: null, schema: undefined, setSchema: () => {} }
  )
}
