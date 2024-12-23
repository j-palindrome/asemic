import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import './index.css'
import DigiRis from './digital-resistance/digiris'
import Asemic from '../../src/Asemic'

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <DigiRis />
  </StrictMode>
)
