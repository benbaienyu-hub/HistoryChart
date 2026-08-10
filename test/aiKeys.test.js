// @vitest-environment node
// Encryption and the filesystem, so not jsdom.
import { existsSync, mkdtempSync, readFileSync, rmSync, statSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import {
  baseUrlProblem,
  clearUserAiKey,
  describeUserAiKey,
  getUserAiCredentials,
  keyProblem,
  maskKey,
  setUserAiKey,
  updateUserAiSettings,
} from '../server/aiKeys.js';
import { open, resetSecretCacheForTests, seal } from '../server/secretBox.js';
import { readDb, setDataPathForTests } from '../server/store.js';

let dir;
const KEY = 'sk-proj-abcdefghijklmnopqrstuvwxyz0123456789ABCD';

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'lacuna-keys-'));
  setDataPathForTests(join(dir, 'db.json'));
  resetSecretCacheForTests();
  delete process.env.LACUNA_SECRET;
});

afterEach(() => {
  rmSync(dir, { recursive: true, force: true });
  delete process.env.LACUNA_SECRET;
});

describe('secretBox', () => {
  it('round-trips a value', async () => {
    expect(open(seal(KEY))).toBe(KEY);
  });

  it('produces different ciphertext each time, so equal keys are not obvious', async () => {
    // Without a fresh nonce, two accounts using the same key would have identical
    // rows — which tells a reader of the file something it shouldn't.
    const a = seal(KEY);
    const b = seal(KEY);
    expect(a.data).not.toBe(b.data);
    expect(open(a)).toBe(open(b));
  });

  it('does not contain the plaintext anywhere in the envelope', async () => {
    expect(JSON.stringify(seal(KEY))).not.toContain('abcdefghijklmnop');
  });

  it('refuses a tampered ciphertext rather than returning garbage', async () => {
    const box = seal(KEY);
    const bytes = Buffer.from(box.data, 'base64');
    bytes[0] ^= 0xff;
    expect(open({ ...box, data: bytes.toString('base64') })).toBeNull();
  });

  it('returns null for a box it cannot understand', async () => {
    expect(open(null)).toBeNull();
    expect(open({})).toBeNull();
    expect(open({ v: 99, iv: 'x', tag: 'y', data: 'z' })).toBeNull();
  });

  it('keeps the key file to the owner only', async () => {
    seal('anything');
    const path = join(dir, 'secret.key');
    expect(existsSync(path)).toBe(true);
    // 0600: the file is the difference between an encrypted database and a
    // decorated one.
    expect(statSync(path).mode & 0o777).toBe(0o600);
  });

  it('cannot open a row sealed under a different key', async () => {
    const box = seal(KEY);
    rmSync(join(dir, 'secret.key'));
    resetSecretCacheForTests();
    expect(open(box)).toBeNull();
  });

  it('prefers LACUNA_SECRET over the key file when set', async () => {
    process.env.LACUNA_SECRET = 'a hosted deployment secret';
    const box = seal(KEY);
    // No key file is written when the environment supplies the secret.
    expect(existsSync(join(dir, 'secret.key'))).toBe(false);
    expect(open(box)).toBe(KEY);

    process.env.LACUNA_SECRET = 'a different secret';
    expect(open(box)).toBeNull();
  });
});

