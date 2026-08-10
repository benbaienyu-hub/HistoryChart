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
import {
  postgresUrl,
  setDataPathForTests,
  storeWritable,
  visibleDatabaseVars,
} from '../server/store.js';
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
  // Blanked so this suite describes a machine with no database configured, whatever
  // the one running it has.
  for (const name of [
    'POSTGRES_URL',
    'DATABASE_URL',
    'POSTGRES_URL_NON_POOLING',
    'DATABASE_URL_UNPOOLED',
    'PGHOST',
    'PGUSER',
    'PGPASSWORD',
    'PGDATABASE',
    'PGPORT',
  ]) {
    vi.stubEnv(name, '');
  }
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

describe('finding a database in the environment', () => {
  // Every name a hosted Postgres arrives under. Getting this wrong is invisible:
  // the app just stores data in a file and everything looks fine until a write.
  it('accepts each recognised URL variable', async () => {
    for (const name of [
      'POSTGRES_URL',
      'DATABASE_URL',
      'POSTGRES_URL_NON_POOLING',
      'DATABASE_URL_UNPOOLED',
    ]) {
      vi.stubEnv(name, '');
    }
    expect(postgresUrl()).toBeNull();

    for (const name of [
      'POSTGRES_URL',
      'DATABASE_URL',
      'POSTGRES_URL_NON_POOLING',
      'DATABASE_URL_UNPOOLED',
    ]) {
      vi.stubEnv(name, `postgres://who@host/db-from-${name}`);
      expect(postgresUrl(), name).toBe(`postgres://who@host/db-from-${name}`);
      vi.stubEnv(name, '');
    }
  });

  it('prefers the pooled URL when several are set', async () => {
    vi.stubEnv('DATABASE_URL_UNPOOLED', 'postgres://who@host/direct');
    vi.stubEnv('POSTGRES_URL', 'postgres://who@host/pooled');
    expect(postgresUrl()).toBe('postgres://who@host/pooled');
  });

  it('builds a URL from the libqp variables when that is all there is', async () => {
    // Neon's Vercel integration sets these alongside the URLs; some setups have
    // only these, and ignoring them meant falling back to a file with a database
    // sitting right there.
    vi.stubEnv('PGHOST', 'ep-cool-name.eu-central-1.aws.neon.tech');
    vi.stubEnv('PGUSER', 'lacuna_owner');
    vi.stubEnv('PGPASSWORD', 'npg_secret');
    vi.stubEnv('PGDATABASE', 'neondb');
    expect(postgresUrl()).toBe(
      'postgres://lacuna_owner:npg_secret@ep-cool-name.eu-central-1.aws.neon.tech:5432/neondb'
    );
  });

  it('percent-encodes credentials, so a password with punctuation still parses', async () => {
    vi.stubEnv('PGHOST', 'host');
    vi.stubEnv('PGUSER', 'user@corp');
    vi.stubEnv('PGPASSWORD', 'p@ss/word?');
    vi.stubEnv('PGDATABASE', 'db');
    const url = postgresUrl();
    // The point: it round-trips through URL parsing as the values we put in.
    const parsed = new URL(url);
    expect(decodeURIComponent(parsed.username)).toBe('user@corp');
    expect(decodeURIComponent(parsed.password)).toBe('p@ss/word?');
    expect(parsed.hostname).toBe('host');
    expect(parsed.pathname).toBe('/db');
  });

  it('needs host, user and database before it will guess', async () => {
    vi.stubEnv('PGHOST', 'host');
    expect(postgresUrl()).toBeNull();
    vi.stubEnv('PGUSER', 'user');
    expect(postgresUrl()).toBeNull();
    vi.stubEnv('PGDATABASE', 'db');
    expect(postgresUrl()).toBe('postgres://user@host:5432/db');
  });

  it('reports which variables it can see, by name and never by value', async () => {
    vi.stubEnv('POSTGRES_URL', 'postgres://who:secret-password@host/db');
    vi.stubEnv('PGHOST', 'host');
    const visible = visibleDatabaseVars();
    expect(visible).toContain('POSTGRES_URL');
    expect(visible).toContain('PGHOST');
    expect(JSON.stringify(visible)).not.toContain('secret-password');
  });

  it('says so in the health report, which is how "I did configure it" gets settled', async () => {
    const { json } = await get('/api/health');
    expect(json.databaseVars).toEqual([]);
    vi.stubEnv('POSTGRES_URL', 'postgres://who:secret-password@host/db');
    const after = await get('/api/health');
    expect(after.json.databaseVars).toEqual(['POSTGRES_URL']);
    expect(JSON.stringify(after.json)).not.toContain('secret-password');
  });
});

describe('which build is answering', () => {
  // A production URL on the default branch and a preview URL on a feature branch
  // look identical from outside and can be many commits apart. Without this, "I
  // deployed the fix" and "this URL has the fix" cannot be told apart — which cost
  // a round trip of confusion once already.
  it('reports the branch, commit and environment when the platform provides them', async () => {
    vi.stubEnv('VERCEL_ENV', 'preview');
    vi.stubEnv('VERCEL_GIT_COMMIT_REF', 'claude/knowledge-canvas-blocks-j58i88');
    vi.stubEnv('VERCEL_GIT_COMMIT_SHA', 'ea844ec1234567890abcdef');
    const { json } = await get('/api/health');
    expect(json.deployment).toEqual({
      environment: 'preview',
      branch: 'claude/knowledge-canvas-blocks-j58i88',
      commit: 'ea844ec',
    });
  });

  it('says so plainly when running outside a platform', async () => {
    vi.stubEnv('VERCEL_ENV', '');
    vi.stubEnv('VERCEL_GIT_COMMIT_REF', '');
    vi.stubEnv('VERCEL_GIT_COMMIT_SHA', '');
    const { json } = await get('/api/health');
    expect(json.deployment).toEqual({ environment: 'self-hosted', branch: null, commit: null });
  });
});
