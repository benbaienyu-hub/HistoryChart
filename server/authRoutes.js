// Registration, sign-in, sign-out, and "who am I".
//
// The session lives in an httpOnly cookie rather than a token in localStorage:
// the browser attaches it automatically, and no script on the page — including
// injected script — can read it.

import {
  SESSION_COOKIE,
  SESSION_MAX_AGE,
  clearAttempts,
  clearRecoveryCode,
  createSession,
  createUser,
  destroySessionsForUser,
  findUserByEmail,
  isValidEmail,
  issueRecoveryCode,
  normalizeEmail,
  passwordProblem,
  publicUser,
  recordFailedAttempt,
  setPassword,
  tooManyAttempts,
  userForToken,
  verifyPassword,
  verifyRecoveryCode,
  destroySession,
} from './accounts.js';
import { looksLikeRecoveryCode } from '../src/lib/recoveryCode.js';
import { clearCookie, isSecureRequest, parseCookies, readJsonBody, send, setCookie } from './http.js';

export function sessionToken(req) {
  // Optional chaining because this is now called from the knowledge route, which
  // is mounted as bare middleware and handed whatever the caller has — including,
  // in tests, a request object with no headers at all. "No cookie" is the right
  // answer to that, not a crash.
  return parseCookies(req.headers?.cookie)[SESSION_COOKIE] ?? null;
}

export function currentUser(req) {
  return userForToken(sessionToken(req));
}


async function startSession(req, res, user) {
  const session = await createSession(user.id);
  setCookie(res, SESSION_COOKIE, session.token, {
    maxAge: SESSION_MAX_AGE,
    secure: isSecureRequest(req),
  });
  return session;
}

export async function handleRegister(req, res) {
  const body = await readJsonBody(req);
  const email = normalizeEmail(body.email);

  if (!isValidEmail(email)) return send(res, 400, { error: 'Enter a valid email address.' });
  const problem = passwordProblem(body.password);
  if (problem) return send(res, 400, { error: problem });
  if (await findUserByEmail(email)) {
    // Deliberately explicit. Hiding whether an account exists protects privacy on
    // a service where membership is sensitive; here it would just leave people
    // stuck on a sign-up form that refuses them for no stated reason.
    return send(res, 409, { error: 'An account already exists for that email. Sign in instead.' });
  }

  const user = await createUser({ email, name: body.name, password: body.password });
  // Issued at sign-up rather than on demand: the moment someone needs a recovery
  // code is the moment they can no longer ask for one.
  const recoveryCode = await issueRecoveryCode(user.id);
  await startSession(req, res, user);
  return send(res, 201, { user: publicUser(await findUserByEmail(email)), recoveryCode });
}

export async function handleLogin(req, res) {
  const body = await readJsonBody(req);
  const email = normalizeEmail(body.email);

  if (tooManyAttempts(email)) {
    return send(res, 429, { error: 'Too many attempts. Wait a few minutes and try again.' });
  }

  const user = await findUserByEmail(email);
  // One message for both "no such account" and "wrong password", so the endpoint
  // can't be used to enumerate who has an account.
  const failed = { error: 'That email and password don’t match an account.' };

  if (!user) {
    recordFailedAttempt(email);
    return send(res, 401, failed);
  }
  if (!verifyPassword(body.password, { hash: user.passwordHash, salt: user.passwordSalt })) {
    recordFailedAttempt(email);
    return send(res, 401, failed);
  }

  clearAttempts(email);
  await startSession(req, res, user);
  return send(res, 200, { user: publicUser(user) });
}

export async function handleLogout(req, res) {
  await destroySession(sessionToken(req));
  clearCookie(res, SESSION_COOKIE, { secure: isSecureRequest(req) });
  return send(res, 200, {});
}

export async function handleMe(req, res) {
  return send(res, 200, { user: publicUser(await currentUser(req)) });
}

// --- getting back in without me ---------------------------------------------
//
// There is no email out of this app, so there is no reset link. The recovery code
// issued at sign-up is the substitute: something the account holder keeps, that
// the server can check, and that nobody has to be asked for.

export async function handleResetPassword(req, res) {
  const body = await readJsonBody(req);
  const email = normalizeEmail(body.email);
  const throttleKey = `reset:${email}`;

  if (tooManyAttempts(throttleKey)) {
    return send(res, 429, { error: 'Too many attempts. Wait a few minutes and try again.' });
  }

  // Checked before anything else so the answer to a mistyped code is about the
  // code, not about the account. Still counted: otherwise the shape check is a
  // free filter for someone working through guesses.
  if (!looksLikeRecoveryCode(body.code)) {
    recordFailedAttempt(throttleKey);
    return send(res, 400, {
      error: 'That does not look like a recovery code. It is 20 characters in four groups.',
    });
  }

  const problem = passwordProblem(body.password);
  if (problem) return send(res, 400, { error: problem });

  const user = await findUserByEmail(email);
  // Same answer for "no such account" and "wrong code", so this endpoint cannot be
  // used to find out who has an account here.
  if (!user || !verifyRecoveryCode(user, body.code)) {
    recordFailedAttempt(throttleKey);
    return send(res, 401, { error: 'That email and recovery code don’t match an account.' });
  }

  clearAttempts(throttleKey);
  await setPassword(user.id, body.password);
  await clearRecoveryCode(user.id);
  // Whoever knew the old password loses their sessions with it — that is the point
  // of a reset. This runs before the new session is created, so it survives.
  await destroySessionsForUser(user.id);
  // A spent code is no code at all, and someone who just proved they own the
  // account should not leave the flow with no way back in.
  const recoveryCode = await issueRecoveryCode(user.id);
  await startSession(req, res, user);
  return send(res, 200, { user: publicUser(await findUserByEmail(email)), recoveryCode });
}

export async function handleChangePassword(req, res, user) {
  const body = await readJsonBody(req);
  const throttleKey = `password:${user.email}`;

  if (tooManyAttempts(throttleKey)) {
    return send(res, 429, { error: 'Too many attempts. Wait a few minutes and try again.' });
  }
  if (!verifyPassword(body.currentPassword, { hash: user.passwordHash, salt: user.passwordSalt })) {
    // Throttled even though the caller is signed in: a borrowed laptop should not
    // be an unlimited oracle for the password itself.
    recordFailedAttempt(throttleKey);
    return send(res, 401, { error: 'That is not your current password.' });
  }

  const problem = passwordProblem(body.newPassword);
  if (problem) return send(res, 400, { error: problem });

  clearAttempts(throttleKey);
  await setPassword(user.id, body.newPassword);
  // Every other session goes; this one stays, because signing someone out of the
  // page they are using to change their password is a bug, not security.
  await destroySessionsForUser(user.id, { except: sessionToken(req) });
  return send(res, 200, { user: publicUser(await findUserByEmail(user.email)) });
}

// Re-issuing needs the password even though the caller is already signed in: a
// session is temporary and revocable, and a recovery code is neither.
export async function handleNewRecoveryCode(req, res, user) {
  const body = await readJsonBody(req);
  const throttleKey = `password:${user.email}`;

  if (tooManyAttempts(throttleKey)) {
    return send(res, 429, { error: 'Too many attempts. Wait a few minutes and try again.' });
  }
  if (!verifyPassword(body.password, { hash: user.passwordHash, salt: user.passwordSalt })) {
    recordFailedAttempt(throttleKey);
    return send(res, 401, { error: 'That is not your password.' });
  }

  clearAttempts(throttleKey);
  const recoveryCode = await issueRecoveryCode(user.id);
  return send(res, 200, { recoveryCode });
}
