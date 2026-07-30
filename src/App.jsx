import { useState } from 'react';
import SignIn from './components/SignIn';
import Home from './components/Home';
import Canvas from './components/Canvas';
import { getCurrentUser, signOut } from './lib/auth';
import { rememberOpenCanvas, restorableCanvasId } from './lib/canvasStore';

function App() {
  const [user, setUser] = useState(() => getCurrentUser());
  // Reloading while on a canvas should land you back on that canvas, not on the
  // library. The pointer is validated on read, so a deleted or un-shared canvas
  // just falls through to Home.
  const [openCanvasId, setOpenCanvasId] = useState(() =>
    user ? restorableCanvasId(user.email) : null
  );

  function openCanvas(id) {
    rememberOpenCanvas(user.email, id);
    setOpenCanvasId(id);
  }

  function closeCanvas() {
    rememberOpenCanvas(user.email, null);
    setOpenCanvasId(null);
  }

  if (!user) {
    return (
      <SignIn
        onSignedIn={(signedIn) => {
          setUser(signedIn);
          setOpenCanvasId(restorableCanvasId(signedIn.email));
        }}
      />
    );
  }

  if (openCanvasId) {
    return <Canvas user={user} canvasId={openCanvasId} onExit={closeCanvas} />;
  }

  return (
    <Home
      user={user}
      onOpenCanvas={openCanvas}
      onSignOut={() => {
        signOut();
        setOpenCanvasId(null);
        setUser(null);
      }}
    />
  );
}

export default App;
