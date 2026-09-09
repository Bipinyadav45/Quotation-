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

3. ~~Customer details are typed by hand.~~ **Resolved — the master is the desk's
   Tally sundry debtors, imported whole** (25 August 2026). See §8.

4. ~~One salesperson is seeded.~~ **Two now** — `RG` Rakhi Gupte and `LD` Linda
   D'mello (26 August 2026). It was *not* purely a data change, which is worth
   recording: the closing "call us at" numbers were a company constant baked
   into the template at build time, and they are per-person. See §9.

5. ~~A test quotation sits in the dev database.~~ **Cleared** (25 August 2026).
   The 32 scratch quotations and the five stub customers behind them were
   deleted at the desk's request when the real debtors list came in; `data/quotes.db`
   now holds the 225 imported ledgers and no quotations.

6. **`npm audit` reports 5 advisories** in the dependency tree, all transitive
   through build tooling. Not triaged.

---

## 8 · The customer master, and why a name is not an identity

**25 August 2026.** The desk supplied `Resources/List of Sundry Debtors with
address and GSTIN.xlsx` — 225 ledgers out of Tally — with one instruction about
how to treat it: *many companies have the same name but their locations and GST
numbers differ; treat them as separate entities, and do not complete a
quotation unless the company is selected.*

### What the file actually says

| | |
|---|---|
| Ledgers | 225 |
| Ledger names that repeat | **0** — Tally keeps them unique |
| GSTINs held by more than one ledger | **39** |
| Spellings of "Datamatics Global Services Limited" | 14, across 4 GSTINs |
| Ledgers answering to "Morgan Stanley" | 17, across 5 GSTINs and 3 states |
| Azentio sites sharing GSTIN `27AAUCA4876F1Z4` | 3, differing only by address |

So the ledger name is a usable key and the *company* name is not — and the thing
that separates two ledgers is, in the worst case, only the address.

### The bug this was heading for

`extractCustomer.matchOnFile` fetched the typeahead's first five hits, scored
them, took the single best above 0.75 and returned it as "the record already on
file for this customer". `App.tsx` wrote it onto the draft. The review panel
that used to stand in front of that was removed on 19 August.

Against this list, a thread saying "Morgan Stanley Advantage Services Pvt Ltd"
scores ~1.0 against seven ledgers spanning three GSTINs and three states, and
one of them won on tie-break. The ship-to state decides IGST versus CGST+SGST,
so this was not only the wrong address — it was a coin toss over the tax
treatment, applied silently.

Two smaller things were wrong with the same code path: the candidates came from
`searchCustomers`, which ranks by prefix and recency rather than likeness, so
the right ledger was often not among the five that got scored; and the raw Dice
score it thresholded on is inflated by corporate boilerplate — "Foo Services Pvt
Ltd" against "Bar Services Pvt Ltd" scores 0.75, above the threshold for a
silent write.

### What replaced it

- **004 removed `UNIQUE (lower(name))`** and made `customers.id` the identity.
  `quotes.customer_id` records which ledger was billed; null for a company
  quoted off the list, and for every quotation saved before this.
- **`rankCandidates` returns a list.** It strips corporate forms (`ltd`, `pvt`,
  `llp`…) and scores by *containment* of the remaining tokens in the ledger's —
  asking "is everything the thread named present here?" rather than Dice's "are
  these two names alike?", which punishes a ledger for carrying the branch
  suffix that makes it useful. The threshold went *down*, from 0.75 to 0.6:
  it no longer has to make a silent write safe, only decide whether to show a
  row.
- **A document-frequency stop list was tried and rejected.** Measured on this
  file, "datamatics" appears in 19 of 225 rows (8.4%), which ranks it above
  "technologies" (8.0%) on frequency alone — and it is the single most
  identifying word anyone could type. Frequency measures how many branches a
  customer has, not how little a word says. The hand-written list is correct
  here, and deliberately excludes "Global", "Staffing" and "Business Solutions":
  those separate three real Datamatics entities.
