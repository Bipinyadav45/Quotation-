# Project log — Newtech Quotation Desk

A record of what was built, what the real data turned out to say, and what is
still open. Built to [PROMPT.md](PROMPT.md); for how to run it see
[README.md](README.md).

**Date:** 17–18 August 2026
**Status:** all six milestones built and verified. 122 tests pass, none skipped.
Milestone 5's visual check is done and the document matches the original on one
page. PDF export works.

---

## 1 · What this is

An internal tool for the purchase desk (2–5 people) that turns a customer RFQ
email thread into a quotation on Newtech letterhead — and, before producing
anything, shows a line-by-line reconciliation of what the customer asked for
against what we are about to quote.

The reconciliation is the product. Quotations were being retyped by hand from
email threads, and the errors that cost time are silent: a cable length changed
from 1 mtr to 1.5 mtr, a brand dropped from a description, a part code lost.
Each of those sends the customer's procurement system back for another round.

---

## 2 · Stack, and why each piece

Chosen layer by layer against five stated properties: easy to understand, fast,
reliable, robust, scalable.

| Layer | Choice | Reason |
|---|---|---|
| Frontend | React 18 + Vite + TypeScript + Tailwind | §2 |
| Data fetching | Plain `fetch` behind a ~30-line hook | Five screens do not need a caching library |
| Backend | Express 5 + TypeScript | §2. Most documented server framework there is |
| Validation | Zod, via a 5-line middleware | Already in §5; now also the API contract |
| Database | SQLite (`better-sqlite3`), WAL | §2. One file, no server, trivial backup |
| Schema changes | Numbered `.sql` + a 20-line runner | Readable in one sitting; no ORM to learn |
| DOCX | `docxtemplater` + `pizzip` | §2. Injects into the real letterhead |
| PDF | LibreOffice behind a supervised queue | §2, hardened — see §5 below |
| LLM | `@anthropic-ai/sdk`, `claude-sonnet-5` | §2, model updated |
| Tests | Vitest | §10 requires tests |

**New concepts to learn: one (Vitest).** Everything else is either named in
PROMPT.md already or is plain JavaScript. No monorepo tooling, no ORM, no
Docker, no query library, no component library.

**Deliberately not added:** Hono, Drizzle, TanStack Query, npm workspaces, Pino,
pm2. An earlier draft of the plan included all six; they were cut when the
question "which of this is easy?" was put to it, and the reliability work
survived the cut intact — because it never lived in the frameworks.

---

## 3 · Build log

| Commit | Milestone | What landed |
|---|---|---|
| `ec42755` | 1 + 2 | Scaffold, migration runner, supervised PDF converter, the whole reconciliation core, 81 tests |
| `7d07eb4` | 3 + 4 | Parse/reconcile API, screens 1–3, reference allocation, persistence |
| `4c2a26a` | 5 + 6 | Template rebuild, document generation, history, revisions, LLM fallback |
| `f3aa007` | — | Concurrency tests for the PDF queue and reference allocation |

### Size

| Area | Lines |
|---|---|
| `shared/` — the one contract, money, financial year, company | 579 |
| `server/src/` | 1,865 |
| `server/scripts/` — template builder, visual preview | 450 |
| `web/src/` — five screens | 1,528 |
| Tests (10 files) | 1,392 |

Ten runtime dependencies: `@anthropic-ai/sdk`, `better-sqlite3`, `docxtemplater`,
`dotenv`, `express`, `pizzip`, `react`, `react-dom`, `tsx`, `zod`.

---

## 4 · Four corrections to PROMPT.md

§13 said: *"If a rule in this file turns out to be wrong once you see the real
data, say so rather than coding around it."* Four did. Each has a regression
test that would have caught it.

### 4.1 §6's similarity scoring was blind to the differences it exists to catch

§6 defines tokens as "lowercased alphanumerics of length ≥ 2". Applied to §11's
own fixture, that rule deletes exactly the information the product protects:
`USB-C` becomes `usb` + `c`(dropped), and `1.5` becomes `1` + `5` (both
dropped). The result:

| Line | Tokens under §6 as written |
|---|---|
| Req 1 `Black i USB-C to USB-A 1.5 mtr` | `{black, usb, to, mtr}` |
| Req 2 `Black i USB-C to USB-C 1 mtr` | `{black, usb, to, mtr}` |
| Offer 1 `Black i USB-C to USB-A 1.5 mtr` | `{black, usb, to, mtr}` |
| Offer 2 `Black i USB-C to USB-C 1.5 mtr` | `{black, usb, to, mtr}` |

