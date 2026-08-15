import { describe, expect, it } from 'vitest';
import {
  MAX_SUGGESTIONS,
  describePlacement,
  gapIdFromSuggestion,
  isSuggestionId,
  planInsertion,
  suggestibleGaps,
  suggestionGraph,
  suggestionId,
} from '../src/lib/suggestions';

// A three-block chain, which is the shape the feature exists for:
// WWI → Versailles → Hitler, with the step between them missing.
const chain = () => [
  { id: 'wwi', position: { x: 0, y: 0 }, data: { label: 'WWI', parentId: null } },
  { id: 'ver', position: { x: 0, y: 300 }, data: { label: 'Versailles', parentId: 'wwi' } },
  { id: 'hit', position: { x: 0, y: 600 }, data: { label: 'Hitler', parentId: 'ver' } },
];

const gap = (over = {}) => ({
  id: 'missing-0-weimar',
  kind: 'missing',
  blockId: null,
  afterId: null,
  afterLabel: null,
  beforeId: null,
  beforeLabel: null,
  title: 'Weimar Republic',
  detail: 'Nothing here explains what the treaty produced.',
  hint: 'What kind of state came out of it?',
  question: 'What replaced the Kaiserreich?',
  answer: 'The Weimar Republic.',
  fill: ['The Weimar Republic was founded in 1919.'],
  ...over,
});

describe('which gaps become blocks', () => {
  it('is only the missing ones', () => {
    // A wrong or thin claim is about a block that already exists. There is
    // nothing to put on the canvas between anything, and a ghost block saying
    // "this is wrong" would misrepresent what it is.
    const gaps = [gap(), gap({ id: 'b', kind: 'incorrect' }), gap({ id: 'c', kind: 'incomplete' })];
    expect(suggestibleGaps(gaps).map((g) => g.id)).toEqual(['missing-0-weimar']);
  });

  it('survives a missing list', () => {
    expect(suggestibleGaps()).toEqual([]);
    expect(suggestibleGaps(null)).toEqual([]);
  });
});

describe('suggestion ids', () => {
  it('round-trip, and never collide with a real block id', () => {
    const id = suggestionId('missing-0-weimar');
    expect(isSuggestionId(id)).toBe(true);
    expect(isSuggestionId('9c1f-uuid-looking-thing')).toBe(false);
    expect(gapIdFromSuggestion(id)).toBe('missing-0-weimar');
  });
});

describe('suggestionGraph', () => {
  it('puts a between-gap between the two blocks it names', () => {
    const { nodes } = suggestionGraph([gap({ afterId: 'wwi', beforeId: 'ver' })], chain());
    expect(nodes).toHaveLength(1);
    // Halfway down, which is the whole point: the position is the argument.
    expect(nodes[0].position.y).toBe(150);
  });

  it('draws the arrows through it, so the chain reads with the hole in it', () => {
    const { edges } = suggestionGraph([gap({ afterId: 'wwi', beforeId: 'ver' })], chain());
    const ghost = suggestionId('missing-0-weimar');
    expect(edges.map((e) => [e.source, e.target])).toEqual([
      ['wwi', ghost],
      [ghost, 'ver'],
    ]);
    expect(edges.every((e) => e.style.strokeDasharray)).toBeTruthy();
  });

  it('hangs an after-only gap below the block it follows', () => {
    const { nodes, edges } = suggestionGraph([gap({ afterId: 'wwi' })], chain());
    expect(nodes[0].position.y).toBeGreaterThan(0);
    expect(edges).toEqual([expect.objectContaining({ source: 'wwi' })]);
  });

  it('puts a before-only gap above the block it leads into', () => {
    const { nodes, edges } = suggestionGraph([gap({ beforeId: 'hit' })], chain());
    expect(nodes[0].position.y).toBeLessThan(600);
    expect(edges).toEqual([expect.objectContaining({ target: 'hit' })]);
  });

  it('parks an unattached gap off to the right, with no arrows', () => {
    // It is an aside, and drawing an edge would claim a relationship the model
    // did not report.
    const { nodes, edges } = suggestionGraph([gap()], chain());
    expect(nodes[0].position.x).toBeGreaterThan(0);
    expect(edges).toEqual([]);
  });

  it('ignores a block reference that is not on the canvas', () => {
    const { nodes, edges } = suggestionGraph([gap({ afterId: 'ghost-town' })], chain());
    expect(nodes).toHaveLength(1);
    expect(edges).toEqual([]);
  });

  it('does not stack two suggestions on the same spot', () => {
    const { nodes } = suggestionGraph(
      [
        gap({ id: 'one', afterId: 'wwi', beforeId: 'ver' }),
        gap({ id: 'two', afterId: 'wwi', beforeId: 'ver' }),
      ],
      chain()
    );
    expect(nodes[0].position).not.toEqual(nodes[1].position);
  });

  it('moves a crowded suggestion aside rather than below', () => {
    // A tight chain leaves no room at the midpoint, and the height is what
    // carries the meaning: level with the space between two blocks still reads
    // as "between them", however far out to the side. Below both of them reads
    // as "after", which is a different claim.
    const tight = [
      { id: 'a', position: { x: 0, y: 0 }, data: { label: 'A', parentId: null } },
      { id: 'b', position: { x: 0, y: 240 }, data: { label: 'B', parentId: 'a' } },
    ];
    const [ghost] = suggestionGraph([gap({ afterId: 'a', beforeId: 'b' })], tight).nodes;
    expect(ghost.position.y).toBe(120);
    expect(ghost.position.x).toBeGreaterThan(0);
  });

  it('does not drop a suggestion on top of a real block either', () => {
    const nodes = [
      { id: 'a', position: { x: 0, y: 0 }, data: { label: 'A', parentId: null } },
      { id: 'b', position: { x: 0, y: 600 }, data: { label: 'B', parentId: 'a' } },
      // Sitting exactly where a between-gap would land.
      { id: 'c', position: { x: 0, y: 300 }, data: { label: 'C', parentId: null } },
    ];
    const { nodes: ghosts } = suggestionGraph([gap({ afterId: 'a', beforeId: 'b' })], nodes);
    expect(ghosts[0].position).not.toEqual({ x: 0, y: 300 });
  });

  it('leaves out anything already accepted or turned down', () => {
    const gaps = [gap({ id: 'kept' }), gap({ id: 'gone' }), gap({ id: 'added' })];
    const { nodes } = suggestionGraph(gaps, chain(), {
      dismissed: new Set(['gone']),
      accepted: new Set(['added']),
    });
    expect(nodes.map((n) => n.data.gap.id)).toEqual(['kept']);
  });

  it('caps how many are drawn, since a canvas of dashed boxes hides the hole', () => {
    const many = Array.from({ length: 12 }, (_, i) => gap({ id: `g${i}` }));
    expect(suggestionGraph(many, chain()).nodes).toHaveLength(MAX_SUGGESTIONS);
  });

  it('makes ghosts inert — not draggable, selectable, or connectable', () => {
    // They are proposals. Anything that behaves like a block you own would say
    // you had already accepted it.
    const [ghost] = suggestionGraph([gap()], chain()).nodes;
    expect(ghost).toMatchObject({
      type: 'suggestion',
      draggable: false,
      selectable: false,
      connectable: false,
      deletable: false,
    });
  });

  it('puts the pointer events back, since React Flow removes them', () => {
    // React Flow switches pointer events off for a node that is neither
    // selectable nor draggable — which is exactly what a ghost is, and which
    // would leave its three buttons dead.
    const [ghost] = suggestionGraph([gap()], chain()).nodes;
    expect(ghost.style).toMatchObject({ pointerEvents: 'all' });
    expect(ghost.zIndex).toBeGreaterThan(0);
  });

  it('survives an empty canvas and junk input', () => {
    expect(suggestionGraph([gap()], []).nodes).toHaveLength(1);
    expect(suggestionGraph([], chain())).toEqual({ nodes: [], edges: [] });
    expect(suggestionGraph(undefined, undefined)).toEqual({ nodes: [], edges: [] });
  });
});

