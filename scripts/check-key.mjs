#!/usr/bin/env node
// `npm run check-key` — answers one question definitively: is the key the dev
// server would use actually accepted by OpenAI?
//
// It talks to OpenAI directly, so it separates "the key is bad" from "the app
// is misconfigured", which a 401 in the app cannot distinguish. It never prints
// the key itself.

import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { fingerprint, inspectKey, parseEnv, resolveKey } from './keyDiagnostics.js';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const DEFAULT_MODEL = 'gpt-4o';

function readEnvFile() {
  try {
    return parseEnv(readFileSync(join(ROOT, '.env'), 'utf8'));
  } catch (error) {
    if (error.code === 'ENOENT') return null;
    throw error;
  }
}

const fileEnv = readEnvFile();

console.log('');
if (fileEnv === null) {
  console.log('  .env                 not found in the project root');
  console.log('                       create it with:  cp .env.example .env');
} else {
  const names = Object.keys(fileEnv);
  console.log(`  .env                 found, ${names.length} setting(s): ${names.join(', ') || '—'}`);
}

const { key, source, shadowedFile } = resolveKey({
  shellValue: process.env.OPENAI_API_KEY,
  fileValue: fileEnv?.OPENAI_API_KEY,
});

console.log(`  key comes from       ${source}`);
console.log(`  key                  ${fingerprint(key)}`);

if (shadowedFile) {
  console.log('');
  console.log('  ! A shell variable is overriding .env. That is Vite\'s precedence, not a bug —');
  console.log('    but it means the key in .env is being ignored. To use the file instead:');
  console.log('');
  console.log('        unset OPENAI_API_KEY');
  console.log('');
  console.log('    and check ~/.zshrc or ~/.bashrc for an export that puts it back.');
}

const problems = inspectKey(key);
if (problems.length) {
  console.log('');
  for (const p of problems) console.log(`  ${p.fatal ? '✗' : '!'} ${p.message}`);
}

if (problems.some((p) => p.fatal)) {
  console.log('');
  console.log('  Not contacting OpenAI: the value above cannot work as written.');
  console.log('  Fix it in .env, then run this again.');
  console.log('');
  process.exit(1);
}

const configured = (process.env.OPENAI_MODEL || fileEnv?.OPENAI_MODEL || '').trim();
const model = configured || DEFAULT_MODEL;
console.log(`  model                ${model}${configured ? '' : '  (default)'}`);
console.log('');
console.log('  Asking OpenAI whether it accepts this key…');

let res;
try {
  res = await fetch('https://api.openai.com/v1/models', {
    headers: { Authorization: `Bearer ${key}` },
  });
} catch (error) {
  console.log('');
  console.log(`  ✗ Could not reach api.openai.com: ${error.message}`);
  console.log('    A proxy, VPN or firewall is the usual cause. This is not a key problem.');
  console.log('');
  process.exit(1);
}

const body = await res.json().catch(() => null);

console.log('');
if (res.status === 200) {
  const ids = (body?.data ?? []).map((m) => m.id);
  console.log(`  ✓ The key is valid. ${ids.length} model(s) available to it.`);

  if (ids.includes(model)) {
    console.log(`  ✓ "${model}" is one of them.`);
    console.log('');
    console.log('    So the key is fine. If the app still reports 401, the dev server is using a');
    console.log('    different value than this script found — restart it, since Vite reads .env');
    console.log('    only at startup.');
  } else {
    console.log(`  ✗ "${model}" is NOT available to this key.`);
    const suggestions = ids.filter((id) => id.startsWith('gpt-')).slice(0, 6);
    if (suggestions.length) {
      console.log(`    Models you do have: ${suggestions.join(', ')}`);
    }
    console.log('');
    console.log('    Set OPENAI_MODEL in .env to one of those. It needs to support');
    console.log('    JSON-schema structured outputs.');
  }
} else if (res.status === 401) {
  console.log('  ✗ OpenAI rejected the key (401).');
  const message = body?.error?.message;
  if (message) console.log(`    OpenAI says: ${message}`);
  console.log('');
  console.log('    The key itself is the problem, not the app. Either it was revoked, it belongs');
  console.log('    to a deleted project, or the copy is damaged. Create a new one at');
  console.log('    https://platform.openai.com/api-keys and paste it into .env.');
} else if (res.status === 403) {
  // OpenAI returns 403 for an unsupported region, but an intercepting corporate
  // proxy returns one too — and that has nothing to do with the key.
  const message = body?.error?.message;
  if (message) {
    console.log('  ✗ OpenAI refused the request (403).');
    console.log(`    OpenAI says: ${message}`);
  } else {
    console.log('  ? Got a 403 that does not look like it came from OpenAI.');
    console.log('    Something between you and the API is intercepting the request — a corporate');
    console.log('    proxy or VPN is the usual cause. This is not a key problem.');
  }
} else if (res.status === 429) {
  console.log('  ! The key is recognised but rate-limited or out of quota (429).');
  const message = body?.error?.message;
  if (message) console.log(`    OpenAI says: ${message}`);
  console.log('    Check billing at https://platform.openai.com/settings/organization/billing');
} else {
  console.log(`  ? Unexpected response: ${res.status}`);
  if (body?.error?.message) console.log(`    OpenAI says: ${body.error.message}`);
}
console.log('');
process.exit(res.status === 200 ? 0 : 1);
