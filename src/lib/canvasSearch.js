// Filtering the canvas library. Kept out of the component so the matching rules
// can be tested without rendering a page.
//
// Search covers titles *and* block content, because "which canvas had the thing
// about Adwa in it" is the question you actually have — a title-only search finds
// nothing when you named the canvas "History revision".

export function parseQuery(query) {
  return String(query ?? '')
    .trim()
    .toLowerCase()
    .split(/\s+/)
    .filter(Boolean);
}

function has(text, term) {
  return String(text ?? '').toLowerCase().includes(term);
}

// Every term must match somewhere, but not necessarily in the same place — so
// "ethiopia adwa" finds the canvas titled Ethiopia with a block about Adwa.
function matchesAll(terms, haystacks) {
  return terms.every((term) => haystacks.some((text) => has(text, term)));
}

function blocksOf(canvas) {
  return (canvas.nodes ?? []).map((n) => ({
    label: String(n.data?.label ?? ''),
    notes: String(n.data?.notes ?? ''),
  }));
}

// How many matched block names to name on the card. Past a handful it stops
// being a reason and turns into noise.
const MAX_NAMED_BLOCKS = 3;

export function searchCanvases(canvases, query) {
  const terms = parseQuery(query);
  const list = canvases ?? [];

  if (terms.length === 0) {
    return list.map((canvas) => ({ canvas, terms, inTitle: false, matchedBlocks: [] }));
  }

  const results = [];
  for (const canvas of list) {
    const blocks = blocksOf(canvas);
    const haystacks = [canvas.title, ...blocks.flatMap((b) => [b.label, b.notes])];
    if (!matchesAll(terms, haystacks)) continue;

    const inTitle = matchesAll(terms, [canvas.title]);
    const matched = blocks
      .filter((b) => terms.some((t) => has(b.label, t) || has(b.notes, t)))
      .map((b) => b.label)
      .filter(Boolean);

    results.push({
      canvas,
      terms,
      inTitle,
      // A title match is reason enough; listing its blocks as well is clutter.
      matchedBlocks: inTitle ? [] : [...new Set(matched)].slice(0, MAX_NAMED_BLOCKS),
    });
  }

  // Title matches first. Sort is stable, so within each group the caller's order
  // — most recently updated first — is preserved.
  return results.sort((a, b) => Number(b.inTitle) - Number(a.inTitle));
}

// Templates carry their block text pre-flattened as `searchText` (see
// listTemplates), so an example is searchable by its content too — the same rule
// as a real canvas, without building its graph on every keystroke.
export function searchTemplates(templates, query) {
  const terms = parseQuery(query);
  const list = templates ?? [];
  if (terms.length === 0) return list;
  return list.filter((t) => matchesAll(terms, [t.title, t.blurb, t.searchText]));
}

// Splits text into runs so the matched part can be marked in the UI. Overlapping
// hits are merged, so "ada ad" doesn't produce nested highlights.
export function highlightSegments(text, terms) {
  const source = String(text ?? '');
  const needles = (terms ?? []).map((t) => String(t).toLowerCase()).filter(Boolean);
  if (!source || needles.length === 0) return [{ text: source, hit: false }];

  const lower = source.toLowerCase();
  const found = [];
  for (const needle of needles) {
    let from = 0;
    for (;;) {
      const at = lower.indexOf(needle, from);
      if (at === -1) break;
      found.push([at, at + needle.length]);
      from = at + 1;
    }
  }
  if (found.length === 0) return [{ text: source, hit: false }];

  found.sort((a, b) => a[0] - b[0]);
  const merged = [[...found[0]]];
  for (const [start, end] of found.slice(1)) {
    const last = merged[merged.length - 1];
    if (start <= last[1]) last[1] = Math.max(last[1], end);
    else merged.push([start, end]);
  }

  const segments = [];
  let cursor = 0;
  for (const [start, end] of merged) {
    if (start > cursor) segments.push({ text: source.slice(cursor, start), hit: false });
    segments.push({ text: source.slice(start, end), hit: true });
    cursor = end;
  }
  if (cursor < source.length) segments.push({ text: source.slice(cursor), hit: false });
  return segments;
}
