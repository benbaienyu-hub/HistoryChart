// Client half of the AI features. The model call lives server-side in
// server/knowledgeRoutes.js so the API key never reaches the browser; this
// module just talks to that route.
//
// With no OPENAI_API_KEY configured the route answers 503 and everything
// here degrades to clearly-labelled placeholders, so the app stays usable
// without a key instead of erroring.

const ENDPOINT = '/api/knowledge';

// Cached, because several components ask — but only briefly. Whether AI works can
// change underneath a page that is already open: a key added to the server and
// deployed, or a key saved by this account in another tab. Memoising the answer for
// the lifetime of the tab meant the app kept insisting there was no key long after
// there was one, with a full reload as the only cure. That was a real bug.
const STATUS_TTL_MS = 30_000;
const UNAVAILABLE = { configured: false };

let cached = null;

export function fetchAiStatus({ force = false } = {}) {
  const fresh = cached && !force && Date.now() - cached.at < STATUS_TTL_MS;
  if (!fresh) {
    cached = {
      at: Date.now(),
      // Cache-busted: this answer changes with deployment configuration, and a
      // conditional request served from cache would defeat the whole point.
      promise: fetch('/api/knowledge-status', { cache: 'no-store' })
        .then((res) => (res.ok ? res.json() : UNAVAILABLE))
        .catch(() => UNAVAILABLE),
    };
  }
  return cached.promise;
}

export function forgetAiStatus() {
  cached = null;
}

export function isAiConfigured(options) {
  return fetchAiStatus(options).then((body) => Boolean(body.configured));
}

// What to tell someone about the state of their AI access. Kept here, next to the
// status shape, rather than inline in a component: the wording is the useful part,
// and it needs to be right for a hosted deployment as well as a local checkout.
export function describeAiStatus(status) {
  if (!status) return 'Checking whether an AI key is available…';
  if (status.configured) {
    return status.keySource === 'user'
      ? 'Review notes with AI and suggest what’s missing — using your own API key'
      : 'Review notes with AI and suggest what’s missing';
  }
  if (status.requiresOwnKey) {
    return 'This server asks everyone to use their own API key. Add yours under Account → AI key.';
  }
  return (
    'No AI key connected, so this will insert placeholders. Add your own under ' +
    'Account → AI key, or set OPENAI_API_KEY on the server and redeploy.'
  );
}

const PLACEHOLDER = {
  summary: 'Connect an API key to generate a real summary here.',
  correction: 'Connect an API key to fact-check these notes.',
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
      'Could not reach the server. If you are running Lacuna yourself, check that ' +
        'terminal for a crash; otherwise it is a connection problem, not an AI one.',
      { cause }
    );
  }

  if (response.status === 503) {
    // The server just told us there is no usable key, which may be news — drop the
    // cached status so the next check reflects reality rather than what we assumed
    // when the page loaded.
    forgetAiStatus();
    const detail = await response.json().catch(() => ({}));
    // Carry the server's own explanation. "No key" and "this server wants you to
    // bring your own" have different fixes, and the client cannot tell them apart.
    return { ...PLACEHOLDER, placeholder: true, reason: detail.error ?? null };
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
    reason: result.reason ?? null,
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
    reason: result.reason ?? null,
    refused: Boolean(result.refused),
  };
}
