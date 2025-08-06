import React, { useCallback, useEffect, useRef, useState } from 'react'
import ReactDOM from 'react-dom/client'
import AsemicApp from '../app/AsemicApp'
import { createBrowserRouter, Outlet, RouterProvider } from 'react-router'
import AsemicParams from '../app/AsemicParams'
import asemicDefault from './asemicDefault'
import { SocketContext } from '../server/schema'
import { InputSchema } from '../server/inputSchema'
import { io, Socket } from 'socket.io-client'
import './index.css'
import { isEqual } from 'lodash'

function AsemicWrapper() {
  return (
    <AsemicApp
      source={defaultSource}
      save={newSource => localStorage.setItem('asemic-source', newSource)}
      getRequire={async link => ''}
    />
  )
}

let router = createBrowserRouter([
  {
    path: '/',
    Component: AsemicWrapper
  },
  { path: '/control', Component: AsemicParams }
])

// Default source content - you can customize this initial content
const defaultSource = localStorage.getItem('asemic-source') ?? asemicDefault

const App = () => {
  const [socket, setSocket] = useState<Socket<SendMap, ReceiveMap> | null>(null)
  const socketRef = useRef<Socket<SendMap, ReceiveMap> | null>(socket)
  useEffect(() => {
    socketRef.current = socket
  }, [socket])

  useEffect(() => {
    const newSocket = io(`http://${window.location.hostname}:3000`)
    setSocket(newSocket)

    newSocket.on('connect', () => {
      console.log('Socket.IO connected')
    })

    newSocket.on('disconnect', () => {
      console.log('Socket.IO disconnected')
    })
    console.log('there is a socket')

    return () => {
      newSocket.disconnect()
    }
  }, [])

  const [schema, setSchema] = useState<InputSchema>({ params: {}, presets: {} })

  const setSchemaWithBroadcast = useCallback(
    (newSchema: Partial<InputSchema>, broadcast = true) => {
      if (!socketRef.current) {
        return
      }

      for (let key in newSchema) {
        if (Object.keys(newSchema[key] || {}).length === 0) {
          delete newSchema[key]
        }
      }

      setSchema({ ...schema, ...newSchema })

      if (broadcast) {
        socketRef.current.emit('params', { ...schema, ...newSchema })
      }
    },
    [socketRef, schema]
  )

  useEffect(() => {
    if (!socket) return

    const handleParamsUpdate = (newSchema: InputSchema) => {
      setSchemaWithBroadcast(newSchema, false)
    }
    socket.on('params', handleParamsUpdate)

    return () => {
      socket.off('params', handleParamsUpdate)
    }
  }, [socket, setSchemaWithBroadcast])

  return (
    socket && (
      <SocketContext.Provider
        value={{
          socket,
          schema,
          setSchema: setSchemaWithBroadcast
        }}>
        <RouterProvider router={router} />
      </SocketContext.Provider>
    )
  )
}

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>
)
