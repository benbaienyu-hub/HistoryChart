import { describe, expect, it } from 'vitest';
import {
  buildDeck,
  flaggedCardCount,
  gradeCard,
  sessionTally,
  shuffle,
  splitPoints,
} from '../src/lib/deck';
import { node } from './helpers';

function card(id, { notes = 'some notes', unsure = false, collapsed = false } = {}) {
  return node(id, null, { notes, unsure, collapsed });
}

const ids = (deck) => deck.map((c) => c.id).sort();

describe('shuffle', () => {
  it('is a permutation — nothing lost, nothing added', () => {
    const input = [1, 2, 3, 4, 5, 6, 7, 8];
    expect([...shuffle(input, 7)].sort((a, b) => a - b)).toEqual(input);
  });

  it('is deterministic for a given seed', () => {
    const input = [1, 2, 3, 4, 5, 6, 7, 8];
    expect(shuffle(input, 3)).toEqual(shuffle(input, 3));
  });

  it('a different seed generally gives a different order', () => {
    const input = Array.from({ length: 20 }, (_, i) => i);
    expect(shuffle(input, 1)).not.toEqual(shuffle(input, 2));
  });

  it('does not mutate the input', () => {
    const input = [1, 2, 3];
    shuffle(input, 5);
    expect(input).toEqual([1, 2, 3]);
  });

  it('handles empty and single-item lists', () => {
    expect(shuffle([], 1)).toEqual([]);
    expect(shuffle(['x'], 1)).toEqual(['x']);
  });
});

describe('buildDeck', () => {
  it('only includes blocks that have notes — the notes are the answer', () => {
    const nodes = [card('a'), card('b', { notes: '' }), card('c', { notes: '   ' })];
    expect(ids(buildDeck(nodes))).toEqual(['a']);
  });

  it('flaggedOnly keeps just the flagged blocks', () => {
    const nodes = [card('a', { unsure: true }), card('b')];
    expect(ids(buildDeck(nodes, { flaggedOnly: true }))).toEqual(['a']);
    expect(ids(buildDeck(nodes))).toEqual(['a', 'b']);
  });

  it('a flagged block with no notes still cannot be a card', () => {
    const nodes = [card('a', { unsure: true, notes: '' })];
    expect(buildDeck(nodes, { flaggedOnly: true })).toEqual([]);
  });

  it('includes collapsed blocks — folding a branch is a viewing choice', () => {
    const nodes = [card('a', { collapsed: true }), card('b')];
    expect(ids(buildDeck(nodes))).toEqual(['a', 'b']);
  });

  it('restrictTo narrows the deck to the given ids', () => {
    const nodes = [card('a'), card('b'), card('c')];
    expect(ids(buildDeck(nodes, { restrictTo: ['a', 'c'] }))).toEqual(['a', 'c']);
  });

  it('restrictTo ids that are no longer cards are simply absent', () => {
    const nodes = [card('a')];
    expect(ids(buildDeck(nodes, { restrictTo: ['a', 'gone'] }))).toEqual(['a']);
  });

  it('carries the fields a card needs to render', () => {
    const nodes = [node('a', null, { notes: 'n', date: '1914', category: 'event', unsure: true })];
    expect(buildDeck(nodes)[0]).toEqual({
      id: 'a',
      label: 'a',
      notes: 'n',
      points: ['n'],
      images: [],
      date: '1914',
      category: 'event',
      unsure: true,
    });
  });

  it('is stable for a seed, so a re-render does not reshuffle mid-session', () => {
    const nodes = Array.from({ length: 10 }, (_, i) => card(`n${i}`));
    expect(buildDeck(nodes, { seed: 4 })).toEqual(buildDeck(nodes, { seed: 4 }));
  });

  it('is empty for an empty canvas', () => {
    expect(buildDeck([])).toEqual([]);
  });
});

describe('splitPoints', () => {
  it('has nothing to recall in empty notes', () => {
    expect(splitPoints('')).toEqual([]);
    expect(splitPoints('   \n  ')).toEqual([]);
    expect(splitPoints(null)).toEqual([]);
  });

  it('treats the user’s own lines as the division of the material', () => {
    expect(splitPoints('Grew from 1889\nCapital is Addis Ababa\nNever colonised')).toEqual([
      'Grew from 1889',
      'Capital is Addis Ababa',
      'Never colonised',
    ]);
  });

  it('strips bullet and numbering markers, whichever style is used', () => {
    expect(splitPoints('- one thing\n* another\n• a third\n1. a fourth\n2) a fifth')).toEqual([
      'one thing',
      'another',
      'a third',
      'a fourth',
      'a fifth',
    ]);
  });

  it('respects a short line the user chose to write on its own', () => {
    // Their split, their call — merging it would second-guess an explicit choice.
    expect(splitPoints('1889\nAddis Ababa becomes the capital')).toEqual([
      '1889',
      'Addis Ababa becomes the capital',
    ]);
  });

  it('splits a paragraph into sentences, so each is gradeable', () => {
    const notes =
      'Ethiopia sits in the Horn of Africa. It was never colonised by a European power. ' +
      'The highlands make up most of the interior.';
    expect(splitPoints(notes)).toEqual([
      'Ethiopia sits in the Horn of Africa.',
      'It was never colonised by a European power.',
      'The highlands make up most of the interior.',
    ]);
  });

  it('keeps abbreviations and initials inside their sentence', () => {
    expect(
      splitPoints('Highland crops, e.g. teff, dominate the plateau farms of the north.')
    ).toEqual(['Highland crops, e.g. teff, dominate the plateau farms of the north.']);
    expect(splitPoints('Named after W. E. B. Du Bois, whose panafricanism shaped it.')).toEqual([
      'Named after W. E. B. Du Bois, whose panafricanism shaped it.',
    ]);
  });

  it('absorbs a fragment rather than making it a point of its own', () => {
    const points = splitPoints('Battle of Adwa, 1896. Decisive. Italy recognised independence.');
    // "Decisive." is not something to recall by itself, so it rides along with
    // the clause before it. The sentence after it still stands on its own.
    expect(points).toEqual([
      'Battle of Adwa, 1896. Decisive.',
      'Italy recognised independence.',
    ]);
  });

  it('keeps question and exclamation marks as sentence ends', () => {
    expect(splitPoints('Why did the empire hold together? Terrain and a strong core army.')).toEqual(
      ['Why did the empire hold together?', 'Terrain and a strong core army.']
    );
  });

  it('a single short note is one point, never zero', () => {
    expect(splitPoints('1974')).toEqual(['1974']);
  });

  it('loses none of the text it was given', () => {
    const notes = 'First fact here, at length. Second fact here, also long enough.';
    const joined = splitPoints(notes).join(' ');
    expect(joined.replace(/\s+/g, ' ')).toBe(notes);
  });
});

