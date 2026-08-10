// The server's data store. Two backends, one interface:
//
//   readDb()    -> the whole document, for reading
//   mutate(fn)  -> apply fn to the document and persist it
//
// A JSON file by default, so cloning the repo and running it needs no database at
// all. Postgres when POSTGRES_URL (or DATABASE_URL) is set, which is what makes
// hosting on a platform with no writable disk possible — see stores/pgStore.js.
//
// Both are async, because one of them talks over a network. That is the only
// reason: the file backend does its work synchronously behind the promise.
//
// Why the whole document rather than a table per entity. The app's data is small
// and highly interlinked, and the logic above this module was written against a
// plain object. Keeping that shape means the database swap is this module plus two
// files, instead of rewriting every query in the app — and at a few hundred
// kilobytes, reading and writing it whole costs less than the code it saves.
// The cost is paid in mutate(): see the conflict handling there.

import { createFileStore } from './stores/fileStore.js';
import { createPgStore } from './stores/pgStore.js';

export { EMPTY, withDefaults } from './stores/document.js';

export function postgresUrl() {
  // POSTGRES_URL is what Vercel's Neon integration sets; DATABASE_URL is what
  // everything else uses. Accepting both means no renaming step at deploy time.
  return process.env.POSTGRES_URL?.trim() || process.env.DATABASE_URL?.trim() || null;
}

let backend = null;

function active() {
  if (!backend) {
    const url = postgresUrl();
    backend = url ? createPgStore(url) : createFileStore();
  }
  return backend;
}

// Which one is in use. Reported at startup, because "my accounts keep vanishing"
// and "I thought it was using the database" are the same confusion.
export function storeKind() {
  return active().kind;
}

export function readDb() {
  return active().read();
}

export function mutate(fn) {
  return active().mutate(fn);
}

// Only meaningful for the file backend; kept at this level because callers and
// diagnostics ask the store where its data is without caring which kind it is.
export function dataFilePath() {
  return active().dataPath ?? null;
}

export function describeStore() {
  return active().describe();
}

// Whether saving would actually work, asked without saving anything real. A read
// cannot answer this: on a read-only filesystem, reading a missing file looks
// exactly like a first run, and everything seems fine until the first write.
export function storeWritable() {
  return active().writable();
}

// Test seams. Both drop the current backend, so the next call builds a fresh one.
export function setDataPathForTests(path) {
  backend = createFileStore(path);
}

export function usePostgresForTests(url) {
  backend = createPgStore(url);
}

export async function resetStoreForTests() {
  await backend?.close?.();
  backend = null;
}
