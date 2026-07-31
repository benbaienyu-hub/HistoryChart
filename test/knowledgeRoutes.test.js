// @vitest-environment node
// Server-side code: the OpenAI SDK refuses to construct under jsdom, which it
// treats as a browser and therefore a credential-exposure risk.
import { Readable } from 'node:stream';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import {
  buildPrompt,
  generateKnowledge,
  handleKnowledgeRequest,
  hasApiKey,
  isKnownLevel,
  mockEnabled,
  normalizeContext,
  normalizeMaxSubtopics,
} from '../server/knowledgeRoutes.js';
import { GRAPH_LEVELS } from '../src/lib/graphLevels.js';

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
  // must never depend on that, and must never make a real API call. Offline mode
  // is cleared too, so the no-key paths below are genuinely exercised.
  vi.stubEnv('OPENAI_API_KEY', '');
  vi.stubEnv('OPENAI_MODEL', '');
  vi.stubEnv('OPENAI_MOCK', '');
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

describe('offline mode', () => {
  it('is off unless explicitly enabled', () => {
    expect(mockEnabled()).toBe(false);
    for (const value of ['0', 'false', 'no', '']) {
      vi.stubEnv('OPENAI_MOCK', value);
      expect(mockEnabled(), value).toBe(false);
    }
  });

  it('accepts 1 and true, in any case, with stray whitespace', () => {
    for (const value of ['1', 'true', 'TRUE', '  1  ']) {
      vi.stubEnv('OPENAI_MOCK', value);
      expect(mockEnabled(), JSON.stringify(value)).toBe(true);
    }
  });

  it('answers without a key, and without contacting OpenAI', async () => {
    vi.stubEnv('OPENAI_MOCK', '1');
    // No key is set, so reaching the real client would throw NO_API_KEY.
    const result = await generateKnowledge({ topic: 'Rome', level: 'simple' });
    expect(result.summary).toContain('[offline sample]');
    expect(result.subtopics.length).toBeGreaterThan(0);
  });

  it('labels its output so it cannot be mistaken for real content', async () => {
    vi.stubEnv('OPENAI_MOCK', '1');
    const { summary } = await generateKnowledge({ topic: 'Rome' });
    expect(summary).toMatch(/^\[offline sample\]/);
    expect(summary).toContain('OPENAI_MOCK');
  });

  it('shapes sub-topics as { label, detail }', async () => {
    vi.stubEnv('OPENAI_MOCK', '1');
    const { subtopics } = await generateKnowledge({ topic: 'Rome' });
    expect(Object.keys(subtopics[0]).sort()).toEqual(['detail', 'label']);
  });

  it('returns enough sub-topics for the widest level', async () => {
    vi.stubEnv('OPENAI_MOCK', '1');
    const { subtopics } = await generateKnowledge({ topic: 'Rome' });
    const widest = Math.max(...GRAPH_LEVELS.map((l) => Math.max(l.maxBranches, l.maxLeaves)));
    expect(subtopics.length).toBeGreaterThanOrEqual(widest);
  });

  it('is deterministic for a topic but differs between topics', async () => {
    vi.stubEnv('OPENAI_MOCK', '1');
    const a = await generateKnowledge({ topic: 'Rome' });
    const b = await generateKnowledge({ topic: 'Rome' });
    const c = await generateKnowledge({ topic: 'Carthage' });
    expect(a.subtopics).toEqual(b.subtopics);
    expect(a.subtopics[0].label).not.toBe(c.subtopics[0].label);
  });

  it('does not repeat a branch label in its own children', async () => {
    // A child whose label equals its parent's would make the sample graph look
    // broken rather than merely fake.
    vi.stubEnv('OPENAI_MOCK', '1');
    const root = await generateKnowledge({ topic: 'Rome' });
    const branch = root.subtopics[0].label;
    const child = await generateKnowledge({ topic: branch });
    expect(child.subtopics.map((s) => s.label)).not.toContain(branch);
  });

  it('gives every sample sub-topic a detail line, so leaves are never blank', async () => {
    vi.stubEnv('OPENAI_MOCK', '1');
    const { subtopics } = await generateKnowledge({ topic: 'Rome' });
    for (const s of subtopics) {
      expect(s.label).toBeTruthy();
      expect(s.detail).toBeTruthy();
    }
  });

  it('leaves the user’s own notes alone', async () => {
    vi.stubEnv('OPENAI_MOCK', '1');
    const { summary } = await generateKnowledge({ topic: 'Rome', notes: 'Founded 753 BC.' });
    expect(summary).toBe('');
  });

  it('the route serves it with a 200 rather than the no-key 503', async () => {
    vi.stubEnv('OPENAI_MOCK', '1');
    const { status, json } = await call('POST', { topic: 'Rome', level: 'advanced' });
    expect(status).toBe(200);
    expect(json.summary).toContain('[offline sample]');
    expect(json.summary).toContain('advanced');
  });
});

