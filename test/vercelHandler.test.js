// @vitest-environment node
// The serverless entry point (api/index.js).
//
// It is a thin wrapper, but it is the only door into the app on a hosted
// deployment: if its path handling or its error handling is wrong, everything is
// wrong and nothing else in this suite would notice.
import { createServer } from 'node:http';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import handler from '../api/index.js';
import { resetThrottleForTests } from '../server/accounts.js';
import { setDataPathForTests } from '../server/store.js';
import { setEnvFileForTests } from '../server/aiConfig.js';

let server;
let base;
let dir;

beforeAll(async () => {
  server = createServer((req, res) => handler(req, res));
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  base = `http://127.0.0.1:${server.address().port}`;
});

afterAll(() => new Promise((resolve) => server.close(resolve)));

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'lacuna-vercel-'));
  setDataPathForTests(join(dir, 'db.json'));
  resetThrottleForTests();
  // Hermetic: no real key, no real provider, no live call.
  vi.stubEnv('OPENAI_API_KEY', '');
  vi.stubEnv('OPENAI_MOCK', '');
  setEnvFileForTests(null);
});

afterEach(() => {
  rmSync(dir, { recursive: true, force: true });
});

async function call(method, path, body, cookie) {
  const res = await fetch(`${base}${path}`, {
    method,
    headers: {
      ...(body === undefined ? {} : { 'content-type': 'application/json' }),
      ...(cookie ? { cookie } : {}),
    },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  return {
    status: res.status,
    json: await res.json().catch(() => ({})),
    cookie: (res.headers.getSetCookie?.() ?? [])[0]?.split(';')[0] ?? null,
  };
}

describe('the serverless handler', () => {
  it('serves the account API, cookie and all', async () => {
    const created = await call('POST', '/api/auth/register', {
      email: 'ben@example.com',
      password: 'longenough1',
    });
    expect(created.status).toBe(201);
    expect(created.cookie).toContain('lacuna_session=');
    expect(created.json.recoveryCode).toBeTruthy();

    const me = await call('GET', '/api/auth/me', undefined, created.cookie);
    expect(me.json.user.email).toBe('ben@example.com');
  });

  it('still refuses what the API refuses', async () => {
    const { status } = await call('GET', '/api/canvases');
    expect(status).toBe(401);
  });

  it('serves the knowledge status route, which is mounted outside the table', async () => {
    const { status, json } = await call('GET', '/api/knowledge-status');
    // 401 rather than 404: the route was reached and asked for a session, which is
    // what proves it is mounted. Both AI routes require one — an open route backed
    // by the server's key is a free model proxy for anyone who finds it.
    expect(status).toBe(401);
    expect(json.code).toBe('SIGN_IN');
  });

  it('answers the knowledge route rather than falling through', async () => {
    const { status, json } = await call('POST', '/api/knowledge', { topic: 'Rome' });
    expect(status).toBe(401);
    expect(json.code).toBe('SIGN_IN');
  });

  it('serves the AI routes once there is a session', async () => {
    const created = await call('POST', '/api/auth/register', {
      email: 'ben@example.com',
      password: 'longenough1',
    });
    const status = await call('GET', '/api/knowledge-status', undefined, created.cookie);
    expect(status.status).toBe(200);
    // No key configured in this test, so nothing is available — the point is that
    // the route answered.
    expect(status.json).toMatchObject({ configured: false });

    const knowledge = await call('POST', '/api/knowledge', { topic: 'Rome' }, created.cookie);
    expect(knowledge.status).toBe(503);
    expect(knowledge.json.code).toBe('NO_API_KEY');
  });

  it('answers JSON for an unknown API path, never HTML', async () => {
    // The client parses these as JSON; an HTML error page would surface as a
    // baffling parse error instead of a message.
    const { status, json } = await call('GET', '/api/nonsense');
    expect(status).toBe(404);
    expect(json.error).toMatch(/No API route/);
  });

  it('reports a wrong method on a real path as a 404 from the router', async () => {
    const { status, json } = await call('DELETE', '/api/auth/login');
    expect(status).toBe(404);
    expect(json.error).toMatch(/No API route/);
  });
});
