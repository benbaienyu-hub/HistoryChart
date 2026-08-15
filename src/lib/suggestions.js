// Missing ideas, drawn where they belong.
//
// A canvas is a chain of thought, and the most useful thing a review can find is
// a step the chain jumps over: WWI → Versailles → Hitler, with nothing in
// between about the Weimar Republic or the Depression. Reported in a list, that
// finding is a sentence you have to hold in your head while you look at the
// canvas and work out where it goes. Drawn as a ghost block between the two real
// ones, it is the picture of the argument with the hole in it.
//
// Only "missing" gaps become ghosts. "incorrect" and "incomplete" are about a
// block that already exists — there is nothing to add between anything, and a
// ghost block saying "this claim is wrong" would be a lie about what it is.
// Those stay in the panel, on the block they concern.
//
// Pure: positions in, positions out. The canvas does the rendering and the
// Canvas component does the state.

export const SUGGESTION_PREFIX = 'suggestion:';

// Blocks are 320 wide and roughly this tall once they have notes in them. The
// numbers only have to be close — they space ghosts away from real blocks, they
// do not lay the canvas out.
const BLOCK_W = 320;
const BLOCK_H = 300;
const LEVEL = 260;
const COLUMN = 364;

// More than this and the canvas is buried in dashed boxes, which is the opposite
// of seeing the hole. The rest stay in the panel, and the panel says so.
export const MAX_SUGGESTIONS = 6;

export function suggestionId(gapId) {
  return `${SUGGESTION_PREFIX}${gapId}`;
}

export function isSuggestionId(id) {
  return String(id ?? '').startsWith(SUGGESTION_PREFIX);
}

export function gapIdFromSuggestion(id) {
  return String(id ?? '').slice(SUGGESTION_PREFIX.length);
}

// The gaps that can be a block: something absent, which adding would fix.
export function suggestibleGaps(gaps = []) {
  return (gaps ?? []).filter((gap) => gap?.kind === 'missing');
}

// Where one ghost goes, given the blocks it names.
//
// The between case is the one worth getting right, so it is first: halfway
// along, nudged clear of the straight line between the two so it does not sit on
// the edge it is interrupting.
function placeOne(gap, byId, fallbackIndex, bounds) {
  const after = gap.afterId ? byId.get(gap.afterId) : null;
  const before = gap.beforeId ? byId.get(gap.beforeId) : null;

  if (after && before) {
    return {
      x: (after.position.x + before.position.x) / 2,
      y: (after.position.y + before.position.y) / 2,
    };
  }
  if (after) return { x: after.position.x + BLOCK_W / 4, y: after.position.y + LEVEL };
  if (before) return { x: before.position.x + BLOCK_W / 4, y: before.position.y - LEVEL };

  // Attached to nothing: a column of its own, off to the right, where it is
  // clearly an aside rather than a claim about the structure.
  return { x: bounds.maxX + COLUMN, y: bounds.minY + fallbackIndex * LEVEL };
}

// Nudge a position until it is not sitting on top of something. Cheap and
// bounded — this is a hint about where to look, not a layout engine.
//
// Sideways, as far as it takes. The height is what carries the meaning: a ghost
// level with the space between two blocks still reads as being between them
// however far out it is, while one pushed *below* both of them does not — it
// reads as coming after. Dropping down is the last resort, for a canvas with no
// room left beside the chain at all.
function unstack(position, occupied) {
  const clash = (p) =>
    occupied.some(
      (other) => Math.abs(other.x - p.x) < BLOCK_W * 0.8 && Math.abs(other.y - p.y) < BLOCK_H * 0.6
    );

  if (!clash(position)) return position;

  for (let step = 1; step <= 6; step += 1) {
    const aside = { x: position.x + BLOCK_W * 0.85 * step, y: position.y };
    if (!clash(aside)) return aside;
  }

  let placed = position;
  for (let step = 1; step <= 4 && clash(placed); step += 1) {
    placed = { x: position.x, y: position.y + BLOCK_H * 0.7 * step };
  }
  return placed;
}

function boundsOf(nodes) {
  if (nodes.length === 0) return { maxX: 0, minY: 0 };
  return {
    maxX: Math.max(...nodes.map((n) => n.position.x)),
    minY: Math.min(...nodes.map((n) => n.position.y)),
  };
}

