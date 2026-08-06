// Client half of the AI features. The model call lives server-side in
// server/knowledgeRoutes.js so the API key never reaches the browser; this
// module just talks to that route.
//
// With no OPENAI_API_KEY configured the route answers 503 and everything
// here degrades to clearly-labelled placeholders, so the app stays usable
// without a key instead of erroring.

const ENDPOINT = '/api/knowledge';

let configuredPromise = null;

export function isAiConfigured() {
  if (!configuredPromise) {
    configuredPromise = fetch('/api/knowledge-status')
      .then((res) => (res.ok ? res.json() : { configured: false }))
      .then((body) => Boolean(body.configured))
      .catch(() => false);
  }
  return configuredPromise;
}

const PLACEHOLDER = {
  summary: 'Connect an OpenAI API key to generate a real summary here.',
  correction: 'Connect an OpenAI API key to fact-check these notes.',
  subtopics: [{ label: 'Suggested subtopic (connect AI)', detail: '' }],
};

async function requestKnowledge({ topic, notes, childLabels, level, context, maxSubtopics }) {
  let response;
  try {
    response = await fetch(ENDPOINT, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ topic, notes, childLabels, level, context, maxSubtopics }),
    });
  } catch (cause) {
    // fetch only rejects when the request never reached a server, and the
    // browser's own wording for that is "Failed to fetch" — which sounds like an
    // AI or key problem and is not one. Name the actual cause instead.
    throw new Error(
      'Could not reach the local server. Is `npm run dev` still running? Check that ' +
        'terminal for a crash, and that the page is open on the port it printed.',
      { cause }
    );
  }

  if (response.status === 503) {
    return { ...PLACEHOLDER, placeholder: true };
  }
  if (!response.ok) {
    const detail = await response.json().catch(() => ({}));
    throw new Error(detail.error ?? `Request failed (${response.status})`);
  }

  return response.json();
}

// Sub-topics arrive as { label, detail }. Tolerate a bare string too, so a
// response from an older server still produces usable blocks rather than labels
// reading "[object Object]".
export function normalizeSubtopics(list) {
  return (list ?? [])
    .map((s) => (typeof s === 'string' ? { label: s, detail: '' } : s))
    .map((s) => ({ label: String(s?.label ?? '').trim(), detail: String(s?.detail ?? '').trim() }))
    .filter((s) => s.label);
}

// Called when a brand-new root block is created, and for each branch of a
// generated graph: fetch a summary plus suggested sub-topics so the block doesn't
// arrive empty. `level` decides how the summary is pitched. `context` is the chain
// of ancestor labels — without it a branch called "Geography" gets defined rather
// than described.
export async function expandTopic({ topic, level, context, maxSubtopics }) {
  const result = await requestKnowledge({
    topic,
    notes: '',
    childLabels: [],
    level,
    context,
    maxSubtopics,
  });
  return {
    summary: result.summary ?? '',
    subtopics: normalizeSubtopics(result.subtopics),
    placeholder: Boolean(result.placeholder),
    refused: Boolean(result.refused),
  };
}

// Called by "Fill my knowledge": review what the user wrote, fill gaps, and
// suggest what's missing.
export async function fillKnowledge({ topic, notes, childLabels }) {
  const result = await requestKnowledge({ topic, notes, childLabels });
  const hasNotes = (notes ?? '').trim().length > 0;

  return {
    // Never overwrite notes the user actually wrote.
    filledNotes: hasNotes ? null : result.summary || null,
    correction: result.correction || null,
    suggestedSubtopics: normalizeSubtopics(result.subtopics),
    placeholder: Boolean(result.placeholder),
    refused: Boolean(result.refused),
  };
}
