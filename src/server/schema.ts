import _, { pick } from 'lodash'
import { useCallback, useEffect, useRef, useState } from 'react'
import { z } from 'zod'
import { inputSchema, InputSchema } from './constants'

export const useSchema = () => {
  // WebSocket connection setup
  const websocket = useRef<WebSocket | null>(null)
  const [wsConnected, setWsConnected] = useState(false)
  const [schema, setSchema] = useState<InputSchema | null>(null)
  useEffect(() => {}, [schema])

  useEffect(() => {
    const connectWebSocket = () => {
      try {
        const serverUrl = `ws://${window.location.hostname}:7000`
        websocket.current = new WebSocket(serverUrl)

        websocket.current.onopen = () => {
          console.log('WebSocket connected to port 7000')
          setWsConnected(true)
        }

        websocket.current.onclose = () => {
          console.log('WebSocket disconnected')
          setWsConnected(false)
          // Attempt to reconnect after 3 seconds
          // setTimeout(connectWebSocket, 3000)
        }

        websocket.current.onerror = error => {
          console.error('WebSocket error:', error)

          setWsConnected(false)
        }

        websocket.current.onmessage = event => {
          try {
            const data = inputSchema.parse(JSON.parse(event.data))
            console.log('Received WebSocket data:', data)
            setSchema(prevSchema => ({
              params: {
                ...prevSchema?.params,
                ...data.params
              }
            }))
          } catch (error) {
            console.error('Failed to parse WebSocket message:', error)
          }
        }
      } catch (error) {
        console.error('Failed to create WebSocket connection:', error)
        setTimeout(connectWebSocket, 3000)
      }
    }

    connectWebSocket()

    return () => {
      websocket.current?.close()
    }
  }, [])

  // Function to send data via WebSocket
  const sendWebSocketData = useCallback(
    (data: InputSchema) => {
      if (
        !websocket.current ||
        websocket.current.readyState !== WebSocket.OPEN
      ) {
        console.warn('WebSocket not connected')
        return
      }

      websocket.current.send(JSON.stringify(data))
    },
    [websocket]
  )

  const setParams = useCallback(
    (params: Record<string, number>) => {
      if (!schema) return
      const newParams = { ...schema.params }

      Object.entries(params).forEach(([param, value]) => {
        newParams[param] = {
          ...schema.params[param],
          value: Math.max(
            schema.params[param].min,
            Math.min(schema.params[param].max, value)
          )
        }
      })

      const newSchema: InputSchema = { params: newParams }
      setSchema(newSchema)

      sendWebSocketData(newSchema)
    },
    [schema, sendWebSocketData]
  )

  return [schema, setParams] as const
}
