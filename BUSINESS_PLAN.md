# Lacuna — Business Plan

**A knowledge canvas that finds the gaps in your notes, then quizzes you on them.**

By Ben Yu · July 2026

---

## 1. The problem

Note-taking has no shape. You write pages of linear notes, and nothing in them tells
you what you have understood, what you have merely copied down, or what you never
wrote at all. The third category is the dangerous one: you cannot revise a gap you
cannot see.

Revision then happens in a second, disconnected place. You read your notes, then go
to Quizlet or Anki and re-type the same material as flashcards. The structure you
built while learning — what causes what, what belongs under what — is thrown away
at exactly the moment you start testing yourself on it.

So students do three jobs badly instead of one job well: organise, find what's
missing, and test recall.

## 2. The product

Lacuna is one canvas that does all three.

- **Write first.** Type a topic, get a blank block, and write what you already know. This order is deliberate — the writing is the learning.
- **Then find the gaps.** *Fill my knowledge* reads what you actually wrote, flags factual errors, fills the notes you left blank, and adds the sub-topics you missed. *Make a graph* generates a three-level map of a topic at one of four depths when you're starting cold.
- **Study the same artifact.** Every block with notes is a card. Notes are split into points, and each card is graded **per point** rather than pass/fail — nobody recalls a paragraph verbatim, and being marked wrong for failing to is not a useful signal. The session summary lists the *specific* points that got away.

The name is the thesis. A *lacuna* is a missing passage in a manuscript; the logo is
the editorial notation for one. The product is about the gap, not the notes.

### What is genuinely different

- **The map and the deck are the same object.** No re-typing. Building the map *is* making the flashcards.
- **The AI's job is to find what's missing from your writing** — not to write it for you. A tool that writes your notes leaves you with nothing learned.
- **Grading is per point**, which produces the data nobody else has: not "you scored 6/10" but "you don't know these four facts."
- **Bring your own AI.** The app talks to any OpenAI-compatible endpoint, including a model running locally on your own laptop for free. Already built and working.

## 3. Market

The market is real, large, and currently served by tools that each do one third of
the job:

| Competitor | Price (2026) | What it does | What it doesn't |
| --- | --- | --- | --- |
| **Quizlet** | $2.99/mo, billed $35.99/yr · 60M+ monthly users | Flashcards at enormous scale | No structure, no gap-finding; you type every card |
| **Anki** | Free | Best-in-class spaced repetition | Punishing interface; no structure, no AI |
| **Obsidian** | Free; Sync $4–8/mo | Linked notes, real structure | No active recall, no quizzing |
| **Heptabase** | $8.99/mo billed annually ($107.88/yr) | Canvas + notes, closest in spirit | Priced for professionals, not exams; no quizzing |
| **Milanote** | From $9.99/mo | Visual boards | Not a study tool at all |
| **ChatGPT / NotebookLM** | Free tiers | Will happily explain and quiz you | Ephemeral. No persistent map, no scheduling, nothing accumulates |

Quizlet's 60M monthly users and ~$139M revenue establish that students pay for
revision tools at roughly $3/month. That is the price anchor, and Lacuna should sit
at or below it.

**Initial target:** GCSE/A-level and first-year university students in
content-heavy, fact-dense subjects — history, biology, geography, politics, law.
These are the subjects where "what am I missing?" is the actual question and where
rote recall alone fails.

## 4. Business model — freemium

The core loop stays free forever. What costs money to run is what gets metered.

| | Free | **Plus** | **Classroom** |
| --- | --- | --- | --- |
| Price | £0 | **$3.49/mo or $29/yr** | **$3/student/year**, 30-seat minimum |
| Canvases, blocks, study mode | Unlimited | Unlimited | Unlimited |
| AI generations | 15/month | 300/month (fair use) | Pooled per class |
| Bring your own API key | **Unlimited, free forever** | — | — |
| Sync across devices | — | ✓ | ✓ |
| Spaced-repetition scheduling | — | ✓ | ✓ |
| Export (PDF, Anki deck) | — | ✓ | ✓ |
| Teacher dashboard | — | — | ✓ |

Three deliberate decisions:

