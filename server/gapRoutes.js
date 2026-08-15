// "Find my gaps": the model reads a whole canvas and reports what is missing,
// wrong, or thin — and does not rewrite anything.
//
// One request for the entire canvas rather than one per block. Cheaper, and
// better: a gap is often the relationship between two blocks, which nothing
// looking at a single block can see.
//
// Each gap arrives carrying its own hint, test question, answer and filling. That
// is deliberate. The alternative — fetching those when the user clicks — would mean
// a model call per click, on a feature people are meant to click a lot. This way
// "Find my gaps" costs exactly one call however much you do with the result.

import { canvasDigest, normalizeGaps } from '../src/lib/gaps.js';
import { callModel } from './modelCall.js';
import { credentialsForUser, mockEnabled } from './aiConfig.js';
import { readJsonBody, send } from './http.js';

const GAP_SCHEMA = {
  type: 'object',
  properties: {
    gaps: {
      type: 'array',
      description:
        'The gaps worth raising, most important first. An empty array is a valid and useful answer when the notes are genuinely sound.',
      items: {
        type: 'object',
        properties: {
          kind: {
            type: 'string',
            enum: ['missing', 'incorrect', 'incomplete'],
            description:
              '"missing" = an important idea absent from the canvas. "incorrect" = a claim in the notes that is factually wrong. "incomplete" = something named but not explained.',
          },
          blockRef: {
            type: 'integer',
            description:
              'The number of the block this concerns, from the list given. Use 0 when it belongs to the canvas as a whole rather than to one block.',
          },
          title: {
            type: 'string',
            description: 'A few words naming the gap. Not a sentence.',
          },
          detail: {
            type: 'string',
            description:
              'One sentence saying what is absent, wrong, or unexplained. For "incorrect", say what the notes claim and what is actually true.',
          },
          hint: {
            type: 'string',
            description:
              'A nudge toward the answer that does NOT contain it — the shape of the idea, a question to ask, or where to look. Someone reading this should still have to think.',
          },
          question: {
            type: 'string',
            description: 'One question that tests whether the person knows this.',
          },
          answer: {
            type: 'string',
            description: 'The answer to that question, in one or two sentences.',
          },
          fill: {
            type: 'string',
            description:
              'The notes to add if the user asks for it: dot points, one per line, each beginning "- ", each a complete sentence carrying specifics. For "incorrect", this is the corrected statement.',
          },
        },
        required: ['kind', 'blockRef', 'title', 'detail', 'hint', 'question', 'answer', 'fill'],
        additionalProperties: false,
      },
    },
  },
  required: ['gaps'],
  additionalProperties: false,
};

const SYSTEM = `You are reviewing someone's study notes to find what they do not know yet. You are not writing their notes for them.

Report three kinds of gap, and nothing else:

- "missing": an important idea about this subject that is nowhere on the canvas. It must be genuinely important — something a competent answer on this subject could not omit — not merely another fact that exists.
- "incorrect": a claim in their notes that is factually wrong. Name what they wrote and what is actually the case.
- "incomplete": something they have named but not explained, so it would earn no marks as written. A bare label, a date with no significance, a term used without saying what it means.

Rules that matter more than coverage:

Do not pad. An empty list is a correct and useful answer when the notes are sound. Three real gaps are worth more than ten manufactured ones, and a person who is told their good notes are full of holes stops trusting you.

Be careful with "incorrect". Only flag a claim you are confident is wrong — not one that is simplified, differently emphasised, or a matter of interpretation. Being wrongly told you are wrong is worse than not being told anything: they will correct something that was right. If the notes are ambiguous, leave them alone.

"incomplete" is about depth, not length. A short point that says something specific is complete. A long paragraph that says nothing is not.

The hint must not contain the answer. It points; the answer answers. If your hint would let someone write the answer without knowing it, rewrite it.

Write "fill" as dot points, one per line, each starting "- ", each a complete sentence that carries names, dates or numbers. These become the user's notes and, later, the cards they are tested on — so a point that says nothing is a mark they lose for remembering nothing.`;

