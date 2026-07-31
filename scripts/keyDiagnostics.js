// Pure helpers behind `npm run check-key`. Kept free of I/O so the parsing and
// the "what is wrong with this key" rules can be unit tested directly.

// A deliberately small .env parser, matching the subset of dotenv's behaviour
// that Vite relies on: KEY=value per line, # comments, and surrounding quotes
// stripped. It exists so the diagnostic reads the same file the dev server does
// without pulling in a dependency.
export function parseEnv(text) {
  const out = {};
  for (const rawLine of String(text).split(/\r?\n/)) {
    const line = rawLine.trim();
    if (!line || line.startsWith('#')) continue;

    const eq = line.indexOf('=');
    if (eq === -1) continue;

    const key = line.slice(0, eq).trim().replace(/^export\s+/, '');
    let value = line.slice(eq + 1).trim();

    const quote = value[0];
    if ((quote === '"' || quote === "'") && value.endsWith(quote) && value.length > 1) {
      value = value.slice(1, -1);
    } else {
      // Only an unquoted value can carry a trailing comment.
      const hash = value.indexOf(' #');
      if (hash !== -1) value = value.slice(0, hash).trim();
    }
    out[key] = value;
  }
  return out;
}

// Never print a key. This is what the diagnostic shows instead.
export function fingerprint(key) {
  if (!key) return '(none)';
  if (key.length <= 12) return `${key.length} chars`;
  return `${key.length} chars, ${key.slice(0, 7)}…${key.slice(-4)}`;
}

// Problems worth reporting before spending a request on the API. `fatal` means
// the key certainly will not work, so there is no point calling out.
export function inspectKey(key) {
  const problems = [];

  if (!key) {
    problems.push({ fatal: true, message: 'No OPENAI_API_KEY found in the shell or in .env.' });
    return problems;
  }

  if (key.includes('...') || key.includes('…')) {
    problems.push({
      fatal: true,
      message:
        'The value still contains "..." — the placeholder from .env.example was not fully replaced.',
    });
  }
  if (/\s/.test(key)) {
    problems.push({
      fatal: true,
      message: 'The value contains a space, tab or line break. A key must be one unbroken line.',
    });
  }
  if (/["']/.test(key)) {
    problems.push({
      fatal: false,
      message: 'The value contains a quote character, which is usually a stray paste artefact.',
    });
  }
  // Smart quotes and non-breaking spaces survive a copy from a web page or a
  // chat window and are invisible in most editors.
  if (/[^\x20-\x7E]/.test(key)) {
    problems.push({
      fatal: true,
      message:
        'The value contains a non-ASCII character (a curly quote or non-breaking space, most likely). Retype or re-copy it as plain text.',
    });
  }
  if (!key.startsWith('sk-')) {
    problems.push({
      fatal: false,
      message: 'The value does not start with "sk-", which OpenAI keys normally do.',
    });
  }
  if (key.length < 40) {
    problems.push({
      fatal: false,
      message: `The value is only ${key.length} characters, which is shorter than any current OpenAI key — it looks truncated.`,
    });
  }

  return problems;
}

// Which value the dev server will actually use. Vite's loadEnv lets a real
// environment variable win over .env, so a stale shell export silently beats
// whatever is in the file — the single most confusing failure here.
export function resolveKey({ shellValue, fileValue }) {
  const shell = shellValue?.trim() || null;
  const file = fileValue?.trim() || null;

  if (shell) {
    return {
      key: shell,
      source: 'shell environment',
      shadowedFile: Boolean(file) && file !== shell,
    };
  }
  return { key: file, source: file ? '.env' : 'nowhere', shadowedFile: false };
}
