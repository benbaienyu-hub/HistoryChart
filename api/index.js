// The whole API as one Vercel function.
//
// Vercel routes every /api/* request here (see vercel.json) and serves the built
// front end from dist/ as static files. One function rather than a file per route
// because the routing table already exists in server/api.js, and splitting it
// would mean two descriptions of the same thing — plus a separate cold start for
// each endpoint.
//
// The handler signature is Node's (req, res), which is what the rest of the server
// is written against, so nothing here is Vercel-specific except the export.

import { handleApiRequest } from '../server/api.js';
import { handleKnowledgeRequest, handleKnowledgeStatus } from '../server/knowledgeRoutes.js';

function fail(res, error) {
  console.error('[api]', error);
  if (res.headersSent) return res.end();
  res.statusCode = 500;
  res.setHeader('content-type', 'application/json');
  res.end(JSON.stringify({ error: 'Something went wrong on the server.' }));
}

export default async function handler(req, res) {
  try {
    // The knowledge routes own their own paths and are not in the table.
    const { pathname } = new URL(req.url, 'http://localhost');
    if (pathname === '/api/knowledge') return void (await handleKnowledgeRequest(req, res));
    if (pathname === '/api/knowledge-status') return void (await handleKnowledgeStatus(req, res));

    if (await handleApiRequest(req, res)) return;

    // handleApiRequest answers 404 for anything under /api it doesn't recognise, so
    // reaching here means the rewrite sent us a path that isn't an API path at all.
    res.statusCode = 404;
    res.setHeader('content-type', 'application/json');
    res.end(JSON.stringify({ error: `No API route for ${req.method} ${pathname}` }));
  } catch (error) {
    fail(res, error);
  }
}
