// Gaps: what the app is named after.
//
// "Fill my knowledge" used to hand back finished notes, which is the opposite of
// studying — reading a good answer feels like learning and isn't. This module
// backs the replacement: the AI says *where the holes are* and you decide what to
// do about each one. Testing yourself on a hole, or being nudged toward it, beats
// being handed the filling; filling it is still there for when you just want the
// fact written down.
//
// Pure, so the shaping and the guards can be tested without a model or a browser.

export const GAP_KINDS = {
  // Order matters: this is the order they are shown in, most alarming first.
  // Something you believe that is wrong does more damage than something you have
  // not written down yet.
  incorrect: {
    key: 'incorrect',
    label: 'Incorrect',
    emoji: '⚠️',
    blurb: 'appears to be factually wrong',
    // "Fill" is the wrong verb for a correction — the note already says something.
    fillLabel: 'Add correction',
  },
  missing: {
    key: 'missing',
    label: 'Missing',
    emoji: '🔴',
    blurb: 'an important idea that isn’t here',
    fillLabel: 'Fill gap',
  },
  incomplete: {
    key: 'incomplete',
    label: 'Incomplete',
    emoji: '🟡',
    blurb: 'mentioned, but not explained',
    fillLabel: 'Fill gap',
  },
};

export const GAP_ORDER = ['incorrect', 'missing', 'incomplete'];

export function isGapKind(kind) {
  return Object.hasOwn(GAP_KINDS, kind);
}

// How much canvas is sent to the model. A whole-canvas scan is one request instead
// of one per block, which is both cheaper and better — a gap is often the
// *relationship* between two blocks, invisible to anything looking at one alone.
// But a 200-block canvas would blow the context window, so it is bounded.
const MAX_BLOCKS = 40;
const MAX_NOTES = 900;
const MAX_GAPS = 12;

// The blocks, numbered, as the model sees them. Numbers rather than the real UUIDs:
// the model only has to point at one, and a UUID costs ~20 tokens to say.
export function canvasDigest(nodes = []) {
  return nodes
    .filter((node) => (node?.data?.label ?? '').trim())
    .slice(0, MAX_BLOCKS)
    .map((node, index) => ({
      ref: index + 1,
      id: node.id,
      label: node.data.label.trim(),
      notes: truncate((node.data.notes ?? '').trim(), MAX_NOTES),
    }));
}

function truncate(text, limit) {
  return text.length <= limit ? text : `${text.slice(0, limit)}…`;
}

// Splits the model's fill text into the dot points the rest of the app works in.
export function fillPoints(text) {
  return String(text ?? '')
    .split('\n')
    .map((line) => line.replace(/^\s*[-•*]\s*/, '').trim())
    .filter(Boolean);
}

// A gap's identity: its kind and what it is called, flattened so the same hole
// found again next month is recognisably the same hole.
export function gapId(kind, title) {
  const slug = String(title ?? '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 60);
  return `${kind}-${slug || 'untitled'}`;
}

// Turns whatever the model returned into gaps this app can render, dropping
// anything unusable rather than showing a card with an empty title.
//
// `digest` maps the model's block numbers back to real block ids. A gap that names
// no block (or names one that isn't there) belongs to the canvas as a whole — which
// is a real case: "nothing here covers the economic causes at all".
export function normalizeGaps(raw, digest = []) {
  const byRef = new Map(digest.map((entry) => [entry.ref, entry]));
  const seen = new Set();

  return (Array.isArray(raw) ? raw : [])
    .map((gap) => {
      const kind = isGapKind(gap?.kind) ? gap.kind : 'missing';
      const title = String(gap?.title ?? '').trim();
      if (!title) return null;

      const block = byRef.get(Number(gap?.blockRef)) ?? null;
      // Where a missing idea belongs in the chain, so it can be drawn there
      // rather than listed in a panel. Only "missing" gets a place: a wrong or
      // thin claim is about a block that already exists, and there is nothing to
      // put on the canvas between anything.
      const after = kind === 'missing' ? (byRef.get(Number(gap?.afterRef)) ?? null) : null;
      const rawBefore = kind === 'missing' ? (byRef.get(Number(gap?.beforeRef)) ?? null) : null;
      // A gap "between X and X" is a model slip, and drawing an arrow from a
      // block back to itself would be nonsense.
      const before = rawBefore && rawBefore.id !== after?.id ? rawBefore : null;

      return {
        // Built from the content, not from the position in the list. A gap's
        // question is a study card now, and a card needs an id that survives the
        // next scan — otherwise re-finding the same hole would mint a new card
        // and throw away everything the schedule had learned about the old one.
        // The kind-and-title pair is already unique within a scan, because the
        // dedupe below drops repeats of exactly that.
        id: gapId(kind, title),
        kind,
        blockId: block?.id ?? null,
        blockLabel: block?.label ?? null,
        afterId: after?.id ?? null,
        afterLabel: after?.label ?? null,
        beforeId: before?.id ?? null,
        beforeLabel: before?.label ?? null,
        title,
        detail: String(gap?.detail ?? '').trim(),
        hint: String(gap?.hint ?? '').trim(),
        question: String(gap?.question ?? '').trim(),
        answer: String(gap?.answer ?? '').trim(),
        fill: fillPoints(gap?.fill),
      };
    })
    .filter(Boolean)
    .filter((gap) => {
      // The same hole reported twice, usually once per block it touches.
      const key = `${gap.kind}:${gap.title.toLowerCase()}`;
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    })
    .sort((a, b) => GAP_ORDER.indexOf(a.kind) - GAP_ORDER.indexOf(b.kind))
    .slice(0, MAX_GAPS);
}

export function countByKind(gaps = []) {
  const counts = { incorrect: 0, missing: 0, incomplete: 0 };
  for (const gap of gaps) {
    if (counts[gap.kind] !== undefined) counts[gap.kind] += 1;
  }
  return counts;
}

// Appending, never rewriting.
//
// For a *correction* this matters most: the note already contains a claim the model
// thinks is wrong, and silently deleting somebody's sentence — on the say-so of a
// model that is sometimes wrong about being right — is not a thing this app should
// do. The correction is added; removing the line it contradicts stays the user's
// call, and the panel says so.
export function appendPoints(notes, points = []) {
  const existing = String(notes ?? '');
  const already = new Set(
    existing
      .split('\n')
      .map((line) => normalizeForCompare(line))
      .filter(Boolean)
  );

  const fresh = points
    .map((point) => String(point ?? '').trim())
    .filter(Boolean)
    .filter((point) => !already.has(normalizeForCompare(point)));

  if (fresh.length === 0) return existing;

  const lines = fresh.map((point) => `- ${point}`);
  if (!existing.trim()) return lines.join('\n');
  return `${existing.replace(/\s+$/, '')}\n${lines.join('\n')}`;
}

// Loose enough that re-filling the same gap twice doesn't double the line, strict
// enough that two genuinely different points both survive.
function normalizeForCompare(line) {
  return line
    .replace(/^\s*[-•*]\s*/, '')
    .trim()
    .toLowerCase()
    .replace(/[.,;:!?]+$/, '');
}

// A one-line summary for the toolbar, so the result of a scan is legible without
// opening the panel.
export function describeGaps(gaps = []) {
  if (gaps.length === 0) return 'No gaps found';
  const counts = countByKind(gaps);
  const parts = GAP_ORDER.filter((kind) => counts[kind] > 0).map(
    (kind) => `${counts[kind]} ${GAP_KINDS[kind].label.toLowerCase()}`
  );
  return parts.join(' · ');
}