describe('storing a key for an account', () => {
  it('keeps the key out of the database file', async () => {
    await setUserAiKey('user-1', { apiKey: KEY });
    const onDisk = readFileSync(join(dir, 'db.json'), 'utf8');
    expect(onDisk).not.toContain(KEY);
    expect(onDisk).not.toContain('abcdefghijklmnop');
  });

  it('gives it back to the one caller that needs it', async () => {
    await setUserAiKey('user-1', { apiKey: KEY, baseUrl: 'https://api.groq.com/openai/v1', model: 'llama' });
    expect(await getUserAiCredentials('user-1')).toEqual({
      apiKey: KEY,
      baseUrl: 'https://api.groq.com/openai/v1',
      model: 'llama',
    });
  });

  it('describes it without revealing it', async () => {
    await setUserAiKey('user-1', { apiKey: KEY });
    const described = await describeUserAiKey('user-1');
    expect(described.configured).toBe(true);
    expect(described.preview).toBe('sk-…ABCD');
    expect(JSON.stringify(described)).not.toContain(KEY);
  });

  it('reports an account with no key of its own', async () => {
    expect(await describeUserAiKey('nobody')).toMatchObject({ configured: false, preview: null });
    expect(await getUserAiCredentials('nobody')).toBeNull();
  });

  it('keeps one row per account', async () => {
    await setUserAiKey('user-1', { apiKey: KEY });
    await setUserAiKey('user-1', { apiKey: `${KEY}-second` });
    expect((await readDb()).aiKeys).toHaveLength(1);
    expect((await getUserAiCredentials('user-1')).apiKey).toBe(`${KEY}-second`);
  });

  it('does not mix up two accounts', async () => {
    await setUserAiKey('user-1', { apiKey: 'sk-one-one-one-one-one' });
    await setUserAiKey('user-2', { apiKey: 'sk-two-two-two-two-two' });
    expect((await getUserAiCredentials('user-1')).apiKey).toBe('sk-one-one-one-one-one');
    expect((await getUserAiCredentials('user-2')).apiKey).toBe('sk-two-two-two-two-two');
  });

  it('changes the provider and model without being re-sent the key', async () => {
    // The browser was never given the key, so it cannot send it back — a partial
    // update has to be able to keep what is stored.
    await setUserAiKey('user-1', { apiKey: KEY, model: 'gpt-4o' });
    await updateUserAiSettings('user-1', { baseUrl: 'https://api.groq.com/openai/v1', model: 'llama' });
    expect(await getUserAiCredentials('user-1')).toEqual({
      apiKey: KEY,
      baseUrl: 'https://api.groq.com/openai/v1',
      model: 'llama',
    });
  });

  it('has nothing to update for an account with no key', async () => {
    expect(await updateUserAiSettings('nobody', { model: 'x' })).toBeNull();
  });

  it('forgets the key when asked', async () => {
    await setUserAiKey('user-1', { apiKey: KEY });
    await clearUserAiKey('user-1');
    expect(await getUserAiCredentials('user-1')).toBeNull();
    expect((await readDb()).aiKeys).toHaveLength(0);
  });

  it('says so when the row cannot be decrypted, rather than claiming a working key', async () => {
    // What a database restored without its secret.key looks like.
    await setUserAiKey('user-1', { apiKey: KEY });
    rmSync(join(dir, 'secret.key'));
    resetSecretCacheForTests();
    expect(await describeUserAiKey('user-1')).toMatchObject({ configured: true, unreadable: true });
    expect(await getUserAiCredentials('user-1')).toBeNull();
  });

  it('normalizes a trailing slash off the provider URL', async () => {
    await setUserAiKey('user-1', { apiKey: KEY, baseUrl: 'https://api.groq.com/openai/v1//' });
    expect((await getUserAiCredentials('user-1')).baseUrl).toBe('https://api.groq.com/openai/v1');
  });

  it('treats blank provider and model as unset rather than empty strings', async () => {
    await setUserAiKey('user-1', { apiKey: KEY, baseUrl: '   ', model: '  ' });
    expect(await getUserAiCredentials('user-1')).toEqual({ apiKey: KEY, baseUrl: null, model: null });
  });
});

describe('what we refuse to store', () => {
  it('names the problem with a key that cannot be right', async () => {
    expect(keyProblem('')).toMatch(/Paste/);
    expect(keyProblem(undefined)).toMatch(/Paste/);
    expect(keyProblem('sk-abc def')).toMatch(/space/);
    expect(keyProblem('sk-abc...xyz')).toMatch(/placeholder/);
    expect(keyProblem('x'.repeat(500))).toMatch(/too long/);
    expect(keyProblem(KEY)).toBeNull();
  });

  it('accepts an https provider, and localhost for a local model', async () => {
    expect(baseUrlProblem('')).toBeNull();
    expect(baseUrlProblem('https://api.groq.com/openai/v1')).toBeNull();
    expect(baseUrlProblem('http://localhost:11434/v1')).toBeNull();
    expect(baseUrlProblem('http://127.0.0.1:11434/v1')).toBeNull();
  });

  it('refuses plain http to somewhere else, which would put the key on the wire', async () => {
    expect(baseUrlProblem('http://example.com/v1')).toMatch(/https/);
    expect(baseUrlProblem('not a url')).toMatch(/valid URL/);
  });
});

describe('maskKey', () => {
  it('shows enough to recognise and not enough to use', async () => {
    expect(maskKey(KEY)).toBe('sk-…ABCD');
    expect(maskKey(KEY)).not.toContain('abcdefgh');
  });

  it('does not reveal a short value by trying to mask it', async () => {
    expect(maskKey('short')).toBe('••••');
    expect(maskKey('')).toBe('••••');
  });
});
