import { describe, expect, it } from 'vitest';
import {
  canvasesOwnedBy,
  canvasesSharedWith,
  createCanvas,
  deleteCanvas,
  getCanvas,
  rememberOpenCanvas,
  renameCanvas,
  restorableCanvasId,
  shareCanvas,
  uniqueTitle,
  unshareCanvas,
  updateCanvas,
} from '../src/lib/canvasStore';

const ALICE = 'alice@example.com';
const BOB = 'bob@example.com';

const titles = (list) => list.map((c) => c.title);

describe('createCanvas', () => {
  it('normalizes the owner email so casing can’t split ownership', () => {
    const canvas = createCanvas({ ownerEmail: '  Alice@Example.COM ', title: 'A' });
    expect(canvas.ownerEmail).toBe(ALICE);
    expect(titles(canvasesOwnedBy('ALICE@example.com'))).toEqual(['A']);
  });

  it('starts with an empty share list and matching timestamps', () => {
    const canvas = createCanvas({ ownerEmail: ALICE });
    expect(canvas.sharedWith).toEqual([]);
    expect(canvas.createdAt).toBe(canvas.updatedAt);
  });

  it('gives each canvas a distinct id', () => {
    const a = createCanvas({ ownerEmail: ALICE });
    const b = createCanvas({ ownerEmail: ALICE });
    expect(a.id).not.toBe(b.id);
  });
});

describe('canvasesOwnedBy / canvasesSharedWith', () => {
  it('scopes canvases to their owner', () => {
    createCanvas({ ownerEmail: ALICE, title: 'A' });
    createCanvas({ ownerEmail: BOB, title: 'B' });
    expect(titles(canvasesOwnedBy(ALICE))).toEqual(['A']);
    expect(titles(canvasesOwnedBy(BOB))).toEqual(['B']);
  });

  it('sorts most-recently-updated first', () => {
    const old = createCanvas({ ownerEmail: ALICE, title: 'old' });
    createCanvas({ ownerEmail: ALICE, title: 'new' });
    updateCanvas(old.id, { title: 'old (touched)' });
    expect(titles(canvasesOwnedBy(ALICE))[0]).toBe('old (touched)');
  });

  it('never lists a canvas as both owned and shared', () => {
    const canvas = createCanvas({ ownerEmail: ALICE, title: 'A' });
    shareCanvas(canvas.id, BOB);
    expect(titles(canvasesOwnedBy(ALICE))).toEqual(['A']);
    expect(canvasesSharedWith(ALICE)).toEqual([]);
    expect(titles(canvasesSharedWith(BOB))).toEqual(['A']);
  });
});

describe('shareCanvas', () => {
  it('refuses to share with the owner', () => {
    const canvas = createCanvas({ ownerEmail: ALICE });
    expect(shareCanvas(canvas.id, 'ALICE@example.com')).toEqual({ ok: false, reason: 'self' });
  });

  it('refuses a duplicate share', () => {
    const canvas = createCanvas({ ownerEmail: ALICE });
    expect(shareCanvas(canvas.id, BOB).ok).toBe(true);
    expect(shareCanvas(canvas.id, BOB)).toEqual({ ok: false, reason: 'already-shared' });
    expect(getCanvas(canvas.id).sharedWith).toEqual([BOB]);
  });

  it('reports a missing canvas rather than throwing', () => {
    expect(shareCanvas('nope', BOB)).toEqual({ ok: false, reason: 'not-found' });
  });

  it('unshare removes access and is safe to repeat', () => {
    const canvas = createCanvas({ ownerEmail: ALICE });
    shareCanvas(canvas.id, BOB);
    unshareCanvas(canvas.id, BOB);
    unshareCanvas(canvas.id, BOB);
    expect(canvasesSharedWith(BOB)).toEqual([]);
  });
});

