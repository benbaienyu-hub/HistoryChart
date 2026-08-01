// Flashcard deck construction, kept out of StudyMode so the selection and
// ordering rules can be tested without rendering anything.

// Deterministic shuffle (a seeded LCG) so a session's order doesn't reshuffle
// on every re-render — the deck is recomputed from props, not stored.
export function shuffle(list, seed) {
  const out = [...list];
  let state = seed;
  for (let i = out.length - 1; i > 0; i--) {
    state = (state * 1103515245 + 12345) & 0x7fffffff;
    const j = state % (i + 1);
    [out[i], out[j]] = [out[j], out[i]];
  }
  return out;
}

// Notes are usually a few separate facts, not one thing to memorise. Splitting
// them into points lets a card be graded on how much came back rather than on
// whether the whole paragraph did — nobody recalls a block of notes word for
// word, and asking them to isn't what studying is for.

const BULLET = /^\s*(?:[-*•·–—]|\(?\d+[.)])\s+/;

// A period after one of these isn't the end of a sentence.
const ABBREVIATION = /(?:^|\s)(?:e\.g|i\.e|etc|vs|approx|ca|cf|Mr|Mrs|Ms|Dr|Prof|St|Mt|No|Fig|Vol)\.$/i;
const INITIAL = /(?:^|\s)[A-Za-z]\.$/;

// Short enough that on its own it isn't a thing to recall — "1914." or "Roughly."
// belongs with the clause beside it.
const MIN_POINT = 24;

function sentences(line) {
  const out = [];
  const breaks = /[.!?]+["')\]]?\s+/g;
  let start = 0;
  let match;
  while ((match = breaks.exec(line))) {
    const upToPunctuation = line.slice(start, match.index + 1);
    if (ABBREVIATION.test(upToPunctuation) || INITIAL.test(upToPunctuation)) continue;
    out.push(line.slice(start, match.index + match[0].length).trim());
    start = match.index + match[0].length;
  }
  const tail = line.slice(start).trim();
  if (tail) out.push(tail);
  return out;
}

function absorbFragments(list) {
  const out = [];
  for (const item of list) {
    const previous = out[out.length - 1];
    if (previous && (item.length < MIN_POINT || previous.length < MIN_POINT)) {
      out[out.length - 1] = `${previous} ${item}`;
    } else {
      out.push(item);
    }
  }
  return out;
}

// Lines and bullets are the user's own division of the material, so they are
// taken as written. Prose gets split by sentence instead, with fragments
// absorbed so a stray "1914." never becomes a point of its own.
export function splitPoints(notes) {
  const text = String(notes ?? '').trim();
  if (!text) return [];

  const lines = text
    .split(/\r?\n+/)
    .map((line) => line.replace(BULLET, '').trim())
    .filter(Boolean);
  if (lines.length > 1) return lines;

  const points = absorbFragments(sentences(lines[0] ?? text));
  return points.length ? points : [text];
}

// A block becomes a card only once it has notes — the notes are the answer, so
// an empty block would be an unanswerable prompt. Collapsed blocks still count:
// folding a branch is a viewing choice, not a decision to stop studying it.
export function buildDeck(nodes, { flaggedOnly = false, seed = 1, restrictTo = null } = {}) {
  const usable = nodes.filter(
    (n) => n.data.notes?.trim() && (!flaggedOnly || n.data.unsure)
  );

  const cards = usable.map((n) => ({
    id: n.id,
    label: n.data.label,
    notes: n.data.notes,
    points: splitPoints(n.data.notes),
    date: n.data.date,
    category: n.data.category,
    unsure: n.data.unsure,
    // Shown with the answer, not the prompt: a diagram on the front would give
    // away what you are trying to recall.
    images: n.data.images ?? [],
  }));

  const ordered = shuffle(cards, seed);
  return restrictTo ? ordered.filter((c) => restrictTo.includes(c.id)) : ordered;
}

// Grading is per point, so a card is a fraction rather than a pass/fail. The
// points the user didn't tick are carried through by name — knowing *which* fact
// escaped you is the useful part; a bare "missed it" isn't.
export function gradeCard(card, recalled = []) {
  const kept = new Set(recalled);
  const points = card.points ?? splitPoints(card.notes);
  return {
    id: card.id,
    label: card.label,
    category: card.category,
    recalled: points.filter((_, i) => kept.has(i)).length,
    total: points.length,
    missedPoints: points.filter((_, i) => !kept.has(i)),
  };
}

export function sessionTally(grades) {
  const recalled = grades.reduce((sum, g) => sum + g.recalled, 0);
  const total = grades.reduce((sum, g) => sum + g.total, 0);
  return {
    recalled,
    total,
    pct: total ? Math.round((recalled / total) * 100) : 0,
    fullyRecalled: grades.filter((g) => g.total > 0 && g.missedPoints.length === 0).length,
    cards: grades.length,
    missed: grades.filter((g) => g.missedPoints.length > 0),
  };
}

export function flaggedCardCount(nodes) {
  return nodes.filter((n) => n.data.unsure && n.data.notes?.trim()).length;
}