describe('sub-topic ceiling', () => {
  it('states the cap in the prompt and calls it a ceiling, not a target', () => {
    const prompt = buildPrompt({ topic: 'Rome', level: 'concise', maxSubtopics: 3 });
    expect(prompt).toMatch(/AT MOST 3 sub-topics/);
    expect(prompt).toMatch(/ceiling, not a target/i);
    expect(prompt).toMatch(/Do not invent, split hairs, or pad/i);
  });

  it('never returns more than asked for', async () => {
    vi.stubEnv('OPENAI_MOCK', '1');
    for (const cap of [1, 2, 5]) {
      const { subtopics } = await generateKnowledge({ topic: 'Rome', maxSubtopics: cap });
      expect(subtopics.length, `cap ${cap}`).toBeLessThanOrEqual(cap);
    }
  });

  it('clamps a nonsensical cap rather than trusting it', () => {
    expect(normalizeMaxSubtopics(99)).toBe(8);
    expect(normalizeMaxSubtopics(0)).toBe(8);
    expect(normalizeMaxSubtopics(-3)).toBe(8);
    expect(normalizeMaxSubtopics(2.5)).toBe(8);
    expect(normalizeMaxSubtopics('4')).toBe(4);
    expect(normalizeMaxSubtopics(undefined)).toBe(8);
    expect(normalizeMaxSubtopics('nonsense')).toBe(8);
  });

  it('the route applies the cap it was sent', async () => {
    vi.stubEnv('OPENAI_MOCK', '1');
    const { json } = await call('POST', { topic: 'Rome', maxSubtopics: 2 });
    expect(json.subtopics).toHaveLength(2);
  });
});

describe('topic context', () => {
  // The bug this exists for: a branch labelled "Geography" under a graph about
  // Ethiopia came back as a dictionary definition of the word geography, because
  // only the label was sent.
  it('anchors the topic to the root subject', () => {
    const prompt = buildPrompt({ topic: 'Geography', level: 'detailed', context: ['Ethiopia'] });
    expect(prompt).toContain('Geography');
    expect(prompt).toContain('Ethiopia');
    expect(prompt).toMatch(/AS IT APPLIES TO Ethiopia/);
  });

  it('tells the model explicitly not to define the term', () => {
    const prompt = buildPrompt({ topic: 'Geography', level: 'detailed', context: ['Ethiopia'] });
    expect(prompt).toMatch(/Do not define the general concept/i);
  });

  it('extends the rule to the per-sub-topic details', () => {
    // The leaves are built from this response, so their details need anchoring too.
    const prompt = buildPrompt({ topic: 'Geography', level: 'detailed', context: ['Ethiopia'] });
    expect(prompt).toMatch(/every "detail".*specific fact about Ethiopia/is);
  });

  it('names the intermediate path when there is one', () => {
    const prompt = buildPrompt({
      topic: 'Rift Valley',
      level: 'detailed',
      context: ['Ethiopia', 'Geography'],
    });
    expect(prompt).toContain('under Geography');
    expect(prompt).toMatch(/APPLIES TO Ethiopia/);
  });

  it('says a root topic has nothing above it, rather than inventing a subject', () => {
    const prompt = buildPrompt({ topic: 'Ethiopia', level: 'detailed' });
    expect(prompt).toMatch(/top-level topic/i);
    expect(prompt).not.toMatch(/AS IT APPLIES TO/);
  });

  it('serves the request through the route with context applied', async () => {
    vi.stubEnv('OPENAI_MOCK', '1');
    const { status, json } = await call('POST', {
      topic: 'Geography',
      context: ['Ethiopia'],
    });
    expect(status).toBe(200);
    expect(json.summary).toContain('Ethiopia');
  });
});

