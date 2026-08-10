// Account settings: the AI credential an account uses for itself.
//
// Password and recovery-code routes live in authRoutes.js next to the rest of the
// session handling; this module is only about the key, because that is where the
// "is it safe to send this back to the browser" question lives.

import {
  baseUrlProblem,
  clearUserAiKey,
  describeUserAiKey,
  keyProblem,
  setUserAiKey,
  updateUserAiSettings,
} from './aiKeys.js';
import { requireOwnKey, hasApiKey, mockEnabled } from './knowledgeRoutes.js';
import { readJsonBody, send } from './http.js';

// The client needs to know three things: what this account has saved, whether the
// server would cover it otherwise, and whether it has to bring its own.
async function settingsPayload(user) {
  return {
    own: await describeUserAiKey(user.id),
    serverKeyAvailable: hasApiKey() || mockEnabled(),
    requiresOwnKey: requireOwnKey(),
  };
}

export async function handleGetAiSettings(req, res, user) {
  return send(res, 200, await settingsPayload(user));
}

export async function handleSaveAiSettings(req, res, user) {
  const body = await readJsonBody(req);

  const urlProblem = baseUrlProblem(body.baseUrl);
  if (urlProblem) return send(res, 400, { error: urlProblem });

  // An empty key with a key already saved means "keep the key, change the rest" —
  // the browser was never given the key, so it cannot send it back.
  const wantsKeyChange = String(body.apiKey ?? '').trim().length > 0;
  if (!wantsKeyChange) {
    const updated = await updateUserAiSettings(user.id, {
      baseUrl: body.baseUrl,
      model: body.model,
    });
    if (!updated) return send(res, 400, { error: 'Paste an API key.' });
    return send(res, 200, await settingsPayload(user));
  }

  const problem = keyProblem(body.apiKey);
  if (problem) return send(res, 400, { error: problem });

  await setUserAiKey(user.id, {
    apiKey: body.apiKey,
    baseUrl: body.baseUrl,
    model: body.model,
  });
  return send(res, 200, await settingsPayload(user));
}

export async function handleDeleteAiSettings(req, res, user) {
  await clearUserAiKey(user.id);
  return send(res, 200, await settingsPayload(user));
}
