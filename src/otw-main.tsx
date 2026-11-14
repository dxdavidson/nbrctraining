import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import './index.css'
import './otw/otw.css'
import OtwApp from './otw/OtwApp'
import { showEnvBanner } from './envBanner'

document.body.classList.add('otw-document')
showEnvBanner()

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <OtwApp />
  </StrictMode>,
)
