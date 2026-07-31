import { readFileSync } from 'node:fs';
import OpenAI from 'openai';
import { parseEnv } from '../scripts/keyDiagnostics.js';

// Server-side only. The API key must never reach the browser, so every model
// call goes through this module — it is mounted into the Vite dev server (see
// vite.config.js) and is deliberately framework-agnostic so the same handler
// can back an Express route or a serverless function in production.

// Overridable so you can change models without editing code. If this default
// has aged out and you get a "model not found" error, set OPENAI_MODEL in .env.
const DEFAULT_MODEL = 'gpt-4o';

// Structured outputs guarantee the response parses, so the client never has to
// cope with prose where it expected JSON. `correction` is a plain string ('' for
// "nothing to correct") rather than a nullable — strict mode requires every
// property in `required`, so an "absent" field isn't available to us anyway.
const KNOWLEDGE_SCHEMA = {
  type: 'object',
  properties: {
    summary: {
      type: 'string',
      description:
        'Two sentences at most, explaining the topic plainly. Empty string if the user already wrote adequate notes.',
    },
    correction: {
      type: 'string',
      description:
        "A specific correction to the user's notes, naming what is wrong and what is actually true. Empty string if the notes contain no factual errors.",
    },
    // Each sub-topic carries its own one-line description. This is what lets the
    // third level of a generated graph arrive with content in it: the leaves are
    // built from their parent's response, so filling them costs no extra request.
    subtopics: {
      type: 'array',
      items: {
        type: 'object',
        properties: {
          label: {
            type: 'string',
            description: 'A short label, a few words at most. No trailing punctuation.',
          },
          detail: {
            type: 'string',
            description:
              'One sentence saying what this sub-topic is and why it matters to the parent topic. Specific, not a restatement of the label.',
          },
        },
        required: ['label', 'detail'],
        additionalProperties: false,
      },
      description:
        'Up to 8 sub-topics worth exploring next, most important first. Omit any the user already has.',
    },
  },
  required: ['summary', 'correction', 'subtopics'],
  additionalProperties: false,
};

// The three depths the "Make a graph" menu offers. The level changes how the
// model writes, not just how much the client draws — a Simple graph should be
// readable by someone new to the subject, an Advanced one should not waste words
// explaining the basics. Mirrors src/lib/graphLevels.js, which owns the
// client-side counts.
const LEVEL_GUIDANCE = {
  simple: `Write for someone meeting this subject for the first time. Keep "summary" to a single plain sentence, avoid jargon, and where a term is unavoidable, gloss it. For "subtopics", choose the few most fundamental parts of the subject, and keep each "detail" to one short, plain sentence.`,
  detailed: `Write for someone studying this subject seriously. Keep "summary" to at most two sentences, but make them carry specifics — names, dates, numbers. For "subtopics", cover the main branches of the subject, and make each "detail" a concrete sentence rather than a definition.`,
  advanced: `Write for someone who already knows the basics. Do not explain elementary terms. Keep "summary" to at most two dense sentences, and prefer precise, technical, specific content over general orientation. For "subtopics", include the less obvious branches a newcomer's overview would leave out, and make each "detail" carry a specific fact.`,
};

const DEFAULT_LEVEL = 'detailed';

export function isKnownLevel(level) {
  return Object.hasOwn(LEVEL_GUIDANCE, level);
}

// Offline mode: OPENAI_MOCK=1 makes every route answer with deterministic sample
// content and never contact OpenAI. It exists so the graph generator can be
// exercised end to end — in tests, in a browser, or in a live demo — without a
// key, a network, or a bill. Every summary it produces is prefixed so it can
// never be mistaken for real output.
export function mockEnabled() {
  const value = process.env.OPENAI_MOCK?.trim().toLowerCase();
  return value === '1' || value === 'true';
}

const MOCK_ASPECTS = [
  'origins',
  'key figures',
  'turning points',
  'consequences',
  'primary sources',
  'open debates',
  'timeline',
  'legacy',
];

// Deterministic, so the same topic always yields the same sample graph.
function seedFrom(text) {
  let h = 0;
  for (const ch of text) h = (h * 31 + ch.charCodeAt(0)) | 0;
  return Math.abs(h);
}

function mockKnowledge({ topic, notes, level, context }) {
  const subject = normalizeContext(context)[0];
  // Offset the aspect list by the topic, otherwise every level picks the same
  // first aspect and a branch's children repeat their parent's label.
  const offset = seedFrom(topic);
  return {
    summary: (notes ?? '').trim()
      ? ''
      : `[offline sample] A ${level} summary of ${topic}${
          subject ? ` as it applies to ${subject}` : ''
        } would go here. Set OPENAI_MOCK=0 for real output.`,
    correction: '',
    subtopics: MOCK_ASPECTS.map((_, i) => {
      const aspect = MOCK_ASPECTS[(offset + i) % MOCK_ASPECTS.length];
      return {
        label: `${topic} — ${aspect}`,
        detail: `[offline sample] One specific fact about the ${aspect} of ${
          subject ? `${topic}, within ${subject},` : topic
        } would go here.`,
      };
    }),
  };
}

