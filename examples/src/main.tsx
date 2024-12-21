import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import './index.css'
import Asemic from '../../util/src/asemic/Asemic'
import Scene from './Text'

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <Asemic>
      <Scene />
    </Asemic>
  </StrictMode>
)
