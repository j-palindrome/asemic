import React from 'react'
import ReactDOM from 'react-dom/client'
import AsemicApp from '../app/AsemicApp'
import { createBrowserRouter, Outlet, RouterProvider } from 'react-router'
import AsemicParams from '../app/AsemicParams'

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
const defaultSource =
  localStorage.getItem('asemic-source') ??
  `h=1
---
[0,0 1,1]`

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <RouterProvider router={router} />
  </React.StrictMode>
)
