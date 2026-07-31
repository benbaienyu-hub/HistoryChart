# Lacuna

A knowledge canvas. Search a topic to drop a block on an infinite canvas, write
notes on it, branch into sub-topics, connect blocks with labelled relationships —
then let the AI fill the gaps, correct what you got wrong, and quiz you on the
rest.

A *lacuna* is a gap — specifically a missing passage in a manuscript. Finding the
ones in your own notes is the point of the app.

> Renamed from **HistoryChart**, which promised both less (it was never
> history-only) and more (it is a canvas, not a chart). Storage keys moved from
> the `historychart:` prefix to `lacuna:`; `src/lib/migrate.js` moves existing
> data across on first load, so an upgrade keeps your canvases.

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
  three-level graph for one topic. Clicking it asks how deep you want to go:

  | | Written for | Branches | Sub-topics each | Blocks | Requests |
  | --- | --- | --- | --- | --- | --- |
  | **Simple** | a newcomer | ≤ 3 | ≤ 2 | ≤ 10 | ≤ 4 |
  | **Concise** | a serious reader | ≤ 3 | ≤ 3 | ≤ 13 | ≤ 4 |
  | **Detailed** | a serious reader | ≤ 5 | ≤ 3 | ≤ 21 | ≤ 6 |
  | **Advanced** | someone with background | ≤ 6 | ≤ 4 | ≤ 31 | ≤ 7 |

  Two things vary independently — **how it's written** and **how much there is**.
  That's what Concise is for: the same substance as Detailed, in a small graph.

  **The counts are ceilings, not quotas.** Not every subject has six worthwhile
  branches, and padding one out to hit a number produces filler blocks that make
  the canvas worse. The model is told the cap *and* told not to reach for it, so
  a thin topic gives a small graph even on Advanced. The whole graph is a single
  undo step, so ⌘Z removes all of it.

  **Every block arrives with something in it, including the third level.** That
  costs no extra requests: each response returns its sub-topics as a label *plus*
  a one-line description, so a branch's children are built from the branch's own
  reply. It's why Detailed needs 6 requests for 21 blocks rather than 21.

  A side effect worth knowing: since study mode draws on any block with notes, a
  generated graph is immediately a deck of however many blocks it produced.

  Each request carries the subject it sits under, not just its own label. A
  branch called "Geography" in an Ethiopia graph would otherwise come back as a
  definition of the word *geography* — the label alone is ambiguous, and the
  model has no way to know better. The root subject travels with the request and
  governs the sub-topic details too.
- Pressing **Enter** instead adds a single **empty** block and nothing else — no
  model call at all. That is deliberate: the block is a blank page for your own
  account of the topic. Writing it yourself is the part that makes the app worth
  using.
- **Fill my knowledge** is the other half. It reads what you actually wrote,
  flags factual errors, fills notes you left blank, and adds the sub-topics you
  missed. So the order is: type a topic, write what you know, then ask what you
  got wrong and left out.

Without a key, "Make a graph" is disabled (hover it for why), the toolbar
button reads "(no key)", and Fill inserts placeholder text. Enter is unaffected,
since it never calls out.

## Reading and writing a block

Each block carries an **expand** button in its top-right corner, which opens it
at about half the screen: a large title field, the metadata, and a full-height
notes area. It edits the same fields through the same handlers as the block
itself — there is no separate draft, so what you type is already saved and
already undoable — and it renders outside the canvas viewport, so the zoom level
doesn't scale it.

On the block itself, notes longer than the box scroll with a trackpad or wheel
while the pointer is over them, and the box can be dragged taller by its
bottom-right corner. React Flow claims wheel events to zoom the canvas, so the
notes field opts out with its `nowheel` class — otherwise two-finger scrolling
over long notes zoomed the graph and the scrollbar was the only way to read past
the fourth line.

### How the key is kept safe

The key is read **only** by `server/knowledgeRoutes.js`, which runs server-side.
It is deliberately named `OPENAI_API_KEY` without Vite's `VITE_` prefix, so Vite
will not inline it into the browser bundle. **Never rename it to
`VITE_OPENAI_API_KEY`** — that ships your key to every visitor. `.env` is
gitignored.

Note that a real environment variable takes precedence over `.env`; if
`OPENAI_API_KEY` is already exported in your shell, that value wins.

### Running without a key, on purpose

```bash
npm run demo          # or: OPENAI_MOCK=1 npm run dev
```

Offline mode: every AI feature answers with deterministic sample content and
nothing is sent to OpenAI. Useful when building the UI, and for demoing on a
laptop with no network and no bill. Every summary it writes is prefixed
`[offline sample]`, so it can't be mistaken for real output, and the dev server
says so once at startup.