- **Nothing is filled in while a choice is outstanding.** The name survives, so
  the chooser can ask its question and "none of these" leaves something to type
  over; the four fields that decide what prints and what tax applies stay blank.
- **Each candidate carries the block it would produce**, merged by the old
  precedence table (now `mergeWithLedger`). Choosing is therefore instant and
  offline, and the precedence — the thread's Kind attention beats the ledger's,
  a flattened stored address gets repaired — lives in one place.
- **The refusal is server-side.** `resolveCustomerChoice` answers 409 with the
  candidates. Four things count as answering: an id, "not on my list", an exact
  ledger name (unique by construction — this is what keeps re-quoting a customer
  frictionless), or nothing on the list matching at all.

### What the import had to repair

Tally flattens a multi-line address into one cell, joining the lines with a
comma — so `,,` is where a line break was. `"Office No. 501 & 503, 5th Floor,,
Light Bridge, Saki Vihar Road,, Andheri-East, Mumbai-400072"` is a three-line
address, and §11's block prints one paragraph per line. 183 of the 225 addresses
were rebuilt this way; imported flat they would each have printed as one line
running past the column, and `lostLineStructure` would have spent every read
repairing what could be stored correctly once.

Also stripped: the `` Tally writes before "Not Applicable", and stray
carriage returns and tabs — they print as boxes on a quotation.

The import reports what it will not fix, and imported all 225 regardless:

- `CBI SPECIAL UNIT` — GSTIN `27MUMS49872E1D9` is not a GSTIN. Dropped rather
  than stored; half a number on a tax document is worse than a blank.
- `INVESTEC CAPITAL SERVICES (INDIA) PVT. LTD. B WING` — state "Not Applicable"
  on an Indian ledger. Left blank; the report names the state its GSTIN is
  registered in, but does not fill it in — registration is not ship-to.
- `K.M. & CO. (SALE)` — state says Maharashtra, GSTIN is registered in Gujarat.
- `VALUE POINT SYSTEMS PVT. LTD. - HYD` — Andhra Pradesh against a Telangana
  GSTIN.

The last two are one field wrong in Tally and only the desk knows which, so
neither is corrected here.

### Reading .xlsx without a dependency

`server/src/lib/xlsx.ts` is ~80 lines over `pizzip`, which was already present
for docxtemplater. The `xlsx` package is 7 MB and has carried
prototype-pollution and ReDoS advisories; this reads one sheet of one
spreadsheet a human exports by hand, and needs no formulas, dates, styles or
writing. Every cell comes back as a string — a GSTIN is not a number and a
pincode with a leading zero is not a number.

---

## 9 · Four changes the desk asked for

**26 August 2026.**

### The tax stopped being a choice

The editor offered a mode — IGST as one row against CGST + SGST as two — and an
editable rate, defaulted from the ship-to state. It is now a constant: one row
reading **GST 18%**, on every quotation.

Both documents the desk supplied as correct print exactly that, whatever state
the customer ships to, so the control existed only to make the document disagree
with the letterhead. Three call sites set the mode from the state — the chooser,
the typeahead and the state dropdown — and all three are gone; the state is
still stored, because it is part of the customer's address on file.

`computeTotals` still knows how to split it and every quotation stores the mode
it was saved with, so nothing was deleted and nothing needs rebuilding to put
the dropdown back. **Worth knowing if it ever comes back:** for an intra-state
sale — both parties in Maharashtra, which is over half the customer list — the
tax is legally CGST 9% + SGST 9%, and a tax *invoice* has to show the halves
separately. The total is identical, and this document is a quotation.

### The PDF is editable, and now provably

It already was: real text, no encryption, tagged. The change is a guarantee
rather than a fix.

Word's `ExportAsFixedFormat` was called with two arguments and therefore its
defaults, and one of those defaults is **`BitmapMissingFonts = TRUE`** — "if a
font cannot be embedded, draw that text as a picture instead". A quotation
exported that way has no text at all: nothing to select, search or edit. The
export succeeds, there is no warning, and it would happen only for the
quotations that used a glyph Word could not embed. It is now passed `$false`
explicitly, along with `DocStructureTags = $true` for the tag tree that tells an
editor which runs are paragraphs and which are table cells.