// Offline sample gaps, one of each kind, so the whole flow can be exercised with no
// key and no bill. Prefixed like the other mock content so it can never be mistaken
// for real review.
function mockGaps(digest) {
  const first = digest[0];
  const second = digest[1];
  return {
    gaps: [
      {
        kind: 'incorrect',
        blockRef: first?.ref ?? 0,
        title: '[offline sample] A date that looks wrong',
        detail:
          'This is sample output, not a real review — set OPENAI_MOCK=0 and add a key for the real thing.',
        hint: 'A real hint would point you at the right decade without naming the year.',
        question: 'A real question would go here.',
        answer: 'And its answer here.',
        fill: '- A corrected point would be added to your notes.',
      },
      {
        kind: 'missing',
        blockRef: 0,
        title: '[offline sample] An idea the canvas never mentions',
        detail: 'Sample output. Canvas-level gaps have no block, and can be added as a new one.',
        hint: 'Think about what connects the blocks you already have.',
        question: 'A real question would go here.',
        answer: 'And its answer here.',
        fill: '- A new point would be added here.\n- And another.',
      },
      {
        kind: 'incomplete',
        blockRef: second?.ref ?? first?.ref ?? 0,
        title: '[offline sample] Something named but not explained',
        detail: 'Sample output — this is what a thin note looks like when flagged.',
        hint: 'Ask yourself why it mattered, not just when it happened.',
        question: 'A real question would go here.',
        answer: 'And its answer here.',
        fill: '- The explanation would be added here.',
      },
    ],
  };
}

export function buildGapPrompt({ title, digest }) {
  const blocks = digest
    .map((entry) => {
      const notes = entry.notes ? entry.notes : '(no notes written yet)';
      return `[${entry.ref}] ${entry.label}\n${notes}`;
    })
    .join('\n\n');

  return [
    `Subject of this canvas: ${title || 'untitled'}`,
    '',
    'Their blocks, numbered:',
    '',
    blocks,
    '',
    'Report the gaps. Use the block numbers above for "blockRef", or 0 for something that belongs to the canvas as a whole rather than to any one block.',
  ].join('\n');
}

export async function generateGaps({ title, nodes }, credentials) {
  const digest = canvasDigest(nodes);
  if (digest.length === 0) return { gaps: [], digest };

  if (mockEnabled()) return { gaps: normalizeGaps(mockGaps(digest).gaps, digest), digest };

  const parsed = await callModel({
    credentials,
    system: SYSTEM,
    prompt: buildGapPrompt({ title, digest }),
    schemaName: 'gaps',
    schema: GAP_SCHEMA,
    shape: '{"gaps": [{"kind": "missing|incorrect|incomplete", "blockRef": 0, "title": "…", "detail": "…", "hint": "…", "question": "…", "answer": "…", "fill": "- …"}]}',
  });

  return { gaps: normalizeGaps(parsed?.gaps, digest), digest };
}

export async function handleFindGaps(req, res, user) {
  const body = await readJsonBody(req);
  const nodes = Array.isArray(body.nodes) ? body.nodes : [];

  if (nodes.length === 0) {
    return send(res, 400, { error: 'There is nothing on this canvas to review yet.' });
  }

  const credentials = await credentialsForUser(user);
  if (!credentials.apiKey && !mockEnabled()) {
    return send(res, 503, {
      error: credentials.requiresOwnKey
        ? 'This server asks everyone to bring their own API key. Add yours in account settings.'
        : 'No API key configured, so there is nothing to review your notes with.',
      code: 'NO_API_KEY',
      requiresOwnKey: Boolean(credentials.requiresOwnKey),
    });
  }

  try {
    const { gaps } = await generateGaps({ title: body.title, nodes }, credentials);
    return send(res, 200, { gaps });
  } catch (error) {
    if (error.code === 'REFUSED') {
      return send(res, 200, { gaps: [], refused: true });
    }
    if (error.code === 'CONFIG') {
      return send(res, 502, { error: error.message });
    }
    if (error.status === 401) {
      return send(res, 502, {
        error:
          credentials.source === 'user'
            ? 'Your provider rejected your API key. Open account settings and paste it again.'
            : 'The provider rejected the server’s API key.',
      });
    }
    console.error('[gaps] request failed:', error);
    return send(res, 502, { error: error.message ?? 'The review request failed.' });
  }
}

// Exported for the tests, which assert the schema rather than trusting it.
export { GAP_SCHEMA, SYSTEM as GAP_SYSTEM };