// The ghost nodes and dashed edges for a scan's missing gaps.
//
// `dismissed` and `accepted` are sets of gap ids: a dismissed suggestion is gone
// for this scan, and an accepted one has become a real block, so neither should
// still be drawn.
export function suggestionGraph(gaps = [], nodes = [], { dismissed, accepted } = {}) {
  const real = (nodes ?? []).filter((n) => n?.id && n.position);
  const byId = new Map(real.map((n) => [n.id, n]));
  const bounds = boundsOf(real);

  const wanted = suggestibleGaps(gaps)
    .filter((gap) => !dismissed?.has(gap.id) && !accepted?.has(gap.id))
    .slice(0, MAX_SUGGESTIONS);

  const occupied = real.map((n) => n.position);
  const out = { nodes: [], edges: [] };

  wanted.forEach((gap, index) => {
    const position = unstack(placeOne(gap, byId, index, bounds), occupied);
    occupied.push(position);

    const id = suggestionId(gap.id);
    out.nodes.push({
      id,
      type: 'suggestion',
      position,
      // Not part of the canvas until it is accepted: dragging one would imply it
      // is already yours, and dropping it somewhere would imply that meant
      // something. Selecting or connecting it would be worse.
      draggable: false,
      selectable: false,
      connectable: false,
      deletable: false,
      // React Flow switches a node's pointer events off unless it is selectable,
      // draggable or has a node-level click handler — none of which a ghost
      // should be. `style` is applied last, so this puts them back for the
      // buttons inside without making the node itself behave like a real one.
      style: { pointerEvents: 'all' },
      // Above the real blocks: an opened suggestion grows, and being half
      // covered by the block it is talking about would be a poor way to explain
      // itself.
      zIndex: 5,
      data: { gap },
    });

    if (gap.afterId && byId.has(gap.afterId)) {
      out.edges.push(suggestionEdge(gap.afterId, id));
    }
    if (gap.beforeId && byId.has(gap.beforeId)) {
      out.edges.push(suggestionEdge(id, gap.beforeId));
    }
  });

  return out;
}

function suggestionEdge(source, target) {
  return {
    id: `${SUGGESTION_PREFIX}e-${source}-${target}`,
    source,
    target,
    type: 'smoothstep',
    animated: true,
    selectable: false,
    deletable: false,
    focusable: false,
    style: {
      stroke: 'var(--color-accent)',
      strokeWidth: 1.5,
      strokeDasharray: '6 5',
      strokeOpacity: 0.5,
    },
  };
}

// What accepting a suggestion does to the graph.
//
// Kept separate from the component because it is the part with a decision in it:
// where the new block hangs, and whether it is being *inserted into* a chain or
// merely added beside one.
export function planInsertion(gap, nodes = []) {
  const byId = new Map((nodes ?? []).map((n) => [n.id, n]));
  const after = gap?.afterId ? (byId.get(gap.afterId) ?? null) : null;
  const before = gap?.beforeId ? (byId.get(gap.beforeId) ?? null) : null;

  // The case the feature is for: the model named two blocks that really are
  // parent and child, so the new one goes between them and the chain reads
  // through it. Anything else and re-parenting would be rearranging a structure
  // the user built on a guess about what they meant.
  const inChain = Boolean(after && before && before.data?.parentId === after.id);

  let parentId = null;
  if (after) parentId = after.id;
  else if (before) parentId = before.data?.parentId ?? null;

  return {
    parentId,
    isRoot: parentId === null,
    // The existing block to hang under the new one.
    reparent: inChain ? before.id : null,
    // Named a block it leads to, but not one it can be threaded into — so the
    // relationship is drawn as a relation instead of faked as parentage.
    relateTo: before && !inChain ? before.id : null,
    // The structural edge the insertion replaces.
    unlink: inChain ? { source: after.id, target: before.id } : null,
  };
}

// How a suggestion's position reads in words — the panel and the node both need
// to say where a thing is being proposed.
export function describePlacement(gap) {
  if (gap?.afterLabel && gap?.beforeLabel) {
    return `between ${gap.afterLabel} and ${gap.beforeLabel}`;
  }
  if (gap?.afterLabel) return `after ${gap.afterLabel}`;
  if (gap?.beforeLabel) return `before ${gap.beforeLabel}`;
  return 'not attached to anything yet';
}
