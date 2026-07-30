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

Get a key from the [OpenAI dashboard](https://platform.openai.com/api-keys).

With a key set:

- **Make a graph** (the button inside the search bar) generates a whole
  multi-level graph for one topic in a single click: the root with a summary,
  up to 5 branches each with their own summary, and up to 3 sub-topics under
  each branch. It's one undo step, so ⌘Z removes the whole thing.
- Pressing **Enter** instead adds just one block, which still fetches its own
  summary and suggested sub-topics.
- **Fill my knowledge** reviews each root topic's notes, flags factual errors,
  fills empty notes, and suggests sub-topics you're missing.

Without a key, "Make a graph" is disabled (hover it for why), the toolbar
button reads "(no key)", and Fill inserts placeholder text. Enter still works —
it just adds an empty block.

### How the key is kept safe

The key is read **only** by `server/knowledgeRoutes.js`, which runs server-side.
It is deliberately named `OPENAI_API_KEY` without Vite's `VITE_` prefix, so Vite
will not inline it into the browser bundle. **Never rename it to
`VITE_OPENAI_API_KEY`** — that ships your key to every visitor. `.env` is
gitignored.

Note that a real environment variable takes precedence over `.env`; if
`OPENAI_API_KEY` is already exported in your shell, that value wins.

### Choosing a model

The route defaults to `gpt-4o`. If your key doesn't have access to it, the app
tells you so and you can set `OPENAI_MODEL` in `.env` to any model you do have —
it needs to support JSON-schema structured outputs.

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

## Dark mode

Follows your OS by default. The sun/moon button in the header (and the canvas
toolbar) overrides it, and the choice is remembered. A small inline script in
`index.html` applies the stored theme before first paint so dark-mode users
don't get a white flash.

Colours are semantic CSS variables defined once in `src/index.css`
(`--color-surface`, `--color-ink`, `--color-line`, …), so components never
hardcode white or black and both themes stay in sync.

## Where things live

| Path | What it does |
| --- | --- |
| `src/components/Canvas.jsx` | The canvas: blocks, edges, undo/redo, AI calls |
| `src/components/KnowledgeBlock.jsx` | A single block — title, notes, date, category, flag |
| `src/components/StudyMode.jsx` | Flashcards generated from your notes |
| `src/components/Home.jsx` | Canvas library sidebar (Your canvases / Shared with me / Examples) |
| `src/lib/theme.js` | Light/dark theme store and `useTheme` hook |
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
