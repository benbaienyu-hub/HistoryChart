// @vitest-environment node
// Server-side code: the OpenAI SDK refuses to construct under jsdom, which it
// treats as a browser and therefore a credential-exposure risk.
import { createServer } from 'node:http';
import { mkdirSync, writeFileSync } from 'node:fs';
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  configProblem,
  generateKnowledge,
  isFormatUnsupported,
  parseKnowledgeJson,
  readBaseUrl,
  setEnvFileForTests,
} from '../server/knowledgeRoutes.js';
import { inspectKey } from '../scripts/keyDiagnostics.js';

// OPENAI_BASE_URL exists so the app can be pointed at any OpenAI-compatible
// provider — one with a free tier, or a local Ollama — when OpenAI credit runs
// out. These tests stand up a stub that speaks the chat-completions wire format
// and prove the route really calls it, rather than trusting that the option is
// wired up.
let server;
let baseUrl;
const received = [];
// Which response_format types the stub refuses, and what content it returns.
let rejectFormats = new Set();
let stubContent = null;

beforeAll(async () => {
  server = createServer((req, res) => {
    let raw = '';
    req.on('data', (c) => (raw += c));
    req.on('end', () => {
      const body = JSON.parse(raw || '{}');
      received.push({ url: req.url, auth: req.headers.authorization, body });

      res.setHeader('content-type', 'application/json');

      // Groq's exact shape for an unsupported format.
      const type = body.response_format?.type ?? 'none';
      if (rejectFormats.has(type)) {
        res.statusCode = 400;
        res.end(
          JSON.stringify({
            error: {
              message: `This model does not support response format \`${type}\`.`,
              type: 'invalid_request_error',
            },
          })
        );
        return;
      }

      if (stubContent !== null) {
        res.end(JSON.stringify({ choices: [{ message: { content: stubContent } }] }));
        return;
      }

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
  rejectFormats = new Set();
  stubContent = null;
  vi.stubEnv('OPENAI_MOCK', '');
  // Hermetic: ignore any .env on disk, so these assert process.env behaviour.
  setEnvFileForTests(null);
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
  // A custom provider requires an explicit model — see the guard tested below —
  // so every case here sets one.
  beforeEach(() => {
    vi.stubEnv('OPENAI_MODEL', 'stub-model');
  });

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

describe('a custom provider with no model set', () => {
  // The failure this prevents: OPENAI_BASE_URL pointed at Ollama, OPENAI_MODEL
  // unset, so the app fell back to "gpt-4o" and reported that the model was not
  // available to the key — which sounds like a credentials problem and is not.
  beforeEach(() => {
    vi.stubEnv('OPENAI_BASE_URL', baseUrl);
    vi.stubEnv('OPENAI_MODEL', '');
  });

  it('refuses before spending a request', async () => {
    await expect(generateKnowledge({ topic: 'Ethiopia' })).rejects.toMatchObject({ code: 'CONFIG' });
    expect(received).toHaveLength(0);
  });

  it('names the problem, the provider, and the command that fixes it', async () => {
    const message = await generateKnowledge({ topic: 'Ethiopia' }).catch((e) => e.message);
    expect(message).toContain('OPENAI_MODEL');
    expect(message).toContain(baseUrl);
    expect(message).toContain('check-key');
    // Must not demand a restart: the file is re-read on each request now, and
    // telling the user otherwise is what sent them round this loop twice.
    expect(message).not.toMatch(/restart the dev server/i);
  });

  it('stops complaining once a model is set', async () => {
    vi.stubEnv('OPENAI_MODEL', 'llama3.1:8b');
    await expect(generateKnowledge({ topic: 'Ethiopia' })).resolves.toBeTruthy();
    expect(received[0].body.model).toBe('llama3.1:8b');
  });

  it('says nothing when no custom provider is configured', () => {
    // OpenAI's own default is a sensible one, so this must not fire for it.
    vi.stubEnv('OPENAI_BASE_URL', '');
    expect(configProblem()).toBeNull();
  });

  it('offline mode is unaffected — it needs no model at all', async () => {
    vi.stubEnv('OPENAI_MOCK', '1');
    await expect(generateKnowledge({ topic: 'Ethiopia' })).resolves.toBeTruthy();
    expect(received).toHaveLength(0);
  });
});

describe('reading settings from .env without a restart', () => {
  // Vite copies .env into process.env once, at startup. Editing the file while
  // the dev server ran therefore changed nothing, and the error said
  // "OPENAI_MODEL is not set" while the file plainly set it.
  const fixture = new URL('./fixtures/env-fallback', import.meta.url);

  beforeAll(() => {
    mkdirSync(new URL('./fixtures/', import.meta.url), { recursive: true });
    writeFileSync(
      fixture,
      'OPENAI_BASE_URL=https://api.groq.com/openai/v1\nOPENAI_MODEL=llama-3.3-70b-versatile\nOPENAI_API_KEY=gsk_from_the_file\n'
    );
  });

  beforeEach(() => {
    setEnvFileForTests(fixture);
    vi.stubEnv('OPENAI_BASE_URL', '');
    vi.stubEnv('OPENAI_MODEL', '');
    vi.stubEnv('OPENAI_API_KEY', '');
  });

  it('picks up values the process never had', () => {
    expect(readBaseUrl()).toBe('https://api.groq.com/openai/v1');
    expect(configProblem()).toBeNull();
  });

  it('a real environment variable still wins, which is Vite’s precedence', () => {
    vi.stubEnv('OPENAI_BASE_URL', 'http://localhost:11434/v1');
    expect(readBaseUrl()).toBe('http://localhost:11434/v1');
  });

  it('a missing file is not an error', () => {
    setEnvFileForTests(new URL('./fixtures/does-not-exist', import.meta.url));
    expect(readBaseUrl()).toBeNull();
    expect(configProblem()).toBeNull();
  });
});

describe('a model that does not support json_schema', () => {
  // Groq's llama-3.3 answers a json_schema request with
  // "This model does not support response format `json_schema`" and a 400.
  // Requiring the user to find a compatible model is a bad answer, so the route
  // steps down to a plainer request instead.
  beforeEach(() => {
    vi.stubEnv('OPENAI_BASE_URL', baseUrl);
    vi.stubEnv('OPENAI_MODEL', `no-schema-${Math.round(performance.now() * 1000)}`);
  });

  it('falls back to json_object and still returns a usable result', async () => {
    rejectFormats = new Set(['json_schema']);
    const result = await generateKnowledge({ topic: 'Ethiopia' });

    expect(received.map((r) => r.body.response_format?.type)).toEqual([
      'json_schema',
      'json_object',
    ]);
    expect(result.summary).toBe('From the stub provider.');
  });

  it('spells the required shape out once the schema is gone', async () => {
    rejectFormats = new Set(['json_schema']);
    await generateKnowledge({ topic: 'Ethiopia' });
    const retryPrompt = received[1].body.messages.at(-1).content;
    expect(retryPrompt).toContain('"subtopics"');
    expect(retryPrompt).toMatch(/JSON and nothing else/i);
  });

  it('falls all the way to no response_format when json_object is refused too', async () => {
    rejectFormats = new Set(['json_schema', 'json_object']);
    const result = await generateKnowledge({ topic: 'Ethiopia' });
    expect(received.map((r) => r.body.response_format?.type ?? 'none')).toEqual([
      'json_schema',
      'json_object',
      'none',
    ]);
    expect(result.summary).toBe('From the stub provider.');
  });

  it('remembers, so the wasted request happens once per model', async () => {
    rejectFormats = new Set(['json_schema']);
    await generateKnowledge({ topic: 'Ethiopia' });
    expect(received).toHaveLength(2);

    received.length = 0;
    await generateKnowledge({ topic: 'Carthage' });
    expect(received.map((r) => r.body.response_format?.type)).toEqual(['json_object']);
  });

  it('extracts JSON from a fenced code block, which a plain reply often uses', async () => {
    rejectFormats = new Set(['json_schema', 'json_object']);
    stubContent =
      '```json\n{"summary":"Fenced.","correction":"","subtopics":[{"label":"A","detail":"B"}]}\n```';
    const result = await generateKnowledge({ topic: 'Ethiopia' });
    expect(result.summary).toBe('Fenced.');
    expect(result.subtopics).toEqual([{ label: 'A', detail: 'B' }]);
  });

  it('does not walk the ladder for a failure that is not about the format', async () => {
    // The provider accepted json_schema but answered with prose. That is a
    // content problem, not a format-support problem: retrying a plainer request
    // would waste two more calls and still fail.
    rejectFormats = new Set();
    stubContent = 'I am afraid I cannot do that.';
    const error = await generateKnowledge({ topic: 'Ethiopia' }).catch((e) => e);
    expect(error.message).toMatch(/did not return JSON/i);
    expect(received).toHaveLength(1);
  });
});

describe('parseKnowledgeJson', () => {
  it('reads plain JSON', () => {
    expect(parseKnowledgeJson('{"summary":"x"}')).toEqual({ summary: 'x' });
  });

  it('strips a ```json fence', () => {
    expect(parseKnowledgeJson('```json\n{"summary":"x"}\n```')).toEqual({ summary: 'x' });
  });

  it('strips a bare ``` fence', () => {
    expect(parseKnowledgeJson('```\n{"summary":"x"}\n```')).toEqual({ summary: 'x' });
  });

  it('finds the object inside surrounding prose', () => {
    expect(parseKnowledgeJson('Sure! {"summary":"x"} Hope that helps.')).toEqual({ summary: 'x' });
  });

  it('throws a readable error when there is no JSON at all', () => {
    expect(() => parseKnowledgeJson('I cannot do that.')).toThrow(/did not return JSON/i);
    expect(() => parseKnowledgeJson('')).toThrow(/did not return JSON/i);
    expect(() => parseKnowledgeJson(null)).toThrow(/did not return JSON/i);
  });
});

describe('isFormatUnsupported', () => {
  it('recognises the provider saying the format is not supported', () => {
    expect(
      isFormatUnsupported({
        status: 400,
        message: 'This model does not support response format `json_schema`.',
      })
    ).toBe(true);
  });

  it('ignores other 400s, which must not trigger a retry', () => {
    expect(isFormatUnsupported({ status: 400, message: 'A "topic" is required' })).toBe(false);
  });

  it('ignores non-400 failures entirely', () => {
    expect(isFormatUnsupported({ status: 401, message: 'response_format' })).toBe(false);
    expect(isFormatUnsupported(undefined)).toBe(false);
  });
});
