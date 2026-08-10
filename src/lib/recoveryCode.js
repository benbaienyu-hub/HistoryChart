// The format of a recovery code, shared by the server that issues them and the
// form that accepts them — so "is this even a code" is answered the same way in
// both places.
//
// A recovery code exists because this app has no way to send email. Without one,
// a forgotten password can only be fixed by whoever owns the server editing JSON
// by hand, which makes every other person on it a dependent.

// No I, L, O, 0 or 1: the code gets read off a screen or a piece of paper, and
// those are the characters people mistype. 31 symbols over 20 characters is about
// 10^29 possibilities, so guessing is not an attack worth considering.
export const RECOVERY_ALPHABET = 'ABCDEFGHJKMNPQRSTUVWXYZ23456789';
export const RECOVERY_GROUP_SIZE = 5;
export const RECOVERY_GROUPS = 4;
export const RECOVERY_LENGTH = RECOVERY_GROUP_SIZE * RECOVERY_GROUPS;

// Everything that isn't a code character goes: the dashes we print, spaces from a
// sloppy paste, and a trailing period from an email client. Lowercase is folded up
// rather than rejected, because case is not information here.
export function normalizeRecoveryCode(input) {
  return String(input ?? '')
    .toUpperCase()
    .replace(/[^A-Z0-9]/g, '');
}

// Deliberately does not "correct" an O to a 0 or an I to a 1. Both members of each
// confusable pair are absent from the alphabet, so a code containing one was
// misread — and there is no way to know which way. Failing with "that code doesn't
// match" is better than silently trying a different code.
export function looksLikeRecoveryCode(input) {
  const code = normalizeRecoveryCode(input);
  if (code.length !== RECOVERY_LENGTH) return false;
  return [...code].every((ch) => RECOVERY_ALPHABET.includes(ch));
}

// Grouped for reading and typing. The dashes are cosmetic — normalize strips them.
export function formatRecoveryCode(input) {
  const code = normalizeRecoveryCode(input);
  const groups = [];
  for (let i = 0; i < code.length; i += RECOVERY_GROUP_SIZE) {
    groups.push(code.slice(i, i + RECOVERY_GROUP_SIZE));
  }
  return groups.join('-');
}
