import { describe, expect, it } from 'vitest';
import {
  DEFAULT_LEVEL,
  GRAPH_LEVELS,
  graphLevel,
  graphPlan,
  isGraphLevel,
} from '../src/lib/graphLevels';

const KEYS = GRAPH_LEVELS.map((l) => l.key);

describe('GRAPH_LEVELS', () => {
  it('offers exactly the three the menu shows', () => {
    expect(KEYS).toEqual(['simple', 'detailed', 'advanced']);
  });

  it('gives every level a label, a blurb, and positive counts', () => {
    for (const level of GRAPH_LEVELS) {
      expect(level.label).toBeTruthy();
      expect(level.blurb).toBeTruthy();
      expect(level.branches).toBeGreaterThan(0);
      expect(level.leaves).toBeGreaterThan(0);
    }
  });

  it('gets wider as it gets deeper, so the names are honest', () => {
    for (let i = 1; i < GRAPH_LEVELS.length; i++) {
      expect(GRAPH_LEVELS[i].branches).toBeGreaterThanOrEqual(GRAPH_LEVELS[i - 1].branches);
      expect(GRAPH_LEVELS[i].leaves).toBeGreaterThanOrEqual(GRAPH_LEVELS[i - 1].leaves);
      expect(graphPlan(GRAPH_LEVELS[i].key).blocks).toBeGreaterThan(
        graphPlan(GRAPH_LEVELS[i - 1].key).blocks
      );
    }
  });

  it('never asks for more branches than the route can return', () => {
    // The response schema caps subtopics at 8; a level wanting more would
    // silently produce a narrower graph than its menu entry promises.
    for (const level of GRAPH_LEVELS) {
      expect(level.branches).toBeLessThanOrEqual(8);
      expect(level.leaves).toBeLessThanOrEqual(8);
    }
  });

  it('keeps the request count small enough to be affordable', () => {
    for (const key of KEYS) expect(graphPlan(key).requests).toBeLessThanOrEqual(8);
  });

  it('has a default that is one of the levels', () => {
    expect(KEYS).toContain(DEFAULT_LEVEL);
  });
});

describe('isGraphLevel', () => {
  it('accepts the real keys and nothing else', () => {
    for (const key of KEYS) expect(isGraphLevel(key)).toBe(true);
    for (const key of ['', 'SIMPLE', 'expert', null, undefined, 'toString']) {
      expect(isGraphLevel(key), String(key)).toBe(false);
    }
  });
});

describe('graphLevel', () => {
  it('looks up by key', () => {
    expect(graphLevel('simple').label).toBe('Simple');
  });

  it('falls back to the default rather than returning undefined', () => {
    expect(graphLevel('nope').key).toBe(DEFAULT_LEVEL);
    expect(graphLevel(undefined).key).toBe(DEFAULT_LEVEL);
  });
});

describe('graphPlan', () => {
  it('counts the whole three-level tree', () => {
    // root + branches + (branches × leaves)
    expect(graphPlan('simple')).toMatchObject({ branches: 3, leaves: 2, blocks: 10 });
    expect(graphPlan('detailed')).toMatchObject({ branches: 5, leaves: 3, blocks: 21 });
    expect(graphPlan('advanced')).toMatchObject({ branches: 6, leaves: 4, blocks: 31 });
  });

  it('counts one request for the root plus one per branch, and none for leaves', () => {
    // Leaves are created empty, so they cost nothing.
    for (const key of KEYS) {
      const plan = graphPlan(key);
      expect(plan.requests).toBe(1 + plan.branches);
    }
  });

  it('carries the level’s own fields through, so callers need only the plan', () => {
    const plan = graphPlan('advanced');
    expect(plan.key).toBe('advanced');
    expect(plan.label).toBe('Advanced');
    expect(plan.blurb).toBeTruthy();
  });

  it('falls back for an unknown key instead of throwing', () => {
    expect(graphPlan('nope').key).toBe(DEFAULT_LEVEL);
  });
});