describe('planInsertion', () => {
  it('threads a block into the chain when the two really are parent and child', () => {
    // The showcase: WWI → Versailles → Hitler becomes
    // WWI → Versailles → Weimar → Hitler.
    const plan = planInsertion(gap({ afterId: 'ver', beforeId: 'hit' }), chain());
    expect(plan).toMatchObject({
      parentId: 'ver',
      isRoot: false,
      reparent: 'hit',
      relateTo: null,
      unlink: { source: 'ver', target: 'hit' },
    });
  });

  it('will not rearrange a structure the user built on a guess', () => {
    // Two blocks that are not parent and child: the relationship gets drawn as a
    // relation instead of faked as parentage.
    const plan = planInsertion(gap({ afterId: 'wwi', beforeId: 'hit' }), chain());
    expect(plan).toMatchObject({ parentId: 'wwi', reparent: null, relateTo: 'hit', unlink: null });
  });

  it('hangs an after-only gap under the block it follows', () => {
    expect(planInsertion(gap({ afterId: 'ver' }), chain())).toMatchObject({
      parentId: 'ver',
      isRoot: false,
      reparent: null,
      relateTo: null,
    });
  });

  it('makes a before-only gap a sibling of what it leads into', () => {
    const plan = planInsertion(gap({ beforeId: 'hit' }), chain());
    expect(plan).toMatchObject({ parentId: 'ver', relateTo: 'hit', reparent: null });
  });

  it('makes a before-only gap a root when the block it precedes is one', () => {
    expect(planInsertion(gap({ beforeId: 'wwi' }), chain())).toMatchObject({
      parentId: null,
      isRoot: true,
      relateTo: 'wwi',
    });
  });

  it('makes an unattached gap a root block of its own', () => {
    expect(planInsertion(gap(), chain())).toMatchObject({
      parentId: null,
      isRoot: true,
      reparent: null,
      relateTo: null,
      unlink: null,
    });
  });

  it('ignores references to blocks that have since been deleted', () => {
    expect(planInsertion(gap({ afterId: 'gone', beforeId: 'also-gone' }), chain())).toMatchObject({
      parentId: null,
      isRoot: true,
      reparent: null,
      relateTo: null,
    });
  });

  it('survives being handed nothing', () => {
    expect(planInsertion(undefined, [])).toMatchObject({ parentId: null, isRoot: true });
  });
});

describe('describePlacement', () => {
  it('says where a suggestion is being proposed', () => {
    expect(describePlacement(gap({ afterLabel: 'Versailles', beforeLabel: 'Hitler' }))).toBe(
      'between Versailles and Hitler'
    );
    expect(describePlacement(gap({ afterLabel: 'Versailles' }))).toBe('after Versailles');
    expect(describePlacement(gap({ beforeLabel: 'Hitler' }))).toBe('before Hitler');
  });

  it('is honest when it is attached to nothing', () => {
    expect(describePlacement(gap())).toBe('not attached to anything yet');
    expect(describePlacement(undefined)).toBe('not attached to anything yet');
  });
});
