#!/usr/bin/env node
// Regenerates the static logo files. Run after editing src/lib/logoMark.js —
// test/logo.test.js fails until you do.
import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { logoFiles } from './buildLogo.js';

const root = resolve(import.meta.dirname, '..');

for (const [relative, contents] of Object.entries(logoFiles())) {
  const path = resolve(root, relative);
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, contents);
  console.log(`wrote ${relative}`);
}