const SYSTEM = `You help someone build a knowledge map. They give you a topic, whatever notes they have written, and the sub-topics already on their canvas.

Be accurate and specific. Prefer concrete names, dates, and numbers over hedged generalities.

A topic may be given with the subject it sits under. When it is, everything you write must be about the topic within that subject — never a general definition of the topic's name.

Only populate "correction" when the notes contain a genuine factual error — a wrong date, a wrong causal claim, a wrong attribution. Say what is wrong and what is actually the case. Incomplete notes are not an error; leave "correction" empty for those.

Only populate "summary" when the notes are empty or say almost nothing. If the user has already written a reasonable account, leave it empty — do not overwrite their words.

For "subtopics", suggest specific things worth a block of their own, not vague categories. Skip anything already on the canvas. Give each one a short label and a single sentence of substance — the sentence is shown to the user as the starting content of that block, so it must say something, not merely restate the label.`;

function readKey() {
  return process.env.OPENAI_API_KEY?.trim() || null;
}

function readModel() {
  return process.env.OPENAI_MODEL?.trim() || DEFAULT_MODEL;
}

export function hasApiKey() {
  return readKey() !== null;
}

// Does .env itself define a key? Used only to tell the user, on a 401, whether
// a shell variable is shadowing their file — the most confusing failure here.
function readEnvFileKey() {
  try {
    const text = readFileSync(new URL('../.env', import.meta.url), 'utf8');
    return parseEnv(text).OPENAI_API_KEY?.trim() || null;
  } catch {
    return null;
  }
}

