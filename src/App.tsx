import { useEffect } from 'react'
import { isEmbed } from './app/embed'
import { Canvas } from './ui/canvas/Canvas'
import { EmbedBar } from './ui/EmbedBar'
import { fitView } from './ui/canvas/viewport'
import { Inspector } from './ui/Inspector'
import { Palette } from './ui/Palette'
import { SelectionBar } from './ui/SelectionBar'
import { StatusBar, Toolbar } from './ui/Toolbar'
import { WaveformPanel } from './ui/WaveformPanel'

export default function App() {
  useEffect(() => {
    requestAnimationFrame(fitView)
  }, [])
  if (isEmbed())
    return (
      <div className="app embed">
        <div className="stage-view">
          <Canvas />
          <StatusBar />
          <EmbedBar />
        </div>
      </div>
    )
  return (
    <div className="app">
      <Toolbar />
      <main className="main">
        <Palette />
        <div className="stage">
          <div className="stage-view">
            <Canvas />
            <StatusBar />
            <SelectionBar />
          </div>
          <WaveformPanel />
        </div>
        <Inspector />
      </main>
    </div>
  )
}
