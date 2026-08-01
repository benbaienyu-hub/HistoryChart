import { readFileSync } from 'node:fs';
import OpenAI from 'openai';
import { parseEnv } from '../scripts/keyDiagnostics.js';
import { splitPoints } from '../src/lib/deck.js';

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
        'Dot points, one per line, each line starting with "- ". Each point is a complete standalone sentence stating one fact. Empty string if the user already wrote adequate notes.',
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
              'Dot points, one per line, each line starting with "- ", saying what this sub-topic is and why it matters to the parent topic. Specific, not a restatement of the label.',
          },
        },
        required: ['label', 'detail'],
        additionalProperties: false,
      },
      description:
        'Sub-topics worth exploring next, most important first, up to the ceiling stated in the message. Fewer is correct when the topic does not warrant more. Omit any the user already has.',
    },
  },
  required: ['summary', 'correction', 'subtopics'],
  additionalProperties: false,
};

// How each depth in the "Make a graph" menu should be written. The level governs
// the register, not the size — Concise and Detailed read the same way and differ
// only in how many blocks the client asks for. Mirrors src/lib/graphLevels.js,
// which owns the counts.
const LEVEL_GUIDANCE = {
  simple: `Write for someone meeting this subject for the first time. Give "summary" 2 points in plain language, avoiding jargon and glossing any term you cannot avoid. For "subtopics", choose the most fundamental parts of the subject, and give each "detail" 1 or 2 short, plain points.`,
  concise: `Write for someone studying this subject seriously, in a deliberately small graph — so each block has to carry its weight. Give "summary" 4 or 5 substantial points and each "detail" 2 or 3, every one of them carrying names, dates, or numbers. Choose only the sub-topics that genuinely matter most: few, weighty blocks, not many thin ones.`,
  detailed: `Write for someone studying this subject seriously. Give "summary" 3 points that carry specifics — names, dates, numbers — and give each "detail" 2 concrete points rather than a definition. For "subtopics", cover the main branches of the subject.`,
  advanced: `Write for someone who already knows the basics. Do not explain elementary terms. Give "summary" 3 or 4 dense, precise points and each "detail" 2 or 3, preferring technical specifics over general orientation. For "subtopics", include the less obvious branches a newcomer's overview would leave out.`,
};

// How many sub-topics the caller will actually use. Sent so the prompt can state
// the ceiling — and, more importantly, say that it is a ceiling.
const MAX_SUBTOPICS = 8;

export function normalizeMaxSubtopics(value) {
  const n = Number(value);
  if (!Number.isInteger(n) || n < 1) return MAX_SUBTOPICS;
  return Math.min(n, MAX_SUBTOPICS);
}

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
  const value = envValue('OPENAI_MOCK')?.toLowerCase();
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

function mockKnowledge({ topic, notes, level, context, maxSubtopics }) {
  const subject = normalizeContext(context)[0];
  const cap = normalizeMaxSubtopics(maxSubtopics);
  // Offset the aspect list by the topic, otherwise every level picks the same
  // first aspect and a branch's children repeat their parent's label.
  const offset = seedFrom(topic);
  const within = subject ? `${topic}, within ${subject},` : topic;
  return {
    // Dot points, like real output — so a demo shows the study cards splitting
    // the way they will with a key attached.
    summary: (notes ?? '').trim()
      ? ''
      : [
          `- [offline sample] A ${level} summary of ${topic}${
            subject ? ` as it applies to ${subject}` : ''
          } would go here.`,
          `- Each line is one dot point, and one card in study mode.`,
          `- Set OPENAI_MOCK=0 for real output.`,
        ].join('\n'),
    correction: '',
    subtopics: MOCK_ASPECTS.slice(0, cap).map((_, i) => {
      const aspect = MOCK_ASPECTS[(offset + i) % MOCK_ASPECTS.length];
      return {
        label: `${topic} — ${aspect}`,
        detail: [
          `- [offline sample] One specific fact about the ${aspect} of ${within} would go here.`,
          `- A second point about the ${aspect} would follow it.`,
        ].join('\n'),
      };
    }),
  };
}

