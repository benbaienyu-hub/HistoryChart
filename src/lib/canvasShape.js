// What a canvas looks like when it is stored.
//
// This is the boundary between the live React Flow graph — which carries callbacks,
// selection state, and in-flight upload flags — and the version that goes to the
// server and onto the undo stack. It is an allowlist, deliberately: anything not
// named here is dropped, so a stray piece of UI state can never be persisted.
//
// The flip side is that a field added to a block and *not* added here vanishes on
// the next save, silently. That is why this lives in its own module with its own
// tests rather than inside the component.

// One image on a block. The bytes live on the server; a block only refers to them.
// `caption` is the user's own words about the picture, and is part of the canvas
// rather than the upload — the same file could reasonably be captioned differently
// in two places.
function serializeImage(image) {
  return {
    id: image.id,
    url: image.url,
    name: image.name ?? '',
    caption: image.caption ?? '',
  };
}

export function serializeCanvas({ nodes, edges }) {
  return {
    nodes: (nodes ?? []).map((n) => ({
      id: n.id,
      type: n.type,
      position: n.position,
      data: {
        label: n.data.label,
        notes: n.data.notes,
        date: n.data.date ?? '',
        category: n.data.category ?? 'none',
        unsure: Boolean(n.data.unsure),
        parentId: n.data.parentId,
        isRoot: n.data.isRoot,
        aiFilled: n.data.aiFilled,
        aiCorrection: n.data.aiCorrection,
        aiSuggested: n.data.aiSuggested,
        images: (n.data.images ?? []).map(serializeImage),
        collapsed: Boolean(n.data.collapsed),
      },
    })),
    edges: (edges ?? []).map((e) => ({
      id: e.id,
      source: e.source,
      target: e.target,
      label: e.label ?? undefined,
      data: e.data ?? undefined,
    })),
  };
}