All four identical, so every pairing scored exactly **1.0** and matching was
decided by iteration order. §11's two expected flags still fired — the `spec`
flag comes from the separate length regex, not the score — so **the fixture
passed by luck.** A third USB-C variant would have made pairing arbitrary,
silently pairing the wrong products.

Fixed by keeping hyphenated compounds whole (`usb-c`, `usb-a`) and joining a
number to its unit (`1.5mtr`, `1mtr`). §6's formula, its +0.35 part-code bonus
and its 0.42 threshold are all unchanged. Resulting scores:

| Pairing | Score | Outcome |
|---|---|---|
| Req 1 ↔ Offer 1 | 1.000 | matched |
| Req 1 ↔ Offer 2 | 0.909 | correctly loses |
| Req 2 ↔ Offer 2 | 0.800 | matched |
| Req 2 ↔ Offer 1 | 0.727 | correctly loses |
| Req 3 ↔ Offer 3 | 0.889 | matched |

### 4.2 §6 says "best unclaimed offer" — that is greedy, and greedy is wrong here

Greedy walks requests in order and lets each take whatever is free. On
near-identical cable variants that mispairs. Replaced with the Hungarian
algorithm (maximum-weight assignment), checked against a brute-force search over
every permutation on **300 random matrices**.

### 4.3 §6 requires brand flags but §5 never defined brand extraction

Two of §6's eight flag rows turn on brand, and §11's second expected flag is a
dropped `Black i` — but §5 has regexes for quantity, rate, length and part code
only. "Black i" is two words whose second token is a lowercase single letter, so
no capitalisation heuristic finds it.

Fixed with a seeded `makes` table, which also carries the manufacturer address
§11 calls *"a requirement, not trivia"* (Black i distributes from Bengaluru
560002).

### 4.4 The letterhead's body lives inside a Word text box

Both supplied `.docx` files keep the entire quotation body in a floating text
box (`w:txbxContent`), not in `w:body`. docxtemplater's `{#items}` loop operates
on table rows and is fragile inside one — and that text box is why the layout
shifts whenever staff edit the document today.

The body is rebuilt as ordinary paragraphs and a real table. The geometry needed
care: **the original page has no margins at all** (`w:pgMar` is all zeros)
because the text box supplied the inset. Setting real page margins is the
obvious move and is wrong — the header table is **11382 twips wide, sized for a
zero-margin page**, so margins would have pushed the logo out of place. Left and
right stay at zero and the body is indented by 824 twips instead, reproducing
the original text position exactly.

`header1.xml`, `footer1.xml`, `styles.xml` and the logo image are copied through
**byte-identical**, asserted by a test.

**Two things the first rebuild got wrong, both caught only by rendering it:**

- **It ran to two pages.** Eight blank paragraphs against the original's four,
  and two of them sat between the company name and the signatory, pushing
  "Rakhi Gupte" onto page 2. Trimmed to match the original's spacing.
- **It was in the wrong typeface.** The builder hard-coded Arial, taken from a
  scan of every font *referenced* anywhere in the package. The body does not use
  it: 158 of the original's 166 text-bearing runs carry no `w:rFonts` at all and
  inherit Times New Roman from `docDefaults`; the remaining 8 name Times New
  Roman explicitly. **Zero use Arial.** The builder now names no font, exactly
  as those 158 runs do, so it inherits from the styles we copy across.

Neither was visible in the text-extraction tests, which is precisely why §10
asks for the page to be rendered and looked at.

### Smaller items

- **Model.** §2 specifies `claude-sonnet-4-6`. Still valid, but a generation
  behind; now `claude-sonnet-5` at `effort: "low"` (extraction is not a
  reasoning task).
- **LLM output.** §5 asks for "a bare JSON array … no prose and no markdown
  fences" plus post-hoc validation. Structured outputs constrain the response to
  the schema at the API layer, removing the fence-stripping failure class. The
  rate comes back **as written** and is converted server-side — asking a
  language model to do paise arithmetic is a way for a customer's quotation to
  be wrong.
