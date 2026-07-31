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
  it('offers exactly the four the menu shows', () => {
    expect(KEYS).toEqual(['simple', 'concise', 'detailed', 'advanced']);
  });

  it('gives every level a label, a blurb, a register, and positive ceilings', () => {
    for (const level of GRAPH_LEVELS) {
      expect(level.label).toBeTruthy();
      expect(level.blurb).toBeTruthy();
      expect(['plain', 'standard', 'expert']).toContain(level.register);
      expect(level.maxBranches).toBeGreaterThan(0);
      expect(level.maxLeaves).toBeGreaterThan(0);
    }
  });

  it('separates how much is generated from how it is written', () => {
    // Concise exists to give detailed writing in a small graph, so it must share
    // Detailed's register while asking for fewer blocks. If that ever collapses,
    // the level is just a second Simple.
    const concise = graphLevel('concise');
    const detailed = graphLevel('detailed');
    expect(concise.register).toBe(detailed.register);
    expect(graphPlan('concise').maxBlocks).toBeLessThan(graphPlan('detailed').maxBlocks);
    expect(concise.register).not.toBe(graphLevel('simple').register);
  });

  it('grows monotonically down the menu, so the ordering is honest', () => {
    for (let i = 1; i < GRAPH_LEVELS.length; i++) {
      expect(graphPlan(GRAPH_LEVELS[i].key).maxBlocks).toBeGreaterThan(
        graphPlan(GRAPH_LEVELS[i - 1].key).maxBlocks
      );
    }
  });

  it('never asks for more branches than the route can return', () => {
    // The response schema caps subtopics at 8; a level wanting more would
    // silently produce a narrower graph than its menu entry promises.
    for (const level of GRAPH_LEVELS) {
      expect(level.maxBranches).toBeLessThanOrEqual(8);
      expect(level.maxLeaves).toBeLessThanOrEqual(8);
    }
  });

  it('keeps the request count small enough to be affordable', () => {
    for (const key of KEYS) expect(graphPlan(key).maxRequests).toBeLessThanOrEqual(8);
  });

  it('has a default that is one of the levels', () => {
    expect(KEYS).toContain(DEFAULT_LEVEL);
  });
});

describe('isGraphLevel', () => {
  it('accepts the real keys and nothing else', () => {
    for (const key of KEYS) expect(isGraphLevel(key)).toBe(true);
    for (const key of ['', 'SIMPLE', 'expert', 'brief', null, undefined, 'toString']) {
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
  it('counts the ceiling of the whole three-level tree', () => {
    // root + branches + (branches × leaves)
    expect(graphPlan('simple')).toMatchObject({ maxBranches: 3, maxLeaves: 2, maxBlocks: 10 });
    expect(graphPlan('concise')).toMatchObject({ maxBranches: 3, maxLeaves: 3, maxBlocks: 13 });
    expect(graphPlan('detailed')).toMatchObject({ maxBranches: 5, maxLeaves: 3, maxBlocks: 21 });
    expect(graphPlan('advanced')).toMatchObject({ maxBranches: 6, maxLeaves: 4, maxBlocks: 31 });
  });

  it('counts one request for the root plus one per branch, and none for leaves', () => {
    // Leaf content rides along in the branch's response, so leaves cost nothing.
    for (const key of KEYS) {
      const plan = graphPlan(key);
      expect(plan.maxRequests).toBe(1 + plan.maxBranches);
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
