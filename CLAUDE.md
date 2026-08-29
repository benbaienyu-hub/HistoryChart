# CLAUDE.md — working on Lacuna

Instructions for any Claude session working in this repository. Everything below
was read out of the repo, not assumed.

## Who you are talking to

**The owner of this project has very little programming knowledge.** That shapes
how you work here more than anything else in this file:

- Explain technical decisions in plain English whenever they matter. No jargon
  without a short translation. "A migration" means nothing; "a one-off script
  that changes the shape of already-saved data" does.
- When there are several reasonable approaches, **pick the simplest one** and say
  in one sentence why. Do not present a menu of options unless the choice really
  is theirs to make (a product decision, not a technical one).
- After any substantial change, **summarise what changed in plain English** and
  **say what they should manually click through to check it**. They cannot read
  the diff to find out.
- Never assume they will spot a problem you noticed. Say it.

## What Lacuna is

A knowledge canvas for studying. A *lacuna* is a gap — specifically a missing
passage in a manuscript — and the app is named after the thing it looks for.

The loop it is built around, in order:

1. **Map.** Search a topic to drop a block on an infinite canvas, write your own
   notes on it, branch into sub-topics, connect blocks with labelled
   relationships. Pressing Enter adds an *empty* block on purpose — writing it
   yourself is the part that teaches you something.
2. **Find the gaps.** "Find my gaps" reads what you actually wrote and reports
   three kinds of hole — **incorrect** (a claim that looks factually wrong),
   **missing** (a concept absent entirely), **incomplete** (mentioned but not
   explained). For each one you choose *Test me*, *Hint*, or *Fill gap*. Missing
   ones are drawn on the canvas as dashed "suggested" blocks between the two
   blocks they belong between.
3. **Study.** Every block with notes is a flashcard. Grading is per point, not
   pass/fail. Results come back onto the canvas as a mastery status on each
   block — **Untested / Weak / Learning / Mastered** — so the map and the deck
   are the same object rather than two features that share data.

The product argument running through all of it: **the AI's job is to find what
is missing from your writing, not to write it for you.** Be very careful about
changes that erode that. A feature that hands over finished notes is the thing
this app deliberately replaced.

## Technologies actually in use

From `package.json`:

- **React 19** + **Vite 8**, plain JavaScript with JSX. No TypeScript.
- **React Flow 11** (`reactflow`) for the canvas.
- **Framer Motion 12** for animation.
- **Tailwind CSS v4** via `@tailwindcss/postcss`, configured in `src/index.css`
  with an `@theme` block — there is no `tailwind.config.js`.
- **Vitest 4** with **jsdom** for tests, configured inside `vite.config.js`.
- **oxlint** for linting, configured in `.oxlintrc.json`.
- **openai** SDK for model calls, **pg** for Postgres, **@vercel/blob** for
  hosted image storage.
- The server is otherwise **Node built-ins only** — `node:http`, `node:crypto`,
  `node:fs`. There is no Express, no ORM, no auth library. Keep it that way.

## How the repository is laid out

```
src/
  App.jsx                 sign-in → home → canvas shell; holds the current user
  main.jsx                React entry
  index.css               Tailwind import + the @theme colour tokens
  components/             all the UI
  lib/                    all the logic, with no React import

server/
  api.js                  the ROUTES table — one handler for the whole API
  http.js                 tiny request/response helpers (send, readJsonBody, matchPath)
  index.mjs               standalone Node server (npm start)
  store.js                picks a backend, exposes readDb() / mutate()
  stores/document.js      the shape of the stored document
  stores/fileStore.js     JSON file backend (the default)
  stores/pgStore.js       Postgres backend (one jsonb document, one version column)
  accounts.js             password hashing, sessions, recovery codes, throttling
  authRoutes.js           register / login / logout / me / reset
  accountRoutes.js        password, recovery code, this account's AI key
  canvasRoutes.js         canvas CRUD, share grants, permission checks
  reviewRoutes.js         per-user spaced-repetition state
  knowledgeRoutes.js      "Make a graph" — topic expansion
  gapRoutes.js            "Find my gaps" — the prompt and JSON schema
  modelCall.js            the single place a model is actually called
  aiConfig.js             which key pays for a request — the account's or the server's
  aiKeys.js               per-account AI credentials, encrypted at rest
  secretBox.js            AES-256-GCM for the few stored values that are secrets
  fileStorage.js          image bytes: local disk, or Vercel Blob
  images.js               upload rules and cleanup
  healthRoutes.js         GET /api/health — deliberately unauthenticated

api/index.js              the whole API as one Vercel serverless function
scripts/                  CLI tools (accounts, check-key, build-logo)
test/                     Vitest suite
```

**The split that matters:** anything with a decision in it lives in `src/lib/`
in a module with **no React import**, so it can be unit-tested directly.
Components hold markup and state wiring. When you add logic, follow this — put
the rule in `src/lib/`, write a test for it, and let the component call it.

### The API

