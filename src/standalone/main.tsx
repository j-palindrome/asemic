import React, { useCallback, useEffect, useRef, useState } from 'react'
import ReactDOM from 'react-dom/client'
import AsemicApp from '../app/AsemicApp'
import { createBrowserRouter, Outlet, RouterProvider } from 'react-router'
import AsemicParams from '../app/AsemicParams'
import asemicDefault from './asemicDefault'
import { SocketContext } from '../server/schema'
import { InputSchema } from '../server/constants'
import { io, Socket } from 'socket.io-client'
import './index.css'

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
    const newSocket = io(`http://localhost:3000`)
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

  const [schema, setSchema] = useState<InputSchema>({ params: {} })

  const setParams = useCallback(
    (params: InputSchema['params'], broadcast = true) => {
      if (!socketRef.current) {
        return
      }

      setSchema({ ...schema, params: { ...schema.params, ...params } })

      if (broadcast) {
        socketRef.current.emit('params', { params })
      }
    },
    [socketRef, schema.params]
  )

  useEffect(() => {
    if (!socket) return

    const handleParamsUpdate = ({ params }: InputSchema) => {
      setParams(params, false)
    }
    socket.on('params', handleParamsUpdate)

    return () => {
      socket.off('params', handleParamsUpdate)
    }
  }, [socket, setParams])
  return (
    <SocketContext.Provider
      value={{ socket, params: schema.params, setParams }}>
      <RouterProvider router={router} />
    </SocketContext.Provider>
  )
}

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>
)
