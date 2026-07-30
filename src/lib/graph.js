// Pure graph helpers, kept out of the Canvas component so they can be unit
// tested without React or React Flow. `nodes` here are React Flow nodes whose
// `data.parentId` defines the tree; manual relation edges are annotations and
// deliberately play no part in any of this.

export function childrenOf(nodes, id) {
  return nodes.filter((n) => n.data.parentId === id);
}

export function childCountOf(nodes, id) {
  let count = 0;
  for (const n of nodes) if (n.data.parentId === id) count += 1;
  return count;
}

// Every node beneath `id`, at any depth.
export function descendantIds(nodes, id) {
  const byParent = new Map();
  for (const n of nodes) {
    const list = byParent.get(n.data.parentId);
    if (list) list.push(n.id);
    else byParent.set(n.data.parentId, [n.id]);
  }

  const out = [];
  const stack = [...(byParent.get(id) ?? [])];
  const seen = new Set();
  while (stack.length) {
    const next = stack.pop();
    // A malformed graph (a parent cycle) would otherwise spin forever.
    if (seen.has(next)) continue;
    seen.add(next);
    out.push(next);
    stack.push(...(byParent.get(next) ?? []));
  }
  return out;
}

// Ids hidden because some ancestor is collapsed. A collapsed node is itself
// still visible — only what's beneath it is hidden — and nesting works because
// every collapsed node contributes its whole subtree.
export function hiddenIds(nodes) {
  const hidden = new Set();
  for (const node of nodes) {
    if (!node.data.collapsed) continue;
    for (const id of descendantIds(nodes, node.id)) hidden.add(id);
  }
  return hidden;
}

// How many nodes a collapse is currently hiding beneath `id`. Counts the whole
// subtree, including anything hidden by a nested collapse, since that's what
// the user is choosing not to look at.
export function hiddenCountOf(nodes, id) {
  return descendantIds(nodes, id).length;
}

// Decorate nodes and edges for rendering: mark hidden ones, and tell each node
// how many children it has (so a block can show a collapse control) and how
// many nodes its collapse is hiding.
export function withVisibility(nodes, edges) {
  const hidden = hiddenIds(nodes);

  const decoratedNodes = nodes.map((node) => {
    const childCount = childCountOf(nodes, node.id);
    const hiddenCount = node.data.collapsed ? hiddenCountOf(nodes, node.id) : 0;
    const isHidden = hidden.has(node.id);

    if (
      node.hidden === isHidden &&
      node.data.childCount === childCount &&
      node.data.hiddenCount === hiddenCount
    ) {
      return node; // unchanged — keep the reference so React can bail out
    }
    return { ...node, hidden: isHidden, data: { ...node.data, childCount, hiddenCount } };
  });

  // An edge is hidden when either end is.
  const decoratedEdges = edges.map((edge) => {
    const isHidden = hidden.has(edge.source) || hidden.has(edge.target);
    return edge.hidden === isHidden ? edge : { ...edge, hidden: isHidden };
  });

  return { nodes: decoratedNodes, edges: decoratedEdges };
}

// Collapsing a node whose subtree is entirely hidden already would look like a
// no-op, so the toggle reports whether it can do anything useful.
export function canCollapse(nodes, id) {
  return childCountOf(nodes, id) > 0;
}
