// One request handler for the whole API, so the same routes serve the Vite dev
// server and the standalone production server (server/index.mjs) without a second
// wiring path that could drift.

import { currentUser, handleLogin, handleLogout, handleMe, handleRegister } from './authRoutes.js';
import {
  handleCreate,
  handleDelete,
  handleGet,
  handleList,
  handleShare,
  handleUnshare,
  handleUpdate,
} from './canvasRoutes.js';
import { matchPath, send } from './http.js';

// `auth: true` means the route needs a signed-in user, and gets it as the third
// argument. Everything about a canvas requires one — there are no public canvases.
const ROUTES = [
  { method: 'POST', path: '/api/auth/register', handler: handleRegister },
  { method: 'POST', path: '/api/auth/login', handler: handleLogin },
  { method: 'POST', path: '/api/auth/logout', handler: handleLogout },
  { method: 'GET', path: '/api/auth/me', handler: handleMe },

  { method: 'GET', path: '/api/canvases', handler: handleList, auth: true },
  { method: 'POST', path: '/api/canvases', handler: handleCreate, auth: true },
  { method: 'GET', path: '/api/canvases/:id', handler: handleGet, auth: true },
  { method: 'PUT', path: '/api/canvases/:id', handler: handleUpdate, auth: true },
  { method: 'DELETE', path: '/api/canvases/:id', handler: handleDelete, auth: true },
  { method: 'POST', path: '/api/canvases/:id/share', handler: handleShare, auth: true },
  { method: 'POST', path: '/api/canvases/:id/unshare', handler: handleUnshare, auth: true },
];

export function isApiPath(pathname) {
  return pathname === '/api' || pathname.startsWith('/api/');
}

// Returns true when the request was handled, so callers can fall through to
// whatever serves the app itself.
export async function handleApiRequest(req, res) {
  const pathname = new URL(req.url, 'http://localhost').pathname;
  if (!isApiPath(pathname)) return false;

  // The knowledge routes are mounted separately and own their own paths.
  if (pathname.startsWith('/api/knowledge')) return false;

  for (const route of ROUTES) {
    const params = matchPath(route.path, pathname);
    if (!params) continue;
    if (route.method !== req.method) continue;

    try {
      if (route.auth) {
        const user = currentUser(req);
        if (!user) {
          send(res, 401, { error: 'Sign in to continue.' });
          return true;
        }
        await route.handler(req, res, user, params);
      } else {
        await route.handler(req, res, params);
      }
    } catch (error) {
      // A thrown status is a client error the handler chose to report; anything
      // else is ours, and the message stays server-side.
      if (error?.status) send(res, error.status, { error: error.message });
      else {
        console.error('[api]', error);
        send(res, 500, { error: 'Something went wrong on the server.' });
      }
    }
    return true;
  }

  // A path under /api that matches nothing must not fall through to the SPA, or
  // the client would try to parse index.html as JSON.
  send(res, 404, { error: `No API route for ${req.method} ${pathname}` });
  return true;
}

// Vite plugin form, matching how the knowledge route is mounted.
export function accountApiPlugin() {
  return {
    name: 'lacuna-account-api',
    configureServer(server) {
      server.middlewares.use((req, res, next) => {
        handleApiRequest(req, res).then((handled) => {
          if (!handled) next();
        }, next);
      });
    },
  };
}
