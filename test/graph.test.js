import { describe, expect, it } from 'vitest';
import {
  canCollapse,
  childCountOf,
  childrenOf,
  descendantIds,
  hiddenCountOf,
  hiddenIds,
  withVisibility,
} from '../src/lib/graph';
import { collapse, edge, node, tree } from './helpers';

// root
// ├── a
// │   ├── a1
// │   └── a2
// │       └── a2x
// └── b
const SPEC = { root: null, a: 'root', a1: 'a', a2: 'a', a2x: 'a2', b: 'root' };

const ids = (list) => list.map((n) => n.id).sort();
const byId = (list, id) => list.find((n) => n.id === id);
const hiddenNodeIds = (list) => list.filter((n) => n.hidden).map((n) => n.id).sort();

describe('childrenOf / childCountOf', () => {
  const { nodes } = tree(SPEC);

  it('returns only direct children', () => {
    expect(ids(childrenOf(nodes, 'a'))).toEqual(['a1', 'a2']);
    expect(ids(childrenOf(nodes, 'root'))).toEqual(['a', 'b']);
  });

  it('returns nothing for a leaf', () => {
    expect(childrenOf(nodes, 'a1')).toEqual([]);
    expect(childCountOf(nodes, 'a1')).toBe(0);
  });

  it('counts match the children list', () => {
    for (const id of ['root', 'a', 'a2', 'b']) {
      expect(childCountOf(nodes, id)).toBe(childrenOf(nodes, id).length);
    }
  });
});

describe('descendantIds', () => {
  const { nodes } = tree(SPEC);

  it('walks the whole subtree, not just direct children', () => {
    expect(descendantIds(nodes, 'a').sort()).toEqual(['a1', 'a2', 'a2x']);
    expect(descendantIds(nodes, 'root').sort()).toEqual(['a', 'a1', 'a2', 'a2x', 'b']);
  });

  it('excludes the node itself', () => {
    expect(descendantIds(nodes, 'a')).not.toContain('a');
  });

  it('is empty for a leaf and for an unknown id', () => {
    expect(descendantIds(nodes, 'a2x')).toEqual([]);
    expect(descendantIds(nodes, 'nope')).toEqual([]);
  });

  it('terminates on a malformed graph that contains a parent cycle', () => {
    // x → y → x. Without the `seen` guard this spins forever.
    const cyclic = [node('x', 'y'), node('y', 'x')];
    expect(descendantIds(cyclic, 'x').sort()).toEqual(['x', 'y']);
  });
});

describe('hiddenIds', () => {
  const { nodes } = tree(SPEC);

  it('hides nothing when nothing is collapsed', () => {
    expect([...hiddenIds(nodes)]).toEqual([]);
  });

  it('hides a collapsed node’s subtree but not the node itself', () => {
    const hidden = hiddenIds(collapse(nodes, 'a'));
    expect([...hidden].sort()).toEqual(['a1', 'a2', 'a2x']);
    expect(hidden.has('a')).toBe(false);
  });

  it('is idempotent when an already-hidden node is also collapsed', () => {
    // a2 is inside a's collapsed subtree — collapsing it too changes nothing.
    expect([...hiddenIds(collapse(nodes, 'a', 'a2'))].sort()).toEqual(['a1', 'a2', 'a2x']);
  });

  it('handles sibling collapses independently', () => {
    expect([...hiddenIds(collapse(nodes, 'a2'))]).toEqual(['a2x']);
  });
});

describe('hiddenCountOf', () => {
  const { nodes } = tree(SPEC);

  it('counts the whole subtree, including nested collapses', () => {
    expect(hiddenCountOf(nodes, 'a')).toBe(3);
    expect(hiddenCountOf(collapse(nodes, 'a2'), 'a')).toBe(3);
  });

  it('is zero for a leaf', () => {
    expect(hiddenCountOf(nodes, 'b')).toBe(0);
  });
});

describe('withVisibility', () => {
  const { nodes, edges } = tree(SPEC);

  it('marks no node hidden with nothing collapsed', () => {
    const out = withVisibility(nodes, edges);
    expect(hiddenNodeIds(out.nodes)).toEqual([]);
    expect(out.edges.some((e) => e.hidden)).toBe(false);
  });

  it('marks the collapsed subtree hidden and keeps the collapsed node visible', () => {
    const out = withVisibility(collapse(nodes, 'a'), edges);
    expect(hiddenNodeIds(out.nodes)).toEqual(['a1', 'a2', 'a2x']);
    expect(byId(out.nodes, 'a').hidden).toBe(false);
  });

  it('reports childCount on every node', () => {
    const out = withVisibility(nodes, edges);
    expect(byId(out.nodes, 'root').data.childCount).toBe(2);
    expect(byId(out.nodes, 'a').data.childCount).toBe(2);
    expect(byId(out.nodes, 'a2').data.childCount).toBe(1);
    expect(byId(out.nodes, 'b').data.childCount).toBe(0);
  });

  it('reports hiddenCount only on the collapsed node', () => {
    const out = withVisibility(collapse(nodes, 'a'), edges);
    expect(byId(out.nodes, 'a').data.hiddenCount).toBe(3);
    expect(byId(out.nodes, 'root').data.hiddenCount).toBe(0);
  });

  it('hides an edge when either end is hidden', () => {
    const out = withVisibility(collapse(nodes, 'a'), edges);
    const hiddenEdges = out.edges.filter((e) => e.hidden).map((e) => e.id).sort();
    // root→a stays visible; a→a1, a→a2 and a2→a2x go.
    expect(hiddenEdges).toEqual(['e-a-a1', 'e-a-a2', 'e-a2-a2x']);
  });

  it('hides a manual relation edge that crosses into a collapsed subtree', () => {
    const relation = edge('b', 'a2x', { data: { manual: true }, label: 'influenced' });
    const out = withVisibility(collapse(nodes, 'a'), [...edges, relation]);
    expect(byId(out.edges, 'e-b-a2x').hidden).toBe(true);
  });

  it('keeps unchanged node and edge references so React can bail out', () => {
    const first = withVisibility(nodes, edges);
    const second = withVisibility(first.nodes, first.edges);
    for (const n of second.nodes) expect(n).toBe(byId(first.nodes, n.id));
    for (const e of second.edges) expect(e).toBe(byId(first.edges, e.id));
  });

  it('returns a new reference for a node whose visibility changed', () => {
    const collapsed = collapse(nodes, 'a');
    const before = withVisibility(nodes, edges);
    const after = withVisibility(collapsed, edges);
    expect(byId(after.nodes, 'a1')).not.toBe(byId(before.nodes, 'a1'));
  });

  it('ignores manual relation edges when deciding what is hidden', () => {
    // A manual edge must not act like a parent link: a2x hangs off a2 only.
    const relation = edge('b', 'a2x', { data: { manual: true } });
    const out = withVisibility(collapse(nodes, 'b'), [...edges, relation]);
    expect(hiddenNodeIds(out.nodes)).toEqual([]);
  });
});

describe('canCollapse', () => {
  const { nodes } = tree(SPEC);

  it('is true only for nodes that have children', () => {
    expect(canCollapse(nodes, 'root')).toBe(true);
    expect(canCollapse(nodes, 'a2')).toBe(true);
    expect(canCollapse(nodes, 'a2x')).toBe(false);
    expect(canCollapse(nodes, 'b')).toBe(false);
  });
});