### Using a different provider (or none)

OpenAI credit is prepaid and runs out. The route talks to whatever
OpenAI-compatible endpoint you point it at, so you have options:

```bash
# In .env — a provider with a free tier
OPENAI_BASE_URL=https://api.groq.com/openai/v1
OPENAI_API_KEY=gsk_your_key
OPENAI_MODEL=llama-3.3-70b-versatile

# …or a model running on your own machine, with no key and no account
OPENAI_BASE_URL=http://localhost:11434/v1
OPENAI_API_KEY=ollama
OPENAI_MODEL=llama3.1:8b
```

**`OPENAI_MODEL` is required once `OPENAI_BASE_URL` is set.** A model name belongs
to its provider, so there is no sensible default — the app says so at startup and
refuses the request rather than falling back to `gpt-4o` and reporting that your
key can't reach it, which sounds like a credentials problem and isn't.

**Editing these three settings needs no restart.** Vite copies `.env` into the
environment once at startup, so the route reads the file directly as a fallback:
change `OPENAI_MODEL`, `OPENAI_BASE_URL` or `OPENAI_API_KEY` and the next request
uses the new value. A real environment variable still wins, which is Vite's
precedence.

`npm run check-key` follows the same setting, so it tests the provider the app
would actually call, lists the models that provider offers, and stops complaining
that a `gsk_…` key isn't shaped like an OpenAI one.

**Structured outputs are negotiated, not required.** Not every model supports
JSON-schema responses — Groq's `llama-3.3` answers such a request with *"This
model does not support response format `json_schema`"* — so rather than making you
hunt for a compatible model, the route steps down a ladder:

| | Guarantee |
| --- | --- |
| `json_schema` | the reply matches the schema |
| `json_object` | the reply is JSON, but not necessarily the right shape — validated here |
| no format | no guarantee; the JSON is extracted from the text, code fences and all |

It only steps down when the provider explicitly rejects the format, and it
remembers what worked per model — so the cost is one wasted request the first
time and nothing after. A refusal, a bad key or an unknown model is not a format
problem and surfaces immediately rather than triggering retries.

Verified against a local stub speaking the OpenAI wire format, including one that
refuses `json_schema` with Groq's exact error: the request goes to
`{OPENAI_BASE_URL}/chat/completions` with the key as a bearer token, carrying the
model, level and context, and the ladder steps down and succeeds. Not verified
against any particular third-party provider — my sandbox cannot reach them.

### When the key doesn't work

```bash
npm run check-key
```

This is the one command to run. It reads the same value the dev server would
use, points out the faults that make a key fail before spending a request
(the placeholder left in place, a line break in the middle, a curly quote from a
bad paste), then asks OpenAI directly whether it accepts the key and reports what
OpenAI said. It never prints the key — only its length and first and last few
characters.

The failure it exists for: **a shell variable silently overriding `.env`.** That
is Vite's precedence, not a bug, but it means you can edit `.env` all day and
change nothing. `check-key` tells you which source won.

A 401 in the app is not a config problem — it means OpenAI refused the key. It is
either revoked, from a deleted project, or the copy is damaged. Keys are shown
once at creation, so if you didn't save it you need a new one.

### Choosing a model

The route defaults to `gpt-4o`. If your key doesn't have access to it, the app
tells you so and you can set `OPENAI_MODEL` in `.env` to any model you do have —
it needs to support JSON-schema structured outputs. `npm run check-key` lists the
models your key can actually reach.

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

## The logo

The mark is `[- -]` — the editorial notation for an omission, which is how a
missing passage is marked in a manuscript. That is what a *lacuna* is, so the
mark says the name rather than decorating it.

It is one shape at every size, with no separate small variant. The constraint
that drove the drawing was the 16px favicon: at lighter weights the two round
stroke caps close the gap optically and the mark reads as a single dash, which
throws away the only idea it has. Hence a 3-unit stroke in a 32-unit box and a
gap wider than the stroke — `test/logo.test.js` asserts that ratio so a later
tidy-up can't quietly break it.

| File | Use |
| --- | --- |
| `public/favicon.svg` | tab icon — the mark reversed out of a blue tile, so it holds against light and dark browser chrome |
| `public/logo.svg` | the bare mark, blue, transparent behind it |
| `public/logo-lockup.svg` | mark + wordmark for light backgrounds |
| `public/logo-lockup-dark.svg` | the same for dark ones — the wordmark inverts, the blue doesn't need to |