describe('updateCanvas / deleteCanvas', () => {
  it('bumps updatedAt and leaves other canvases alone', () => {
    const a = createCanvas({ ownerEmail: ALICE, title: 'A' });
    const b = createCanvas({ ownerEmail: ALICE, title: 'B' });
    updateCanvas(a.id, { title: 'A2' });
    expect(getCanvas(a.id).title).toBe('A2');
    expect(getCanvas(b.id).title).toBe('B');
    expect(getCanvas(a.id).updatedAt).toBeGreaterThanOrEqual(a.updatedAt);
  });

  it('returns null for an unknown id instead of creating one', () => {
    expect(updateCanvas('nope', { title: 'x' })).toBeNull();
    expect(getCanvas('nope')).toBeNull();
  });

  it('delete removes only the target', () => {
    const a = createCanvas({ ownerEmail: ALICE, title: 'A' });
    const b = createCanvas({ ownerEmail: ALICE, title: 'B' });
    deleteCanvas(a.id);
    expect(getCanvas(a.id)).toBeNull();
    expect(getCanvas(b.id)).not.toBeNull();
  });
});

describe('remembering the open canvas', () => {
  it('round-trips the id for the owner', () => {
    const canvas = createCanvas({ ownerEmail: ALICE });
    rememberOpenCanvas(ALICE, canvas.id);
    expect(restorableCanvasId(ALICE)).toBe(canvas.id);
  });

  it('is per-user — one user’s open canvas is not another’s', () => {
    const canvas = createCanvas({ ownerEmail: ALICE });
    rememberOpenCanvas(ALICE, canvas.id);
    expect(restorableCanvasId(BOB)).toBeNull();
  });

  it('normalizes the email on both write and read', () => {
    const canvas = createCanvas({ ownerEmail: ALICE });
    rememberOpenCanvas('  Alice@Example.COM ', canvas.id);
    expect(restorableCanvasId('ALICE@EXAMPLE.COM')).toBe(canvas.id);
  });

  it('returns null with nothing remembered', () => {
    expect(restorableCanvasId(ALICE)).toBeNull();
  });

  it('forgets when passed null, without disturbing other users', () => {
    const a = createCanvas({ ownerEmail: ALICE });
    const b = createCanvas({ ownerEmail: BOB });
    rememberOpenCanvas(ALICE, a.id);
    rememberOpenCanvas(BOB, b.id);
    rememberOpenCanvas(ALICE, null);
    expect(restorableCanvasId(ALICE)).toBeNull();
    expect(restorableCanvasId(BOB)).toBe(b.id);
  });

  it('drops a pointer to a deleted canvas', () => {
    const canvas = createCanvas({ ownerEmail: ALICE });
    rememberOpenCanvas(ALICE, canvas.id);
    deleteCanvas(canvas.id);
    expect(restorableCanvasId(ALICE)).toBeNull();
  });

  it('restores a canvas shared with the user', () => {
    const canvas = createCanvas({ ownerEmail: ALICE });
    shareCanvas(canvas.id, BOB);
    rememberOpenCanvas(BOB, canvas.id);
    expect(restorableCanvasId(BOB)).toBe(canvas.id);
  });

  it('stops restoring once the share is revoked', () => {
    const canvas = createCanvas({ ownerEmail: ALICE });
    shareCanvas(canvas.id, BOB);
    rememberOpenCanvas(BOB, canvas.id);
    unshareCanvas(canvas.id, BOB);
    expect(restorableCanvasId(BOB)).toBeNull();
  });

  it('will not restore a canvas the user never had access to', () => {
    const canvas = createCanvas({ ownerEmail: ALICE });
    rememberOpenCanvas(BOB, canvas.id);
    expect(restorableCanvasId(BOB)).toBeNull();
  });
});

