import { afterEach, beforeEach } from 'vitest';

// Most of the suite runs in jsdom, because most of what is worth testing here
// talks to localStorage. The server-side files opt into the node environment
// instead — the OpenAI SDK refuses to construct in anything browser-like — so
// everything below is guarded rather than assumed.
const inBrowser = typeof window !== 'undefined';

// Every module in src/lib persists to localStorage, so leaking state between
// tests would make them order-dependent. Wipe it around each one.
beforeEach(() => {
  if (inBrowser) localStorage.clear();
});

afterEach(() => {
  if (!inBrowser) return;
  localStorage.clear();
  delete document.documentElement.dataset.theme;
});

// canvasStore mints ids with crypto.randomUUID(); both environments have it, but
// a counter keeps ids readable in failure output and stable across runs.
let uuidCounter = 0;
globalThis.crypto.randomUUID = () => `uuid-${++uuidCounter}`;

// jsdom implements matchMedia only from v22 onwards and always reports
// "no match"; the theme store needs a real one it can flip.
if (inBrowser && !window.matchMedia) {
  window.matchMedia = () => ({
    matches: false,
    addEventListener() {},
    removeEventListener() {},
  });
}
