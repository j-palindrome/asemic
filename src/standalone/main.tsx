import React from 'react'
import ReactDOM from 'react-dom/client'
import AsemicApp from '../app/AsemicApp'

// Default source content - you can customize this initial content
const defaultSource =
  localStorage.getItem('asemic-source') ??
  `h=1
---
[0,0 1,1]`

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <AsemicApp
      source={defaultSource}
      save={newSource => localStorage.setItem('asemic-source', newSource)}
      getRequire={async link => ''}
    />
  </React.StrictMode>
)
