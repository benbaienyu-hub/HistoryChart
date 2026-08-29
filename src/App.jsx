import { useEffect, useState } from 'react';
import SignIn from './components/SignIn';
import Home from './components/Home';
import Canvas from './components/Canvas';
import { fetchCurrentUser, logOut } from './lib/api';
import { rememberOpenCanvas, restorableOpenCanvasId } from './lib/canvasStore';

function App() {
  // The session lives in an httpOnly cookie, so the page cannot read it — the
  // server has to be asked. Until it answers we know nothing, which is a third
  // state distinct from signed-in and signed-out.
  const [user, setUser] = useState(null);
  const [checking, setChecking] = useState(true);
  const [openCanvasId, setOpenCanvasId] = useState(null);
  // A block to land on when the canvas opens. Set when you arrive from a link
  // that named one — the weakest-blocks list on the home screen — so that
  // clicking a block takes you to the block rather than to the general area.
  const [focusBlockId, setFocusBlockId] = useState(null);

  useEffect(() => {
    let cancelled = false;
    fetchCurrentUser()
      .then((found) => {
        if (cancelled) return;
        setUser(found);
        // Reloading while on a canvas should land you back on that canvas. Which
        // canvas that is stays in this browser: it's a per-device UI preference,
        // not account data.
        if (found) setOpenCanvasId(restorableOpenCanvasId(found.email));
      })
      .catch(() => {
        // Unreachable server. Sign-in will report it properly when tried.
        if (!cancelled) setUser(null);
      })
      .finally(() => {
        if (!cancelled) setChecking(false);
      });
    return () => {
      cancelled = true;
    };
  }, []);

  function openCanvas(id, blockId = null) {
    rememberOpenCanvas(user.email, id);
    setFocusBlockId(blockId);
    setOpenCanvasId(id);
  }

  function closeCanvas() {
    rememberOpenCanvas(user.email, null);
    setFocusBlockId(null);
    setOpenCanvasId(null);
  }

  if (checking) {
    // Deliberately blank rather than a spinner: the check is one local request and
    // a flashing spinner reads worse than a beat of nothing.
    return <div className="min-h-screen bg-canvas" />;
  }

  if (!user) {
    return (
      <SignIn
        onSignedIn={(signedIn) => {
          setUser(signedIn);
          setOpenCanvasId(restorableOpenCanvasId(signedIn.email));
        }}
      />
    );
  }

  if (openCanvasId) {
    return (
      <Canvas
        user={user}
        canvasId={openCanvasId}
        focusBlockId={focusBlockId}
        onExit={closeCanvas}
        onMissing={() => setOpenCanvasId(null)}
      />
    );
  }

  return (
    <Home
      user={user}
      onOpenCanvas={openCanvas}
      // Settings can change the user row (a first recovery code, a new password),
      // and the header reads from it, so the change has to come back up here.
      onUserChanged={setUser}
      onSignOut={async () => {
        await logOut().catch(() => {});
        setOpenCanvasId(null);
        setUser(null);
      }}
    />
  );
}

export default App;
