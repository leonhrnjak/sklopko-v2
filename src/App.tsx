import { useEffect } from 'react'
import { Canvas } from './ui/canvas/Canvas'
import { fitView } from './ui/canvas/viewport'
import { Inspector } from './ui/Inspector'
import { Palette } from './ui/Palette'
import { StatusBar, Toolbar } from './ui/Toolbar'

export default function App() {
  useEffect(() => {
    requestAnimationFrame(fitView)
  }, [])
  return (
    <div className="app">
      <Toolbar />
      <main className="main">
        <Palette />
        <div className="stage">
          <Canvas />
          <StatusBar />
        </div>
        <Inspector />
      </main>
    </div>
  )
}