Three tests assert the *properties*, not the flag: extractable text, no
`/Encrypt` dictionary of any kind (which is also how "printing allowed, editing
not" is expressed), and embedded fonts.

**Measured and not pursued:** Word subsets fonts on PDF export and offers no way
to stop it — `SaveSubsetFonts` and `EmbedTrueTypeFonts` are DOCX-save settings
and changed the output not at all, so they were removed rather than left in with
a comment claiming otherwise. The faces come out as `BCDEEE+TimesNewRomanPSMT`.
That is fine here: the letterhead is Times New Roman and Arial, which every
machine already has, so a subset resolves against the local copy. A subset only
bites for a face the editing machine does not own.

### Two people sign these documents

`LD` Linda D'mello joins `RG` Rakhi Gupte, from the quotation she sent
(`Supporting Documents/HCL Quote 34 Dt. 30.07.2026.pdf`). Four lines are hers
and none of them is shared:

| | Rakhi Gupte | Linda D'mello |
|---|---|---|
| Reference | `NCS/2026-27/Quotes/**RG**/030` | `NCS/2026-27/Quotes/**LD**/34` |
| Contact | 022-40668809 | 40668803 |
| Email | rakhi.gupte@newtech.in | Linda.pdmello@newtech.**co**.in |
| Closing | call us at 40668812/88 | call us at 40668803/40668888 |

The fourth is the one that was wrong. It was `COMPANY.queriesNumbers`,
interpolated into the template as a literal at build time, so Linda's quotations
would have closed with Rakhi's numbers. It is a `{queriesNumbers}` tag now, and
005 stores it on the quotation beside `contact`, `email` and `signatory` — a
quotation records what was **sent**, so a number that changes later must not
rewrite a document already with a customer. Rows saved before 005 have a blank
and fall back to whoever the initials in their reference belong to.

Two spellings deliberately not corrected: `Linda.pdmello` carries the `p`, and
her surname carries a typographic apostrophe (U+2019). Both are copied from the
document she sent, and there is a test for the apostrophe surviving the trip
through docxtemplater into XML.

The editor now has a **Prepared by** picker rather than a free-text initials
box, because on this document those four fields are not four facts — they are
one person, and typed separately they drift. A quotation numbered `.../LD/` over
Rakhi's direct line is one neither of them can answer the phone for. Everything
it sets stays editable.

### It is a Quotation again

"Proforma Invoice" was reverted to "Quotation" in both places the document says
it, which puts it back in agreement with every reference document in the
repository — and with the reference series, `NCS/<FY>/Quotes/...`, which never
stopped saying Quotes. It also reached further than the two headings: the
downloaded filename (`Quotation-Morgan-2026-07-10.pdf`), the Prices term, and
the covering-email prompt, which was telling the model it was writing about a
proforma invoice.

The test that used to assert the two lines differed from the reference document
now asserts they match, and that nothing anywhere still says "proforma".

---

## 10 · If you pick this up cold

Read in this order:

1. `PROMPT.md` — the specification
2. `shared/schema.ts` — §4's data model, and the one contract in the system
3. `server/src/lib/similarity.ts` — the correction that matters most, with the
   reasoning in the comment. (It was `tokenize.ts` when this list was written,
   and `reconcile.test.ts` went with §6's comparison on 19 August.)
4. `server/src/lib/parser.test.ts` — four real threads out of the desk's
   mailbox, each added after it broke something
5. `server/src/lib/customerMatch.ts` — why identifying a customer returns a
   list, and §8 above for what the real data does to anything that returns one

Two rules worth internalising before changing anything:

**Money is integer paise, everywhere, and nothing divides by 100 in floating
point.** A quotation that is one paisa off is a quotation the customer's system
rejects.

**A customer is a ledger, not a name.** Fourteen ledgers are spelled some
version of "Datamatics Global Services Limited" and three Azentio sites share a
name and a GSTIN. Nothing may collapse two rows because their names match, and
nothing may pick one of them on the desk's behalf.