All four are **generated**, not hand-edited: `src/lib/logoMark.js` holds the
geometry, `npm run logo` writes the files, and a test fails if what's committed
no longer matches. In the app the mark is `src/components/Logo.jsx`, drawn in
`currentColor` so it needs no light/dark variant at all.

One caveat on the lockups: the wordmark is live text in the app's font stack, not
outlined glyphs (there's no font tooling in this repo to outline with), so it
renders in whatever font the viewer has. Fine on the web; worth checking before
it goes into a printed deck.

## Studying

Any block with notes is a card, with the title as the prompt. Cards are graded
**per point, not word for word** — nobody recalls a paragraph of notes verbatim,
and being marked wrong for failing to is not a useful signal.

So notes are split into points. Lines and bullets are your own division of the
material and are taken exactly as written, including a deliberately short one
like `1889`. A paragraph is split by sentence instead, with abbreviations and
initials protected (`e.g. teff`, `W. E. B. Du Bois` stay whole) and fragments
under ~24 characters absorbed into the neighbour, so a stray `Decisive.` never
becomes a point on its own.

The card says how many points there are *before* you reveal — which turns
"reproduce the paragraph" into a target you can hit — then you tick the ones you
had (`1`–`9`, `A` for all, `→` to move on). A one-point card keeps the plain
Missed it / Got it pair, since a checklist of one is just friction.

The summary counts points rather than cards, and lists the specific points that
got away under each block, so it tells you what to reread instead of only which
card felt bad. "Retry the N with gaps" restricts the next round to those blocks.

**Generated notes are dot points for the same reason.** The model is asked for a
small number of complete, standalone claims — one per line — and told why: each
line becomes a card, so a padded line is a mark lost for failing to remember
nothing. Compliance isn't guaranteed (the plainer format tiers carry no schema at
all), so a prose reply is put through the same splitter the grader uses, which
also normalises whatever marker the model chose. One definition of "a point",
shared by the writer and the grader. Corrections stay prose — a correction is an
argument about your notes, not material to memorise.

## Working with a big canvas

Generated graphs get wide fast, so every block with children carries a chevron
on its bottom edge. Collapsing folds the whole subtree away and the chevron turns
into a badge showing how many blocks are hidden. Collapses nest (folding a parent
doesn't disturb a child's own state), survive a reload, and are a single undo
step. Study mode still draws on collapsed blocks — folding a branch is a viewing
choice, not a decision to stop learning it.

Reloading while on a canvas reopens that canvas. The pointer is validated on
read, so a canvas that was deleted or un-shared just drops you on the library
instead.

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
| `src/components/StudyMode.jsx` | Flashcards from your notes, graded per point |
| `src/components/Home.jsx` | Canvas library sidebar (Your canvases / Shared with me / Examples) |
| `src/lib/graph.js` | Pure tree helpers — descendants, collapse visibility |
| `src/lib/graphLevels.js` | The Simple / Detailed / Advanced depths and their sizing |
| `src/components/GraphLevelMenu.jsx` | The depth picker that drops out of "Make a graph" |
| `src/components/BlockDetail.jsx` | The half-screen expanded view of one block |
| `src/lib/layout.js` | Tidy-tree layout over the `parentId` forest |
| `src/lib/deck.js` | Flashcard selection, point splitting, and per-point grading |
| `src/lib/theme.js` | Light/dark theme store and `useTheme` hook |
| `src/lib/aiFill.js` | Client side of the AI calls (talks to `/api/knowledge`) |
| `server/knowledgeRoutes.js` | Server side — the only place the API key is read |
| `src/lib/canvasStore.js` | Canvas persistence (localStorage) |
| `src/lib/migrate.js` | One-time move of pre-rename storage keys |
| `src/lib/logoMark.js` | The logo's geometry — one source for the icon and the favicon |
| `src/components/Logo.jsx` | The mark as a React component, in `currentColor` |
| `scripts/check-key.mjs` | Diagnoses a rejected key against whichever provider is configured |
| `src/lib/templates.js` | Pre-built starter canvases |
| `test/` | Vitest suite over everything in `src/lib` and the API route |

The rule the `src/lib` split follows: anything with a decision in it lives in a
module with no React import, so it can be tested directly. Components are left
holding markup and state wiring.

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
npm test         # vitest, single run
npm run check-key   # diagnose an OPENAI_API_KEY that isn't working
npm run demo        # dev server in offline mode — no key, no network, no bill
npm run logo        # regenerate public/*.svg from the shared mark geometry
npm run test:watch
```

The tests never make a network call: the API-route tests blank `OPENAI_API_KEY`
first, so they exercise the validation and no-key paths rather than OpenAI.
