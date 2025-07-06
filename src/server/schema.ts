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

export const SocketContext = createContext<{
  socket: Socket<SendMap, ReceiveMap>
  params: InputSchema['params']
  setParams: (params: InputSchema['params'], silent?: boolean) => void
  presets: InputSchema['presets']
  setPresets: (presets: InputSchema['presets'], silent?: boolean) => void
}>({} as any)

export const useSocket = () => {
  return useContext(SocketContext)
}