// The faults worth naming in a 401 log. Deliberately does not include the key.
function describeKeyFaults(key) {
  const faults = [];
  if (key.includes('...')) faults.push('still contains the "..." placeholder');
  if (/\s/.test(key)) faults.push('contains whitespace');
  if (/["']/.test(key)) faults.push('contains a quote character');
  if (/[^\x20-\x7E]/.test(key)) faults.push('contains a non-ASCII character');
  if (!key.startsWith('sk-')) faults.push('does not start with "sk-"');
  if (key.length < 40) faults.push('shorter than any current OpenAI key');
  return faults.join('; ');
}

// `context` is the chain of ancestor labels, outermost first — ['Ethiopia'] for a
// branch of an Ethiopia graph. Without it a branch labelled "Geography" reads as
// a request to define the word geography, and that is exactly what comes back.
export function normalizeContext(context) {
  return (Array.isArray(context) ? context : [])
    .filter((c) => typeof c === 'string')
    .map((c) => c.trim())
    .filter(Boolean)
    .slice(0, 6);
}

export function buildPrompt({ topic, notes, childLabels, level, context }) {
  const trimmedNotes = (notes ?? '').trim();
  const existing = (childLabels ?? []).filter(Boolean);
  const guidance = LEVEL_GUIDANCE[level] ?? LEVEL_GUIDANCE[DEFAULT_LEVEL];
  const path = normalizeContext(context);
  const subject = path[0];

  return [
    `Topic: ${topic}`,
    subject
      ? `This topic is part of a knowledge map about "${subject}"${
          path.length > 1 ? `, under ${path.slice(1).join(' → ')}` : ''
        }. Write about ${topic} AS IT APPLIES TO ${subject}. Do not define the general concept of "${topic}" — a definition of the term is useless here. The same rule applies to every "detail" you return: each must be a specific fact about ${subject}.`
      : 'This is a top-level topic, with nothing above it.',
    trimmedNotes
      ? `The user's notes:\n"""\n${trimmedNotes}\n"""`
      : 'The user has not written any notes yet.',
    existing.length
      ? `Sub-topics already on their canvas: ${existing.join(', ')}`
      : 'They have no sub-topics on this branch yet.',
    `Level: ${guidance}`,
  ].join('\n\n');
}

export async function generateKnowledge({ topic, notes, childLabels, level, context }) {
  if (mockEnabled())
    return mockKnowledge({ topic, notes, level: level ?? DEFAULT_LEVEL, context });

  const apiKey = readKey();
  if (!apiKey) {
    const error = new Error('OPENAI_API_KEY is not set');
    error.code = 'NO_API_KEY';
    throw error;
  }

  const client = new OpenAI({ apiKey });

  const completion = await client.chat.completions.create({
    model: readModel(),
    messages: [
      { role: 'system', content: SYSTEM },
      { role: 'user', content: buildPrompt({ topic, notes, childLabels, level, context }) },
    ],
    response_format: {
      type: 'json_schema',
      json_schema: { name: 'knowledge', strict: true, schema: KNOWLEDGE_SCHEMA },
    },
  });

  const message = completion.choices?.[0]?.message;

  // With structured outputs the model can decline instead of answering; that
  // arrives as a `refusal` string rather than an error.
  if (message?.refusal) {
    const error = new Error(message.refusal);
    error.code = 'REFUSED';
    throw error;
  }

  const parsed = JSON.parse(message?.content ?? '{}');

  return {
    summary: (parsed.summary ?? '').trim(),
    correction: (parsed.correction ?? '').trim(),
    // Eight is the ceiling the schema asks for; the client takes as many as the
    // chosen level calls for. A sub-topic with no label is unusable; one with no
    // detail is merely thin, so it survives.
    subtopics: (parsed.subtopics ?? [])
      .map((s) => ({
        label: String(s?.label ?? '').trim(),
        detail: String(s?.detail ?? '').trim(),
      }))
      .filter((s) => s.label)
      .slice(0, 8),
  };
}

function readBody(req) {
  return new Promise((resolve, reject) => {
    let raw = '';
    req.on('data', (chunk) => {
      raw += chunk;
      if (raw.length > 1_000_000) reject(new Error('Request body too large'));
    });
    req.on('end', () => resolve(raw));
    req.on('error', reject);
  });
}

function send(res, status, payload) {
  res.statusCode = status;
  res.setHeader('content-type', 'application/json');
  res.end(JSON.stringify(payload));
}

// Node-style (req, res) handler for POST /api/knowledge.
export async function handleKnowledgeRequest(req, res) {
  if (req.method !== 'POST') {
    send(res, 405, { error: 'Use POST' });
    return;
  }

  let body;
  try {
    body = JSON.parse((await readBody(req)) || '{}');
  } catch {
    send(res, 400, { error: 'Invalid JSON body' });
    return;
  }

  const topic = typeof body.topic === 'string' ? body.topic.trim() : '';
  if (!topic) {
    send(res, 400, { error: 'A "topic" string is required' });
    return;
  }

  // An unknown level falls back rather than erroring: the level only shapes the
  // wording, so a stale client asking for one we dropped should still get a
  // usable answer.
  const level = isKnownLevel(body.level) ? body.level : DEFAULT_LEVEL;

  try {
    const result = await generateKnowledge({
      topic,
      notes: typeof body.notes === 'string' ? body.notes : '',
      childLabels: Array.isArray(body.childLabels) ? body.childLabels : [],
      level,
      context: normalizeContext(body.context),
    });
    send(res, 200, result);
  } catch (error) {
    if (error.code === 'NO_API_KEY') {
      // 503 is the signal the client uses to fall back to placeholder mode.
      send(res, 503, { error: 'No API key configured', code: 'NO_API_KEY' });
      return;
    }
    if (error.code === 'REFUSED') {
      send(res, 200, { summary: '', correction: '', subtopics: [], refused: true });
      return;
    }

    // Surface the two setup mistakes that are otherwise baffling, with the fix.
    if (error.status === 401) {
      // A bare "401" is the least actionable message this route can produce, so
      // report what the process is actually holding — never the key itself.
      const key = readKey() ?? '';
      const fromShell = Boolean(process.env.OPENAI_API_KEY) && !readEnvFileKey();
      console.error(
        [
          '[knowledge] 401 — OpenAI rejected the key.',
          `  length: ${key.length}`,
          `  starts: ${JSON.stringify(key.slice(0, 8))}`,
          `  source: ${fromShell ? 'shell environment (this overrides .env)' : '.env or shell'}`,
          `  suspicious: ${describeKeyFaults(key) || 'nothing obvious'}`,
          '  Run `npm run check-key` for a definitive answer.',
        ].join('\n')
      );
      send(res, 502, {
        error:
          'OpenAI rejected the API key. Run `npm run check-key` in the project folder — it will say exactly why.',
      });
      return;
    }
    if (error.status === 404) {
      console.error(`[knowledge] 404 — model "${readModel()}" not available to this key.`);
      send(res, 502, {
        error: `Model "${readModel()}" isn't available to this key. Set OPENAI_MODEL in .env to one you have access to.`,
      });
      return;
    }

    console.error('[knowledge] request failed:', error);
    send(res, 502, { error: error.message ?? 'Upstream request failed' });
  }
}

// Vite dev-server plugin: makes `npm run dev` serve the route with no extra
// process. In production, mount handleKnowledgeRequest in your own server.
export function knowledgeApiPlugin() {
  return {
    name: 'lacuna-knowledge-api',
    configureServer(server) {
      if (mockEnabled()) {
        console.log(
          '[knowledge] OPENAI_MOCK is on — returning offline sample data, not calling OpenAI.'
        );
      }
      server.middlewares.use('/api/knowledge', handleKnowledgeRequest);
      server.middlewares.use('/api/knowledge-status', (req, res) => {
        send(res, 200, {
          configured: hasApiKey() || mockEnabled(),
          model: mockEnabled() ? 'offline sample data' : readModel(),
          mock: mockEnabled(),
        });
      });
    },
  };
}
