import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import './index.css'
import { registerOffline } from './app/offline'
import { reportSimFailure } from './app/simHealth'
import { installEngine } from './engine/wasm'
import { installErrorLog } from './app/errors'
import { CrashScreen } from './ui/ErrorBoundary'

registerOffline()
installErrorLog()

// The Rust engine's module is compiled before anything makes a Simulator (the page's own, for the analyses, and the one in the
// worker does the same), so every Simulator has it from the start. If it cannot be loaded there is no engine to run instead: the footer
// says "Simulator stopped" (`simHealth`) and offers a restart.
// The engine, the runtime and App are fetched together; only `startRuntime` (which makes the first Simulator) waits for the engine.
// The library is read before the first render, so the canvas never shows a circuit that is about to be replaced.
async function start() {
  const [, { startRuntime }, { default: App }] = await Promise.all([
    installEngine().catch(reportSimFailure),
    import('./app/runtime'),
    import('./App.tsx'),
  ])
  await startRuntime().catch((e) => console.error(e))
  createRoot(document.getElementById('root')!).render(
    <StrictMode>
      <App />
    </StrictMode>,
  )
}
// If a script of the start-up cannot be fetched (a tab open across a deploy), say so instead of leaving the page empty.
start().catch((e) => {
  console.error(e)
  createRoot(document.getElementById('root')!).render(<CrashScreen />)
})
