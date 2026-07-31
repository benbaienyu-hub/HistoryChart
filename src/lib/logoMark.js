// The Lacuna mark, in one place.
//
// It is the editorial notation for an omission — a bracketed gap, `[- -]`, which
// is how a missing passage is marked in a manuscript. That is what a lacuna is,
// and finding the ones in your own notes is what the app is for.
//
// Everything that draws the logo reads these constants: the React component, the
// favicon, the standalone files under public/. scripts/build-logo.mjs regenerates
// the static files and test/logo.test.js fails if they have drifted, so the mark
// cannot end up different in the tab from the header.

export const VIEWBOX = 32;

// Heavy enough that the gap survives a 16px favicon. At lighter weights the two
// round caps close the gap optically and the mark reads as one dash — which
// throws away the only idea it has.
export const STROKE = 3;

export const MARK_PATHS = [
  'M8.2 6.8H3.6v18.4h4.6', // left bracket
  'M23.8 6.8h4.6v18.4h-4.6', // right bracket
  'M9.3 16h3', // the passage, before the gap
  'M19.7 16h3', // and after it
];

// Brand blue, matching --color-accent. Kept as a literal rather than read from
// CSS because the favicon and the standalone files are static, and a favicon that
// waited on a stylesheet would render blank.
export const ACCENT = '#0071e3';

export const INK = '#1d1d1f';
export const INK_DARK = '#f5f5f7';

// Corner radius of the app-icon tile, as a fraction of its size. Matches the
// squircle proportions of the platform icons it sits beside.
export const TILE_RADIUS = 0.23;

// Inset of the mark within the tile: the mark needs air around it or it reads as
// a sticker rather than an icon.
const TILE_INSET = 0.09;

function paths(color, indent = '  ') {
  return MARK_PATHS.map((d) => `${indent}<path d="${d}"/>`).join('\n');
}

function strokeGroup(color, indent = '  ') {
  return [
    `${indent}<g stroke="${color}" stroke-width="${STROKE}" stroke-linecap="round" stroke-linejoin="round" fill="none">`,
    paths(color, `${indent}  `),
    `${indent}</g>`,
  ].join('\n');
}

// The bare mark, transparent behind it.
export function markSvg({ color = ACCENT, size = VIEWBOX, title = 'Lacuna' } = {}) {
  return [
    `<svg xmlns="http://www.w3.org/2000/svg" width="${size}" height="${size}" viewBox="0 0 ${VIEWBOX} ${VIEWBOX}" fill="none">`,
    `  <title>${title}</title>`,
    strokeGroup(color),
    '</svg>',
    '',
  ].join('\n');
}

// The app icon: the mark reversed out of a solid tile. A tile rather than a bare
// mark because a favicon sits on browser chrome of unknown colour, and a
// monochrome mark disappears against half of them.
export function tileSvg({
  background = ACCENT,
  color = '#ffffff',
  size = VIEWBOX,
  title = 'Lacuna',
} = {}) {
  const inset = VIEWBOX * TILE_INSET;
  const scale = (VIEWBOX - inset * 2) / VIEWBOX;
  return [
    `<svg xmlns="http://www.w3.org/2000/svg" width="${size}" height="${size}" viewBox="0 0 ${VIEWBOX} ${VIEWBOX}" fill="none">`,
    `  <title>${title}</title>`,
    `  <rect width="${VIEWBOX}" height="${VIEWBOX}" rx="${(VIEWBOX * TILE_RADIUS).toFixed(2)}" fill="${background}"/>`,
    `  <g transform="translate(${inset.toFixed(2)} ${inset.toFixed(2)}) scale(${scale.toFixed(4)})">`,
    strokeGroup(color, '    '),
    '  </g>',
    '</svg>',
    '',
  ].join('\n');
}

// Mark plus wordmark, for a README header or a slide.
//
// The wordmark is live text in the app's own font stack rather than outlined
// glyphs — this repo has no font tooling to outline with. It therefore renders in
// whatever the viewer has installed, which is fine on the web and worth knowing
// before dropping it into a printed deck.
const WORDMARK_FONT =
  "-apple-system, BlinkMacSystemFont, 'SF Pro Display', 'Segoe UI', Roboto, 'Helvetica Neue', Arial, sans-serif";

export function lockupSvg({ mark = ACCENT, text = INK, height = VIEWBOX } = {}) {
  const gap = 11;
  const width = 128;
  return [
    `<svg xmlns="http://www.w3.org/2000/svg" width="${Math.round(
      (width / VIEWBOX) * height
    )}" height="${height}" viewBox="0 0 ${width} ${VIEWBOX}" fill="none">`,
    '  <title>Lacuna</title>',
    strokeGroup(mark),
    `  <text x="${VIEWBOX + gap}" y="22.2" font-family="${WORDMARK_FONT}" font-size="21" font-weight="600" letter-spacing="-0.6" fill="${text}">Lacuna</text>`,
    '</svg>',
    '',
  ].join('\n');
}
