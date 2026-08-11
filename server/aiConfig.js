// Where the AI settings come from, and whose key pays for a request.
//
// Split out of knowledgeRoutes.js so that asking "does this account need its own
// key" costs an import of this file rather than an import of the OpenAI SDK — the
// account settings routes need the answer and have no business loading a model
// client to get it.

import { readFileSync } from 'node:fs';
import { parseEnv } from '../scripts/keyDiagnostics.js';
import { getUserAiCredentials } from './aiKeys.js';

// Overridable so you can change models without editing code. If this default
// has aged out and you get a "model not found" error, set OPENAI_MODEL in .env.
export const DEFAULT_MODEL = 'gpt-4o';

// Settings resolve from the real environment first, then from .env directly.
//
// Vite copies .env into process.env once, at startup (see vite.config.js), so
// editing .env while the dev server runs used to change nothing until a restart
// — and the resulting error said "OPENAI_MODEL is not set" while the file plainly
// set it. Reading the file as a fallback removes that trap. Precedence is
// unchanged: a real environment variable still wins, which is Vite's rule.
let envFilePath = new URL('../.env', import.meta.url);

// Test seam. The fallback reads a real file, which would otherwise make the test
// suite depend on whatever .env happens to be sitting on disk. Pass null to turn
// the fallback off entirely.
export function setEnvFileForTests(path) {
  envFilePath = path;
}

export function envValue(name) {
  const fromProcess = process.env[name]?.trim();
  if (fromProcess) return fromProcess;
  if (!envFilePath) return null;
  try {
    return parseEnv(readFileSync(envFilePath, 'utf8'))[name]?.trim() || null;
  } catch {
    // No .env, or unreadable. In production there may legitimately not be one.
    return null;
  }
}

export function readKey() {
  return envValue('OPENAI_API_KEY');
}

export function readModel() {
  return envValue('OPENAI_MODEL') ?? DEFAULT_MODEL;
}

// Point the app at any OpenAI-compatible provider. Several have free tiers, and
// a local Ollama needs no key at all, so this is the escape hatch when OpenAI
// credits run out. Unset means OpenAI itself, exactly as before.
//
// The provider must support JSON-schema structured outputs; the route relies on
// them so the client never has to parse prose. Support varies, so if a provider
// rejects the schema the route surfaces its error rather than guessing.
export function readBaseUrl() {
  return envValue('OPENAI_BASE_URL')?.replace(/\/+$/, '') || null;
}

// Offline mode: OPENAI_MOCK=1 makes every route answer with deterministic sample
// content and never contact OpenAI. It exists so the graph generator can be
// exercised end to end — in tests, in a browser, or in a live demo — without a
// key, a network, or a bill.
export function mockEnabled() {
  const value = envValue('OPENAI_MOCK')?.toLowerCase();
  return value === '1' || value === 'true';
}

export function hasApiKey() {
  return readKey() !== null;
}

// A model name is provider-specific. Defaulting to gpt-4o is right for OpenAI and
// nonsense for anything else, so when a custom provider is configured without a
// model we refuse to guess — otherwise the first request fails with "gpt-4o isn't
// available", which reads like a key problem and isn't.
//
// The advice differs by whose credential it is: the owner edits .env, a guest with
// their own key edits a form, and telling either one to do the other's job is
// worse than saying nothing.
export function credentialProblem(credentials) {
  if (!credentials?.baseUrl || credentials.model) return null;
  if (credentials.source === 'user') {
    return (
      `You set the provider URL ${credentials.baseUrl} but left the model name empty. ` +
      'A model name is specific to its provider, so there is no sensible default — ' +
      'put the one your provider lists (for Groq, "llama-3.3-70b-versatile") in the ' +
      'Model field in your account settings.'
    );
  }
  return (
    `OPENAI_BASE_URL is set to ${credentials.baseUrl} but OPENAI_MODEL is not set. ` +
    'A model name is specific to its provider, so there is no sensible default here. ' +
    'Run `npm run check-key` — it lists the models that provider offers — then put one ' +
    'in OPENAI_MODEL in .env. The file is re-read on each request, so that takes effect immediately.'
  );
}

export function configProblem() {
  return credentialProblem(serverCredentials({ evenWithoutKey: true }));
}

// --- whose key pays for the request ----------------------------------------
//
// The server's key belongs to whoever set the server up. Once a second person has
// an account, spending it on their requests is that person's cost and that
// person's rate limit — so an account can hold its own key, and the owner can
// require it.

export function requireOwnKey() {
  const value = envValue('LACUNA_REQUIRE_OWN_KEY')?.toLowerCase();
  return value === '1' || value === 'true';
}

// `evenWithoutKey` is for configProblem, which reports a misconfigured provider
// whether or not a key is present — the two are separate complaints.
export function serverCredentials({ evenWithoutKey = false } = {}) {
  const apiKey = readKey();
  if (!apiKey && !evenWithoutKey) return null;
  const baseUrl = readBaseUrl();
  return {
    apiKey,
    baseUrl,
    // Deliberately not readModel(): its gpt-4o default would hide the "custom
    // provider, no model" mistake that credentialProblem exists to catch.
    model: envValue('OPENAI_MODEL') ?? (baseUrl ? null : DEFAULT_MODEL),
    source: 'server',
  };
}

export async function credentialsForUser(user) {
  // No account, no credential — not even the server's. The routes require a
  // session before they get here, so this is the second lock rather than the first:
  // an anonymous request that reached a model call would be spending the server
  // owner's key for a stranger.
  if (!user) return { apiKey: null, source: 'none' };

  const own = await getUserAiCredentials(user.id);
  if (own) {
    return {
      apiKey: own.apiKey,
      baseUrl: own.baseUrl,
      model: own.model ?? (own.baseUrl ? null : DEFAULT_MODEL),
      source: 'user',
    };
  }
  // With own-key mode on, there is no fallback: the request fails and says so,
  // rather than quietly billing the owner.
  if (requireOwnKey()) return { apiKey: null, source: 'none', requiresOwnKey: true };
  return serverCredentials() ?? { apiKey: null, source: 'none' };
}
