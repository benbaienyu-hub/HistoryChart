// @vitest-environment node
// The health route, and the failure it was written for.
//
// A deployment with no database configured looks fine: the page loads, the API
// answers, "who am I" says nobody. Only the first write fails — so the first
// symptom is a generic 500 on sign-in, with the real cause in a log. These tests
// pin the behaviour that replaced that.
import { createServer } from 'node:http';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { handleApiRequest } from '../server/api.js';
import { setDataPathForTests, storeWritable } from '../server/store.js';
import { resetFileStorageForTests } from '../server/fileStorage.js';
import { resetSecretCacheForTests, hasSecret, secretProblem } from '../server/secretBox.js';
import { setEnvFileForTests } from '../server/aiConfig.js';

let server;
let base;
let dir;

beforeAll(async () => {
  server = createServer((req, res) => {
    handleApiRequest(req, res).then((handled) => {
      if (!handled) {
        res.statusCode = 404;
        res.end('not an api path');
      }
    });
  });
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  base = `http://127.0.0.1:${server.address().port}`;
});

afterAll(() => new Promise((resolve) => server.close(resolve)));

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'lacuna-health-'));
  setDataPathForTests(join(dir, 'db.json'));
  resetFileStorageForTests();
  resetSecretCacheForTests();
  vi.stubEnv('OPENAI_API_KEY', '');
  vi.stubEnv('OPENAI_MOCK', '');
  vi.stubEnv('LACUNA_SECRET', '');
  // Unset by default: some tests set it to take the hosted code path deliberately.
  vi.stubEnv('VERCEL', '');
  setEnvFileForTests(null);
});

afterEach(() => {
  rmSync(dir, { recursive: true, force: true });
});

function get(path) {
  return fetch(`${base}${path}`).then(async (res) => ({
    status: res.status,
    json: await res.json().catch(() => ({})),
  }));
}

describe('GET /api/health', () => {
  it('says everything is fine on a normal local setup', async () => {
    const { status, json } = await get('/api/health');
    expect(status).toBe(200);
    expect(json).toMatchObject({ ok: true, store: 'file', images: 'disk', canWrite: true });
    expect(json.problems).toEqual([]);
  });

  it('needs no session — the thing it diagnoses is nobody being able to sign in', async () => {
    // Asserted explicitly because putting this behind auth would make it useless
    // for exactly the deployment it exists to explain.
    const { status } = await get('/api/health');
    expect(status).toBe(200);
  });

  it('gives away no secrets, no connection string, and no account information', async () => {
    vi.stubEnv('LACUNA_SECRET', 'super-secret-value');
    resetSecretCacheForTests();
    const { json } = await get('/api/health');
    const body = JSON.stringify(json);
    expect(body).not.toContain('super-secret-value');
    expect(body).not.toContain('postgres://');
    expect(body).not.toContain('@');
    expect(json.secret).toBe('environment');
  });

  it('reports which AI arrangement is in force', async () => {
    expect((await get('/api/health')).json.ai).toBe('own keys only');
    vi.stubEnv('OPENAI_API_KEY', 'sk-something');
    expect((await get('/api/health')).json.ai).toBe('shared key');
    vi.stubEnv('OPENAI_MOCK', '1');
    expect((await get('/api/health')).json.ai).toBe('offline sample data');
  });
});

describe('when the data file cannot be written', () => {
  // What a serverless deployment with no database configured looks like: reads
  // work, writes fail.
  //
  // Not simulated with permissions, because this suite runs as root in CI and root
  // ignores them — a chmod 0555 directory stayed perfectly writable and the test
  // passed while proving nothing. Instead the data path is pointed *inside a
  // regular file*, which nothing can write into at any privilege level, and VERCEL
  // is set so the code takes the hosted branch it would take there.
  function makeUnwritable() {
    const notADirectory = join(dir, 'occupied');
    writeFileSync(notADirectory, 'this is a file, not a directory');
    setDataPathForTests(join(notADirectory, 'db.json'));
    vi.stubEnv('VERCEL', '1');
  }

  it('reports it as unhealthy, naming the fix', async () => {
    makeUnwritable();
    const { status, json } = await get('/api/health');
    expect(status).toBe(503);
    expect(json.ok).toBe(false);
    expect(json.canWrite).toBe(false);
    expect(json.problems.join(' ')).toMatch(/POSTGRES_URL/);
    expect(json.problems.join(' ')).toMatch(/redeploy/);
  });

  it('fails a sign-up with that explanation instead of a generic 500', async () => {
    // This is the bug being fixed: the write threw, the router had no status to go
    // on, and the person saw "Something went wrong on the server."
    makeUnwritable();
    const res = await fetch(`${base}/api/auth/register`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ email: 'ben@example.com', password: 'longenough1' }),
    });
    const json = await res.json();
    expect(res.status).toBe(503);
    expect(json.error).toMatch(/Cannot write/);
    expect(json.error).toMatch(/POSTGRES_URL/);
    expect(json.error).not.toMatch(/Something went wrong/);
  });

  it('still answers reads, which is why the failure was invisible', async () => {
    makeUnwritable();
    const me = await get('/api/auth/me');
    expect(me.status).toBe(200);
    expect(me.json.user).toBeNull();
  });

  it('reports writability honestly through the store interface', async () => {
    makeUnwritable();
    expect(await storeWritable()).toMatchObject({ ok: false });
  });
});

describe('the encryption secret', () => {
  it('is the key file when there is a data directory', () => {
    expect(hasSecret()).toBe('key file');
    expect(secretProblem()).toBeNull();
  });

  it('prefers the environment when set', () => {
    vi.stubEnv('LACUNA_SECRET', 'a-long-random-string');
    expect(hasSecret()).toBe('environment');
    expect(secretProblem()).toBeNull();
  });

  it('does not generate anything while being asked about', () => {
    // A diagnostic that changes what it is diagnosing is not a diagnostic.
    const before = hasSecret();
    secretProblem();
    expect(hasSecret()).toBe(before);
  });
});
