import { describe, expect, it } from 'vitest';
import { serializeCanvas } from '../src/lib/canvasShape';
import { edge, node } from './helpers';

// This module is an allowlist, which cuts both ways: it stops UI state being
// persisted, and it silently drops any field somebody forgets to add. These tests
// are the guard on the second half.

const live = (overrides = {}) => ({
  ...node('n1', null, overrides),
  // Things React Flow and the block put on a live node that must never be stored.
  selected: true,
  dragging: false,
  width: 320,
  height: 240,
});

describe('serializeCanvas', () => {
  it('keeps everything a block is', () => {
    const stored = serializeCanvas({
      nodes: [
        live({
          label: 'Ethiopia',
          notes: '- Highlands\n- Adwa',
          date: '1896',
          category: 'event',
          unsure: true,
          aiFilled: true,
          aiCorrection: 'Adwa was 1896, not 1898.',
          aiSuggested: false,
          collapsed: true,
        }),
      ],
      edges: [],
    });
    expect(stored.nodes[0].data).toEqual({
      label: 'Ethiopia',
      notes: '- Highlands\n- Adwa',
      date: '1896',
      category: 'event',
      unsure: true,
      parentId: null,
      isRoot: true,
      aiFilled: true,
      aiCorrection: 'Adwa was 1896, not 1898.',
      aiSuggested: false,
      images: [],
      collapsed: true,
    });
  });

  it('drops the callbacks and the transient flags', () => {
    // A stored callback would be `null` on reload and a stored `isAddingChild`
    // would reopen an input nobody asked for.
    const stored = serializeCanvas({
      nodes: [
        live({
          onNotesChange: () => {},
          onExpand: () => {},
          isAddingChild: true,
          loading: true,
          uploadingImages: 3,
          childCount: 4,
          hiddenCount: 2,
        }),
      ],
      edges: [],
    });
    const keys = Object.keys(stored.nodes[0].data);
    for (const gone of [
      'onNotesChange',
      'onExpand',
      'isAddingChild',
      'loading',
      'uploadingImages',
      'childCount',
      'hiddenCount',
    ]) {
      expect(keys, gone).not.toContain(gone);
    }
    expect(Object.keys(stored.nodes[0])).toEqual(['id', 'type', 'position', 'data']);
  });

  it('keeps images, including their captions', () => {
    // The caption is the reason this module has tests: it is canvas data, and a
    // whitelist that forgot it would throw away the user's writing on every save.
    const stored = serializeCanvas({
      nodes: [
        live({
          images: [
            { id: 'i1', url: '/api/images/i1', name: 'map.png', caption: 'The northern plateau' },
          ],
        }),
      ],
      edges: [],
    });
    expect(stored.nodes[0].data.images).toEqual([
      { id: 'i1', url: '/api/images/i1', name: 'map.png', caption: 'The northern plateau' },
    ]);
  });

  it('gives an un-captioned image an empty caption rather than undefined', () => {
    // undefined would vanish through JSON and come back as a missing key, which
    // then reads as `undefined` in an input and makes React complain.
    const stored = serializeCanvas({
      nodes: [live({ images: [{ id: 'i1', url: '/u', name: 'x.png' }] })],
      edges: [],
    });
    expect(stored.nodes[0].data.images[0].caption).toBe('');
  });

  it('carries relationship labels on edges, and omits absent ones', () => {
    const stored = serializeCanvas({
      nodes: [],
      edges: [
        { ...edge('a', 'b'), label: 'caused', data: { kind: 'relation' } },
        edge('b', 'c'),
      ],
    });
    expect(stored.edges[0]).toEqual({
      id: 'e-a-b',
      source: 'a',
      target: 'b',
      label: 'caused',
      data: { kind: 'relation' },
    });
    expect(stored.edges[1].label).toBeUndefined();
  });

  it('drops the styling React Flow puts on an edge', () => {
    const stored = serializeCanvas({
      nodes: [],
      edges: [{ ...edge('a', 'b'), style: { stroke: 'red' }, markerEnd: 'arrow', animated: true }],
    });
    expect(Object.keys(stored.edges[0])).toEqual(['id', 'source', 'target', 'label', 'data']);
  });

  it('fills in defaults so an older canvas serializes cleanly', () => {
    const sparse = { id: 'n1', type: 'knowledge', position: { x: 0, y: 0 }, data: { label: 'x', notes: '' } };
    const stored = serializeCanvas({ nodes: [sparse], edges: [] });
    expect(stored.nodes[0].data).toMatchObject({
      date: '',
      category: 'none',
      unsure: false,
      collapsed: false,
      images: [],
    });
  });

  it('survives an empty canvas and a missing list', () => {
    expect(serializeCanvas({ nodes: [], edges: [] })).toEqual({ nodes: [], edges: [] });
    expect(serializeCanvas({})).toEqual({ nodes: [], edges: [] });
  });

  it('round-trips: serializing stored output changes nothing', () => {
    // The undo stack stores this shape and hands it back as live state, so it has
    // to be a fixed point.
    const once = serializeCanvas({
      nodes: [live({ images: [{ id: 'i1', url: '/u', name: 'x.png', caption: 'c' }] })],
      edges: [{ ...edge('a', 'b'), label: 'led to' }],
    });
    expect(serializeCanvas(once)).toEqual(once);
  });
});
