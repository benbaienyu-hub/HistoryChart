import { describe, expect, it } from 'vitest';
import {
  highlightSegments,
  parseQuery,
  searchCanvases,
  searchTemplates,
} from '../src/lib/canvasSearch';
import { node } from './helpers';

function canvas(title, blocks = []) {
  return {
    id: title,
    title,
    updatedAt: 1,
    nodes: blocks.map(([label, notes = ''], i) => node(`n${i}`, null, { label, notes })),
    edges: [],
  };
}

const titles = (results) => results.map((r) => r.canvas.title);

describe('parseQuery', () => {
  it('splits on whitespace and lowercases', () => {
    expect(parseQuery('  Battle  of ADWA ')).toEqual(['battle', 'of', 'adwa']);
  });

  it('is empty for blank input, which means "no filter"', () => {
    expect(parseQuery('')).toEqual([]);
    expect(parseQuery('    ')).toEqual([]);
    expect(parseQuery(null)).toEqual([]);
    expect(parseQuery(undefined)).toEqual([]);
  });
});

describe('searchCanvases', () => {
  const library = [
    canvas('Ethiopia', [['Geography', 'The highlands hold most of the farmland.']]),
    canvas('History revision', [['Adwa', 'Italy was defeated in 1896.']]),
    canvas('Photosynthesis', [['Chloroplasts', 'Where the light reactions happen.']]),
  ];

  it('returns everything, unfiltered, for an empty query', () => {
    expect(titles(searchCanvases(library, ''))).toEqual([
      'Ethiopia',
      'History revision',
      'Photosynthesis',
    ]);
  });

  it('matches a title', () => {
    expect(titles(searchCanvases(library, 'ethiopia'))).toEqual(['Ethiopia']);
  });

  it('is case-insensitive', () => {
    expect(titles(searchCanvases(library, 'ETHIOPIA'))).toEqual(['Ethiopia']);
  });

  it('matches a block title, so a canvas named something else is still findable', () => {
    // The whole reason search covers content: this canvas is called "History
    // revision" and nothing about the name would ever lead you to Adwa.
    expect(titles(searchCanvases(library, 'adwa'))).toEqual(['History revision']);
  });

  it('matches the notes inside a block', () => {
    expect(titles(searchCanvases(library, 'chloroplast'))).toEqual(['Photosynthesis']);
    expect(titles(searchCanvases(library, '1896'))).toEqual(['History revision']);
  });

  it('requires every term to match, but not in the same field', () => {
    const one = canvas('Ethiopia', [['Adwa', 'A battle in 1896.']]);
    const two = canvas('Ethiopia', [['Geography', 'Highlands.']]);
    expect(titles(searchCanvases([one, two], 'ethiopia adwa'))).toEqual(['Ethiopia']);
    expect(searchCanvases([two], 'ethiopia adwa')).toEqual([]);
  });

  it('puts title matches ahead of content-only matches', () => {
    const mentions = canvas('Africa notes', [['Ethiopia', 'A country in the Horn.']]);
    const named = canvas('Ethiopia', [['Geography', '']]);
    expect(titles(searchCanvases([mentions, named], 'ethiopia'))).toEqual([
      'Ethiopia',
      'Africa notes',
    ]);
  });

  it('keeps the caller’s order within a group, so recency still wins ties', () => {
    const a = { ...canvas('Rome A', [['x', 'legion']]), updatedAt: 2 };
    const b = { ...canvas('Rome B', [['y', 'legion']]), updatedAt: 1 };
    expect(titles(searchCanvases([a, b], 'legion'))).toEqual(['Rome A', 'Rome B']);
  });

  it('names the blocks that matched, so the card can say why it is here', () => {
    const [result] = searchCanvases(library, 'adwa');
    expect(result.matchedBlocks).toEqual(['Adwa']);
    expect(result.inTitle).toBe(false);
  });

  it('does not name blocks when the title already explains the match', () => {
    const [result] = searchCanvases(library, 'ethiopia');
    expect(result.inTitle).toBe(true);
    expect(result.matchedBlocks).toEqual([]);
  });

  it('names at most three blocks — past that it is noise, not a reason', () => {
    const many = canvas('Big', [
      ['One', 'term'],
      ['Two', 'term'],
      ['Three', 'term'],
      ['Four', 'term'],
      ['Five', 'term'],
    ]);
    expect(searchCanvases([many], 'term')[0].matchedBlocks).toHaveLength(3);
  });

  it('does not repeat a block name that matched twice', () => {
    const twice = canvas('Dup', [['Adwa', 'Adwa was decisive.']]);
    expect(searchCanvases([twice], 'adwa')[0].matchedBlocks).toEqual(['Adwa']);
  });

  it('skips a matched block with no title, which would render as an empty name', () => {
    const unnamed = canvas('Untitled', [['', 'mentions adwa']]);
    expect(searchCanvases([unnamed], 'adwa')[0].matchedBlocks).toEqual([]);
  });

  it('survives a canvas with no blocks at all', () => {
    expect(titles(searchCanvases([canvas('Empty')], 'empty'))).toEqual(['Empty']);
    expect(searchCanvases([canvas('Empty')], 'nothing')).toEqual([]);
  });

  it('handles a missing list', () => {
    expect(searchCanvases(undefined, 'x')).toEqual([]);
    expect(searchCanvases(null, '')).toEqual([]);
  });
});

