// GET /api/health — is this deployment actually able to work?
//
// This exists because of a real failure. A deployment with no database configured
// looks healthy: the page loads, the API answers, "who am I" returns nobody. The
// first write is where it falls over, so the first symptom is a generic 500 on
// sign-in and the actual cause is a line in a log somewhere.
//
// So: one unauthenticated URL that answers the three questions that matter — where
// is data going, can it be written, and can stored secrets be read back — in words
// that name the fix. It reports no secrets, no connection strings, and nothing
// about who has an account.

import { describeStore, storeKind, storeWritable, visibleDatabaseVars } from './store.js';
import { fileStorage } from './fileStorage.js';
import { hasSecret, secretProblem } from './secretBox.js';
import { hasApiKey, mockEnabled, requireOwnKey } from './aiConfig.js';
import { send } from './http.js';

export async function handleHealth(req, res) {
  const problems = [];

  const writable = await storeWritable();
  if (!writable.ok) problems.push(writable.problem);

  const secret = secretProblem();
  if (secret) problems.push(secret);

  const images = fileStorage();
  if (images.kind === 'disk' && storeKind() !== 'file') {
    // Storing the document in a database but the pictures on a local disk is a
    // deployment half-done: it works until the instance is replaced.
    problems.push(
      'Images are being written to a local disk while the database is remote, so they will ' +
        'not survive a redeploy. Set BLOB_READ_WRITE_TOKEN, or point LACUNA_UPLOADS at a volume.'
    );
  }

  const ok = problems.length === 0;
  // 503 when it cannot work, so an uptime check notices without reading the body.
  return send(res, ok ? 200 : 503, {
    ok,
    // Deliberately just the kind, not describeStore(), which includes a host and
    // database name — this route needs no authentication and should stay boring.
    store: storeKind(),
    // Names only, never values. Empty here while you believe you configured a
    // database means the variable is not reaching this process — which is a
    // different problem from the database being wrong.
    databaseVars: visibleDatabaseVars(),
    images: images.kind,
    canWrite: writable.ok,
    secret: hasSecret(),
    ai: mockEnabled() ? 'offline sample data' : hasApiKey() ? 'shared key' : 'own keys only',
    requiresOwnKey: requireOwnKey(),
    problems,
  });
}

// The same answer, for a terminal rather than a browser. Used by `npm start` at
// boot so a broken deployment complains in the logs on the way up, instead of
// waiting for somebody to try signing in.
export async function reportHealth(log = console) {
  const writable = await storeWritable();
  log.log(`[lacuna] storing data in ${describeStore()}`);
  log.log(`[lacuna] storing images in ${fileStorage().describe()}`);
  if (!writable.ok) log.error(`[lacuna] CANNOT SAVE — ${writable.problem}`);
  const secret = secretProblem();
  if (secret) log.warn(`[lacuna] ${secret}`);
  return writable.ok;
}
