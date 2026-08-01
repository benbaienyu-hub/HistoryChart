// Registration, sign-in, sign-out, and "who am I".
//
// The session lives in an httpOnly cookie rather than a token in localStorage:
// the browser attaches it automatically, and no script on the page — including
// injected script — can read it.

import {
  SESSION_COOKIE,
  SESSION_MAX_AGE,
  clearAttempts,
  createSession,
  createUser,
  findUserByEmail,
  isValidEmail,
  normalizeEmail,
  passwordProblem,
  publicUser,
  recordFailedAttempt,
  tooManyAttempts,
  userForToken,
  verifyPassword,
  destroySession,
} from './accounts.js';
import { clearCookie, isSecureRequest, parseCookies, readJsonBody, send, setCookie } from './http.js';

export function sessionToken(req) {
  return parseCookies(req.headers.cookie)[SESSION_COOKIE] ?? null;
}

export function currentUser(req) {
  return userForToken(sessionToken(req));
}

function startSession(req, res, user) {
  const session = createSession(user.id);
  setCookie(res, SESSION_COOKIE, session.token, {
    maxAge: SESSION_MAX_AGE,
    secure: isSecureRequest(req),
  });
}

export async function handleRegister(req, res) {
  const body = await readJsonBody(req);
  const email = normalizeEmail(body.email);

  if (!isValidEmail(email)) return send(res, 400, { error: 'Enter a valid email address.' });
  const problem = passwordProblem(body.password);
  if (problem) return send(res, 400, { error: problem });
  if (findUserByEmail(email)) {
    // Deliberately explicit. Hiding whether an account exists protects privacy on
    // a service where membership is sensitive; here it would just leave people
    // stuck on a sign-up form that refuses them for no stated reason.
    return send(res, 409, { error: 'An account already exists for that email. Sign in instead.' });
  }

  const user = createUser({ email, name: body.name, password: body.password });
  startSession(req, res, user);
  return send(res, 201, { user: publicUser(user) });
}

export async function handleLogin(req, res) {
  const body = await readJsonBody(req);
  const email = normalizeEmail(body.email);

  if (tooManyAttempts(email)) {
    return send(res, 429, { error: 'Too many attempts. Wait a few minutes and try again.' });
  }

  const user = findUserByEmail(email);
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
  startSession(req, res, user);
  return send(res, 200, { user: publicUser(user) });
}

export function handleLogout(req, res) {
  destroySession(sessionToken(req));
  clearCookie(res, SESSION_COOKIE, { secure: isSecureRequest(req) });
  return send(res, 200, {});
}

export function handleMe(req, res) {
  return send(res, 200, { user: publicUser(currentUser(req)) });
}
