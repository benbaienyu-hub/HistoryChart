// The three depths "Make a graph" can build. Kept here rather than in the
// component so the sizing arithmetic — how many blocks, how many model requests
// — can be tested, and so the menu and the generator can never disagree about
// what a level means.
//
// A generated graph is always three levels deep:
//
//   root            one block, with a summary
//   └── branch      `branches` blocks, each with its own summary
//       └── leaf    `leaves` blocks per branch, deliberately left empty
//
// The leaves arrive blank on purpose. They are the prompts — the things the
// canvas has identified as worth knowing but has not told you about, for you to
// fill in yourself. Filling them is the point of the app, so generating their
// text would defeat it.
export const GRAPH_LEVELS = [
  {
    key: 'simple',
    label: 'Simple',
    blurb: 'A plain overview. Short summaries, few branches.',
    branches: 3,
    leaves: 2,
  },
  {
    key: 'detailed',
    label: 'Detailed',
    blurb: 'The usual choice. Fuller summaries and more ground covered.',
    branches: 5,
    leaves: 3,
  },
  {
    key: 'advanced',
    label: 'Advanced',
    blurb: 'Assumes some background. Precise, specific, and wider.',
    branches: 6,
    leaves: 4,
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

// What choosing this level will cost, so the menu can say so before you click.
// One request for the root plus one per branch; leaves need none, because they
// are created empty.
export function graphPlan(key) {
  const level = graphLevel(key);
  return {
    ...level,
    blocks: 1 + level.branches + level.branches * level.leaves,
    requests: 1 + level.branches,
  };
}
