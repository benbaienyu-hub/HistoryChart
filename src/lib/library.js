// The library, taken as a whole — and the one thing worth doing next.
//
// The home screen used to answer only "what do I have": a grid of cards. The
// question you actually arrive with is "what should I do now", and every piece
// of the answer was already on the page — the canvases, their stored gap scans,
// and this account's review rows — just never added up.
//
// So this module does the adding up. It takes rows that have already been
// measured per canvas (see progress.js) and returns the totals plus a single
// recommendation. One recommendation, not a list: a home screen that offers five
// equally-weighted things to do is a home screen that has not decided, and
// deciding is the part the person came here for.
//
// Pure. Takes plain numbers, so it neither knows nor cares how a canvas is
// fetched or how "due" is worked out.

// Totals across the library.
//
// Coverage and mastery are pooled rather than averaged. Averaging the
// percentages would let a two-block canvas you abandoned drag down a hundred
// blocks you know cold — every canvas would count the same regardless of size.
// Pooling the underlying counts means a block is a block wherever it lives.
export function librarySummary(rows = []) {
  const list = (rows ?? []).filter(Boolean);

  const totals = {
    canvases: list.length,
    due: 0,
    gaps: 0,
    unscanned: 0,
    weak: 0,
    coverage: null,
    mastery: null,
  };

  let written = 0;
  let coverable = 0;
  let recalled = 0;
  let points = 0;

  for (const row of list) {
    totals.due += row.due ?? 0;
    totals.weak += row.weak ?? 0;
    if (row.scanned) totals.gaps += row.gapCount ?? 0;
    else totals.unscanned += 1;

    if (row.coverage) {
      written += row.coverage.written;
      coverable += row.coverage.total;
    }
    if (row.mastery) {
      recalled += row.mastery.recalled;
      points += row.mastery.total;
    }
  }

  if (coverable > 0) {
    totals.coverage = { written, total: coverable, pct: Math.round((written / coverable) * 100) };
  }
  if (points > 0) {
    totals.mastery = { recalled, total: points, pct: Math.round((recalled / points) * 100) };
  }

  return totals;
}

// The single most useful thing to do right now.
//
// The order is the app's argument about studying, in priority form: recall what
// is slipping first, then find out what you do not know you are missing, then
// shore up what you know you are weak on. Writing more comes last of the four
// because more notes you cannot recall is not progress.
export function nextAction(rows = []) {
  const list = (rows ?? []).filter(Boolean);
  if (list.length === 0) {
    return {
      kind: 'start',
      label: 'Start your first canvas',
      detail: 'Search a topic, then write what you already know about it.',
    };
  }

  const most = (key) =>
    list.reduce((best, row) => ((row[key] ?? 0) > (best?.[key] ?? 0) ? row : best), null);

  const due = most('due');
  if (due && due.due > 0) {
    return {
      kind: 'study',
      canvasId: due.id,
      label: `Study ${due.title}`,
      count: due.due,
      detail: `${due.due} card${due.due === 1 ? '' : 's'} ready — recall is what makes it stick.`,
    };
  }

  // Rows arrive most-recently-updated first, so this picks the canvas you were
  // last working on rather than the oldest thing you have forgotten about.
  const unscanned = list.find((row) => !row.scanned && row.coverage?.written > 0);
  if (unscanned) {
    return {
      kind: 'scan',
      canvasId: unscanned.id,
      label: `Find gaps in ${unscanned.title}`,
      detail: 'Never scanned, so its coverage only counts the blocks you left empty.',
    };
  }

  const weak = most('weak');
  if (weak && weak.weak > 0) {
    return {
      kind: 'weak',
      canvasId: weak.id,
      label: `Shore up ${weak.title}`,
      count: weak.weak,
      detail: `${weak.weak} block${weak.weak === 1 ? '' : 's'} where less than 60% came back.`,
    };
  }

  const gaps = most('gapCount');
  if (gaps && gaps.gapCount > 0) {
    return {
      kind: 'gaps',
      canvasId: gaps.id,
      label: `Work through ${gaps.title}`,
      count: gaps.gapCount,
      detail: `${gaps.gapCount} gap${gaps.gapCount === 1 ? '' : 's'} found and not yet dealt with.`,
    };
  }

  // Genuinely nothing waiting. Said plainly rather than manufacturing a task —
  // an app that always has something for you to do is an app you stop believing.
  return {
    kind: 'clear',
    label: 'Nothing waiting',
    detail: 'Everything is scanned, nothing is due, and nothing is weak. Go and write something new.',
  };
}

// Where you are weakest, across every canvas at once.
//
// The canvas already marks its own weak blocks, but only one canvas at a time —
// so a fact you keep failing in Macroeconomics is invisible while you are looking
// at Cold War. Revision does not respect those boundaries and neither should
// this list.
//
// Only blocks that have actually been tested. A block nobody has asked you about
// is not *known* to be weak, and putting it here on suspicion would bury the
// ones you demonstrably got wrong. Untested work is already visible as mastery
// and as a due count.
export function weakestBlocks(canvases = [], { limit = 6 } = {}) {
  const found = [];

  for (const canvas of canvases ?? []) {
    const reviews = canvas?.reviews ?? {};
    for (const node of canvas?.nodes ?? []) {
      const label = (node?.data?.label ?? '').trim();
      if (!label || !node?.data?.notes?.trim()) continue;

      const score = reviews[node.id]?.lastScore;
      if (!score || !Number.isFinite(score.recalled) || !(score.total > 0)) continue;
      // Perfect recall is not weakness. Anything short of it is worth ranking,
      // so a canvas of near-misses still has a worst one.
      if (score.recalled >= score.total) continue;

      found.push({
        blockId: node.id,
        label,
        canvasId: canvas.id,
        canvasTitle: canvas.title,
        recalled: score.recalled,
        total: score.total,
        fraction: score.recalled / score.total,
        missed: score.total - score.recalled,
      });
    }
  }

  return found
    .sort((a, b) => a.fraction - b.fraction || b.missed - a.missed || a.label.localeCompare(b.label))
    .slice(0, limit);
}

// The library's headline, in words. Only the parts that are actually true — a
// row of zeroes is not a summary.
export function describeLibrary(totals) {
  const parts = [];
  if (totals.due > 0) parts.push(`${totals.due} card${totals.due === 1 ? '' : 's'} due`);
  if (totals.gaps > 0) parts.push(`${totals.gaps} gap${totals.gaps === 1 ? '' : 's'} found`);
  if (totals.unscanned > 0) {
    parts.push(`${totals.unscanned} canvas${totals.unscanned === 1 ? '' : 'es'} never scanned`);
  }
  return parts.join(' · ');
}
