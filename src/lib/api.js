// Client side of the account API. Every call is a fetch to our own origin with
// `credentials: 'same-origin'`, so the session cookie rides along and the client
// never holds a token it could leak.

const JSON_HEADERS = { 'content-type': 'application/json' };

export class ApiError extends Error {
  constructor(message, status, options) {
    super(message, options);
    this.name = 'ApiError';
    // 0 means the request never reached the server, which is a different problem
    // from anything the server itself would answer.
    this.status = status;
  }
}

async function request(method, path, body, options = {}) {
  let response;
  try {
    response = await fetch(path, {
      method,
      credentials: 'same-origin',
      headers: body === undefined ? undefined : JSON_HEADERS,
      body: body === undefined ? undefined : JSON.stringify(body),
      // Set when a save has to survive the page going away — see the flush on
      // pagehide in Canvas.
      keepalive: options.keepalive ?? false,
    });
  } catch (cause) {
    // fetch only rejects when nothing answered, and the browser's wording for
    // that ("Failed to fetch") reads like a login problem. Name the real cause.
    throw new ApiError(
      'Could not reach the server. Is `npm run dev` still running in your terminal?',
      0,
      { cause }
    );
  }

  if (response.status === 204) return {};

  const payload = await response.json().catch(() => ({}));
  if (!response.ok) {
    throw new ApiError(payload.error ?? `Request failed (${response.status})`, response.status);
  }
  return payload;
}

// --- session ---------------------------------------------------------------

export function register({ email, name, password }) {
  return request('POST', '/api/auth/register', { email, name, password }).then((r) => r.user);
}

export function logIn({ email, password }) {
  return request('POST', '/api/auth/login', { email, password }).then((r) => r.user);
}

export function logOut() {
  return request('POST', '/api/auth/logout');
}

// Resolves to null when nobody is signed in — an unauthenticated visitor is a
// normal state, not an error, so this never throws for that.
export function fetchCurrentUser() {
  return request('GET', '/api/auth/me').then((r) => r.user ?? null);
}

// --- canvases --------------------------------------------------------------

export function fetchCanvases() {
  return request('GET', '/api/canvases');
}

export function fetchCanvas(id) {
  return request('GET', `/api/canvases/${encodeURIComponent(id)}`).then((r) => r.canvas);
}

export function createCanvas({ title, nodes = [], edges = [] } = {}) {
  return request('POST', '/api/canvases', { title, nodes, edges }).then((r) => r.canvas);
}

export function saveCanvas(id, patch, options) {
  return request('PUT', `/api/canvases/${encodeURIComponent(id)}`, patch, options).then(
    (r) => r.canvas
  );
}

export function deleteCanvas(id) {
  return request('DELETE', `/api/canvases/${encodeURIComponent(id)}`);
}

export function shareCanvas(id, { email, role = 'edit' }) {
  return request('POST', `/api/canvases/${encodeURIComponent(id)}/share`, { email, role });
}

export function unshareCanvas(id, email) {
  return request('POST', `/api/canvases/${encodeURIComponent(id)}/unshare`, { email }).then(
    (r) => r.canvas
  );
}

// --- images ----------------------------------------------------------------

// Sent as a raw body with the file's own content-type. The server stores the
// bytes and returns a URL; the canvas keeps only that URL, so a picture is never
// re-uploaded on every save the way an inlined data URL would be.
export async function uploadImage(canvasId, file) {
  let response;
  try {
    response = await fetch(`/api/canvases/${encodeURIComponent(canvasId)}/images`, {
      method: 'POST',
      credentials: 'same-origin',
      headers: {
        'content-type': file.type || 'application/octet-stream',
        // Header rather than the body, and ASCII-only: a filename with an emoji
        // in it would otherwise make the header invalid and fail the upload.
        'x-image-name': encodeURIComponent(file.name ?? 'image'),
      },
      body: file,
    });
  } catch (cause) {
    throw new ApiError('Could not reach the server to upload that image.', 0, { cause });
  }

  const payload = await response.json().catch(() => ({}));
  if (!response.ok) {
    throw new ApiError(payload.error ?? `Upload failed (${response.status})`, response.status);
  }
  return payload.image;
}

export function deleteImage(id) {
  return request('DELETE', `/api/images/${encodeURIComponent(id)}`);
}
