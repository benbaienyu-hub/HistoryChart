// Small helpers shared by the API routes. Not a framework — the surface is a
// dozen endpoints, and Express would be a dependency to save thirty lines.

const MAX_BODY = 4 * 1024 * 1024; // canvases carry notes, but not megabytes of them

export function send(res, status, body) {
  const payload = JSON.stringify(body ?? {});
  res.statusCode = status;
  res.setHeader('content-type', 'application/json');
  res.end(payload);
}

export async function readJsonBody(req) {
  const chunks = [];
  let size = 0;
  for await (const chunk of req) {
    size += chunk.length;
    if (size > MAX_BODY) {
      const error = new Error('Request body too large.');
      error.status = 413;
      throw error;
    }
    chunks.push(chunk);
  }
  const raw = Buffer.concat(chunks).toString('utf8');
  if (!raw.trim()) return {};
  try {
    return JSON.parse(raw);
  } catch {
    const error = new Error('Body was not valid JSON.');
    error.status = 400;
    throw error;
  }
}

export function parseCookies(header) {
  const out = {};
  for (const part of String(header ?? '').split(';')) {
    const at = part.indexOf('=');
    if (at === -1) continue;
    const name = part.slice(0, at).trim();
    if (name) out[name] = decodeURIComponent(part.slice(at + 1).trim());
  }
  return out;
}

// Behind a proxy the connection to Node is plain http even when the browser used
// https, so the forwarded header is the only honest signal. Getting this wrong
// either drops the cookie in production or breaks sign-in on localhost.
export function isSecureRequest(req) {
  const forwarded = String(req.headers['x-forwarded-proto'] ?? '').split(',')[0].trim();
  if (forwarded) return forwarded === 'https';
  return Boolean(req.socket?.encrypted);
}

export function setCookie(res, name, value, { maxAge, secure }) {
  const parts = [
    `${name}=${encodeURIComponent(value)}`,
    'Path=/',
    // HttpOnly is the whole point: script on the page cannot read the session,
    // so an XSS bug cannot walk off with it the way a localStorage token would.
    'HttpOnly',
    // Lax rather than Strict: Strict drops the cookie when arriving from an
    // external link, which would silently sign people out of a shared canvas.
    'SameSite=Lax',
    `Max-Age=${maxAge}`,
  ];
  if (secure) parts.push('Secure');
  appendHeader(res, 'set-cookie', parts.join('; '));
}

export function clearCookie(res, name, { secure }) {
  const parts = [`${name}=`, 'Path=/', 'HttpOnly', 'SameSite=Lax', 'Max-Age=0'];
  if (secure) parts.push('Secure');
  appendHeader(res, 'set-cookie', parts.join('; '));
}

function appendHeader(res, name, value) {
  const existing = res.getHeader(name);
  if (!existing) res.setHeader(name, value);
  else res.setHeader(name, [...(Array.isArray(existing) ? existing : [existing]), value]);
}

// Matches "/api/canvases/:id/share" against a request path, returning the
// captured values or null. Keeps the route table declarative.
export function matchPath(pattern, path) {
  const patternParts = pattern.split('/').filter(Boolean);
  const pathParts = path.split('/').filter(Boolean);
  if (patternParts.length !== pathParts.length) return null;

  const params = {};
  for (const [i, part] of patternParts.entries()) {
    if (part.startsWith(':')) {
      params[part.slice(1)] = decodeURIComponent(pathParts[i]);
    } else if (part !== pathParts[i]) {
      return null;
    }
  }
  return params;
}
