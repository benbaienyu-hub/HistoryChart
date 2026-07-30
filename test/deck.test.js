import { describe, expect, it } from 'vitest';
import { buildDeck, flaggedCardCount, shuffle } from '../src/lib/deck';
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
