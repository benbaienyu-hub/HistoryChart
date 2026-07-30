// Category colours live in JS rather than as Tailwind @theme tokens because
// v4 tree-shakes custom properties that no literal utility class references —
// dynamic `var(--color-x)` lookups silently resolve to nothing.
export const CATEGORIES = [
  { key: 'none', label: 'None', color: '#c7c7cc' },
  { key: 'person', label: 'Person', color: '#0071e3' },
  { key: 'place', label: 'Place', color: '#2e7d6b' },
  { key: 'event', label: 'Event', color: '#a13b3b' },
  { key: 'idea', label: 'Idea', color: '#7d5aa1' },
  { key: 'period', label: 'Period', color: '#b8860b' },
  { key: 'source', label: 'Source', color: '#4a7d3b' },
];

const BY_KEY = new Map(CATEGORIES.map((c) => [c.key, c]));

export function categoryColor(key) {
  return (BY_KEY.get(key) ?? BY_KEY.get('none')).color;
}

export function categoryLabel(key) {
  return (BY_KEY.get(key) ?? BY_KEY.get('none')).label;
}
