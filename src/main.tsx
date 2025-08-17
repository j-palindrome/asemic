import React, { useCallback, useEffect, useRef, useState } from 'react'
import ReactDOM from 'react-dom/client'
import AsemicApp from './app/AsemicApp'
import { createBrowserRouter, Outlet, RouterProvider } from 'react-router'
import AsemicParams from './app/AsemicParams'
import { SocketContext } from './server/schema'
import { InputSchema } from './server/inputSchema'
import { io, Socket } from 'socket.io-client'
import { isEqual } from 'lodash'
import './standalone/index.css'

// Default source code for the Asemic app
const defaultSource = `// Asemic Language Example
// This is a simple generative writing system

let text = "Hello World"
let curve = asemic.curve()
  .start([50, 50])
  .to([200, 100])
  .to([350, 50])

asemic.render(curve)`

function AsemicWrapper() {
  const [source, setSource] = useState(() => {
    // Try to load from localStorage first, then fall back to default
    if (typeof localStorage !== 'undefined') {
      return localStorage.getItem('asemic-source') || defaultSource
    }
    return defaultSource
  })

  const saveToFile = useCallback(
    async (
      newSource: string,
      options: { reload: boolean } = { reload: false }
    ) => {
      setSource(newSource)
      // Save to localStorage
      if (typeof localStorage !== 'undefined') {
        localStorage.setItem('asemic-source', newSource)
      }
    },
    []
  )

  const getRequire = useCallback(async (file: string): Promise<string> => {
    // In Electron, we can use the file system API
    if (window.electronAPI) {
      const result = await window.electronAPI.readFile(file)
      if (result.success && result.content) {
        return result.content
      }
    }
    return ''
  }, [])

  return <AsemicApp source={source} save={saveToFile} getRequire={getRequire} />
}

let router = createBrowserRouter([
  {
    path: '/',
    Component: AsemicWrapper
  },
  { path: '/control', Component: AsemicParams }
])

// Socket context for real-time communication
function SocketProvider({ children }: { children: React.ReactNode }) {
  const [socket, setSocket] = useState<Socket | null>(null)
  const [schema, setSchema] = useState<InputSchema>({ params: {}, presets: {} })
  const lastSchemaRef = useRef<InputSchema | null>(null)

  const updateSchema = useCallback(
    (newSchema: Partial<InputSchema>, silent = false) => {
      setSchema(prev => ({ ...prev, ...newSchema }))
    },
    []
  )

  useEffect(() => {
    // Only connect to socket in development or if explicitly configured
    const shouldConnect =
      import.meta.env.DEV || import.meta.env.VITE_ENABLE_SOCKET
    if (!shouldConnect) return

    const newSocket = io('http://localhost:3000')
    setSocket(newSocket)

    newSocket.on('schema', (newSchema: InputSchema) => {
      if (!isEqual(newSchema, lastSchemaRef.current)) {
        setSchema(newSchema)
        lastSchemaRef.current = newSchema
      }
    })

    return () => {
      newSocket.close()
    }
  }, [])

  // Don't render children until we have a socket or decide we don't need one
  const shouldConnect =
    import.meta.env.DEV || import.meta.env.VITE_ENABLE_SOCKET
  if (shouldConnect && !socket) {
    return <div>Connecting...</div>
  }

  return (
    <SocketContext.Provider
      value={{
        socket: socket as any, // Type assertion for now
        schema,
        setSchema: updateSchema
      }}>
      {children}
    </SocketContext.Provider>
  )
}

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <SocketProvider>
      <RouterProvider router={router} />
    </SocketProvider>
  </React.StrictMode>
)

// Remove loading screen
postMessage({ payload: 'removeLoading' }, '*')
