import React from 'react'
import ReactDOM from 'react-dom/client'
import AsemicApp from './AsemicApp'
import './index.css'

// Default source content - you can customize this initial content
const defaultSource = `h=window
---
(repeat 10 {! +#C,#C*H *1/10 >} (repeat 10 {< >} Ic=># [0,0] (repeat 5 +[~.2-.5,-.2*(I+1)*Ic])))`

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <div className='asemic-container'>
      <AsemicApp source={defaultSource} />
    </div>
  </React.StrictMode>
)