- **§7's Make column** takes the item table from five columns to six.
- **Money is integer paise.** §7's rounding rule is preserved exactly; the
  arithmetic just runs in integers so `qty × rate` is never approximate.
- **`max_tokens`.** §5 says 2000. That predates thinking models, where
  `max_tokens` caps thinking and output together and 2000 can truncate mid-array
  — which shows up as a lost line item, not an error. Now 8000.
- **Skip patterns.** Added `sent from my`, `get outlook`, `mailto:`,
  `disclaimer`, `confidential`. De-duplication normalises whitespace first,
  since quoted replies re-indent the line they quote.

---

## 5 · Notable engineering decisions

**PDF conversion is serialised on purpose.** Concurrent `soffice` invocations
that share a user profile directory collide — the second either hangs or exits 0
having written nothing. One person clicking *Download PDF* never sees it; three
at once do. `server/src/lib/pdf.ts` runs a queue of one, gives each call an
isolated profile via `-env:UserInstallation`, enforces a timeout and kills the
process tree, **verifies the output file exists because exit 0 does not prove
it**, retries once, and warms up at boot so the first real PDF does not pay
LibreOffice's 2–4 second cold start.

**References are allocated by an atomic `UPSERT … RETURNING`.** There is no
read-then-write window for two concurrent saves to lose. Allocation happens on
save, never on page load, so an abandoned page burns no number (§7).

**Totals are recomputed server-side on save and again at render.** Whatever the
browser believed is irrelevant; a stale or tampered figure cannot reach a
document.

**Amber is reserved for drift flags and nothing else** (§9), enforced by a
comment on the Tailwind palette. A false flag costs the strip its meaning, which
is why part-code extraction requires a digit or a hyphen — without it an
ALL-CAPS line yields phantom codes and phantom `code` flags.

**No dead buttons** (§13). "Parse with Claude" is hidden unless the server
reports an API key; *Download PDF* is disabled with the reason when LibreOffice
is missing.

---

## 6 · Verification evidence

**122 tests across 11 files — all passing, none skipped.**

### Milestone 5 visual check — 18 August 2026

`npm run preview` renders §11's quotation through the rebuilt template, converts
both it and the hand-made original to PDF, and rasterises page one of each.

| Check | Result |
|---|---|
| One page | ✓ — was 2, fixed |
| Logo / "Ref:" spacing | ✓ same gap as the original |
| Footer / signatory spacing | ✓ signatory clear of the rule |
| Left-edge alignment | ✓ "Dear Sir," lines up |
| Description-column wrapping | ✓ line 04 wraps to 3 lines against the original's 2 — expected, the Make column took that width |
| Typeface | ✓ Times New Roman, after the Arial defect above |


| File | Tests | Covers |
|---|---|---|
| `server/src/lib/parser.test.ts` | 22 | §5 regexes on the real fixture, skip rules, de-duplication |
| `server/src/lib/reconcile.test.ts` | 21 | §11 golden fixture, one minimal fixture per §6 flag row |
| `server/src/lib/docx.test.ts` | 17 | Golden file vs the document Newtech actually sent |
| `shared/money.test.ts` | 13 | Indian grouping, amount in words across crore/lakh, §7 rounding |
| `server/src/lib/tokenize.test.ts` | 12 | Correction 4.1 — the two assertions that would have caught it |
| `server/src/lib/refno.test.ts` | 9 | FY rollover on 1 April, gapless series, two-connection allocation |
| `shared/fy.test.ts` | 7 | FY boundaries, ordinal date format |
| `server/src/lib/assign.test.ts` | 6 | Hungarian vs brute force, 300 random matrices |
| `server/src/lib/pdf.test.ts` | 4 | Three simultaneous conversions, and a bad input not wedging the queue |
| `web/bundle-safety.test.ts` | 3 | Greps the **built** `web/dist` for the API key |
| `web/src/lib/diff.test.ts` | 8 | The word-level diff that marks where a line drifted |

### Verified end to end against §11

Paste thread → parse → reconcile → save → render, through the real HTTP API:

