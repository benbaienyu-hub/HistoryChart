// One place that talks to a model and comes back with parsed JSON.
//
// Extracted when a second route needed it. The interesting part is the format
// negotiation: OpenAI supports JSON-schema structured outputs, several
// OpenAI-compatible providers do not, and the ones that don't fail with a 400 that
// looks like any other 400. So a call walks down three tiers — schema, plain JSON
// mode, then a prompt that just asks for JSON — and remembers which one a given
// model accepted, so the failure is paid for once per process rather than per
// request.

import OpenAI from 'openai';
import { DEFAULT_MODEL, credentialProblem } from './aiConfig.js';

export { mockEnabled } from './aiConfig.js';

const FORMAT_TIERS = ['json_schema', 'json_object', 'none'];
const workingTierByModel = new Map();

// Test seam: a suite that stubs a provider must not inherit what an earlier test
// taught us about a model of the same name.
export function forgetFormatTiersForTests() {
  workingTierByModel.clear();
}

function responseFormatFor(tier, name, schema) {
  if (tier === 'json_schema') {
    return {
      response_format: { type: 'json_schema', json_schema: { name, strict: true, schema } },
    };
  }
  if (tier === 'json_object') return { response_format: { type: 'json_object' } };
  return {};
}

// A provider refusing the format is a reason to try a plainer one. Anything else
// — a bad key, an unknown model, a rate limit — is not, and must surface.
export function isFormatUnsupported(error) {
  if (error?.status !== 400) return false;
  return /response.?format|json.?schema|json.?object|structured.output/i.test(
    String(error?.message ?? '')
  );
}

// The plainest tier may wrap its JSON in prose or a code fence.
export function parseJsonReply(text) {
  const raw = String(text ?? '').trim();
  const unfenced = raw.replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/, '');
  const start = unfenced.indexOf('{');
  const end = unfenced.lastIndexOf('}');
  if (start === -1 || end <= start) {
    throw new Error('The model did not return JSON.');
  }
  return JSON.parse(unfenced.slice(start, end + 1));
}

export function requireCredentials(credentials) {
  const problem = credentialProblem(credentials);
  if (problem) {
    const error = new Error(problem);
    error.code = 'CONFIG';
    throw error;
  }
  if (!credentials?.apiKey) {
    const error = new Error(
      credentials?.requiresOwnKey
        ? 'This server requires each account to use its own API key.'
        : 'OPENAI_API_KEY is not set'
    );
    error.code = 'NO_API_KEY';
    error.requiresOwnKey = Boolean(credentials?.requiresOwnKey);
    throw error;
  }
}

// `shape` is the JSON shape stated in words, for the tiers with no schema to
// enforce it. Returns the parsed object; shaping it is the caller's business.
export async function callModel({ credentials, system, prompt, schemaName, schema, shape }) {
  requireCredentials(credentials);

  const { apiKey, baseUrl: baseURL } = credentials;
  const client = new OpenAI(baseURL ? { apiKey, baseURL } : { apiKey });
  const model = credentials.model ?? DEFAULT_MODEL;

  const remembered = workingTierByModel.get(model);
  const tiers = remembered ? [remembered] : FORMAT_TIERS;
  const instruction = shape
    ? `Reply with JSON and nothing else — no prose, no code fences — in exactly this shape:\n${shape}`
    : 'Reply with JSON and nothing else — no prose, no code fences.';

  let lastError;
  for (const tier of tiers) {
    try {
      const completion = await client.chat.completions.create({
        model,
        messages: [
          { role: 'system', content: system },
          {
            role: 'user',
            content: tier === 'json_schema' ? prompt : `${prompt}\n\n${instruction}`,
          },
        ],
        ...responseFormatFor(tier, schemaName, schema),
      });

      const message = completion.choices?.[0]?.message;

      // With structured outputs the model can decline instead of answering; that
      // arrives as a `refusal` string rather than an error.
      if (message?.refusal) {
        const error = new Error(message.refusal);
        error.code = 'REFUSED';
        throw error;
      }

      const parsed = parseJsonReply(message?.content);

      if (remembered !== tier) {
        workingTierByModel.set(model, tier);
        if (tier !== 'json_schema') {
          console.log(`[ai] "${model}" does not support json_schema; using ${tier} for it instead.`);
        }
      }
      return parsed;
    } catch (error) {
      lastError = error;
      // A refusal is the model's answer, not a format problem: do not retry it.
      if (error.code === 'REFUSED' || !isFormatUnsupported(error)) throw error;
    }
  }

  throw lastError;
}
