import Anthropic from '@anthropic-ai/sdk';

// Server-side only. The API key must never reach the browser, so every Claude
// call goes through this module — it is mounted into the Vite dev server (see
// vite.config.js) and is deliberately framework-agnostic so the same handler
// can back an Express route or a serverless function in production.

const MODEL = 'claude-opus-5';

// Structured outputs guarantee the response parses, so the client never has to
// cope with prose where it expected JSON. `correction` is a plain string ('' for
// "nothing to correct") rather than a nullable — nullable schemas are the
// fiddliest part of the structured-output spec and buy nothing here.
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
    subtopics: {
      type: 'array',
      items: { type: 'string' },
      description:
        'Up to 5 short labels (a few words each) for sub-topics worth exploring next. Omit any the user already has.',
    },
  },
  required: ['summary', 'correction', 'subtopics'],
  additionalProperties: false,
};

const SYSTEM = `You help someone build a knowledge map. They give you a topic, whatever notes they have written, and the sub-topics already on their canvas.

Be accurate and specific. Prefer concrete names, dates, and numbers over hedged generalities.

Only populate "correction" when the notes contain a genuine factual error — a wrong date, a wrong causal claim, a wrong attribution. Say what is wrong and what is actually the case. Incomplete notes are not an error; leave "correction" empty for those.

Only populate "summary" when the notes are empty or say almost nothing. If the user has already written a reasonable account, leave it empty — do not overwrite their words.

For "subtopics", suggest specific things worth a block of their own, not vague categories. Skip anything already on the canvas.`;

function readKey() {
  return process.env.ANTHROPIC_API_KEY?.trim() || null;
}

export function hasApiKey() {
  return readKey() !== null;
}

function buildPrompt({ topic, notes, childLabels }) {
  const trimmedNotes = (notes ?? '').trim();
  const existing = (childLabels ?? []).filter(Boolean);

  return [
    `Topic: ${topic}`,
    trimmedNotes
      ? `The user's notes:\n"""\n${trimmedNotes}\n"""`
      : 'The user has not written any notes yet.',
    existing.length
      ? `Sub-topics already on their canvas: ${existing.join(', ')}`
      : 'They have no sub-topics on this branch yet.',
  ].join('\n\n');
}

export async function generateKnowledge({ topic, notes, childLabels }) {
  const apiKey = readKey();
  if (!apiKey) {
    const error = new Error('ANTHROPIC_API_KEY is not set');
    error.code = 'NO_API_KEY';
    throw error;
  }

  const client = new Anthropic({ apiKey });

  const response = await client.beta.messages.create({
    model: MODEL,
    max_tokens: 16000,
    system: SYSTEM,
    // Server-side fallback: if Claude Opus 5's safety classifiers decline the
    // request, the API re-runs it on the recommended fallback model in the same
    // call rather than handing back a refusal.
    betas: ['server-side-fallback-2026-07-01'],
    fallbacks: 'default',
    output_config: {
      effort: 'low',
      format: { type: 'json_schema', schema: KNOWLEDGE_SCHEMA },
    },
    messages: [{ role: 'user', content: buildPrompt({ topic, notes, childLabels }) }],
  });

  if (response.stop_reason === 'refusal') {
    const error = new Error('The request was declined by safety classifiers.');
    error.code = 'REFUSED';
    throw error;
  }

  const text = response.content.find((block) => block.type === 'text')?.text ?? '';
  const parsed = JSON.parse(text);

  return {
    summary: (parsed.summary ?? '').trim(),
    correction: (parsed.correction ?? '').trim(),
    subtopics: (parsed.subtopics ?? [])
      .map((s) => String(s).trim())
      .filter(Boolean)
      .slice(0, 5),
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

  try {
    const result = await generateKnowledge({
      topic,
      notes: typeof body.notes === 'string' ? body.notes : '',
      childLabels: Array.isArray(body.childLabels) ? body.childLabels : [],
    });
    send(res, 200, result);
  } catch (error) {
    if (error.code === 'NO_API_KEY') {
      // 503 is the signal the client uses to fall back to placeholder mode.
      send(res, 503, { error: 'No API key configured', code: 'NO_API_KEY' });
      return;
    }
    if (error.code === 'REFUSED') {
      send(res, 200, {
        summary: '',
        correction: '',
        subtopics: [],
        refused: true,
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
    name: 'historychart-knowledge-api',
    configureServer(server) {
      server.middlewares.use('/api/knowledge', handleKnowledgeRequest);
      server.middlewares.use('/api/knowledge-status', (req, res) => {
        send(res, 200, { configured: hasApiKey() });
      });
    },
  };
}
