// @vitest-environment node
// Reads files off disk, which jsdom has no business doing.
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import { logoFiles } from '../scripts/buildLogo.js';
import { MARK_PATHS, STROKE, VIEWBOX, lockupSvg, markSvg, tileSvg } from '../src/lib/logoMark.js';

const root = resolve(import.meta.dirname, '..');

describe('the committed logo files', () => {
  // The point of the whole arrangement: the tab icon and the header mark are
  // generated from one set of paths, so they cannot quietly diverge. If this
  // fails, run `npm run logo`.
  for (const [relative, expected] of Object.entries(logoFiles())) {
    it(`${relative} matches the shared geometry`, () => {
      const onDisk = readFileSync(resolve(root, relative), 'utf8');
      expect(onDisk, `stale — run: npm run logo`).toBe(expected);
    });
  }

  it('is referenced by index.html', () => {
    const html = readFileSync(resolve(root, 'index.html'), 'utf8');
    expect(html).toContain('/favicon.svg');
  });
});

describe('the mark', () => {
  it('is a bracket pair with a gap between two dashes', () => {
    // Four strokes: two brackets, and the passage either side of the lacuna. If
    // this count changes the mark has been redesigned, not tweaked.
    expect(MARK_PATHS).toHaveLength(4);
  });

  it('keeps the gap wider than the stroke, or it closes up when scaled down', () => {
    // Round caps eat half a stroke width from each side of the gap. Once the gap
    // is narrower than the stroke there is no gap left at any size, and the mark
    // becomes a single dash — which is the one thing it must not be.
    const [, , left, right] = MARK_PATHS;
    const [start, length] = left.match(/M([\d.]+) 16h([\d.]+)/).slice(1).map(Number);
    const startOfRight = Number(right.match(/M([\d.]+)/)[1]);
    expect(startOfRight - (start + length)).toBeGreaterThan(STROKE * 1.5);
  });

  it('sits inside its viewBox, so nothing clips when it is used as an icon', () => {
    const half = STROKE / 2;
    for (const d of MARK_PATHS) {
      for (const n of d.match(/[\d.]+/g).map(Number)) {
        expect(n).toBeGreaterThanOrEqual(0);
      }
    }
    // The outermost stroke centre must leave room for half a stroke plus its cap.
    const xs = MARK_PATHS.flatMap((d) => d.match(/[\d.]+/g).map(Number));
    expect(Math.min(...xs)).toBeGreaterThan(half);
    expect(Math.max(...xs)).toBeLessThan(VIEWBOX - half);
  });
});

describe('the generated SVG', () => {
  it('names itself, so it reads as "Lacuna" rather than "image"', () => {
    expect(markSvg()).toContain('<title>Lacuna</title>');
    expect(tileSvg()).toContain('<title>Lacuna</title>');
  });

  it('draws the tile behind the mark, not over it', () => {
    const svg = tileSvg();
    expect(svg.indexOf('<rect')).toBeLessThan(svg.indexOf('<path'));
  });

  it('insets the mark within the tile rather than bleeding to the edge', () => {
    expect(tileSvg()).toMatch(/translate\([\d.]+ [\d.]+\) scale\(0\.\d+\)/);
  });

  it('takes a colour, since the tile reverses the mark out in white', () => {
    expect(tileSvg({ color: '#ffffff', background: '#000000' })).toContain('stroke="#ffffff"');
    expect(markSvg({ color: '#ff0000' })).toContain('stroke="#ff0000"');
  });

  it('gives the lockup room for the wordmark beside the mark', () => {
    const svg = lockupSvg();
    expect(svg).toMatch(/viewBox="0 0 128 32"/);
    expect(svg).toContain('>Lacuna</text>');
    // The text must start clear of the 32-wide mark.
    expect(Number(svg.match(/<text x="([\d.]+)"/)[1])).toBeGreaterThan(VIEWBOX);
  });

  it('inverts only the wordmark for dark backgrounds — the blue works on both', () => {
    const light = lockupSvg({ mark: '#0071e3', text: '#1d1d1f' });
    const dark = lockupSvg({ mark: '#0071e3', text: '#f5f5f7' });
    expect(light).toContain('stroke="#0071e3"');
    expect(dark).toContain('stroke="#0071e3"');
    expect(dark).toContain('fill="#f5f5f7"');
  });
});
