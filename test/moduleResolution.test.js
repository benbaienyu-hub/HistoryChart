// @vitest-environment node
// Does the server actually load under plain Node?
//
// Every other test in this suite runs through Vite's resolver, which is more
// forgiving than Node's. An extensionless relative import — `from './deck'` —
// resolves under Vite and under Vitest, and throws ERR_MODULE_NOT_FOUND under
// plain Node ESM, which is what runs the standalone server and the Vercel
// function.
//
// That is not a hypothetical. One such import in a src/lib module that the gap
// route pulls in took down every API route in production, sign-in included,
// while 799 tests and a clean build said everything was fine. The build only
// bundles the client, so it never touched the server's import chain either.
//
// So this test does the one thing the rest of the suite cannot: it starts a real
// Node process and asks it to import the production entry points.

import { execFileSync } from 'node:child_process';
import { dirname, join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { describe, expect, it } from 'vitest';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');

function importUnderNode(relativePath) {
  const url = pathToFileURL(join(ROOT, relativePath)).href;
  execFileSync(process.execPath, ['--input-type=module', '-e', `await import(${JSON.stringify(url)})`], {
    cwd: ROOT,
    timeout: 30_000,
    stdio: 'pipe',
  });
}

describe('the production entry points load under plain Node', () => {
  // Deliberately not server/index.mjs: importing it starts listening, which is
  // the right behaviour for a server and the wrong behaviour for a test. It
  // imports server/api.js, so the resolution chain below covers it anyway.

  it('server/api.js — the router every route hangs off', () => {
    // If this module fails to load, nothing has a handler and every request is a
    // 500, including sign-in. It is the single highest-value import in the app.
    expect(() => importUnderNode('server/api.js')).not.toThrow();
  });

  it('api/index.js — the whole API as one Vercel function', () => {
    expect(() => importUnderNode('api/index.js')).not.toThrow();
  });

  it('fails loudly when a module really cannot be resolved', () => {
    // Guarding the guard: a test that silently passes on a broken import would
    // be worse than not having it.
    expect(() => importUnderNode('server/does-not-exist.js')).toThrow();
  });
});
