// The depths "Make a graph" can build. Kept here rather than in the component so
// the sizing arithmetic can be tested, and so the menu and the generator can
// never disagree about what a level means.
//
// A generated graph is always three levels deep:
//
//   root            one block, with a summary
//   └── branch      up to `maxBranches` blocks, each with its own summary
//       └── leaf    up to `maxLeaves` per branch
//
// The counts are CEILINGS, not quotas. Not every subject has six worthwhile
// branches, and padding one out to hit a number produces filler blocks that make
// the canvas worse. The model is told the cap and told explicitly not to reach for
// it, so a thin topic yields a small graph even on Advanced.
//
// Two things vary independently: how much is generated, and how it is written.
// `register` is the writing; the counts are the size. That is why Concise and
// Detailed share a register but not a size.
export const GRAPH_LEVELS = [
  {
    key: 'simple',
    label: 'Simple',
    blurb: 'Plain language, few blocks. Terms get explained.',
    register: 'plain',
    maxBranches: 3,
    maxLeaves: 2,
  },
  {
    key: 'concise',
    label: 'Concise',
    blurb: 'Substantial notes, but a small graph. Depth without sprawl.',
    register: 'standard',
    maxBranches: 3,
    maxLeaves: 3,
  },
  {
    key: 'detailed',
    label: 'Detailed',
    blurb: 'The usual choice. Specifics, and more ground covered.',
    register: 'standard',
    maxBranches: 5,
    maxLeaves: 3,
  },
  {
    key: 'advanced',
    label: 'Advanced',
    blurb: 'Assumes some background. Precise, technical, and wider.',
    register: 'expert',
    maxBranches: 6,
    maxLeaves: 4,
  },
];

export const DEFAULT_LEVEL = 'detailed';

const BY_KEY = new Map(GRAPH_LEVELS.map((l) => [l.key, l]));

export function isGraphLevel(key) {
  return BY_KEY.has(key);
}

export function graphLevel(key) {
  return BY_KEY.get(key) ?? BY_KEY.get(DEFAULT_LEVEL);
}

// The most this level will ever produce, so the menu can say "up to" before you
// click. A real graph is often smaller, and that is the intended behaviour.
export function graphPlan(key) {
  const level = graphLevel(key);
  return {
    ...level,
    maxBlocks: 1 + level.maxBranches + level.maxBranches * level.maxLeaves,
    maxRequests: 1 + level.maxBranches,
  };
}
