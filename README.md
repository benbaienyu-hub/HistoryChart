# HistoryChart

A knowledge canvas. Search a topic to drop a block on an infinite canvas, write
notes on it, branch into sub-topics, connect blocks with labelled relationships —
then let Claude fill the gaps, correct what you got wrong, and quiz you on the
rest.

## Running it

Requires **Node 20.19+ or 22.12+** (Vite 8's floor — older Node will fail to start).

```bash
npm install
npm run dev
```

Then open the URL it prints (usually http://localhost:5173).

The app works without any API key — you just get clearly-labelled placeholders
instead of real AI output.

## Turning on the AI features

```bash
cp .env.example .env
# paste your key into .env, then restart npm run dev
```

Get a key from the [Anthropic Console](https://console.anthropic.com/settings/keys).

With a key set:

- Creating a block fetches a short summary plus suggested sub-topics, so it
  arrives populated instead of blank.
- **Fill my knowledge** reviews each root topic's notes, flags factual errors,
  fills empty notes, and suggests sub-topics you're missing.

Without one, the toolbar button reads "(no key)" and both paths insert
placeholder text.

### How the key is kept safe

The key is read **only** by `server/knowledgeRoutes.js`, which runs server-side.
It is deliberately named `ANTHROPIC_API_KEY` without Vite's `VITE_` prefix, so
Vite will not inline it into the browser bundle. **Never rename it to
`VITE_ANTHROPIC_API_KEY`** — that ships your key to every visitor. `.env` is
gitignored.

Note that a real environment variable takes precedence over `.env`; if
`ANTHROPIC_API_KEY` is already exported in your shell, that value wins.

### Deploying

`npm run dev` serves `/api/knowledge` through a Vite dev-server plugin. That
plugin does **not** run in `vite build` / `vite preview`, so a production deploy
needs the handler mounted somewhere real. `handleKnowledgeRequest` is a plain
Node `(req, res)` handler with no framework dependency, so it drops into an
Express route or a serverless function:

```js
import { handleKnowledgeRequest } from './server/knowledgeRoutes.js'
app.post('/api/knowledge', handleKnowledgeRequest)
```

## Where things live

| Path | What it does |
| --- | --- |
| `src/components/Canvas.jsx` | The canvas: blocks, edges, undo/redo, AI calls |
| `src/components/KnowledgeBlock.jsx` | A single block — title, notes, date, category, flag |
| `src/components/StudyMode.jsx` | Flashcards generated from your notes |
| `src/components/Home.jsx` | Canvas library, example templates, sharing |
| `src/lib/aiFill.js` | Client side of the AI calls (talks to `/api/knowledge`) |
| `server/knowledgeRoutes.js` | Server side — the only place the API key is read |
| `src/lib/canvasStore.js` | Canvas persistence (localStorage) |
| `src/lib/templates.js` | Pre-built starter canvases |

## Known limitations

Auth and sharing are **local-only**. Sign-in is a profile picker with no
password and no server, and sharing grants access to another profile *in the
same browser* — no invite email is sent. Both need a real backend
(`src/lib/auth.js` and `src/lib/share.js` are the modules to replace); canvases
live in `localStorage`, so they don't sync across devices.

## Scripts

```bash
npm run dev      # dev server (serves the AI route too)
npm run build    # production build
npm run preview  # serve the build — no AI route, see Deploying
npm run lint     # oxlint
```