describe('searchTemplates', () => {
  const templates = [
    {
      key: 'a',
      title: 'The Cold War',
      blurb: 'Two superpowers, forty years.',
      searchText: 'Sputnik 1957 The first satellite reached orbit.',
    },
    { key: 'b', title: 'Photosynthesis', blurb: 'Light and dark reactions.', searchText: '' },
  ];

  it('returns all of them for an empty query', () => {
    expect(searchTemplates(templates, '')).toHaveLength(2);
  });

  it('matches the title or the blurb', () => {
    expect(searchTemplates(templates, 'cold').map((t) => t.key)).toEqual(['a']);
    expect(searchTemplates(templates, 'reactions').map((t) => t.key)).toEqual(['b']);
  });

  it('reaches the blocks inside an example, like it does for a real canvas', () => {
    expect(searchTemplates(templates, 'sputnik').map((t) => t.key)).toEqual(['a']);
    expect(searchTemplates(templates, '1957').map((t) => t.key)).toEqual(['a']);
  });

  it('tolerates a template with no flattened text', () => {
    expect(searchTemplates([{ key: 'c', title: 'X', blurb: 'y' }], 'x').map((t) => t.key)).toEqual([
      'c',
    ]);
  });

  it('returns nothing when a term matches neither', () => {
    expect(searchTemplates(templates, 'ethiopia')).toEqual([]);
  });
});

describe('highlightSegments', () => {
  it('splits a title around the match', () => {
    expect(highlightSegments('The Ethiopian highlands', ['ethiopian'])).toEqual([
      { text: 'The ', hit: false },
      { text: 'Ethiopian', hit: true },
      { text: ' highlands', hit: false },
    ]);
  });

  it('marks every occurrence', () => {
    expect(highlightSegments('ab ab', ['ab'])).toEqual([
      { text: 'ab', hit: true },
      { text: ' ', hit: false },
      { text: 'ab', hit: true },
    ]);
  });

  it('merges overlapping terms rather than nesting them', () => {
    // "ada" and "ad" both hit the same characters; one run must come out.
    expect(highlightSegments('Adams', ['ada', 'ad'])).toEqual([
      { text: 'Ada', hit: true },
      { text: 'ms', hit: false },
    ]);
  });

  it('handles a term that runs to the end of the text', () => {
    expect(highlightSegments('Rome', ['ome'])).toEqual([
      { text: 'R', hit: false },
      { text: 'ome', hit: true },
    ]);
  });

  it('returns the text whole when nothing matches', () => {
    expect(highlightSegments('Rome', ['carthage'])).toEqual([{ text: 'Rome', hit: false }]);
    expect(highlightSegments('Rome', [])).toEqual([{ text: 'Rome', hit: false }]);
  });

  it('never loses or duplicates a character', () => {
    const text = 'The Battle of Adwa, 1896';
    for (const terms of [['a'], ['the', 'a'], ['battle', 'adwa'], ['189'], ['e', 'a', 'o']]) {
      expect(highlightSegments(text, terms).map((s) => s.text).join('')).toBe(text);
    }
  });

  it('copes with empty text', () => {
    expect(highlightSegments('', ['a'])).toEqual([{ text: '', hit: false }]);
    expect(highlightSegments(null, ['a'])).toEqual([{ text: '', hit: false }]);
  });
});
