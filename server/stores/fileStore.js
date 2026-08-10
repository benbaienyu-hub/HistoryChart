// The default store: one JSON file, written atomically.
//
// Why a file and not SQLite. `node:sqlite` exists but is experimental and absent
// before Node 22.5, and `better-sqlite3` is a native module that has to compile —
// either one turns "clone and run" into a build-tools problem on somebody else's
// laptop. A JSON file has no install step at all, and at this app's scale
// (hundreds of accounts, a debounced save per edit) rewriting it is cheap.
//
// This backend is what runs when nobody has configured a database, which includes
// every local checkout. It does its work synchronously and returns promises, so it
// satisfies the same interface as the Postgres one without pretending to be slow.

import { mkdirSync, readFileSync, renameSync, rmSync, writeFileSync } from 'node:fs';
import { dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { withDefaults } from './document.js';

const DEFAULT_PATH = fileURLToPath(new URL('../../.data/lacuna.json', import.meta.url));

export function createFileStore(path) {
  const dataPath = path ?? process.env.LACUNA_DATA?.trim() ?? DEFAULT_PATH;

  // One process owns the file, so the parsed document can be held between
  // requests. Note this is also why deleting the file under a running server
  // changes nothing until it restarts.
  let cache = null;

  function load() {
    if (cache) return cache;
    try {
      cache = withDefaults(JSON.parse(readFileSync(dataPath, 'utf8')));
    } catch {
      // Missing or unreadable: start empty rather than crash. A corrupt file is
      // the one case worth being loud about, but not at the cost of the process.
      cache = withDefaults(null);
    }
    return cache;
  }

  return {
    kind: 'file',
    dataPath,

    async read() {
      return load();
    },

    // Writes go to a temp file and are renamed into place, which is atomic on
    // POSIX: a crash mid-write leaves the previous good file rather than a
    // half-written one. No conflict handling is needed — a single process holds
    // the document, and Node runs the callback without interruption.
    async mutate(fn) {
      const db = load();
      const result = await fn(db);
      try {
        mkdirSync(dirname(dataPath), { recursive: true });
        const tmp = `${dataPath}.tmp`;
        writeFileSync(tmp, JSON.stringify(db, null, 2));
        renameSync(tmp, dataPath);
      } catch (cause) {
        throw unwritable(cause, dataPath);
      }
      return result;
    },

    describe() {
      return `JSON file at ${dataPath}`;
    },

    // Can this backend actually save? Read-only is not detectable from a read —
    // reading a missing file looks exactly like a first run — so the only honest
    // answer comes from trying.
    async writable() {
      try {
        mkdirSync(dirname(dataPath), { recursive: true });
        const probe = `${dataPath}.probe`;
        writeFileSync(probe, '');
        rmSync(probe, { force: true });
        return { ok: true };
      } catch (cause) {
        return { ok: false, problem: unwritable(cause, dataPath).message };
      }
    },
  };
}

// Codes that mean "this location cannot be written to", as opposed to a bug.
// EROFS is what a serverless platform's filesystem gives.
const UNWRITABLE_CODES = new Set(['EROFS', 'EACCES', 'EPERM']);

// Being unable to save is almost always one thing: the app fell back to a file
// because no database was configured, and it is running somewhere with no disk.
// Reporting the raw errno — or worse, a generic 500 — leaves someone reading deploy
// logs to work that out for themselves.
function unwritable(cause, dataPath) {
  const hosted = Boolean(process.env.VERCEL);
  if (!UNWRITABLE_CODES.has(cause.code) && !hosted) return cause;

  const what =
    cause.code === 'EROFS'
      ? `Cannot write to ${dataPath}: this filesystem is read-only.`
      : `Cannot write to ${dataPath} (${cause.code ?? 'unknown error'}).`;

  const error = new Error(
    `${what} Lacuna is storing data in a file because no database is configured — set ` +
      'POSTGRES_URL (or DATABASE_URL) to a Postgres connection string and redeploy. On Vercel, ' +
      'adding the variable is not enough on its own: the deployment has to be rebuilt to pick it up.'
  );
  // 503, not 500: the app is fine, the deployment is incomplete.
  error.status = 503;
  error.cause = cause;
  return error;
}
