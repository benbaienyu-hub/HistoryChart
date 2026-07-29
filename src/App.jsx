import { useState } from 'react';
import SignIn from './components/SignIn';
import Home from './components/Home';
import Canvas from './components/Canvas';
import { getCurrentUser, signOut } from './lib/auth';

function App() {
  const [user, setUser] = useState(() => getCurrentUser());
  const [openCanvasId, setOpenCanvasId] = useState(null);

  if (!user) return <SignIn onSignedIn={setUser} />;

  if (openCanvasId) {
    return (
      <Canvas
        user={user}
        canvasId={openCanvasId}
        onExit={() => setOpenCanvasId(null)}
      />
    );
  }

  return (
    <Home
      user={user}
      onOpenCanvas={setOpenCanvasId}
      onSignOut={() => {
        signOut();
        setOpenCanvasId(null);
        setUser(null);
      }}
    />
  );
}

export default App;
