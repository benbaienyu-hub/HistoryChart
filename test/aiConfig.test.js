// @vitest-environment node
// Which key pays for a request. The answer decides whether a second person on
// this server costs the owner money, so it is worth asserting rather than reading.
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  DEFAULT_MODEL,
  configProblem,
  credentialProblem,
  credentialsForUser,
  requireOwnKey,
  serverCredentials,
  setEnvFileForTests,
} from '../server/aiConfig.js';
import { setUserAiKey } from '../server/aiKeys.js';
import { resetSecretCacheForTests } from '../server/secretBox.js';
import { setDataPathForTests } from '../server/store.js';

const OWNER_KEY = 'sk-owner-key-aaaaaaaaaaaaaaaaaaaaaaaaaaaaaa';
const GUEST_KEY = 'sk-guest-key-bbbbbbbbbbbbbbbbbbbbbbbbbbbbbb';

let dir;
const guest = { id: 'guest-1', email: 'guest@example.com' };

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'lacuna-aiconfig-'));
  setDataPathForTests(join(dir, 'db.json'));
  resetSecretCacheForTests();
  // Hermetic: the sandbox may have a real key exported, and none of this should
  // depend on it or ever make a live call.
  vi.stubEnv('OPENAI_API_KEY', '');
  vi.stubEnv('OPENAI_MODEL', '');
  vi.stubEnv('OPENAI_BASE_URL', '');
  vi.stubEnv('LACUNA_REQUIRE_OWN_KEY', '');
  setEnvFileForTests(null);
});

afterEach(() => {
  rmSync(dir, { recursive: true, force: true });
});

describe('the server’s own credential', () => {
  it('is nothing at all when no key is configured', () => {
    expect(serverCredentials()).toBeNull();
  });

  it('defaults to OpenAI and the default model', () => {
    vi.stubEnv('OPENAI_API_KEY', OWNER_KEY);
    expect(serverCredentials()).toEqual({
      apiKey: OWNER_KEY,
      baseUrl: null,
      model: DEFAULT_MODEL,
      source: 'server',
    });
  });

  it('does not invent a model for a custom provider', () => {
    // The gpt-4o default is right for OpenAI and nonsense for anyone else, so a
    // custom provider with no model must surface as a problem, not a guess.
    vi.stubEnv('OPENAI_API_KEY', OWNER_KEY);
    vi.stubEnv('OPENAI_BASE_URL', 'https://api.groq.com/openai/v1');
    expect(serverCredentials().model).toBeNull();
    expect(configProblem()).toMatch(/OPENAI_MODEL/);
  });

  it('has no complaint once the model is named', () => {
    vi.stubEnv('OPENAI_API_KEY', OWNER_KEY);
    vi.stubEnv('OPENAI_BASE_URL', 'https://api.groq.com/openai/v1');
    vi.stubEnv('OPENAI_MODEL', 'llama-3.3-70b-versatile');
    expect(configProblem()).toBeNull();
  });
});

describe('whose key pays', () => {
  it('falls back to the server’s key for a signed-in person with none of their own', () => {
    vi.stubEnv('OPENAI_API_KEY', OWNER_KEY);
    expect(credentialsForUser(guest)).toMatchObject({ apiKey: OWNER_KEY, source: 'server' });
  });

  it('prefers the account’s own key when it has one', () => {
    vi.stubEnv('OPENAI_API_KEY', OWNER_KEY);
    setUserAiKey(guest.id, { apiKey: GUEST_KEY });
    expect(credentialsForUser(guest)).toMatchObject({ apiKey: GUEST_KEY, source: 'user' });
  });

  it('carries the account’s own provider and model', () => {
    setUserAiKey(guest.id, {
      apiKey: GUEST_KEY,
      baseUrl: 'https://api.groq.com/openai/v1',
      model: 'llama-3.3-70b-versatile',
    });
    expect(credentialsForUser(guest)).toEqual({
      apiKey: GUEST_KEY,
      baseUrl: 'https://api.groq.com/openai/v1',
      model: 'llama-3.3-70b-versatile',
      source: 'user',
    });
  });

  it('gives an account’s key the default model when it named no provider', () => {
    setUserAiKey(guest.id, { apiKey: GUEST_KEY });
    expect(credentialsForUser(guest).model).toBe(DEFAULT_MODEL);
  });

  it('leaves an account’s model unset when it named a provider, and says why', () => {
    setUserAiKey(guest.id, { apiKey: GUEST_KEY, baseUrl: 'https://api.groq.com/openai/v1' });
    const credentials = credentialsForUser(guest);
    expect(credentials.model).toBeNull();
    // And the advice points at the settings form, not at .env — a guest cannot
    // edit the owner's .env, so telling them to would be useless.
    expect(credentialProblem(credentials)).toMatch(/account settings/);
    expect(credentialProblem(credentials)).not.toMatch(/OPENAI_MODEL/);
  });

  it('has nothing for a visitor who is not signed in', () => {
    expect(credentialsForUser(null)).toMatchObject({ apiKey: null, source: 'none' });
  });

  it('gives a visitor the server key when one is configured', () => {
    // Not a security hole: every canvas route requires a session, and the
    // knowledge route is the one place where being anonymous is survivable.
    vi.stubEnv('OPENAI_API_KEY', OWNER_KEY);
    expect(credentialsForUser(null)).toMatchObject({ apiKey: OWNER_KEY, source: 'server' });
  });
});

describe('own-key mode', () => {
  it('is off unless asked for', () => {
    expect(requireOwnKey()).toBe(false);
    for (const value of ['1', 'true', 'TRUE']) {
      vi.stubEnv('LACUNA_REQUIRE_OWN_KEY', value);
      expect(requireOwnKey(), value).toBe(true);
    }
    for (const value of ['0', 'false', '']) {
      vi.stubEnv('LACUNA_REQUIRE_OWN_KEY', value);
      expect(requireOwnKey(), value).toBe(false);
    }
  });

  it('refuses to spend the owner’s key on someone else', () => {
    vi.stubEnv('OPENAI_API_KEY', OWNER_KEY);
    vi.stubEnv('LACUNA_REQUIRE_OWN_KEY', '1');
    expect(credentialsForUser(guest)).toEqual({
      apiKey: null,
      source: 'none',
      requiresOwnKey: true,
    });
  });

  it('still lets an account with its own key work', () => {
    vi.stubEnv('OPENAI_API_KEY', OWNER_KEY);
    vi.stubEnv('LACUNA_REQUIRE_OWN_KEY', '1');
    setUserAiKey(guest.id, { apiKey: GUEST_KEY });
    expect(credentialsForUser(guest)).toMatchObject({ apiKey: GUEST_KEY, source: 'user' });
  });
});