```
pairs: 5
01 Black i USB-C to USB-A 1.5 mtr      | Black i USB-C to USB-A 1.5 mtr    | —
02 Black i USB-C to USB-C 1 mtr        | Black i USB-C to USB-C 1.5 mtr    | spec/block
03 Black i Lightning to USB A 1.5 mtr  | Lightning to USB A 1.5 mtr        | brand/block
04 Black i USB Type C Docking Station… | Black i USB Type C Docking Sta…   | —
05 Logitech Wireless Keyboard #MK540   | Logitech Wireless Keyboard #MK5…  | —

ref:   NCS/2026-27/Quotes/RG/001
sub:   11,500.00   tax: 2,070.00   total: 13,570.00     § 11 expects → MATCH
docx:  HTTP 200, 41304 bytes, unresolved template tags: none
pdf:   HTTP 503 — "PDF export is unavailable … The .docx download still works."
```

Note line 02: the *1 mtr* request paired with the *1.5 mtr USB-C* offer, not the
USB-A one. That is Correction 4.1 doing its job.

### Production smoke test — 17 August 2026, 16:05

Run against a clean tree (`git status` empty), with `web/dist` and `data/`
deleted first so the frontend was rebuilt and the database created from nothing
by the migration runner. Vite was **not** running; `npm start` alone served
everything.

```
1. SINGLE PROCESS SERVES THE FRONTEND
   GET /                       200   411 bytes   text/html
   GET /assets/index-….js       200   177,809 bytes
   GET /history (deep link)     200   SPA fallback works

2. DATABASE BUILT FROM NOTHING
   status: degraded
     database  ok           - 1 migration(s) applied
     pdf       unavailable  - LibreOffice not found

3. FULL FLOW THROUGH THE PRODUCTION PROCESS
   POST /api/parse       200   10 lines, 5 requests / 5 offers
   POST /api/reconcile   200   5 pairs
                               flags: line 2 spec/block, line 3 brand/block
                               § 11 expects exactly these two  -> MATCH
   POST /api/quote       201   NCS/2026-27/Quotes/RG/001
                               11,500.00 / 2,070.00 / 13,570.00  -> MATCH
   POST /render/docx     200   41,302 bytes
```

`degraded` rather than `error` is the designed behaviour: the PDF converter is
absent, which is not a fault, and the `.docx` path is unaffected.

The reference restarting at `001` is correct — the database had just been
deleted, and the counter lives in it.

---

## 7 · Open items

1. ~~LibreOffice~~ **Resolved — PDF export works via Microsoft Word.**

   Installing LibreOffice could not be completed: `winget` downloaded the 355 MB
   package but stalled for 25 minutes with no install log, because the session
   was **not elevated** and a per-machine MSI cannot raise a UAC prompt
   non-interactively.

   Rather than wait on an administrator, a second backend was added. Word was
   already on the machine, it renders a Word document with Word, and driving it
   over COM needs no elevation. LibreOffice remains the preferred backend when
   present — it is headless, does not tie up the user's Word, and is the only
   option on a Linux server — so installing it later changes nothing but the
   line in `/api/health`.

   Both backends run behind the same queue, timeout, retry and
   output-verification.

2. **Milestone 5's visual check is done, and it found two real defects** — both
   invisible to the text-extraction tests. See §4.4: the document ran to two
   pages, and it rendered in Arial instead of the letterhead's Times New Roman.
   Both fixed; `.preview/ours.png` now matches `.preview/original.png` on one
   page. Re-run any time with `npm run preview`.

3. **Customer details are typed by hand.** PROMPT.md has no customer master, so
   the editor starts with blank customer fields. A master would be the obvious
   next addition.

4. **One salesperson is seeded** (`RG`, Rakhi Gupte). Reference series are
   per-person and already independent; more people is a data change, not a code
   change.

5. **A test quotation sits in the dev database** (`NCS/2026-27/Quotes/RG/001`)
   so the History screen is not empty. Delete `data/quotes.db` to start clean.

6. **`npm audit` reports 5 advisories** in the dependency tree, all transitive
   through build tooling. Not triaged.

---

## 8 · If you pick this up cold

Read in this order:

1. `PROMPT.md` — the specification
2. `shared/schema.ts` — §4's data model, and the one contract in the system
3. `server/src/lib/tokenize.ts` — the correction that matters most, with the
   reasoning in the comment
4. `server/src/lib/reconcile.test.ts` — what the product is supposed to do

The one rule worth internalising before changing anything: **money is integer
paise, everywhere, and nothing divides by 100 in floating point.** A quotation
that is one paisa off is a quotation the customer's system rejects.
