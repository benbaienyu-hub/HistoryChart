// Minimal stand-ins for React Flow nodes/edges. Only the fields the pure
// helpers actually read are present, so a test failure points at logic rather
// than at fixture drift.
export function node(id, parentId = null, data = {}) {
  return {
    id,
    type: 'knowledge',
    position: { x: 0, y: 0 },
    data: {
      label: id,
      notes: '',
      date: '',
      category: 'none',
      unsure: false,
      parentId,
      isRoot: parentId === null,
      collapsed: false,
      ...data,
    },
  };
}

export function edge(source, target, extra = {}) {
  return { id: `e-${source}-${target}`, source, target, ...extra };
}

// Builds a tree from a `{ id: parentId }` map, plus the structural edges that
// would accompany it on a real canvas.
export function tree(spec) {
  const nodes = Object.entries(spec).map(([id, parentId]) => node(id, parentId));
  const edges = Object.entries(spec)
    .filter(([, parentId]) => parentId !== null)
    .map(([id, parentId]) => edge(parentId, id));
  return { nodes, edges };
}

export function collapse(nodes, ...ids) {
  const set = new Set(ids);
  return nodes.map((n) =>
    set.has(n.id) ? { ...n, data: { ...n.data, collapsed: true } } : n
  );
}
