import React from 'react'
import ReactDOM from 'react-dom/client'
import AsemicApp from '../app/AsemicApp'
import { createBrowserRouter, RouterProvider } from 'react-router'

function App() {
  return <></>
}
let router = createBrowserRouter([
  {
    path: '/',
    Component: App,
    children: [
      {
        path: '/',
        Component: AsemicApp
      }
    ]
  }
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
