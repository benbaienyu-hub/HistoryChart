import { Readable } from 'node:stream';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { generateKnowledge, handleKnowledgeRequest, hasApiKey } from '../server/knowledgeRoutes.js';

// A minimal stand-in for the (req, res) pair the handler is written against, so
// the route can be exercised without a server.
function request(method, body) {
  const raw = typeof body === 'string' ? body : JSON.stringify(body);
  const req = Readable.from(raw === undefined ? [] : [raw]);
  req.method = method;
  return req;
}

function response() {
  const res = {
    statusCode: 200,
    headers: {},
    body: '',
    setHeader(name, value) {
      this.headers[name] = value;
    },
    end(chunk) {
      this.body = chunk ?? '';
      this.ended = true;
    },
  };
  return res;
}

async function call(method, body) {
  const res = response();
  await handleKnowledgeRequest(request(method, body), res);
  return { status: res.statusCode, json: res.body ? JSON.parse(res.body) : null, res };
}

beforeEach(() => {
  // The sandbox this runs in may legitimately have a key exported; these tests
  // must never depend on that, and must never make a real API call.
  vi.stubEnv('OPENAI_API_KEY', '');
  vi.stubEnv('OPENAI_MODEL', '');
});

describe('hasApiKey', () => {
  it('is false when the key is absent or blank', () => {
    expect(hasApiKey()).toBe(false);
    vi.stubEnv('OPENAI_API_KEY', '   ');
    expect(hasApiKey()).toBe(false);
  });

  it('is true once a key is set', () => {
    vi.stubEnv('OPENAI_API_KEY', 'sk-test');
    expect(hasApiKey()).toBe(true);
  });
});

describe('generateKnowledge', () => {
  it('throws a tagged NO_API_KEY error rather than calling out with no key', async () => {
    await expect(generateKnowledge({ topic: 'Rome' })).rejects.toMatchObject({
      code: 'NO_API_KEY',
    });
  });
});

describe('handleKnowledgeRequest', () => {
  it('rejects a non-POST with 405', async () => {
    const { status, json } = await call('GET');
    expect(status).toBe(405);
    expect(json.error).toMatch(/POST/);
  });

  it('rejects an unparseable body with 400', async () => {
    const { status, json } = await call('POST', '{not json');
    expect(status).toBe(400);
    expect(json.error).toMatch(/Invalid JSON/);
  });

  it('requires a topic', async () => {
    for (const body of [{}, { topic: '' }, { topic: '   ' }, { topic: 42 }]) {
      const { status, json } = await call('POST', body);
      expect(status, JSON.stringify(body)).toBe(400);
      expect(json.error).toMatch(/topic/);
    }
  });

  it('answers 503 with a NO_API_KEY code when no key is configured', async () => {
    // The client keys its placeholder fallback off exactly this response.
    const { status, json } = await call('POST', { topic: 'Rome' });
    expect(status).toBe(503);
    expect(json.code).toBe('NO_API_KEY');
  });

  it('always replies JSON', async () => {
    const { res } = await call('POST', { topic: 'Rome' });
    expect(res.headers['content-type']).toBe('application/json');
    expect(res.ended).toBe(true);
  });

  it('rejects an oversized body instead of buffering it', async () => {
    // Guards against a client (or a bad proxy) streaming megabytes at us.
    const res = response();
    const req = Readable.from(['x'.repeat(1_000_001)]);
    req.method = 'POST';
    await handleKnowledgeRequest(req, res);
    expect(res.statusCode).toBe(400);
  });
});
