import Canvas from './components/Canvas';

function App() {
  return (
    <div className="relative h-screen w-screen overflow-hidden bg-canvas">
      <Canvas />

      <header className="pointer-events-none absolute left-6 top-6 z-10">
        <h1 className="text-[22px] font-semibold tracking-tight text-ink">HistoryChart</h1>
        <p className="mt-0.5 text-[13px] text-subink">
          Click a card to explore what came next
        </p>
      </header>
    </div>
  );
}

export default App;