const SYSTEM = `You help someone build a knowledge map. They give you a topic, whatever notes they have written, and the sub-topics already on their canvas.

Be accurate and specific. Prefer concrete names, dates, and numbers over hedged generalities.

A topic may be given with the subject it sits under. When it is, everything you write must be about the topic within that subject — never a general definition of the topic's name.

Only populate "correction" when the notes contain a genuine factual error — a wrong date, a wrong causal claim, a wrong attribution. Say what is wrong and what is actually the case. Incomplete notes are not an error; leave "correction" empty for those.

Only populate "summary" when the notes are empty or say almost nothing. If the user has already written a reasonable account, leave it empty — do not overwrite their words.

Write "summary" and every "detail" as dot points: one point per line, each line beginning with "- ". Every point must be a complete sentence that stands on its own, because it is read on its own. Never write a fragment, a heading, or a bare label — "- Highland agriculture" is not a point; "- Teff grows on the highland plateau and is the staple grain." is. Do not nest points, and do not write a paragraph inside a point.

This matters more than it looks: each point becomes one card in the user's revision, graded separately. A point that says nothing is a mark they lose for failing to remember nothing. So write few points and make each one worth remembering — the stated count is a ceiling, and coming in under it is a better answer than padding to reach it.

For "subtopics", suggest specific things worth a block of their own, not vague categories. Skip anything already on the canvas. Give each one a short label; its "detail" points are shown to the user as the starting content of that block, so they must say something, not merely restate the label.

Never pad the list to reach a count. Some topics support many sub-topics and some support two; returning the honest number is always better than filling space.`;

// Settings resolve from the real environment first, then from .env directly.
//
// Vite copies .env into process.env once, at startup (see vite.config.js), so
// editing .env while the dev server runs used to change nothing until a restart
// — and the resulting error said "OPENAI_MODEL is not set" while the file plainly
// set it. Reading the file as a fallback removes that trap. Precedence is
// unchanged: a real environment variable still wins, which is Vite's rule.
let envFilePath = new URL('../.env', import.meta.url);

// Test seam. The fallback reads a real file, which would otherwise make the test
// suite depend on whatever .env happens to be sitting on disk. Pass null to turn
// the fallback off entirely.
export function setEnvFileForTests(path) {
  envFilePath = path;
}

function envValue(name) {
  const fromProcess = process.env[name]?.trim();
  if (fromProcess) return fromProcess;
  if (!envFilePath) return null;
  try {
    return parseEnv(readFileSync(envFilePath, 'utf8'))[name]?.trim() || null;
  } catch {
    // No .env, or unreadable. In production there may legitimately not be one.
    return null;
  }
}

function readKey() {
  return envValue('OPENAI_API_KEY');
}

function readModel() {
  return envValue('OPENAI_MODEL') ?? DEFAULT_MODEL;
}

// Point the app at any OpenAI-compatible provider. Several have free tiers, and
// a local Ollama needs no key at all, so this is the escape hatch when OpenAI
// credits run out. Unset means OpenAI itself, exactly as before.
//
// The provider must support JSON-schema structured outputs; the route relies on
// them so the client never has to parse prose. Support varies, so if a provider
// rejects the schema the route surfaces its error rather than guessing.
export function readBaseUrl() {
  return envValue('OPENAI_BASE_URL')?.replace(/\/+$/, '') || null;
}

