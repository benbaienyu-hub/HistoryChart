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
  subtopics: ['Suggested subtopic (connect AI)'],
};

async function requestKnowledge({ topic, notes, childLabels }) {
  const response = await fetch(ENDPOINT, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ topic, notes, childLabels }),
  });

  if (response.status === 503) {
    return { ...PLACEHOLDER, placeholder: true };
  }
  if (!response.ok) {
    const detail = await response.json().catch(() => ({}));
    throw new Error(detail.error ?? `Request failed (${response.status})`);
  }

  return response.json();
}

// Called when a brand-new root block is created: fetch a summary plus
// suggested subtopics so the block doesn't arrive empty.
export async function expandTopic({ topic }) {
  const result = await requestKnowledge({ topic, notes: '', childLabels: [] });
  return {
    summary: result.summary ?? '',
    subtopics: result.subtopics ?? [],
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
    suggestedSubtopics: result.subtopics ?? [],
    placeholder: Boolean(result.placeholder),
    refused: Boolean(result.refused),
  };
}