describe('uniqueTitle', () => {
  it('leaves a free title alone', () => {
    expect(uniqueTitle('Ethiopia', ['Rome', 'Carthage'])).toBe('Ethiopia');
  });

  it('numbers the second one from (1)', () => {
    expect(uniqueTitle('Untitled canvas', ['Untitled canvas'])).toBe('Untitled canvas (1)');
  });

  it('keeps counting past the first collision', () => {
    const taken = ['Untitled canvas', 'Untitled canvas (1)', 'Untitled canvas (2)'];
    expect(uniqueTitle('Untitled canvas', taken)).toBe('Untitled canvas (3)');
  });

  it('fills a gap left by a deletion rather than always taking the highest', () => {
    const taken = ['Notes', 'Notes (2)'];
    expect(uniqueTitle('Notes', taken)).toBe('Notes (1)');
  });

  it('renumbers a title that already ends in a counter, instead of stacking', () => {
    // Duplicating "Notes (2)" should give "Notes (3)", never "Notes (2) (1)".
    expect(uniqueTitle('Notes (2)', ['Notes', 'Notes (2)'])).toBe('Notes (1)');
    expect(uniqueTitle('Notes (2)', ['Notes (1)', 'Notes (2)'])).toBe('Notes (3)');
  });

  it('compares case-insensitively — two names that read alike are alike', () => {
    expect(uniqueTitle('untitled canvas', ['Untitled Canvas'])).toBe('untitled canvas (1)');
  });

  it('ignores surrounding whitespace on both sides of the comparison', () => {
    expect(uniqueTitle('  Notes  ', ['Notes'])).toBe('Notes (1)');
    expect(uniqueTitle('Notes', ['  Notes '])).toBe('Notes (1)');
  });

  it('falls back to the default for an empty title', () => {
    expect(uniqueTitle('', [])).toBe('Untitled canvas');
    expect(uniqueTitle('   ', [])).toBe('Untitled canvas');
    expect(uniqueTitle(null, ['Untitled canvas'])).toBe('Untitled canvas (1)');
  });

  it('handles an absent list of taken titles', () => {
    expect(uniqueTitle('Notes', undefined)).toBe('Notes');
    expect(uniqueTitle('Notes', [null, undefined])).toBe('Notes');
  });

  it('does not treat a number in the middle of a title as a counter', () => {
    expect(uniqueTitle('Rome (753 BC) notes', ['Rome (753 BC) notes'])).toBe(
      'Rome (753 BC) notes (1)'
    );
  });
});

describe('unique titles in the library', () => {
  it('numbers a second canvas of the same name', () => {
    createCanvas({ ownerEmail: ALICE });
    const second = createCanvas({ ownerEmail: ALICE });
    expect(titles(canvasesOwnedBy(ALICE)).sort()).toEqual([
      'Untitled canvas',
      'Untitled canvas (1)',
    ]);
    expect(second.title).toBe('Untitled canvas (1)');
  });

  it('numbers a template opened twice', () => {
    createCanvas({ ownerEmail: ALICE, title: 'Photosynthesis' });
    const again = createCanvas({ ownerEmail: ALICE, title: 'Photosynthesis' });
    expect(again.title).toBe('Photosynthesis (1)');
  });

  it('scopes uniqueness to the owner — your names are not mine', () => {
    createCanvas({ ownerEmail: ALICE, title: 'Rome' });
    const bobs = createCanvas({ ownerEmail: BOB, title: 'Rome' });
    expect(bobs.title).toBe('Rome');
  });

  it('renaming onto an existing name gets a counter too', () => {
    createCanvas({ ownerEmail: ALICE, title: 'Rome' });
    const other = createCanvas({ ownerEmail: ALICE, title: 'Carthage' });
    expect(renameCanvas(other.id, 'Rome').title).toBe('Rome (1)');
  });

  it('renaming a canvas to its own name is not a collision with itself', () => {
    const canvas = createCanvas({ ownerEmail: ALICE, title: 'Rome' });
    expect(renameCanvas(canvas.id, 'Rome').title).toBe('Rome');
  });

  it('renaming an unknown id does nothing rather than throwing', () => {
    expect(renameCanvas('nope', 'Rome')).toBeNull();
  });

  it('a name freed by a deletion becomes available again', () => {
    const first = createCanvas({ ownerEmail: ALICE, title: 'Rome' });
    deleteCanvas(first.id);
    expect(createCanvas({ ownerEmail: ALICE, title: 'Rome' }).title).toBe('Rome');
  });
});
