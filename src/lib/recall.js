// Grading typed free recall against a card's points.
//
// Typing beats ticking, because ticking is generous: shown the answer, you will
// reliably believe you knew it. Writing it first makes that self-deception harder.
//
// But a typed answer can't be compared literally — nobody reproduces a sentence
// word for word, and demanding it would be exactly the mistake the per-point
// grading exists to avoid. So each point is reduced to the words that carry its
// meaning, and a point counts as recalled when enough of them turn up in what you
// wrote, in any order and any phrasing around them.
//
// The matcher is a suggestion, not a verdict: it pre-fills the same checklist the
// self-check mode uses, and the user can overrule it. That matters, because no
// keyword rule will ever understand a paraphrase.

// Words that carry no meaning on their own. A point matched on "the" and "of"
// would be a false pass.
const STOPWORDS = new Set([
  'a', 'an', 'and', 'are', 'as', 'at', 'be', 'been', 'but', 'by', 'can', 'did', 'do',
  'for', 'from', 'had', 'has', 'have', 'he', 'her', 'his', 'how', 'in', 'into', 'is', 'it',
  'its', 'made', 'make', 'many', 'may', 'more', 'most', 'much', 'no', 'not', 'of', 'on',
  'one', 'or', 'other', 'our', 'out', 'over', 'own', 'she', 'so', 'some', 'such', 'than',
  'that', 'the', 'their', 'them', 'then', 'there', 'these', 'they', 'this', 'those', 'to',
  'under', 'up', 'very', 'was', 'were', 'what', 'when', 'where', 'which', 'while', 'who',
  'why', 'will', 'with', 'would', 'you', 'your', 'also', 'about', 'after', 'before',
  'between', 'both', 'during', 'each', 'if', 'because', 'through', 'were',
]);

// Two characters is never a distinguishing word; numbers are, always.
const MIN_WORD = 3;

// How much of a point has to appear before it counts. Two thirds is forgiving
// enough for paraphrase but not so loose that one shared word passes a point.
export const MATCH_THRESHOLD = 0.6;

// Folds accents so "Adwa" typed without a diacritic still matches, and drops
// punctuation so "1896," and "1896" are the same word.
export function normalize(text) {
  return String(text ?? '')
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^\p{L}\p{N}\s-]/gu, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

// A crude singular: enough to match "highlands" against "highland" without
// dragging in a stemming library.
function stem(word) {
  if (word.length > 4 && word.endsWith('ies')) return `${word.slice(0, -3)}y`;
  if (word.length > 3 && word.endsWith('es')) return word.slice(0, -2);
  if (word.length > 3 && word.endsWith('s') && !word.endsWith('ss')) return word.slice(0, -1);
  return word;
}

export function wordsOf(text) {
  return normalize(text)
    .split(' ')
    .filter(Boolean)
    .flatMap((word) => word.split('-').filter(Boolean));
}

// The words that make a point what it is: content words and every number.
export function keywordsOf(point) {
  const seen = new Set();
  const keywords = [];
  for (const word of wordsOf(point)) {
    const isNumber = /\d/.test(word);
    if (!isNumber && (word.length < MIN_WORD || STOPWORDS.has(word))) continue;
    const key = isNumber ? word : stem(word);
    if (seen.has(key)) continue;
    seen.add(key);
    keywords.push({ word, key, isNumber });
  }
  return keywords;
}

// Compares one point against what the user typed. Reports the words it found and
// the ones it didn't, so the UI can show *why* it judged as it did rather than
// just handing down a tick.
export function matchPoint(typed, point) {
  const keywords = keywordsOf(point);
  // A point with no content words — "1889" alone, say — is matched on its numbers,
  // and a point that reduces to nothing at all can only be judged by a person.
  if (keywords.length === 0) return { matched: false, ratio: 0, hit: [], missed: [] };

  const typedKeys = new Set(
    wordsOf(typed).map((word) => (/\d/.test(word) ? word : stem(word)))
  );

  const hit = keywords.filter((k) => typedKeys.has(k.key));
  const missed = keywords.filter((k) => !typedKeys.has(k.key));
  const ratio = hit.length / keywords.length;

  // A date or quantity is usually the whole point of the point. Getting the words
  // around it right while missing the number is not recalling it.
  const numbers = keywords.filter((k) => k.isNumber);
  const missedANumber = numbers.length > 0 && numbers.some((k) => !typedKeys.has(k.key));

  return {
    matched: ratio >= MATCH_THRESHOLD && !missedANumber,
    ratio,
    hit: hit.map((k) => k.word),
    missed: missed.map((k) => k.word),
  };
}

// Judges a whole card. Returns which point indexes to tick, plus the per-point
// detail behind that decision.
export function gradeTyped(typed, points) {
  const results = (points ?? []).map((point, index) => ({
    index,
    point,
    ...matchPoint(typed, point),
  }));
  return {
    recalled: results.filter((r) => r.matched).map((r) => r.index),
    results,
  };
}