`server/api.js` holds a single `ROUTES` table used by **both** the Vite dev
server (via `accountApiPlugin()` in `vite.config.js`) and the production server
(`server/index.mjs`) and the Vercel function (`api/index.js`). One wiring path,
so the environments cannot drift.

A route with `auth: true` requires a signed-in user and receives it as its third
argument. Every canvas, review, account and AI route is authenticated. Only
`GET /api/health` is not, on purpose. **Add new routes to that table** rather
than special-casing them somewhere else.

### The data store

One document, whichever backend: a JSON file at `.data/lacuna.json` by default,
or a single `jsonb` row in Postgres when `POSTGRES_URL` (or `DATABASE_URL`, or
the `PG*` variables) is set. `readDb()` reads it; `mutate(fn)` applies a function
to it and persists. Both are async. Postgres uses a version column and
compare-and-swap, with an in-process write queue.

The collections are defined in `server/stores/document.js`: `users`, `sessions`,
`canvases`, `grants`, `images`, `reviews`, `aiKeys`.

## The major features, and how they fit together

- **Accounts and sharing.** Passwords hashed with scrypt, sessions in an httpOnly
  cookie, sign-in throttling. No email is ever sent: password recovery uses a
  one-time **recovery code** the account holder saves, and sharing works by
  granting an email address view or edit access. `npm run accounts` is the
  owner's backstop for someone who lost their code.
- **Canvas.** `src/components/Canvas.jsx` is the big one. Blocks are React Flow
  nodes whose `data.parentId` defines a tree; manual relation edges are
  annotations that play no part in the tree. Undo/redo, autosave (debounced),
  tidy-up layout, collapse/expand.
- **AI, two features.** *Make a graph* (`knowledgeRoutes.js`) generates a
  three-level map at one of four depths. *Find my gaps* (`gapRoutes.js`) reviews
  what you wrote. Both go through `modelCall.js`, which handles the JSON-format
  fallback for providers that do not support strict schemas. The key is read
  **only** on the server.
- **Suggestions on the canvas.** `src/lib/suggestions.js` decides where a missing
  gap gets drawn and what accepting it does to the graph;
  `SuggestedBlock.jsx` renders the dashed ghost. Ghosts never enter node state,
  so they cannot be saved, tidied, or undone.
- **Study mode.** `deck.js` builds the cards and grades per point, `recall.js`
  matches typed free recall, `review.js` is the scheduler, and `session.js` turns
  the stored gap questions into cards and re-asks a card you barely had, later in
  the same session. State is per user per
  block, stored server-side so a client cannot inflate its own intervals.
- **Mastery.** `src/lib/mastery.js` derives Untested / Weak / Learning / Mastered
  from the review rows and paints it back onto each block.
- **The home screen.** `src/lib/library.js` adds the canvases up: pooled coverage
  and mastery, a single recommended next action, the weakest blocks across every
  canvas, and `mergeForStudy` — which namespaces block ids so several canvases can
  be studied as one deck without StudyMode needing to know. All from data Home
  already loads; no extra requests.
- **Coverage and mastery.** `src/lib/progress.js` turns the same data into the two
  percentages the library leads with. They are deliberately separate numbers:
  coverage is how much is written down, mastery is how much of it comes back.
  Coverage counts the last scan's *missing* gaps in its denominator, which is why
  it is dimmed until a canvas has been scanned. The scan itself is stored on the
  canvas record (`gaps`, `gapsScannedAt`, `gapsSignature`) so the library does not
  need a model call per canvas.

## Commands

```bash
npm run dev        # dev server, including the API routes
npm run demo       # dev server in offline mode (OPENAI_MOCK=1) — no key, no bill
npm test           # vitest, single run — this is the one to run
npm run test:watch # vitest in watch mode
npm run lint       # oxlint
npm run build      # production build into dist/
npm run preview    # serve the build — no API routes, see the README
npm start          # serve the built app + API from one Node process
npm run test:pg    # store + HTTP suite against a real Postgres (needs TEST_POSTGRES_URL)
npm run check-key  # diagnose an OPENAI_API_KEY that is not working
npm run accounts   # list accounts, or issue someone a fresh recovery code
```

**After any significant change, run `npm test` and `npm run lint`.** Run
`npm run build` too if you touched anything that could break the bundle. Report
the actual results — if something fails, say so with the output rather than
describing the change as done.

For anything visual, check it in a browser as well. Tests do not catch a block
that renders and then ignores every button on it; that has happened here.

## Conventions already used by this codebase

Follow these because they are what the code already does, not because they are
universal truths.

- **Comments explain *why*, not *what*.** The existing comments are unusually
  discursive: they record the reasoning, the alternative that was rejected, and
  the bug that motivated the shape. Match that. A comment restating the code is
  worse than none.
