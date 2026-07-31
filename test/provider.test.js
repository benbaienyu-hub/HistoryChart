// @vitest-environment node
// Server-side code: the OpenAI SDK refuses to construct under jsdom, which it
// treats as a browser and therefore a credential-exposure risk.
import { createServer } from 'node:http';
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { generateKnowledge, readBaseUrl } from '../server/knowledgeRoutes.js';
import { inspectKey } from '../scripts/keyDiagnostics.js';

// OPENAI_BASE_URL exists so the app can be pointed at any OpenAI-compatible
// provider — one with a free tier, or a local Ollama — when OpenAI credit runs
// out. These tests stand up a stub that speaks the chat-completions wire format
// and prove the route really calls it, rather than trusting that the option is
// wired up.
let server;
let baseUrl;
const received = [];

beforeAll(async () => {
  server = createServer((req, res) => {
    let raw = '';
    req.on('data', (c) => (raw += c));
    req.on('end', () => {
      received.push({
        url: req.url,
        auth: req.headers.authorization,
        body: JSON.parse(raw || '{}'),
      });
      res.setHeader('content-type', 'application/json');
      res.end(
        JSON.stringify({
          choices: [
            {
              message: {
                content: JSON.stringify({
                  summary: 'From the stub provider.',
                  correction: '',
                  subtopics: [{ label: 'Stub topic', detail: 'A detail from the stub.' }],
                }),
              },
            },
          ],
        })
      );
    });
  });
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  baseUrl = `http://127.0.0.1:${server.address().port}/v1`;
});

afterAll(() => new Promise((resolve) => server.close(resolve)));

beforeEach(() => {
  received.length = 0;
  vi.stubEnv('OPENAI_MOCK', '');
  vi.stubEnv('OPENAI_MODEL', '');
  vi.stubEnv('OPENAI_API_KEY', 'stub-key-not-a-real-one');
  vi.stubEnv('OPENAI_BASE_URL', '');
});

describe('readBaseUrl', () => {
  it('is null when unset, so OpenAI stays the default', () => {
    expect(readBaseUrl()).toBeNull();
    vi.stubEnv('OPENAI_BASE_URL', '   ');
    expect(readBaseUrl()).toBeNull();
  });

  it('strips trailing slashes, which would otherwise double up in the path', () => {
    vi.stubEnv('OPENAI_BASE_URL', 'https://api.groq.com/openai/v1///');
    expect(readBaseUrl()).toBe('https://api.groq.com/openai/v1');
  });
});

describe('a custom provider', () => {
  it('receives the request instead of OpenAI', async () => {
    vi.stubEnv('OPENAI_BASE_URL', baseUrl);
    const result = await generateKnowledge({ topic: 'Ethiopia', level: 'concise' });

    expect(received).toHaveLength(1);
    expect(received[0].url).toBe('/v1/chat/completions');
    expect(result.summary).toBe('From the stub provider.');
    expect(result.subtopics).toEqual([{ label: 'Stub topic', detail: 'A detail from the stub.' }]);
  });

  it('sends the key as a bearer token', async () => {
    vi.stubEnv('OPENAI_BASE_URL', baseUrl);
    await generateKnowledge({ topic: 'Ethiopia' });
    expect(received[0].auth).toBe('Bearer stub-key-not-a-real-one');
  });

  it('still asks for a JSON schema, which the provider must support', async () => {
    vi.stubEnv('OPENAI_BASE_URL', baseUrl);
    await generateKnowledge({ topic: 'Ethiopia' });
    expect(received[0].body.response_format.type).toBe('json_schema');
  });

  it('honours OPENAI_MODEL, since provider model names differ', async () => {
    vi.stubEnv('OPENAI_BASE_URL', baseUrl);
    vi.stubEnv('OPENAI_MODEL', 'llama-3.3-70b-versatile');
    await generateKnowledge({ topic: 'Ethiopia' });
    expect(received[0].body.model).toBe('llama-3.3-70b-versatile');
  });

  it('carries the level and context through unchanged', async () => {
    vi.stubEnv('OPENAI_BASE_URL', baseUrl);
    await generateKnowledge({ topic: 'Geography', level: 'simple', context: ['Ethiopia'] });
    const prompt = received[0].body.messages.at(-1).content;
    expect(prompt).toMatch(/APPLIES TO Ethiopia/);
    expect(prompt).toMatch(/first time/i);
  });

  it('offline mode still wins, so the stub is never called', async () => {
    vi.stubEnv('OPENAI_BASE_URL', baseUrl);
    vi.stubEnv('OPENAI_MOCK', '1');
    const result = await generateKnowledge({ topic: 'Ethiopia' });
    expect(received).toHaveLength(0);
    expect(result.summary).toContain('[offline sample]');
  });
});

describe('key shape checks against a custom provider', () => {
  it('does not complain that a Groq or Ollama key lacks the OpenAI shape', () => {
    // gsk_… and a bare "ollama" are both legitimate elsewhere.
    for (const key of ['gsk_' + 'a'.repeat(50), 'ollama']) {
      expect(inspectKey(key, { expectOpenAiKey: false }), key.slice(0, 6)).toEqual([]);
    }
  });

  it('still complains about them when the target really is OpenAI', () => {
    expect(inspectKey('ollama', { expectOpenAiKey: true }).length).toBeGreaterThan(0);
  });

  it('still catches genuine damage whichever provider is in use', () => {
    const problems = inspectKey('gsk_abc def', { expectOpenAiKey: false });
    expect(problems.some((p) => p.fatal)).toBe(true);
  });
});