describe('normalizeContext', () => {
  it('keeps a clean chain in order', () => {
    expect(normalizeContext(['Ethiopia', 'Geography'])).toEqual(['Ethiopia', 'Geography']);
  });

  it('trims, and drops blanks and non-strings', () => {
    expect(normalizeContext(['  Ethiopia  ', '', '   ', 42, null, undefined, 'Geography'])).toEqual([
      'Ethiopia',
      'Geography',
    ]);
  });

  it('returns an empty chain for anything that is not an array', () => {
    for (const bad of [undefined, null, 'Ethiopia', 42, {}]) {
      expect(normalizeContext(bad), String(bad)).toEqual([]);
    }
  });

  it('caps the chain, so a malformed client cannot pad the prompt', () => {
    expect(normalizeContext(Array.from({ length: 50 }, (_, i) => `a${i}`))).toHaveLength(6);
  });
});

describe('graph levels', () => {
  it('recognises exactly the levels the client can offer', () => {
    // If these two lists drift, a level in the menu silently gets the default
    // wording — the difficulty setting would look like it did nothing.
    for (const level of GRAPH_LEVELS) {
      expect(isKnownLevel(level.key), level.key).toBe(true);
    }
  });

  it('rejects anything that is not a level, including inherited property names', () => {
    for (const bad of ['', 'expert', 'SIMPLE', 'toString', 'constructor', undefined, null]) {
      expect(isKnownLevel(bad), String(bad)).toBe(false);
    }
  });

  it('gives each level different guidance in the prompt', () => {
    const prompts = GRAPH_LEVELS.map((l) => buildPrompt({ topic: 'Rome', level: l.key }));
    expect(new Set(prompts).size).toBe(GRAPH_LEVELS.length);
  });

  it('falls back to the detailed wording for an unknown level', () => {
    expect(buildPrompt({ topic: 'Rome', level: 'nonsense' })).toBe(
      buildPrompt({ topic: 'Rome', level: 'detailed' })
    );
  });

  it('pitches simple at a newcomer and advanced at someone with background', () => {
    expect(buildPrompt({ topic: 'Rome', level: 'simple' })).toMatch(/first time/i);
    expect(buildPrompt({ topic: 'Rome', level: 'advanced' })).toMatch(/already knows/i);
  });

  it('still includes the topic, the notes and the existing sub-topics', () => {
    const prompt = buildPrompt({
      topic: 'Rome',
      notes: 'Founded in 753 BC.',
      childLabels: ['Republic', 'Empire'],
      level: 'simple',
    });
    expect(prompt).toContain('Rome');
    expect(prompt).toContain('Founded in 753 BC.');
    expect(prompt).toContain('Republic, Empire');
  });

  it('says so plainly when there are no notes and no sub-topics', () => {
    const prompt = buildPrompt({ topic: 'Rome', level: 'detailed' });
    expect(prompt).toMatch(/not written any notes/i);
    expect(prompt).toMatch(/no sub-topics/i);
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
