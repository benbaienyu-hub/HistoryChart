import { describe, expect, it } from 'vitest';
import {
  fingerprint,
  inspectKey,
  parseEnv,
  resolveKey,
} from '../scripts/keyDiagnostics.js';

const VALID = 'sk-proj-' + 'a'.repeat(120);

const messages = (key) => inspectKey(key).map((p) => p.message).join(' | ');
const isFatal = (key) => inspectKey(key).some((p) => p.fatal);

describe('parseEnv', () => {
  it('reads a plain assignment', () => {
    expect(parseEnv('OPENAI_API_KEY=sk-abc')).toEqual({ OPENAI_API_KEY: 'sk-abc' });
  });

  it('ignores blank lines and comments', () => {
    const text = '# a comment\n\nOPENAI_API_KEY=sk-abc\n\n#OPENAI_MODEL=gpt-4o\n';
    expect(parseEnv(text)).toEqual({ OPENAI_API_KEY: 'sk-abc' });
  });

  it('strips surrounding double and single quotes, as dotenv does', () => {
    expect(parseEnv('A="sk-abc"').A).toBe('sk-abc');
    expect(parseEnv("B='sk-abc'").B).toBe('sk-abc');
  });

  it('keeps a quote that is not a matching pair', () => {
    expect(parseEnv('A="sk-abc').A).toBe('"sk-abc');
  });

  it('strips a trailing comment from an unquoted value only', () => {
    expect(parseEnv('A=sk-abc # my key').A).toBe('sk-abc');
    expect(parseEnv('B="sk-abc # not a comment"').B).toBe('sk-abc # not a comment');
  });

  it('keeps "=" inside a value', () => {
    expect(parseEnv('A=sk-ab=cd').A).toBe('sk-ab=cd');
  });

  it('tolerates an "export" prefix and surrounding whitespace', () => {
    expect(parseEnv('  export OPENAI_API_KEY = sk-abc  ').OPENAI_API_KEY).toBe('sk-abc');
  });

  it('skips a line with no "="', () => {
    expect(parseEnv('nonsense\nA=1')).toEqual({ A: '1' });
  });

  it('handles CRLF line endings', () => {
    expect(parseEnv('A=1\r\nB=2\r\n')).toEqual({ A: '1', B: '2' });
  });
});

describe('fingerprint', () => {
  it('never reveals the middle of the key', () => {
    const fp = fingerprint(VALID);
    expect(fp).toContain('sk-proj');
    expect(fp).not.toContain('aaaaaaaaaaaa');
    expect(fp).toContain(String(VALID.length));
  });

  it('reports only a length for something too short to abbreviate', () => {
    expect(fingerprint('sk-abc')).toBe('6 chars');
  });

  it('handles an absent key', () => {
    expect(fingerprint(null)).toBe('(none)');
    expect(fingerprint('')).toBe('(none)');
  });
});

describe('inspectKey', () => {
  it('passes a well-formed key', () => {
    expect(inspectKey(VALID)).toEqual([]);
  });

  it('reports an absent key as fatal', () => {
    expect(isFatal(null)).toBe(true);
    expect(messages(null)).toMatch(/No OPENAI_API_KEY/);
  });

  it('catches the unreplaced placeholder', () => {
    expect(isFatal('sk-...')).toBe(true);
    expect(messages('sk-...')).toMatch(/placeholder/);
  });

  it('catches whitespace, including a key split across lines', () => {
    expect(isFatal('sk-proj-aaa bbb')).toBe(true);
    expect(isFatal('sk-proj-aaa\nbbb')).toBe(true);
    expect(messages('sk-proj-aaa bbb')).toMatch(/one unbroken line/);
  });

  it('catches a curly quote or non-breaking space from a bad paste', () => {
    expect(isFatal(`sk-proj-${'a'.repeat(100)}’`)).toBe(true);
    expect(isFatal(`sk-proj-${'a'.repeat(100)} `)).toBe(true);
    expect(messages(`sk-proj-${'a'.repeat(100)}’`)).toMatch(/non-ASCII/);
  });

  it('flags a truncated-looking key without calling it fatal', () => {
    const problems = inspectKey('sk-short');
    expect(problems.some((p) => /shorter/.test(p.message))).toBe(true);
    expect(problems.every((p) => !p.fatal)).toBe(true);
  });

  it('flags a missing sk- prefix without calling it fatal', () => {
    // Not fatal: the prefix is a convention, not something we should hard-fail on.
    const problems = inspectKey('proj-' + 'a'.repeat(60));
    expect(problems.some((p) => /sk-/.test(p.message))).toBe(true);
    expect(problems.every((p) => !p.fatal)).toBe(true);
  });

  it('reports several faults at once', () => {
    expect(inspectKey('"sk-... "').length).toBeGreaterThan(2);
  });
});

describe('resolveKey', () => {
  it('prefers the shell value, matching Vite’s precedence', () => {
    const r = resolveKey({ shellValue: 'sk-shell', fileValue: 'sk-file' });
    expect(r.key).toBe('sk-shell');
    expect(r.source).toBe('shell environment');
    expect(r.shadowedFile).toBe(true);
  });

  it('does not report shadowing when both values agree', () => {
    expect(resolveKey({ shellValue: 'sk-same', fileValue: 'sk-same' }).shadowedFile).toBe(false);
  });

  it('falls back to .env when the shell has nothing', () => {
    const r = resolveKey({ shellValue: undefined, fileValue: 'sk-file' });
    expect(r).toEqual({ key: 'sk-file', source: '.env', shadowedFile: false });
  });

  it('treats a blank or whitespace-only shell value as unset', () => {
    expect(resolveKey({ shellValue: '   ', fileValue: 'sk-file' }).key).toBe('sk-file');
    expect(resolveKey({ shellValue: '', fileValue: 'sk-file' }).source).toBe('.env');
  });

  it('reports nowhere when neither is set', () => {
    expect(resolveKey({})).toEqual({ key: null, source: 'nowhere', shadowedFile: false });
  });
});
