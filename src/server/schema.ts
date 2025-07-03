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

export const SocketContext = createContext<Socket | null>(null)

export const useSocket = () => {
  return useContext(SocketContext)
}

export const useSchema = () => {
  const [schema, setSchema] = useState<InputSchema | null>(null)
  const socket = useSocket()

  const setParams = useCallback(
    (params: Record<string, number>, broadcast = true) => {
      if (!schema) return
      const newParams = { ...schema.params }

      Object.entries(params).forEach(([param, value]) => {
        if (newParams[param]) {
          newParams[param] = {
            ...schema.params[param],
            value: Math.max(
              schema.params[param].min,
              Math.min(schema.params[param].max, value)
            )
          }
        }
      })

      const newSchema: InputSchema = { params: newParams }
      setSchema(newSchema)

      if (broadcast && socket) {
        socket.emit('params:update', params)
      }
    },
    [schema, socket]
  )

  useEffect(() => {
    if (!socket) return

    const handleParamsUpdate = (params: Record<string, number>) => {
      setParams(params, false)
    }

    socket.on('params:update', handleParamsUpdate)

    return () => {
      socket.off('params:update', handleParamsUpdate)
    }
  }, [socket, setParams])

  return [schema, setParams] as const
}
