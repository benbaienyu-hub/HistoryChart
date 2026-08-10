// The Postgres backend: the same document, in one row.
//
// This exists so the app can run somewhere with no writable disk — a serverless
// platform, where the filesystem is read-only, /tmp is per-instance and wiped, and
// two requests can be served by two different machines. The JSON file backend
// silently loses data there; this one doesn't.
//
// One row, not a table per entity, for the reason given in store.js: it keeps the
// document shape the rest of the app is written against. The price is that a write
// is a read-modify-write of the whole document, and two of those can interleave.
// That is what the version column is for.
//
//   UPDATE ... SET doc = $1, version = version + 1 WHERE id = 1 AND version = $2
//
// If another writer got there first the version has moved and no row is updated;
// we re-read and re-run the callback against the current document. Every mutate
// callback in this app locates its target inside the callback (db.users.find(...),
// db.canvases.filter(...)), which is exactly what makes re-running one safe.
//
// Without that check the loser of a race would write a document built from data it
// read before the winner's change — silently reverting it. This app has had that
// bug once already, in the client's save-on-close path; it is not getting it again.

import pg from 'pg';
import { withDefaults } from './document.js';

const TABLE = 'lacuna_document';
const ROW_ID = 1;
const MAX_ATTEMPTS = 6;

export function createPgStore(url) {
  // Module-scoped and lazy: on a serverless platform a warm invocation reuses the
  // pool, and a cold one shouldn't pay for it until something actually reads.
  let pool = null;
  let ready = null;

  function connect() {
    if (!pool) {
      pool = new pg.Pool({
        connectionString: url,
        // A serverless instance handles one request at a time, so a large pool
        // would only hold connections the provider counts against us.
        max: Number(process.env.PGPOOL_MAX ?? 3),
        idleTimeoutMillis: 10_000,
        connectionTimeoutMillis: 10_000,
        // Hosted Postgres requires TLS; local development usually has none. The
        // certificate is not verified because managed providers front the database
        // with their own CA, and pinning it would break on rotation.
        ssl: needsSsl(url) ? { rejectUnauthorized: false } : false,
      });
      // A pool that emits an unhandled 'error' takes the process down. A dropped
      // idle connection is normal against a managed database, and the next query
      // opens a new one.
      pool.on('error', (error) => console.error('[store] idle connection error:', error.message));
    }
    return pool;
  }

  // Runs once per process. The table is created if absent so that deploying is
  // one step rather than deploy-then-remember-to-run-a-migration.
  function initialize() {
    ready ??= (async () => {
      await connect().query(`
        CREATE TABLE IF NOT EXISTS ${TABLE} (
          id integer PRIMARY KEY,
          version bigint NOT NULL DEFAULT 0,
          doc jsonb NOT NULL,
          updated_at timestamptz NOT NULL DEFAULT now()
        )
      `);
      await connect().query(
        `INSERT INTO ${TABLE} (id, version, doc) VALUES ($1, 0, '{}'::jsonb)
         ON CONFLICT (id) DO NOTHING`,
        [ROW_ID]
      );
    })();
    return ready;
  }

  async function current() {
    await initialize();
    const { rows } = await connect().query(
      `SELECT version, doc FROM ${TABLE} WHERE id = $1`,
      [ROW_ID]
    );
    const row = rows[0];
    return { version: Number(row?.version ?? 0), db: withDefaults(row?.doc) };
  }

  // Read the current document, apply the callback, and write it back only if
  // nobody else has written since. Returns undefined on a version conflict so the
  // caller can decide whether to try again.
  async function attemptOnce(fn) {
    const { version, db } = await current();
    const result = await fn(db);

    const { rowCount } = await connect().query(
      `UPDATE ${TABLE} SET doc = $1, version = version + 1, updated_at = now()
       WHERE id = $2 AND version = $3`,
      [serialize(db), ROW_ID, version]
    );

    // A sentinel object rather than a bare undefined, because a callback is
    // perfectly entitled to return undefined itself.
    return rowCount === 1 ? { ok: true, result } : { ok: false, version };
  }

  async function mutateWithRetries(fn) {
    await initialize();
    let lastConflict = null;

    for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt++) {
      const outcome = await attemptOnce(fn);
      if (outcome.ok) return outcome.result;

      // Another instance committed between our read and our write. Their change is
      // in the document now, so re-running the callback applies ours on top of it.
      lastConflict = outcome.version;
      // Jittered, so two instances that collide don't line up and collide again.
      await sleep(10 * attempt + Math.floor(Math.random() * 20));
    }

    const error = new Error(
      `Could not save after ${MAX_ATTEMPTS} attempts — the document kept changing underneath ` +
        `(last version seen: ${lastConflict}). Try again.`
    );
    // 409, not 500: nothing is broken, this request simply lost every race.
    error.status = 409;
    throw error;
  }

  // Writes from this process go one at a time. Optimistic retries alone are not
  // enough: a dozen concurrent writers all re-read the instant they lose, collide
  // again, and the unlucky ones exhaust their attempts — measured with a real
  // database, not theorised. Queueing removes contention with ourselves, leaving
  // the version check for what it is actually needed for, which is other instances.
  let queue = Promise.resolve();

  return {
    kind: 'postgres',
    dataPath: null,

    // No caching between calls. On a serverless platform this process may have sat
    // idle for an hour while somebody else's request changed everything, and a
    // stale read here would be written back as fact by the next mutate.
    async read() {
      const { db } = await current();
      return db;
    },

    mutate(fn) {
      const run = () => mutateWithRetries(fn);
      // `then(run, run)` on both paths: a failed write must not poison the queue
      // for later writers. The failure still reaches this caller, through the
      // promise this returns.
      const result = queue.then(run, run);
      queue = result.then(ignore, ignore);
      return result;
    },

    describe() {
      return `Postgres (${redact(url)})`;
    },

    async close() {
      // Let a write that is already in flight finish before the pool goes away.
      await queue;
      await pool?.end();
      pool = null;
      ready = null;
    },
  };
}

const ignore = () => {};
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

// jsonb cannot hold a NUL in a string — it rejects the whole statement with
// "unsupported Unicode escape sequence". Someone pasting text out of a PDF or a
// hex editor can produce one, and the consequence would be that every subsequent
// save of that canvas fails: the document becomes unwritable, so the canvas
// becomes uneditable, with an error that says nothing about a stray byte.
//
// Dropping it costs nothing — a NUL renders as nothing and means nothing in notes.
function serialize(db) {
  const json = JSON.stringify(db);
  return json.includes('\\u0000') ? json.replaceAll('\\u0000', '') : json;
}

// Local Postgres normally has no TLS at all, and asking for it fails the
// connection outright; anything remote must have it.
function needsSsl(url) {
  if (process.env.PGSSLMODE === 'disable') return false;
  try {
    const { hostname, searchParams } = new URL(url);
    if (searchParams.get('sslmode') === 'disable') return false;
    return hostname !== 'localhost' && hostname !== '127.0.0.1';
  } catch {
    return true;
  }
}

// A connection string carries a password. This string ends up in startup logs.
export function redact(url) {
  try {
    const parsed = new URL(url);
    return `${parsed.protocol}//${parsed.username ? '***@' : ''}${parsed.host}${parsed.pathname}`;
  } catch {
    return 'invalid connection string';
  }
}
