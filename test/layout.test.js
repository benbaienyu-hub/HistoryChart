import { describe, expect, it } from 'vitest';
import { autoLayout } from '../src/lib/layout';
import { node } from './helpers';

const at = (nodes, id) => nodes.find((n) => n.id === id).position;

function positioned(id, parentId, x) {
  const n = node(id, parentId);
  n.position = { x, y: 0 };
  return n;
}

describe('autoLayout', () => {
  it('handles an empty graph', () => {
    expect(autoLayout([])).toEqual([]);
  });

  it('puts each depth on its own row', () => {
    const out = autoLayout([positioned('r', null, 0), positioned('c', 'r', 0)]);
    expect(at(out, 'r').y).toBeLessThan(at(out, 'c').y);
  });

  it('gives siblings the same y and distinct x', () => {
    const out = autoLayout([
      positioned('r', null, 0),
      positioned('a', 'r', 0),
      positioned('b', 'r', 100),
    ]);
    expect(at(out, 'a').y).toBe(at(out, 'b').y);
    expect(at(out, 'a').x).not.toBe(at(out, 'b').x);
  });

  it('centres a parent over its children', () => {
    const out = autoLayout([
      positioned('r', null, 0),
      positioned('a', 'r', 0),
      positioned('b', 'r', 100),
    ]);
    expect(at(out, 'r').x).toBeCloseTo((at(out, 'a').x + at(out, 'b').x) / 2);
  });

  it('keeps siblings in their existing left-to-right order', () => {
    // Declared b-then-a but positioned a to the left, so a must stay left.
    const out = autoLayout([
      positioned('r', null, 0),
      positioned('b', 'r', 500),
      positioned('a', 'r', 100),
    ]);
    expect(at(out, 'a').x).toBeLessThan(at(out, 'b').x);
  });

  it('never overlaps two leaves', () => {
    const out = autoLayout([
      positioned('r', null, 0),
      positioned('a', 'r', 0),
      positioned('b', 'r', 100),
      positioned('c', 'r', 200),
    ]);
    const xs = ['a', 'b', 'c'].map((id) => at(out, id).x).sort((p, q) => p - q);
    for (let i = 1; i < xs.length; i++) expect(xs[i] - xs[i - 1]).toBeGreaterThanOrEqual(320);
  });

  it('separates two root trees', () => {
    const out = autoLayout([
      positioned('r1', null, 0),
      positioned('r1a', 'r1', 0),
      positioned('r2', null, 900),
      positioned('r2a', 'r2', 900),
    ]);
    expect(at(out, 'r2a').x).toBeGreaterThan(at(out, 'r1a').x);
  });

  it('lays out collapsed subtrees too, so expanding needs no re-tidy', () => {
    const nodes = [positioned('r', null, 0), positioned('c', 'r', 0)];
    nodes[0].data.collapsed = true;
    const out = autoLayout(nodes);
    expect(at(out, 'c')).toEqual({ x: expect.any(Number), y: expect.any(Number) });
  });

  it('leaves an orphan (unknown parent) untouched rather than dropping it', () => {
    const orphan = positioned('o', 'missing', 42);
    const out = autoLayout([positioned('r', null, 0), orphan]);
    expect(at(out, 'o')).toEqual({ x: 42, y: 0 });
  });

  it('returns new node objects but does not mutate the input', () => {
    const nodes = [positioned('r', null, 0), positioned('c', 'r', 0)];
    const before = JSON.stringify(nodes);
    autoLayout(nodes);
    expect(JSON.stringify(nodes)).toBe(before);
  });

  it('is stable — laying out an already-tidy graph is a no-op', () => {
    const once = autoLayout([
      positioned('r', null, 0),
      positioned('a', 'r', 0),
      positioned('b', 'r', 100),
    ]);
    const twice = autoLayout(once);
    for (const id of ['r', 'a', 'b']) expect(at(twice, id)).toEqual(at(once, id));
  });
});
