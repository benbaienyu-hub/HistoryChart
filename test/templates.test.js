import { describe, expect, it } from 'vitest';
import { buildTemplateGraph, listTemplates, STARTER_TOPICS } from '../src/lib/templates';
import { CATEGORIES } from '../src/lib/categories';

const KEYS = listTemplates().map((t) => t.key);
const CATEGORY_KEYS = new Set(CATEGORIES.map((c) => c.key));

describe('listTemplates', () => {
  it('lists templates with unique keys and a block count', () => {
    const list = listTemplates();
    expect(list.length).toBeGreaterThan(0);
    expect(new Set(KEYS).size).toBe(list.length);
    for (const t of list) {
      expect(t.title).toBeTruthy();
      expect(t.blurb).toBeTruthy();
      expect(t.blockCount).toBeGreaterThan(0);
    }
  });
});

describe('buildTemplateGraph', () => {
  it('returns null for an unknown key rather than throwing', () => {
    expect(buildTemplateGraph('nope')).toBeNull();
  });

  it.each(KEYS)('%s builds a well-formed graph', (key) => {
    const { title, nodes, edges } = buildTemplateGraph(key);
    const ids = new Set(nodes.map((n) => n.id));

    expect(title).toBeTruthy();
    expect(ids.size).toBe(nodes.length); // no duplicate ids

    // Exactly one root, and every other parentId resolves to a real node.
    const roots = nodes.filter((n) => n.data.parentId === null);
    expect(roots).toHaveLength(1);
    expect(roots[0].data.isRoot).toBe(true);
    for (const n of nodes) {
      if (n.data.parentId !== null) {
        expect(ids.has(n.data.parentId), `${n.id} → ${n.data.parentId}`).toBe(true);
        expect(n.data.isRoot).toBe(false);
      }
    }

    // One edge per non-root node, both ends real.
    expect(edges).toHaveLength(nodes.length - 1);
    for (const e of edges) {
      expect(ids.has(e.source)).toBe(true);
      expect(ids.has(e.target)).toBe(true);
    }
  });

  it.each(KEYS)('%s gives every block notes, so study mode works immediately', (key) => {
    for (const n of buildTemplateGraph(key).nodes) {
      expect(n.data.notes.trim(), n.id).not.toBe('');
      expect(n.data.label.trim()).not.toBe('');
    }
  });

  it.each(KEYS)('%s uses only known categories', (key) => {
    for (const n of buildTemplateGraph(key).nodes) {
      expect(CATEGORY_KEYS.has(n.data.category), `${n.id}: ${n.data.category}`).toBe(true);
    }
  });

  it.each(KEYS)('%s arrives laid out and fully expanded', (key) => {
    for (const n of buildTemplateGraph(key).nodes) {
      expect(Number.isFinite(n.position.x)).toBe(true);
      expect(Number.isFinite(n.position.y)).toBe(true);
      expect(n.data.collapsed ?? false).toBe(false);
      expect(n.type).toBe('knowledge');
    }
  });

  it('is a fresh graph each call — editing one canvas cannot touch another', () => {
    const a = buildTemplateGraph(KEYS[0]);
    const b = buildTemplateGraph(KEYS[0]);
    expect(a.nodes[0]).not.toBe(b.nodes[0]);
    a.nodes[0].data.notes = 'edited';
    expect(b.nodes[0].data.notes).not.toBe('edited');
  });

  it('places a root above its children', () => {
    const { nodes } = buildTemplateGraph(KEYS[0]);
    const root = nodes.find((n) => n.data.parentId === null);
    for (const child of nodes.filter((n) => n.data.parentId === root.id)) {
      expect(child.position.y).toBeGreaterThan(root.position.y);
    }
  });
});

describe('STARTER_TOPICS', () => {
  it('offers a few distinct non-empty suggestions', () => {
    expect(STARTER_TOPICS.length).toBeGreaterThan(2);
    expect(new Set(STARTER_TOPICS).size).toBe(STARTER_TOPICS.length);
    for (const topic of STARTER_TOPICS) expect(topic.trim()).not.toBe('');
  });
});

describe('template search text', () => {
  it('flattens every block so library search can reach inside an example', () => {
    for (const summary of listTemplates()) {
      const graph = buildTemplateGraph(summary.key);
      for (const node of graph.nodes) {
        expect(summary.searchText, `${summary.key} / ${node.data.label}`).toContain(
          node.data.label
        );
      }
    }
  });

  it('includes the notes, not just the labels', () => {
    const [first] = listTemplates();
    const graph = buildTemplateGraph(first.key);
    const notes = graph.nodes.find((n) => n.data.notes)?.data.notes;
    expect(first.searchText).toContain(notes);
  });
});
