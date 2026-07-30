import { afterEach, beforeEach } from 'vitest';

// Every module in src/lib persists to localStorage, so leaking state between
// tests would make them order-dependent. Wipe it around each one.
beforeEach(() => {
  localStorage.clear();
});

afterEach(() => {
  localStorage.clear();
  delete document.documentElement.dataset.theme;
});

// canvasStore mints ids with crypto.randomUUID(); jsdom has it, but a counter
// keeps ids readable in failure output and stable across runs.
let uuidCounter = 0;
globalThis.crypto.randomUUID = () => `uuid-${++uuidCounter}`;

// jsdom implements matchMedia only from v22 onwards and always reports
// "no match"; the theme store needs a real one it can flip.
if (!window.matchMedia) {
  window.matchMedia = () => ({
    matches: false,
    addEventListener() {},
    removeEventListener() {},
  });
}
