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
import { inputSchema, InputSchema } from './constants'
import { Socket } from 'socket.io-client'

export const SocketContext = createContext<{
  socket: Socket<SendMap, ReceiveMap> | null
  params: InputSchema['params']
  setParams: (params: InputSchema['params'], silent?: boolean) => void
}>({} as any)

export const useSocket = () => {
  return useContext(SocketContext)
}
