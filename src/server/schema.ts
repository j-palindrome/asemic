import { useCallback, useEffect, useRef, useState } from 'react'
import { z } from 'zod'

export const inputSchema = z.object({
  params: z.record(
    z.string(),
    z.object({
      type: z.literal('number'),
      value: z.number()
    })
  )
})

export type InputSchema = z.infer<typeof inputSchema>

export const useSchema = () => {
  // WebSocket connection setup
  const websocket = useRef<WebSocket | null>(null)
  const [wsConnected, setWsConnected] = useState(false)

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
          setTimeout(connectWebSocket, 3000)
        }

        websocket.current.onerror = error => {
          console.error('WebSocket error:', error)
          setWsConnected(false)
        }

        websocket.current.onmessage = event => {
          try {
            const data = JSON.parse(event.data)
            console.log('Received WebSocket data:', data)
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
  return [sendWebSocketData, wsConnected] as const
}