1. **Meter the AI, not the product.** Study mode costs nothing to run, so putting it behind a paywall would be extracting rent rather than charging for value. The AI calls cost real money; those are metered.
2. **Bring-your-own-key stays unlimited and free.** It already works, it costs us nothing, and it means a student with no money is never locked out. It also removes the usual freemium dishonesty where "free" means "crippled".
3. **$29/yr against $3.49/mo.** Annual works out to 8.3 months, which makes it the obvious choice — and that is the point, because it fixes the seasonality problem in §7.

## 5. Unit economics

These are computed from the app's actual request pattern, not estimated from
nothing. A **Detailed** graph produces 21 blocks from **6 model requests** — each
response returns its sub-topics with their content, so a branch's children are built
from the branch's own reply. At roughly 800 input and 500 output tokens per request:

| | Input | Output | **Cost per graph** |
| --- | --- | --- | --- |
| Groq `llama-3.3-70b` ($0.59/$0.79 per M) | 4,800 tok | 3,000 tok | **$0.0052** |
| OpenAI's cheapest tier ($0.20/$1.20 per M) | 4,800 tok | 3,000 tok | **$0.0046** |

**About half a cent per generated graph.** A *Fill my knowledge* call is one request,
about $0.001.

Worth noting what the architecture buys: one request per block would cost $0.018 per
graph. Building children from their parent's response is **3.5× cheaper** — a design
decision that turns out to be an economic one.

**A heavy Plus subscriber** — 40 graphs and 150 fills a month — costs $0.34 in AI.
Against $29/yr (about $2.35/month after payment processing), that is a **~85% gross
margin**, and a user would have to be 7× heavier than that before a subscription
stopped paying for itself.

**Free-tier exposure is bounded by the meter:** 15 graphs is at most $0.08 per user
per month, and only for users who max it out. Ten thousand free users, a fifth of
them active and maxing the meter, is roughly $160/month.

**Fixed costs are trivial:** static hosting plus a small API, $10–20/month; domain
$15/year. Break-even is about **21 annual subscribers**.

That is the headline finding: at student pricing, with this architecture, the
economics are not the hard part. **Distribution is.**

## 6. Go-to-market

No budget, so no paid acquisition. Bottom-up only:

1. **My own school first.** 20–30 students in the subjects above, in person, watching them use it. This is user research disguised as marketing, and it is the only stage that matters right now.
2. **One teacher, one class.** A teacher who assigns a canvas and sees which points the class missed is the entire Classroom pitch, proven once. The per-point grading already produces that data.
3. **Where students already are.** Subject-specific subreddits, study Discords, study-tok. Content that is genuinely useful on its own — "here is the Cold War as a map, free, no signup" — with the app attached.
4. **Shareable canvases as the loop.** A public canvas link is both a study resource and an advert. This needs the backend in §8, which is why it is Phase 2 and not Phase 1.
5. **Schools last.** Institutional sales are slow, require a data-protection agreement, and are not winnable without the teacher pilot from step 2.

## 7. Risks, honestly

| Risk | Why it's serious | Response |
| --- | --- | --- |
| **A model vendor ships this** | OpenAI or Google could add "map my notes and quiz me" | The defensible asset is a student's accumulated canvases and structure, not the model. We are already provider-agnostic, so cheaper and better models are a tailwind, not a threat |
| **Memorising a wrong fact** | Worse than learning nothing. This is the product's most serious failure mode, not a rough edge | Already: AI-filled content is badged, corrections are proposed rather than silently applied, blocks can be flagged as unsure. Needed: source citations on generated content |
| **Seasonality** | Revenue concentrates Sept–Dec and Mar–Jun; churn spikes the day exams end | Annual pricing deliberately cheap enough to be the default; a lapsed user's canvases stay intact and free to read, so returning next term costs nothing |
| **Distribution without budget** | The actual constraint on this business | Accept slow, compounding, content-led growth. Do not raise money to buy users for a product with unproven retention |
| **Under-18 data protection** | Selling to schools means UK GDPR and COPPA obligations | Today everything is stored locally in the browser, which is a genuine privacy advantage — keep it as long as possible, and collect the minimum when sync arrives |
| **One person, still at school** | Limited hours; exams compete with the build | Scope Phase 1 to the smallest thing that can charge money |

## 8. What is actually built, and what isn't

A plan that overstates the product is worthless, so plainly:

