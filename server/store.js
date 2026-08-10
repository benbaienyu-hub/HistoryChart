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

// Every name a hosted Postgres is likely to arrive under, pooled first. Vercel's
// Neon integration sets several of these at once; other platforms pick one. The
// alternative to accepting them all is an app that silently stores data in a file
// because the variable was called the other thing.
//
// POSTGRES_PRISMA_URL is deliberately absent: it carries Prisma-specific query
// parameters (`pgbouncer=true`) that `pg` would forward as startup options.
const URL_VARS = [
  'POSTGRES_URL',
  'DATABASE_URL',
  'POSTGRES_URL_NON_POOLING',
  'DATABASE_URL_UNPOOLED',
];

// The libpq variables, which the Neon integration also sets. Without this, a
// project that has only these looks to us like a project with no database.
const PART_VARS = ['PGHOST', 'PGUSER', 'PGPASSWORD', 'PGDATABASE', 'PGPORT'];

function env(name) {
  return process.env[name]?.trim() || null;
}

export function postgresUrl() {
  for (const name of URL_VARS) {
    const value = env(name);
    if (value) return value;
  }
  return fromParts();
}

// PGHOST/PGUSER/PGPASSWORD/PGDATABASE assembled into a connection string. The
// credentials are percent-encoded: a generated password containing @ or / would
// otherwise produce a URL that parses as something else entirely.
function fromParts() {
  const host = env('PGHOST');
  const user = env('PGUSER');
  const database = env('PGDATABASE');
  if (!host || !user || !database) return null;

  const password = env('PGPASSWORD');
  const credentials = password
    ? `${encodeURIComponent(user)}:${encodeURIComponent(password)}`
    : encodeURIComponent(user);
  const port = env('PGPORT') ?? '5432';
  return `postgres://${credentials}@${host}:${port}/${database}`;
}

// Which recognised variables this process can actually see — names only, never
// values. The question "is the variable even reaching the function" is otherwise
// unanswerable from outside, and it is the first thing worth knowing when the app
// says it is using a file and you believe you configured a database.
export function visibleDatabaseVars() {
  return [...URL_VARS, ...PART_VARS].filter((name) => env(name));
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
