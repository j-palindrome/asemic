import React, { useCallback, useEffect, useRef, useState } from 'react'
import ReactDOM from 'react-dom/client'
import AsemicApp from './app/AsemicApp'
import { createBrowserRouter, Outlet, RouterProvider } from 'react-router'
import AsemicParams from './app/AsemicParams'
import { SocketContext } from './schema'
import { InputSchema } from './inputSchema'
import { io, Socket } from 'socket.io-client'
import { isEqual } from 'lodash'
import './standalone/index.css'

// Default source code for the Asemic app
const defaultSource = ``

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
    // File system API not available in web version
    return ''
  }, [])

  return <AsemicApp source={source} save={saveToFile} getRequire={getRequire} />
}

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <AsemicWrapper />
  </React.StrictMode>
)

// Remove loading screen
postMessage({ payload: 'removeLoading' }, '*')
