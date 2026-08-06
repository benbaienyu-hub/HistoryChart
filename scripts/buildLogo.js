// Emits the static logo files from the shared geometry in src/lib/logoMark.js.
// Split from the CLI so test/logo.test.js can assert the committed files match
// what this produces — a favicon that has drifted from the in-app mark is the
// usual way a logo ends up inconsistent, and it is silent.
import { ACCENT, INK, INK_DARK, lockupSvg, markSvg, tileSvg } from '../src/lib/logoMark.js';

export function logoFiles() {
  return {
    // The tab icon. A tile, so it holds up against light and dark browser chrome.
    'public/favicon.svg': tileSvg(),
    // The bare mark, for placing on a surface whose colour you control.
    'public/logo.svg': markSvg(),
    'public/logo-lockup.svg': lockupSvg({ mark: ACCENT, text: INK }),
    // For dark slides and dark READMEs — the wordmark needs to invert, the mark
    // does not.
    'public/logo-lockup-dark.svg': lockupSvg({ mark: ACCENT, text: INK_DARK }),
  };
}
