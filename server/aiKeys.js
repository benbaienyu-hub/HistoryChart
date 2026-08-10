// Per-account AI credentials.
//
// Without this, every AI request on the server spends whoever set up the server's
// key — so a second person using the app is a running cost to the first, and a
// rate limit they share. With it, each account can hold its own key, provider and
// model, and the server's key is only a fallback (or nothing at all, if the owner
// sets LACUNA_REQUIRE_OWN_KEY).
//
// The key itself is encrypted (secretBox.js) and never sent back to the browser:
// the settings screen gets a masked preview, which is enough to answer "is the
// right key in there" without the API being able to hand the key out again.

import { mutate, readDb } from './store.js';
import { open, seal } from './secretBox.js';

const MAX_KEY_LENGTH = 400;
const MAX_MODEL_LENGTH = 120;

async function rows() {
  const db = await readDb();
  return db.aiKeys ?? [];
}

async function rowFor(userId) {
  return (await rows()).find((row) => row.userId === userId) ?? null;
}

// A base URL is the difference between "my OpenAI key" and "my free Groq key", so
// it has to be settable per account too. Validated rather than trusted: this
// string becomes the host the server makes an outbound request to.
export function baseUrlProblem(value) {
  const text = String(value ?? '').trim();
  if (!text) return null;
  let url;
  try {
    url = new URL(text);
  } catch {
    return 'That provider URL is not a valid URL. It should look like https://api.groq.com/openai/v1';
  }
  if (url.protocol !== 'https:' && url.hostname !== 'localhost' && url.hostname !== '127.0.0.1') {
    // http to a remote host would put the key on the wire in the clear. Local is
    // fine and is how Ollama runs.
    return 'Use an https:// URL, unless the provider is running on localhost.';
  }
  return null;
}

export function keyProblem(value) {
  const text = String(value ?? '').trim();
  if (!text) return 'Paste an API key.';
  if (text.length > MAX_KEY_LENGTH) return 'That does not look like an API key — it is too long.';
  if (/\s/.test(text)) return 'That key contains a space. Copy it again without the surrounding text.';
  if (text.includes('...')) return 'That still has the "..." placeholder in it.';
  return null;
}

function normalizeBaseUrl(value) {
  const text = String(value ?? '').trim().replace(/\/+$/, '');
  return text || null;
}

function normalizeModel(value) {
  const text = String(value ?? '').trim().slice(0, MAX_MODEL_LENGTH);
  return text || null;
}

// Enough of the key to recognise, not enough to use. Same shape as the previews
// providers show in their own dashboards.
export function maskKey(key) {
  const text = String(key ?? '');
  if (text.length <= 8) return '••••';
  return `${text.slice(0, 3)}…${text.slice(-4)}`;
}

export async function setUserAiKey(userId, { apiKey, baseUrl, model }) {
  const row = {
    userId,
    secret: seal(String(apiKey).trim()),
    preview: maskKey(String(apiKey).trim()),
    baseUrl: normalizeBaseUrl(baseUrl),
    model: normalizeModel(model),
    updatedAt: Date.now(),
  };
  await mutate((db) => {
    db.aiKeys = (db.aiKeys ?? []).filter((r) => r.userId !== userId);
    db.aiKeys.push(row);
  });
  return describeUserAiKey(userId);
}

// Changing the model or provider without re-pasting the key: the settings screen
// can't send the key back (it never had it), so a partial update has to be able to
// keep the stored one.
export async function updateUserAiSettings(userId, { baseUrl, model }) {
  if (!(await rowFor(userId))) return null;
  await mutate((db) => {
    // Located inside the callback, and checked: with the Postgres backend this
    // callback can be re-run against a freshly read document, in which the row
    // might no longer be there.
    const row = (db.aiKeys ?? []).find((r) => r.userId === userId);
    if (!row) return;
    row.baseUrl = normalizeBaseUrl(baseUrl);
    row.model = normalizeModel(model);
    row.updatedAt = Date.now();
  });
  return describeUserAiKey(userId);
}

export async function clearUserAiKey(userId) {
  await mutate((db) => {
    db.aiKeys = (db.aiKeys ?? []).filter((r) => r.userId !== userId);
  });
}

// The decrypted credential, for the one caller that needs it: the module that
// makes the model request. Null when the account has no key of its own, or when
// the row cannot be decrypted (a database restored without its secret.key).
export async function getUserAiCredentials(userId) {
  const row = await rowFor(userId);
  if (!row) return null;
  const apiKey = open(row.secret);
  if (!apiKey) return null;
  return { apiKey, baseUrl: row.baseUrl, model: row.model };
}

// What the settings screen is allowed to know.
export async function describeUserAiKey(userId) {
  const row = await rowFor(userId);
  if (!row) return { configured: false, preview: null, baseUrl: null, model: null, updatedAt: null };
  return {
    configured: true,
    // A row whose secret won't open is worse than no row, because the settings
    // screen would otherwise claim a working key. Say so instead.
    unreadable: open(row.secret) === null,
    preview: row.preview ?? '••••',
    baseUrl: row.baseUrl,
    model: row.model,
    updatedAt: row.updatedAt,
  };
}

export function deleteAiKeysForUser(userId) {
  return clearUserAiKey(userId);
}
