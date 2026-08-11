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
  it('is nothing at all when no key is configured', async () => {
    expect(serverCredentials()).toBeNull();
  });

  it('defaults to OpenAI and the default model', async () => {
    vi.stubEnv('OPENAI_API_KEY', OWNER_KEY);
    expect(serverCredentials()).toEqual({
      apiKey: OWNER_KEY,
      baseUrl: null,
      model: DEFAULT_MODEL,
      source: 'server',
    });
  });

  it('does not invent a model for a custom provider', async () => {
    // The gpt-4o default is right for OpenAI and nonsense for anyone else, so a
    // custom provider with no model must surface as a problem, not a guess.
    vi.stubEnv('OPENAI_API_KEY', OWNER_KEY);
    vi.stubEnv('OPENAI_BASE_URL', 'https://api.groq.com/openai/v1');
    expect(serverCredentials().model).toBeNull();
    expect(configProblem()).toMatch(/OPENAI_MODEL/);
  });

  it('has no complaint once the model is named', async () => {
    vi.stubEnv('OPENAI_API_KEY', OWNER_KEY);
    vi.stubEnv('OPENAI_BASE_URL', 'https://api.groq.com/openai/v1');
    vi.stubEnv('OPENAI_MODEL', 'llama-3.3-70b-versatile');
    expect(configProblem()).toBeNull();
  });
});

describe('whose key pays', () => {
  it('falls back to the server’s key for a signed-in person with none of their own', async () => {
    vi.stubEnv('OPENAI_API_KEY', OWNER_KEY);
    expect(await credentialsForUser(guest)).toMatchObject({ apiKey: OWNER_KEY, source: 'server' });
  });

  it('prefers the account’s own key when it has one', async () => {
    vi.stubEnv('OPENAI_API_KEY', OWNER_KEY);
    await setUserAiKey(guest.id, { apiKey: GUEST_KEY });
    expect(await credentialsForUser(guest)).toMatchObject({ apiKey: GUEST_KEY, source: 'user' });
  });

  it('carries the account’s own provider and model', async () => {
    await setUserAiKey(guest.id, {
      apiKey: GUEST_KEY,
      baseUrl: 'https://api.groq.com/openai/v1',
      model: 'llama-3.3-70b-versatile',
    });
    expect(await credentialsForUser(guest)).toEqual({
      apiKey: GUEST_KEY,
      baseUrl: 'https://api.groq.com/openai/v1',
      model: 'llama-3.3-70b-versatile',
      source: 'user',
    });
  });

  it('gives an account’s key the default model when it named no provider', async () => {
    await setUserAiKey(guest.id, { apiKey: GUEST_KEY });
    expect((await credentialsForUser(guest)).model).toBe(DEFAULT_MODEL);
  });

  it('leaves an account’s model unset when it named a provider, and says why', async () => {
    await setUserAiKey(guest.id, { apiKey: GUEST_KEY, baseUrl: 'https://api.groq.com/openai/v1' });
    const credentials = await credentialsForUser(guest);
    expect(credentials.model).toBeNull();
    // And the advice points at the settings form, not at .env — a guest cannot
    // edit the owner's .env, so telling them to would be useless.
    expect(credentialProblem(credentials)).toMatch(/account settings/);
    expect(credentialProblem(credentials)).not.toMatch(/OPENAI_MODEL/);
  });

  it('has nothing for a visitor who is not signed in', async () => {
    expect(await credentialsForUser(null)).toMatchObject({ apiKey: null, source: 'none' });
  });

  it('gives a visitor nothing, not even the server key', async () => {
    // This used to hand over the server's key, on the reasoning that being
    // anonymous was survivable here. On a deployment anyone can reach it is not:
    // that is a free model proxy billed to whoever set the server up. The routes
    // require a session now; this is the second lock behind that one.
    vi.stubEnv('OPENAI_API_KEY', OWNER_KEY);
    expect(await credentialsForUser(null)).toEqual({ apiKey: null, source: 'none' });
  });
});

describe('own-key mode', () => {
  it('is off unless asked for', async () => {
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

  it('refuses to spend the owner’s key on someone else', async () => {
    vi.stubEnv('OPENAI_API_KEY', OWNER_KEY);
    vi.stubEnv('LACUNA_REQUIRE_OWN_KEY', '1');
    expect(await credentialsForUser(guest)).toEqual({
      apiKey: null,
      source: 'none',
      requiresOwnKey: true,
    });
  });

  it('still lets an account with its own key work', async () => {
    vi.stubEnv('OPENAI_API_KEY', OWNER_KEY);
    vi.stubEnv('LACUNA_REQUIRE_OWN_KEY', '1');
    await setUserAiKey(guest.id, { apiKey: GUEST_KEY });
    expect(await credentialsForUser(guest)).toMatchObject({ apiKey: GUEST_KEY, source: 'user' });
  });
});
