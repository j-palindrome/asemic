import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import './index.css'
import App from './Nurbs.tsx'
import Lines from './Lines.tsx'

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <Lines />
  </StrictMode>
)
