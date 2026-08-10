import { describe, expect, it } from 'vitest';
import {
  RECOVERY_LENGTH,
  formatRecoveryCode,
  looksLikeRecoveryCode,
  normalizeRecoveryCode,
} from '../src/lib/recoveryCode';

const VALID = 'K7QFX-M2XRT-9BWHD-CJ4NP';

describe('normalizeRecoveryCode', () => {
  it('folds case and drops the separators we print', () => {
    expect(normalizeRecoveryCode(VALID)).toBe('K7QFXM2XRT9BWHDCJ4NP');
    expect(normalizeRecoveryCode(VALID.toLowerCase())).toBe('K7QFXM2XRT9BWHDCJ4NP');
  });

  it('survives a sloppy paste', () => {
    // Spaces from a word processor, a period from an email client, a stray newline.
    expect(normalizeRecoveryCode(' k7qfx m2xrt\n9bwhd cj4np. ')).toBe('K7QFXM2XRT9BWHDCJ4NP');
  });

  it('answers with an empty string for nothing at all', () => {
    expect(normalizeRecoveryCode(undefined)).toBe('');
    expect(normalizeRecoveryCode('')).toBe('');
  });
});

describe('looksLikeRecoveryCode', () => {
  it('accepts a real code, formatted or not', () => {
    expect(looksLikeRecoveryCode(VALID)).toBe(true);
    expect(looksLikeRecoveryCode(normalizeRecoveryCode(VALID))).toBe(true);
  });

  it('rejects the wrong length', () => {
    expect(looksLikeRecoveryCode('K7QFX-M2XRT')).toBe(false);
    expect(looksLikeRecoveryCode(`${VALID}-EXTRA`)).toBe(false);
    expect(looksLikeRecoveryCode('')).toBe(false);
  });

  it('rejects a code containing a character we never issue', () => {
    // An I, L, O, 0 or 1 in a code means it was misread. Both halves of each
    // confusable pair are outside the alphabet, so there is nothing to correct to
    // — saying no is the honest answer.
    expect(looksLikeRecoveryCode('K7QFX-M2XRT-9BWHD-CJ4NO')).toBe(false);
    expect(looksLikeRecoveryCode('I7QFX-M2XRT-9BWHD-CJ4NP')).toBe(false);
    expect(looksLikeRecoveryCode('K7QFX-M2XRT-9BWHD-CJ4N0')).toBe(false);
  });

  it('rejects a password typed into the code field', () => {
    expect(looksLikeRecoveryCode('correct horse battery staple')).toBe(false);
  });
});

describe('formatRecoveryCode', () => {
  it('groups for reading and is idempotent', () => {
    const raw = normalizeRecoveryCode(VALID);
    expect(formatRecoveryCode(raw)).toBe(VALID);
    expect(formatRecoveryCode(VALID)).toBe(VALID);
  });

  it('formats a partial code without inventing characters', () => {
    expect(formatRecoveryCode('K7QFXM2')).toBe('K7QFX-M2');
    expect(formatRecoveryCode('')).toBe('');
  });

  it('agrees with the declared length', () => {
    expect(normalizeRecoveryCode(VALID)).toHaveLength(RECOVERY_LENGTH);
  });
});