- **Tests read as prose about behaviour.** Test names are sentences ("drops a
  gap with no title, which would render as an empty card"), and comments inside
  them explain why the behaviour matters. `test/helpers.js` has minimal fixtures.
  Server-side test files start with `// @vitest-environment node`.
- **Semantic colour tokens, never raw colours.** Use `bg-panel`, `text-subink`,
  `border-line2`, `text-danger`, `bg-warn-bg`, `text-good` and friends, defined
  in `src/index.css`. They are what makes dark mode work. Adding a colour means
  adding a token in all three places (`:root`, the `prefers-color-scheme` block,
  and `[data-theme='dark']`).
- **A `src/lib` module the server imports must use explicit `.js` extensions**,
  including in its own relative imports. Vite resolves `from './deck'` and plain
  Node — which runs the standalone server and the Vercel function — does not, so
  leaving the extension off breaks production only. `test/moduleResolution.test.js`
  starts a real Node process and imports the entry points to catch exactly this;
  the rest of the suite runs through Vite's resolver and cannot.
- **`src/lib` modules have no React import.** If you find yourself wanting one,
  the logic probably belongs in the component and the pure part belongs in lib.
- **Blocks are created in exactly one place.** `makeNode` inside `Canvas.jsx` is
  the only thing that attaches the shared dispatchers to a node. Never build a
  node object by hand — a block without them renders normally and then ignores
  every control on it.
- **`src/lib/canvasShape.js` is a persistence allowlist.** A field added to a
  block and not added there vanishes on the next save, silently.
- **React Flow specifics.** `nodrag` on anything interactive, `nowheel` on
  anything scrollable. Node `data` callbacks are captured at creation time, so
  they go through the stable dispatcher ref rather than being recreated.
- **The API key never reaches the browser.** It is deliberately named
  `OPENAI_API_KEY` with no `VITE_` prefix. **Never rename it to
  `VITE_OPENAI_API_KEY`** — that inlines it into the bundle shipped to every
  visitor. Diagnostics print length and a few characters, never the key.
- **`.env`, `.env.*` and `.data/` are gitignored** (`.env.example` is the
  checked-in template). `.data/` holds real accounts and canvases. Never commit
  either, and never put a real key in `.env.example`.
- **Environment variables the server reads:** `OPENAI_API_KEY`, `OPENAI_MODEL`,
  `OPENAI_BASE_URL`, `OPENAI_MOCK`, `LACUNA_SECRET`, `LACUNA_DATA`,
  `LACUNA_UPLOADS`, `LACUNA_REQUIRE_OWN_KEY`, `LACUNA_BLOB_ACCESS`,
  `POSTGRES_URL` / `DATABASE_URL` / the `PG*` set, `BLOB_READ_WRITE_TOKEN`,
  `PORT`, `HOST`.

## How to approach work here

**Prefer simple solutions and existing patterns.** Before writing something new,
look for how the codebase already solves the same shape of problem and follow
it. A new route goes in the `ROUTES` table. New logic goes in `src/lib` with a
test. A new colour goes in the theme tokens.

**Do not refactor working code unless the task requires it.** Tidying something
that already works costs review effort from someone who cannot easily read the
diff, and risks breaking behaviour nobody thought to test. If you spot something
genuinely worth changing, mention it and let them decide rather than doing it
alongside unrelated work.

**Do not add frameworks, libraries, dependencies or architectural patterns
unless genuinely necessary.** The dependency list is short on purpose and the
server uses Node built-ins. If you think something new is needed, say what it
buys, what it costs, and what the no-dependency version would look like — then
wait for an answer. Adding a state library, an ORM, a router, a component
library or a test framework is a decision for the owner, not for you.

**Preserve existing functionality when adding features.** Read enough of the
surrounding code to know what already depends on what you are touching. Run the
tests. If a change makes an existing test fail, work out whether the test was
right before you edit the test.

### Explain the risk before risky changes

Some changes can lose real people's data or let the wrong person in. Before you
make one, **stop and explain the risk in plain English**, then wait. This
applies to:

- **Anything touching the stored document or its shape** — `server/store.js`,
  `server/stores/*`, `src/lib/canvasShape.js`. Real accounts and canvases live
  here. A change to what is saved can quietly discard fields, and there are no
  backups.
- **Authentication and sessions** — `server/accounts.js`, `authRoutes.js`. A
  mistake here can lock everyone out or let anyone in.
- **Sharing and permission checks** — `canvasRoutes.js`. A mistake here shows one
  person's notes to another.
- **Secrets and stored AI keys** — `secretBox.js`, `aiKeys.js`, `aiConfig.js`.
  These are immediately spendable if they leak. Note that `LACUNA_SECRET`
  encrypts them: changing it makes existing stored keys unreadable.
- **Anything that deletes** — a canvas, a block and its subtree, an image,
  reviews.

"Explain the risk" means: what could go wrong, who it would affect, whether it
can be undone, and what you suggest doing about it. One short paragraph, no
jargon.

## Finishing a piece of work

1. `npm test`, `npm run lint`, and `npm run build` where relevant. Report what
   actually happened.
2. Check it in a browser if it is visual.
3. Write a plain-English summary: what changed, why, and anything you decided
   that they might disagree with.
4. **Tell them what to manually test** — the specific clicks, in order.
5. Commit and push only when asked, and only to the branch you have been given.
