import { describe, expect, it } from 'vitest';
import { MATCH_THRESHOLD, gradeTyped, keywordsOf, matchPoint, normalize } from '../src/lib/recall';

const words = (point) => keywordsOf(point).map((k) => k.word);

describe('normalize', () => {
  it('lowercases, drops punctuation, and collapses spacing', () => {
    expect(normalize('  The Battle of Adwa, 1896!  ')).toBe('the battle of adwa 1896');
  });

  it('folds accents, so a diacritic nobody types is not a wrong answer', () => {
    expect(normalize('café')).toBe(normalize('cafe'));
    expect(normalize('Menelik’s')).toBe('menelik s');
  });

  it('keeps hyphens for splitting, and numbers intact', () => {
    expect(normalize('13-day standoff in 1962')).toBe('13-day standoff in 1962');
  });
});

describe('keywordsOf', () => {
  it('keeps the words that carry the meaning', () => {
    expect(words('The plateau holds most of the farmland')).toEqual(['plateau', 'holds', 'farmland']);
  });

  it('drops filler, which would otherwise pass a point on its own', () => {
    expect(words('It was in there with them')).toEqual([]);
  });

  it('keeps every number, however short', () => {
    // "13" is two characters but it is the whole point of "a 13-day standoff".
    expect(words('A 13-day standoff in 1962')).toEqual(['13', 'day', 'standoff', '1962']);
  });

  it('does not count the same word twice', () => {
    expect(words('Teff, teff and more teff')).toEqual(['teff']);
  });

  it('treats a plural and its singular as the same word', () => {
    expect(keywordsOf('highlands')[0].key).toBe(keywordsOf('highland')[0].key);
    expect(keywordsOf('countries')[0].key).toBe(keywordsOf('country')[0].key);
  });

  it('leaves a double-s word alone', () => {
    // Naive de-pluralising turns "grass" into "gras" and stops matching itself.
    expect(keywordsOf('grass')[0].key).toBe('grass');
  });
});

describe('matchPoint', () => {
  const point = 'The plateau holds most of the farmland';

  it('matches a paraphrase that keeps the substance', () => {
    expect(matchPoint('most farmland is on the plateau', point).matched).toBe(true);
  });

  it('does not match a sentence that merely shares a word', () => {
    expect(matchPoint('the plateau is high up', point).matched).toBe(false);
  });

  it('ignores word order and the wording in between', () => {
    expect(matchPoint('farmland, plateau — it holds it', point).matched).toBe(true);
  });

  it('is case- and punctuation-insensitive', () => {
    expect(matchPoint('PLATEAU! HOLDS?? FARMLAND.', point).matched).toBe(true);
  });

  it('reports what it found and what it missed, so the judgement is visible', () => {
    const result = matchPoint('the plateau has farmland', point);
    expect(result.hit).toEqual(['plateau', 'farmland']);
    expect(result.missed).toEqual(['holds']);
    expect(result.ratio).toBeCloseTo(2 / 3);
  });

  it('refuses a point whose date you did not write', () => {
    // The most important rule here. "Adwa was a battle" is not recalling
    // "Battle of Adwa, 1896" — the year is the fact being tested.
    const dated = 'Battle of Adwa, 1896, defeated an Italian invasion';
    const nearly = matchPoint('the battle of adwa defeated an italian invasion', dated);
    expect(nearly.ratio).toBeGreaterThan(MATCH_THRESHOLD);
    expect(nearly.matched).toBe(false);
    expect(matchPoint('battle of adwa 1896 beat an italian invasion', dated).matched).toBe(true);
  });

  it('matches a point that is only a number', () => {
    expect(matchPoint('it was 1889', '1889').matched).toBe(true);
    expect(matchPoint('it was 1890', '1889').matched).toBe(false);
  });

  it('cannot judge a point with nothing to match on', () => {
    // All filler: no keywords, so it stays unticked for a person to decide.
    expect(matchPoint('anything at all', 'It was as it was').matched).toBe(false);
  });

  it('matches nothing when the user typed nothing', () => {
    expect(matchPoint('', point).matched).toBe(false);
    expect(matchPoint('   ', point).matched).toBe(false);
    expect(matchPoint(undefined, point).matched).toBe(false);
  });
});

describe('gradeTyped', () => {
  const points = [
    'The plateau holds most of the farmland',
    'Teff is the staple grain',
    'Battle of Adwa, 1896',
  ];

  it('ticks the points it found in one pass of free writing', () => {
    const typed = 'teff is the staple grain and most farmland is up on the plateau';
    expect(gradeTyped(typed, points).recalled).toEqual([0, 1]);
  });

  it('gives back per-point detail alongside the ticks', () => {
    const { results } = gradeTyped('teff grain', points);
    expect(results).toHaveLength(3);
    expect(results[1]).toMatchObject({ index: 1, matched: true });
    expect(results[0].missed.length).toBeGreaterThan(0);
  });

  it('recognises a full answer', () => {
    const typed =
      'The plateau holds most of the farmland. Teff is the staple grain. Battle of Adwa in 1896.';
    expect(gradeTyped(typed, points).recalled).toEqual([0, 1, 2]);
  });

  it('ticks nothing for an empty answer, which is the honest score', () => {
    expect(gradeTyped('', points).recalled).toEqual([]);
  });

  it('is not fooled by typing the block title back', () => {
    // Writing "Ethiopian highlands" should not score points about farmland.
    expect(gradeTyped('Ethiopian highlands', points).recalled).toEqual([]);
  });

  it('handles a card with no points', () => {
    expect(gradeTyped('anything', [])).toEqual({ recalled: [], results: [] });
    expect(gradeTyped('anything', undefined).recalled).toEqual([]);
  });
});
