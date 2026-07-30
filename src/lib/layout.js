// Tidy-tree layout over the parentId forest. Manual relation edges are
// ignored — they annotate the graph rather than define its structure, so
// letting them influence placement would fight the user's mental model.
const NODE_W = 280;
const H_GAP = 44;
const LEVEL_H = 230;
const TOP_Y = 90;
const ROOT_GAP = H_GAP * 2;

export function autoLayout(nodes) {
  const childrenOf = new Map();
  for (const node of nodes) {
    const parent = node.data.parentId ?? null;
    if (!childrenOf.has(parent)) childrenOf.set(parent, []);
    childrenOf.get(parent).push(node);
  }
  // Keep siblings in the left-to-right order the user already sees.
  for (const list of childrenOf.values()) {
    list.sort((a, b) => a.position.x - b.position.x);
  }

  const placed = new Map();
  let cursor = 0;

  function walk(node, depth) {
    const kids = childrenOf.get(node.id) ?? [];
    const y = TOP_Y + depth * LEVEL_H;

    if (kids.length === 0) {
      const x = cursor;
      cursor += NODE_W + H_GAP;
      placed.set(node.id, { x, y });
      return x;
    }

    const kidXs = kids.map((kid) => walk(kid, depth + 1));
    const x = (Math.min(...kidXs) + Math.max(...kidXs)) / 2;
    placed.set(node.id, { x, y });
    return x;
  }

  for (const root of childrenOf.get(null) ?? []) {
    walk(root, 0);
    cursor += ROOT_GAP;
  }

  return nodes.map((n) => (placed.has(n.id) ? { ...n, position: placed.get(n.id) } : n));
}
