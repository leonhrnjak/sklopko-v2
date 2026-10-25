import { lazy, useEffect } from 'react'
import { useChallenges } from './app/challenges'
import { isEmbed } from './app/embed'
import { useFsm } from './app/fsm'
import { useGallery } from './app/gallery'
import { useMakeIc } from './app/ics'
import { usePicture } from './app/picture'
import { useTestbench } from './app/testbench'
import { useLogic } from './app/logic'
import { useReference } from './app/reference'
import { useOpenOnFirstProbe, useWave } from './app/waveform'
import { usePartsDrawer } from './app/parts'
import { Canvas } from './ui/canvas/Canvas'
import { ContextMenu } from './ui/canvas/ContextMenu'
import { EmbedBar } from './ui/EmbedBar'
import { LibraryDialog } from './ui/library/LibraryDialog'
import { fitView } from './ui/canvas/viewport'
import { Inspector } from './ui/Inspector'
import { OnDemand } from './ui/OnDemand'
import { Palette } from './ui/Palette'
import { SelectionBar } from './ui/SelectionBar'
import { StatusBar, Toolbar } from './ui/Toolbar'
import { ZoomControls } from './ui/ZoomControls'

// The panels, each its own chunk, fetched the first time it is opened.
const LogicPanel = lazy(() => import('./ui/logic/LogicPanel').then((m) => ({ default: m.LogicPanel })))
const FsmPanel = lazy(() => import('./ui/fsm/FsmPanel').then((m) => ({ default: m.FsmPanel })))
const References = lazy(() => import('./ui/References').then((m) => ({ default: m.References })))
const ChallengeList = lazy(() => import('./ui/challenges/ChallengeList').then((m) => ({ default: m.ChallengeList })))
const ChallengePanel = lazy(() => import('./ui/challenges/ChallengePanel').then((m) => ({ default: m.ChallengePanel })))
const ExampleGallery = lazy(() => import('./ui/ExampleGallery').then((m) => ({ default: m.ExampleGallery })))
const MakeIcDialog = lazy(() => import('./ui/MakeIcDialog').then((m) => ({ default: m.MakeIcDialog })))
const PictureDialog = lazy(() => import('./ui/PictureDialog').then((m) => ({ default: m.PictureDialog })))
const TestbenchDialog = lazy(() => import('./ui/TestbenchDialog').then((m) => ({ default: m.TestbenchDialog })))
const WaveformPanel = lazy(() => import('./ui/WaveformPanel').then((m) => ({ default: m.WaveformPanel })))

export default function App() {
  const logicOpen = useLogic((s) => s.open)
  const fsmOpen = useFsm((s) => s.open)
  const referenceOpen = useReference((s) => s.open)
  const challengeListOpen = useChallenges((s) => s.listOpen)
  const challengeOpen = useChallenges((s) => s.current !== null)
  const waveOpen = useWave((s) => s.open)
  const galleryOpen = useGallery((s) => s.open)
  const makeIcOpen = useMakeIc((s) => s.open)
  const pictureOpen = usePicture((s) => s.open)
  const testsOpen = useTestbench((s) => s.open)
  const partsOpen = usePartsDrawer((s) => s.open)
  useOpenOnFirstProbe(!isEmbed())
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
      <main className={`main${partsOpen ? '' : ' parts-closed'}`}>
        <Palette />
        <div className="stage">
          <div className="stage-view">
            <Canvas />
            <StatusBar />
            <ZoomControls />
            <SelectionBar />
            <ContextMenu />
          </div>
          <OnDemand open={waveOpen}>
            <WaveformPanel />
          </OnDemand>
          <OnDemand open={challengeOpen}>
            <ChallengePanel />
          </OnDemand>
        </div>
        <Inspector />
      </main>
      <OnDemand open={logicOpen}>
        <LogicPanel />
      </OnDemand>
      <OnDemand open={fsmOpen}>
        <FsmPanel />
      </OnDemand>
      <OnDemand open={referenceOpen}>
        <References />
      </OnDemand>
      <OnDemand open={challengeListOpen}>
        <ChallengeList />
      </OnDemand>
      <OnDemand open={testsOpen}>
        <TestbenchDialog />
      </OnDemand>
      <OnDemand open={makeIcOpen}>
        <MakeIcDialog />
      </OnDemand>
      <OnDemand open={pictureOpen}>
        <PictureDialog />
      </OnDemand>
      <OnDemand open={galleryOpen}>
        <ExampleGallery />
      </OnDemand>
      <LibraryDialog />
    </div>
  )
}
