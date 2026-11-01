import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import './index.css'
import { registerOffline } from './app/offline'
import { installEngine } from './engine/wasm'

registerOffline()

// The Rust engine's module is compiled before anything makes a Simulator (the page's own, for the analyses, and the one in the
// worker does the same), so every Simulator has it from the start. If it cannot be loaded the TypeScript engines run instead.
// The library is read before the first render, so the canvas never shows a circuit that is about to be replaced.
async function start() {
  await installEngine().catch((e) => console.error(e))
  const { startRuntime } = await import('./app/runtime')
  await startRuntime().catch((e) => console.error(e))
  const { default: App } = await import('./App.tsx')
  createRoot(document.getElementById('root')!).render(
    <StrictMode>
      <App />
    </StrictMode>,
  )
}
void start()