describe('gradeCard', () => {
  const card = { id: 'a', label: 'Ethiopia', category: 'place', points: ['one', 'two', 'three'] };

  it('scores the ticked points and names the ones missed', () => {
    expect(gradeCard(card, [0, 2])).toEqual({
      id: 'a',
      label: 'Ethiopia',
      category: 'place',
      recalled: 2,
      total: 3,
      missedPoints: ['two'],
    });
  });

  it('a card recalled in full has no missed points', () => {
    expect(gradeCard(card, [0, 1, 2]).missedPoints).toEqual([]);
  });

  it('no ticks means everything is missed, not that the card is skipped', () => {
    const grade = gradeCard(card, []);
    expect(grade.recalled).toBe(0);
    expect(grade.missedPoints).toEqual(['one', 'two', 'three']);
    expect(grade.total).toBe(3);
  });

  it('ignores a duplicate or out-of-range tick', () => {
    expect(gradeCard(card, [1, 1, 9]).recalled).toBe(1);
  });

  it('falls back to splitting the notes if a card carries no points', () => {
    const grade = gradeCard({ id: 'b', label: 'B', notes: 'Alpha here.\nBeta here.' }, [0]);
    expect(grade.total).toBe(2);
    expect(grade.missedPoints).toEqual(['Beta here.']);
  });
});

describe('sessionTally', () => {
  const grades = [
    { id: 'a', label: 'A', recalled: 2, total: 3, missedPoints: ['x'] },
    { id: 'b', label: 'B', recalled: 2, total: 2, missedPoints: [] },
    { id: 'c', label: 'C', recalled: 0, total: 1, missedPoints: ['y'] },
  ];

  it('totals points rather than cards, so partial recall counts', () => {
    const tally = sessionTally(grades);
    expect(tally.recalled).toBe(4);
    expect(tally.total).toBe(6);
    expect(tally.pct).toBe(67);
  });

  it('reports how many cards came back in full, alongside the point score', () => {
    const tally = sessionTally(grades);
    expect(tally.fullyRecalled).toBe(1);
    expect(tally.cards).toBe(3);
  });

  it('collects only the cards with gaps, for the retry list', () => {
    expect(sessionTally(grades).missed.map((g) => g.id)).toEqual(['a', 'c']);
  });

  it('is zero, not NaN, for a session with nothing in it', () => {
    expect(sessionTally([])).toEqual({
      recalled: 0,
      total: 0,
      pct: 0,
      fullyRecalled: 0,
      cards: 0,
      missed: [],
    });
  });

  it('a perfect session leaves nothing to retry', () => {
    const tally = sessionTally([{ id: 'a', recalled: 3, total: 3, missedPoints: [] }]);
    expect(tally.pct).toBe(100);
    expect(tally.missed).toEqual([]);
  });
});

describe('images on a card', () => {
  it('carries a block’s images through to the card', () => {
    const withImage = node('a', null, {
      notes: 'some notes',
      images: [{ id: 'i1', url: '/api/images/i1', name: 'diagram.png' }],
    });
    expect(buildDeck([withImage])[0].images).toEqual([
      { id: 'i1', url: '/api/images/i1', name: 'diagram.png' },
    ]);
  });

  it('defaults to none, so an old canvas has no undefined to render', () => {
    expect(buildDeck([node('a', null, { notes: 'x' })])[0].images).toEqual([]);
  });

  it('an image alone does not make a card — the notes are still the answer', () => {
    const pictureOnly = node('a', null, {
      notes: '',
      images: [{ id: 'i1', url: '/api/images/i1', name: 'x.png' }],
    });
    expect(buildDeck([pictureOnly])).toEqual([]);
  });
});

describe('flaggedCardCount', () => {
  it('counts flagged blocks that could actually become cards', () => {
    const nodes = [
      card('a', { unsure: true }),
      card('b', { unsure: true, notes: '' }),
      card('c'),
    ];
    expect(flaggedCardCount(nodes)).toBe(1);
  });
});
