import { describe, expect, it } from 'vitest';
import { normalizeSubtopics } from '../src/lib/aiFill';

// Sub-topics gained a per-item `detail` when the third level of a generated
// graph started arriving with content. This guards the boundary: whatever the
// route sends, the canvas must end up with usable { label, detail } pairs rather
// than blocks labelled "[object Object]" or "undefined".
describe('normalizeSubtopics', () => {
  it('passes through well-formed pairs', () => {
    expect(normalizeSubtopics([{ label: 'Calvin cycle', detail: 'Fixes carbon.' }])).toEqual([
      { label: 'Calvin cycle', detail: 'Fixes carbon.' },
    ]);
  });

  it('accepts a bare string, as an older server would send', () => {
    expect(normalizeSubtopics(['Calvin cycle'])).toEqual([
      { label: 'Calvin cycle', detail: '' },
    ]);
  });

  it('trims both fields', () => {
    expect(normalizeSubtopics([{ label: '  Light  ', detail: '  Reactions.  ' }])).toEqual([
      { label: 'Light', detail: 'Reactions.' },
    ]);
  });

  it('supplies an empty detail rather than undefined', () => {
    expect(normalizeSubtopics([{ label: 'Light' }])).toEqual([{ label: 'Light', detail: '' }]);
  });

  it('drops entries with no usable label', () => {
    const out = normalizeSubtopics([
      { label: '', detail: 'orphan' },
      { label: '   ', detail: 'orphan' },
      { detail: 'orphan' },
      null,
      undefined,
      '',
      { label: 'Kept', detail: '' },
    ]);
    expect(out).toEqual([{ label: 'Kept', detail: '' }]);
  });

  it('coerces non-string fields instead of throwing', () => {
    expect(normalizeSubtopics([{ label: 42, detail: 7 }])).toEqual([
      { label: '42', detail: '7' },
    ]);
  });

  it('handles a missing or empty list', () => {
    expect(normalizeSubtopics(undefined)).toEqual([]);
    expect(normalizeSubtopics(null)).toEqual([]);
    expect(normalizeSubtopics([])).toEqual([]);
  });
});