// A model name is provider-specific. Defaulting to gpt-4o is right for OpenAI and
// nonsense for anything else, so when a custom provider is configured without a
// model we refuse to guess — otherwise the first request fails with "gpt-4o isn't
// available", which reads like a key problem and isn't.
export function configProblem() {
  if (readBaseUrl() && !envValue('OPENAI_MODEL')) {
    return (
      `OPENAI_BASE_URL is set to ${readBaseUrl()} but OPENAI_MODEL is not set. ` +
      'A model name is specific to its provider, so there is no sensible default here. ' +
      'Run `npm run check-key` — it lists the models that provider offers — then put one ' +
      'in OPENAI_MODEL in .env. The file is re-read on each request, so that takes effect immediately.'
    );
  }
  return null;
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
function describeKeyFaults(key, { expectOpenAiKey = true } = {}) {
  const faults = [];
  if (key.includes('...')) faults.push('still contains the "..." placeholder');
  if (/\s/.test(key)) faults.push('contains whitespace');
  if (/["']/.test(key)) faults.push('contains a quote character');
  if (/[^\x20-\x7E]/.test(key)) faults.push('contains a non-ASCII character');
  // Other providers use their own key formats, so only judge the shape when the
  // request is actually going to OpenAI.
  if (expectOpenAiKey) {
    if (!key.startsWith('sk-')) faults.push('does not start with "sk-"');
    if (key.length < 40) faults.push('shorter than any current OpenAI key');
  }
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

export function buildPrompt({ topic, notes, childLabels, level, context, maxSubtopics }) {
  const trimmedNotes = (notes ?? '').trim();
  const existing = (childLabels ?? []).filter(Boolean);
  const guidance = LEVEL_GUIDANCE[level] ?? LEVEL_GUIDANCE[DEFAULT_LEVEL];
  const path = normalizeContext(context);
  const subject = path[0];
  const cap = normalizeMaxSubtopics(maxSubtopics);

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
    `Return AT MOST ${cap} sub-topics. That is a ceiling, not a target: return fewer — or none at all — when the topic genuinely does not have ${cap} parts worth a block of their own. Do not invent, split hairs, or pad the list to reach the number. A short, solid list is a better answer than a padded one.`,
    `Level: ${guidance}`,
  ].join('\n\n');
}


// Not every model supports JSON-schema responses. Groq's llama-3.3 replies
// "This model does not support response format `json_schema`" with a 400, and
// other providers differ again — so rather than requiring the user to hunt for a
// compatible model, the route walks down a ladder of increasingly plain requests:
//
//   json_schema  the response is guaranteed to match the schema
//   json_object  guaranteed to be JSON, but not to match — we validate ourselves
//   none         no guarantee at all; we extract the JSON from the text
//
// Whatever works is remembered per model, so the cost is one wasted request the
// first time and nothing after that.
const FORMAT_TIERS = ['json_schema', 'json_object', 'none'];
const workingTierByModel = new Map();

function responseFormatFor(tier) {
  if (tier === 'json_schema') {
    return {
      response_format: {
        type: 'json_schema',
        json_schema: { name: 'knowledge', strict: true, schema: KNOWLEDGE_SCHEMA },
      },
    };
  }
  if (tier === 'json_object') return { response_format: { type: 'json_object' } };
  return {};
}

// Only the schema guarantees the shape, so the plainer tiers have to state it.
const SHAPE_INSTRUCTION = `Reply with JSON and nothing else — no prose, no code fences — in exactly this shape:
{"summary": "…", "correction": "…", "subtopics": [{"label": "…", "detail": "…"}]}
Every field is required. Use an empty string for "summary" or "correction" when they do not apply, and an empty array for "subtopics".
"summary" and each "detail" are dot points: one point per line, each line starting with "- ", written as \\n inside the JSON string. "correction" is ordinary prose.`;

// A provider refusing the format is a reason to try a plainer one. Anything else
// — a bad key, an unknown model, a rate limit — is not, and must surface.
export function isFormatUnsupported(error) {
  if (error?.status !== 400) return false;
  return /response.?format|json.?schema|json.?object|structured.output/i.test(
    String(error?.message ?? '')
  );
}

// The plainest tier may wrap its JSON in prose or a code fence.
export function parseKnowledgeJson(text) {
  const raw = String(text ?? '').trim();
  const unfenced = raw.replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/, '');
  const start = unfenced.indexOf('{');
  const end = unfenced.lastIndexOf('}');
  if (start === -1 || end <= start) {
    throw new Error('The model did not return JSON.');
  }
  return JSON.parse(unfenced.slice(start, end + 1));
}

// The prompt asks for dot points, and the schema's descriptions repeat it, but
// compliance isn't a guarantee — the plainer format tiers have no schema at all,
// and a model that returns a paragraph would otherwise land one in the block.
// So the text is put through the same splitter the study grader uses, which both
// bulletises prose and normalises whatever marker the model chose (•, *, "1.")
// to a single style. One definition of "a point", used by the writer and the
// grader alike.
export function formatPoints(text) {
  const points = splitPoints(text);
  return points.map((point) => `- ${point}`).join('\n');
}

function shapeResult(parsed, maxSubtopics) {
  return {
    summary: formatPoints(parsed?.summary),
    // Prose, deliberately: a correction is an argument about the notes, not
    // material to memorise, so it isn't a card and isn't a list.
    correction: String(parsed?.correction ?? '').trim(),
    // A sub-topic with no label is unusable; one with no detail is merely thin,
    // so it survives.
    subtopics: (Array.isArray(parsed?.subtopics) ? parsed.subtopics : [])
      .map((s) => ({
        label: String(s?.label ?? '').trim(),
        detail: formatPoints(s?.detail),
      }))
      .filter((s) => s.label)
      .slice(0, normalizeMaxSubtopics(maxSubtopics)),
  };
}

export async function generateKnowledge({ topic, notes, childLabels, level, context, maxSubtopics }) {
  if (mockEnabled())
    return mockKnowledge({ topic, notes, level: level ?? DEFAULT_LEVEL, context, maxSubtopics });

  const problem = configProblem();
  if (problem) {
    const error = new Error(problem);
    error.code = 'CONFIG';
    throw error;
  }

  const apiKey = readKey();
  if (!apiKey) {
    const error = new Error('OPENAI_API_KEY is not set');
    error.code = 'NO_API_KEY';
    throw error;
  }

  const baseURL = readBaseUrl();
  const client = new OpenAI(baseURL ? { apiKey, baseURL } : { apiKey });
  const model = readModel();

  const prompt = buildPrompt({ topic, notes, childLabels, level, context, maxSubtopics });
  const remembered = workingTierByModel.get(model);
  const tiers = remembered ? [remembered] : FORMAT_TIERS;

  let lastError;
  for (const tier of tiers) {
    try {
      const completion = await client.chat.completions.create({
        model,
        messages: [
          { role: 'system', content: SYSTEM },
          {
            role: 'user',
            content: tier === 'json_schema' ? prompt : `${prompt}\n\n${SHAPE_INSTRUCTION}`,
          },
        ],
        ...responseFormatFor(tier),
      });

      const message = completion.choices?.[0]?.message;

      // With structured outputs the model can decline instead of answering; that
      // arrives as a `refusal` string rather than an error.
      if (message?.refusal) {
        const error = new Error(message.refusal);
        error.code = 'REFUSED';
        throw error;
      }

      const result = shapeResult(parseKnowledgeJson(message?.content), maxSubtopics);

      if (remembered !== tier) {
        workingTierByModel.set(model, tier);
        if (tier !== 'json_schema') {
          console.log(
            `[knowledge] "${model}" does not support json_schema; using ${tier} for it instead.`
          );
        }
      }
      return result;
    } catch (error) {
      lastError = error;
      // A refusal is the model's answer, not a format problem: do not retry it.
      if (error.code === 'REFUSED' || !isFormatUnsupported(error)) throw error;
    }
  }

  throw lastError;
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
// Exported so the dev-server plugin and the standalone server (server/index.mjs)
// answer this identically — the client uses it to decide whether the AI features
// are available at all.
export function handleKnowledgeStatus(req, res) {
  send(res, 200, {
    configured: hasApiKey() || mockEnabled(),
    model: mockEnabled() ? 'offline sample data' : readModel(),
    provider: mockEnabled() ? 'offline' : (readBaseUrl() ?? 'openai'),
    mock: mockEnabled(),
  });
}

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
      maxSubtopics: normalizeMaxSubtopics(body.maxSubtopics),
    });
    send(res, 200, result);
  } catch (error) {
    if (error.code === 'NO_API_KEY') {
      // 503 is the signal the client uses to fall back to placeholder mode.
      send(res, 503, { error: 'No API key configured', code: 'NO_API_KEY' });
      return;
    }
    if (error.code === 'CONFIG') {
      console.error(`[knowledge] not configured: ${error.message}`);
      send(res, 502, { error: error.message });
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
      const baseURL = readBaseUrl();
      const fromShell = Boolean(process.env.OPENAI_API_KEY) && !readEnvFileKey();
      console.error(
        [
          '[knowledge] 401 — OpenAI rejected the key.',
          `  length: ${key.length}`,
          `  starts: ${JSON.stringify(key.slice(0, 8))}`,
          `  source: ${fromShell ? 'shell environment (this overrides .env)' : '.env or shell'}`,
          `  provider: ${baseURL ?? 'api.openai.com (default)'}`,
          `  suspicious: ${describeKeyFaults(key, { expectOpenAiKey: !baseURL }) || 'nothing obvious'}`,
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
      const where = readBaseUrl() ?? 'OpenAI';
      console.error(`[knowledge] 404 — ${where} has no model "${readModel()}".`);
      send(res, 502, {
        error:
          `${where} has no model called "${readModel()}". Run \`npm run check-key\` to list the ` +
          'models it does offer, and put one in OPENAI_MODEL in .env.',
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
      } else {
        const problem = configProblem();
        if (problem) console.warn(`[knowledge] NOT CONFIGURED: ${problem}`);
        else if (readBaseUrl()) {
          console.log(`[knowledge] using ${readBaseUrl()} with model "${readModel()}".`);
        }
      }
      server.middlewares.use('/api/knowledge', handleKnowledgeRequest);
      server.middlewares.use('/api/knowledge-status', handleKnowledgeStatus);
    },
  };
}