**Working today.** Infinite canvas with branching blocks, labelled relationships
between them, four generation depths, AI gap-filling and fact-correction, per-point
study grading with a summary of what you missed, images in blocks (paste, drag, or
pick — shown with the answer when studying), library search across titles and note
content, unique canvas titles, undo/redo, light and dark themes, starter example
canvases, and an offline demo mode that needs no API key. 408 automated tests.
Provider-agnostic AI: OpenAI, Groq, or a local model.

**Accounts and sharing are real now.** A password-backed account (scrypt with a
per-user salt), a session in an httpOnly cookie, canvases stored server-side, and
sharing as a permission row granting edit or view access by email — including to
someone who hasn't signed up yet. `npm start` serves the built app and the API from
one Node process, so it can go on a host.

**Not built.** No invite emails (that needs a mail-provider account), no password
reset, no live simultaneous editing — shared editing is last-write-wins — and no
billing. The store is a JSON file rather than a database, which is honest at this
scale and is one module to swap.

### Roadmap

| Phase | Work | Why it's in this order |
| --- | --- | --- |
| **1. Make it sellable** | ~~Accounts, a server, sync~~ **(built)**; still needed: per-user AI quotas, password reset, Stripe | Every revenue line depends on this. The hard half — real identity and server-side canvases — is done and tested |
| **2. Make it stick** | Spaced-repetition scheduling driven by the per-point grades already recorded; Anki and PDF export; shareable public canvases; mobile polish | Retention and the growth loop. Scheduling is the feature that turns a study tool into a habit |
| **3. Make it institutional** | Teacher dashboard: assign a canvas, see which specific points a class is missing | The per-point data is the product no competitor has. A class-wide gap report is worth more to a teacher than any number of scores |

## 9. Illustrative projections

Stated as arithmetic, not forecast. The conversion rates are assumptions; everything
before them is measured.

| | Signups | Conv. | Paying | Revenue | Costs | Net |
| --- | --- | --- | --- | --- | --- | --- |
| **Year 1** (one school year) | 4,000 | 2.5% | 100 | $2,900 | ~$1,050 | **~$1,850** |
| **Year 2** (+10 school pilots) | 25,000 | 3% | 750 | $21,750 + $6,000 | ~$6,100 | **~$21,650** |
| **Year 3** (+40 schools) | 100,000 | 3% | 3,000 | $87,000 + $24,000 | ~$24,250 | **~$86,750** |

Costs are built up rather than guessed: hosting, plus free-tier AI at $0.08/month for
the fifth of signups who are active and max their meter, plus $0.34/month per
subscriber, over an average six active months. School seats are priced at $3/student
with a 200-student school, so ten pilots is $6,000.

The honest reading: this is not a venture-scale business on these numbers, and it does
not need to be. It is a product that can pay for itself in its first year on about a
hundred subscribers, and support one person by year three. If retention proves strong
in Phase 2, the Classroom line is where it becomes something larger.

## 10. What's needed next

Nothing financial — running costs are about $300/year and the free tiers of Groq and
a local model cover development. What is actually needed:

1. **20 students** using it for one real term, and honest data on whether they come back.
2. **One teacher** willing to pilot a class.
3. **Phase 1 built** — the server, accounts, and billing.

The first two are worth more than the third, because they answer the question the
third assumes: does anyone keep using this once the novelty is gone.

---

### Sources

Pricing and market figures were checked in July 2026 and will move:

- Groq API pricing — [aipricing.guru](https://www.aipricing.guru/groq-pricing/), [cloudzero.com](https://www.cloudzero.com/blog/groq-pricing/)
- OpenAI API pricing — [aipricing.guru](https://www.aipricing.guru/openai-pricing/), [cloudzero.com](https://www.cloudzero.com/blog/openai-pricing/)
- Quizlet pricing and scale — [quizlet.com](https://quizlet.com/study-guides/quizlet-plus-subscription-plans-and-pricing-b7bf7630-ec84-45fd-95cf-90ce82132139), [getlatka.com](https://getlatka.com/companies/quizlet), [builtin.com](https://builtin.com/company/quizlet/faq/stability-growth)
- Heptabase, Milanote, Obsidian pricing — [spotsaas.com](https://www.spotsaas.com/product/heptabase/pricing), [checkthat.ai](https://checkthat.ai/brands/obsidian/pricing)

Token counts per request are estimated from the prompts in
`server/knowledgeRoutes.js`; the request count per graph (6 for a 21-block Detailed
graph) is exact and documented in the README.
