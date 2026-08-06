// The server's data store: a single JSON file, written atomically.
//
// Why a file and not SQLite. `node:sqlite` exists but is experimental and absent
// before Node 22.5, and `better-sqlite3` is a native module that has to compile —
// either one turns "clone and run" into a build-tools problem on somebody else's
// laptop. A JSON file has no install step at all, and at this app's scale
// (hundreds of accounts, a debounced save per edit) rewriting it is cheap.
//
// Everything goes through readDb/mutate, so the swap to a real database when the
// numbers justify it touches this module and nothing else.

import { mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs';
import { dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const DEFAULT_PATH = fileURLToPath(new URL('../.data/lacuna.json', import.meta.url));

const EMPTY = {
  version: 1,
  users: [],
  sessions: [],
  canvases: [],
  grants: [],
  images: [],
  // Spaced-repetition state, one row per user per block — see reviewRoutes.js.
  reviews: [],
};

let dataPath = process.env.LACUNA_DATA || DEFAULT_PATH;
let cache = null;

// Test seam: point the store at a temp file, and drop the cache with it.
export function setDataPathForTests(path) {
  dataPath = path;
  cache = null;
}

export function dataFilePath() {
  return dataPath;
}

function load() {
  if (cache) return cache;
  try {
    const parsed = JSON.parse(readFileSync(dataPath, 'utf8'));
    // Merge over EMPTY so a file written by an older version is still readable.
    cache = { ...structuredClone(EMPTY), ...parsed };
  } catch {
    // Missing or unreadable: start empty rather than crash. A corrupt file is
    // the one case worth being loud about, but not at the cost of the process.
    cache = structuredClone(EMPTY);
  }
  return cache;
}

export function readDb() {
  return load();
}

// Writes go to a temp file and are renamed into place, which is atomic on POSIX:
// a crash mid-write leaves the previous good file rather than a half-written one.
export function mutate(fn) {
  const db = load();
  const result = fn(db);
  mkdirSync(dirname(dataPath), { recursive: true });
  const tmp = `${dataPath}.tmp`;
  writeFileSync(tmp, JSON.stringify(db, null, 2));
  renameSync(tmp, dataPath);
  return result;
}
