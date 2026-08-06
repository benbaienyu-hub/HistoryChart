#!/usr/bin/env node
// The production server: one Node process serving the built app and the API.
//
// `npm run dev` mounts the same routes inside Vite, which is convenient but only
// exists in development. This is what you actually deploy — no framework, no
// reverse proxy required, and the API and the app share an origin so the session
// cookie works without any CORS setup.
//
//   npm run build && npm start
//
// Put it behind HTTPS in production. The session cookie sets `Secure` as soon as
// the request arrives over https (directly or via x-forwarded-proto), so a plain
// http deployment would send session cookies in the clear.

import { createServer } from 'node:http';
import { createReadStream, existsSync, statSync } from 'node:fs';
import { extname, join, normalize } from 'node:path';
import { fileURLToPath } from 'node:url';
import { handleApiRequest } from './api.js';
import { handleKnowledgeRequest, handleKnowledgeStatus } from './knowledgeRoutes.js';
import { dataFilePath } from './store.js';

const ROOT = fileURLToPath(new URL('..', import.meta.url));
const DIST = join(ROOT, 'dist');
const PORT = Number(process.env.PORT ?? 5173);
const HOST = process.env.HOST ?? '0.0.0.0';

const TYPES = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.woff2': 'font/woff2',
  '.json': 'application/json; charset=utf-8',
  '.ico': 'image/x-icon',
};

function serveFile(res, path, { cache = false } = {}) {
  res.statusCode = 200;
  res.setHeader('content-type', TYPES[extname(path)] ?? 'application/octet-stream');
  // Vite fingerprints filenames under /assets, so those are safe to cache hard.
  // index.html must never be cached, or a deploy leaves people on the old bundle.
  res.setHeader('cache-control', cache ? 'public, max-age=31536000, immutable' : 'no-cache');
  createReadStream(path).pipe(res);
}

const server = createServer(async (req, res) => {
  const { pathname } = new URL(req.url, `http://${req.headers.host ?? 'localhost'}`);

  try {
    if (pathname === '/api/knowledge' && req.method === 'POST') {
      return void (await handleKnowledgeRequest(req, res));
    }
    if (pathname === '/api/knowledge-status') {
      return void (await handleKnowledgeStatus(req, res));
    }
    if (await handleApiRequest(req, res)) return;
  } catch (error) {
    console.error('[server]', error);
    res.statusCode = 500;
    res.setHeader('content-type', 'application/json');
    return void res.end(JSON.stringify({ error: 'Something went wrong on the server.' }));
  }

  if (req.method !== 'GET' && req.method !== 'HEAD') {
    res.statusCode = 405;
    return void res.end();
  }

  // `normalize` then a prefix check: without it, a request for
  // /../../etc/passwd would escape the dist directory.
  const candidate = join(DIST, normalize(pathname));
  if (candidate.startsWith(DIST) && existsSync(candidate) && statSync(candidate).isFile()) {
    return void serveFile(res, candidate, { cache: pathname.startsWith('/assets/') });
  }

  // Single-page app: any other path is a client route, so hand over index.html.
  const index = join(DIST, 'index.html');
  if (!existsSync(index)) {
    res.statusCode = 500;
    return void res.end('No build found. Run `npm run build` first.');
  }
  serveFile(res, index);
});

server.listen(PORT, HOST, () => {
  console.log(`[lacuna] serving on http://localhost:${PORT}`);
  console.log(`[lacuna] data file: ${dataFilePath()}`);
});
