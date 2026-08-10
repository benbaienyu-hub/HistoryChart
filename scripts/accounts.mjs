#!/usr/bin/env node
// `npm run accounts` — the backstop for whoever runs the server.
//
// Everyone who uses this app can reset their own password with the recovery code
// they were given at sign-up. This exists for the one case that leaves: somebody
// has lost both their password and their code. Rather than hand-editing
// lacuna.json — which is how that used to be fixed, and is easy to corrupt — this
// issues them a fresh recovery code, which they then use like any other.
//
// It deliberately cannot set a password. Handing someone a password means knowing
// it, and typing it where a shell history will keep it.

import { findUserByEmail, issueRecoveryCode } from '../server/accounts.js';
import { dataFilePath, readDb } from '../server/store.js';

const [command, argument] = process.argv.slice(2);

function usage() {
  console.log(`Lacuna accounts — reading ${dataFilePath()}

  npm run accounts list                 every account on this server
  npm run accounts code <email>         issue a fresh recovery code for one person

The code is shown once. Give it to them over something you trust, and they use
"Forgot your password?" on the sign-in screen to set a new password themselves.`);
}

function describe(user) {
  const when = new Date(user.createdAt).toISOString().slice(0, 10);
  const canvases = readDb().canvases.filter((c) => c.ownerId === user.id).length;
  const ownKey = readDb().aiKeys?.some((row) => row.userId === user.id);
  return [
    user.email.padEnd(32),
    `joined ${when}`,
    `${String(canvases).padStart(3)} canvas${canvases === 1 ? '' : 'es'}`,
    user.recoveryHash ? 'has a recovery code' : 'NO recovery code',
    ownKey ? 'own AI key' : 'uses the server key',
  ].join('  ');
}

if (command === 'list') {
  const { users } = readDb();
  if (users.length === 0) {
    console.log('No accounts yet. The first person to sign up gets one.');
  } else {
    for (const user of users) console.log(describe(user));
    console.log(`\n${users.length} account${users.length === 1 ? '' : 's'}.`);
  }
} else if (command === 'code') {
  if (!argument) {
    console.error('Which account? npm run accounts code someone@example.com');
    process.exit(1);
  }
  const user = findUserByEmail(argument);
  if (!user) {
    console.error(`No account for ${argument}. Run "npm run accounts list" to see them all.`);
    process.exit(1);
  }
  const code = issueRecoveryCode(user.id);
  console.log(`New recovery code for ${user.email}:\n\n    ${code}\n`);
  console.log('Any previous code for this account no longer works.');
  console.log('They enter it under "Forgot your password?" and choose their own new password.');
} else {
  usage();
  // An unrecognised command is a mistake worth an exit code, but plain `npm run
  // accounts` asking for help is not.
  if (command) process.exit(1);
}
