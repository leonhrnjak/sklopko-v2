import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import './index.css'
import App from './App.tsx'
import { startRuntime } from './app/runtime'

// The library is read before the first render, so the canvas never shows a circuit that is about to be replaced.
startRuntime()
  .catch((e) => console.error(e))
  .then(() => {
    createRoot(document.getElementById('root')!).render(
      <StrictMode>
        <App />
      </StrictMode>,
    )
  })
