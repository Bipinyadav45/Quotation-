# Newtech Quotation Desk

Turns a customer RFQ email thread into a quotation on Newtech letterhead. Paste the thread,
check the lines it found beside a live preview of the document, save, download.

Two steps: **Email thread → Quotation**. The document is not a third — it sits beside the form
and redraws as you type, so editing and seeing the result are not separate places to be.

> **The ask-vs-quote comparison was removed at the desk's request** (19 August 2026). PROMPT.md
> §1 calls it "the point of the product": it paired each request against each offer and flagged
> the differences. On real threads the two sides usually came from different revisions and did
> not pair, so every row read "quoted but not requested" and it was pure friction. `git log` has
> it if it is ever wanted back.
>
> What survived, because it earns its place: the parser reports **every line it could not read**,
> and warns when the **prices came from a superseded message** in a forwarded chain.

Built to [PROMPT.md](PROMPT.md).

## Running it

```bash
npm ci                    # not `npm install` — respects the lockfile
cp .env.example .env      # optional: GEMINI_API_KEY turns the AI features on
npm run build:template    # rebuilds the .docx template from the letterhead
npm run import:customers  # loads the Tally debtors list into the customer master
npm run dev               # http://localhost:5173
```

Without `GEMINI_API_KEY` the application is **fully usable** — the customer master, price memory,
the parser and every document path work unchanged. The two AI features simply are not offered;
`GET /api/capabilities` tells the frontend to hide the buttons.

In production the frontend is built and served by the same Express process — one port, one URL:

```bash
npm run build
npm start                 # http://localhost:4000
```

| Command | What it does |
|---|---|
| `npm run dev` | Vite on :5173 proxying `/api` to Express on :4000 |
| `npm test` | The whole suite |
| `npm run typecheck` | `tsc --noEmit` |
| `npm run build:template` | Regenerates `server/templates/quotation-template.docx` from the letterhead |
| `npm run import:customers` | Loads Tally's Sundry Debtors export into the customer master. `-- --dry-run` to look first |

## What it does for you

| | Needs a key? | Cost |
|---|---|---|
| **Customer master** — 225 ledgers out of Tally; picking one fills the address block | no | free |
| **Price memory** — what you last charged, under each Rate cell | no | free |
| **Read it with AI** — the lines *and* the customer, in one pass | yes | ~₹1.7 |
| **Draft covering email** — the note that goes with the document | yes | ~₹0.4 |

The first two are the ones that save the most typing, and they cost nothing —
they read your own records. With no `GEMINI_API_KEY` the other two are not
shown at all and everything else works exactly as before.

"Read it with AI" used to be two buttons — one for the lines, one for the
customer — and the customer's details then had to be accepted field by field
before anything happened. One press now does both and fills the draft in
directly. Where it had to infer something, or found nothing, it says so on the
next screen instead of asking you to read a panel.

The model is Google Gemini, called over plain `fetch` from
[server/src/lib/ai.ts](server/src/lib/ai.ts) — one module, never throws, and the
only place a key is read. `gemini-3.7-flash` by default, with three flash models
behind it: 503 UNAVAILABLE from this endpoint is genuinely random (four
identical calls measured 503, 503, 503, 200), so one model is not enough.

**AI suggests, a human accepts.** Nothing Claude produces reaches a saved
quotation or a rendered document without a click — per field where the fields
are independent, so a wrong address never costs you a correct GSTIN. A GSTIN
read from an email signature is a suggestion; the one on file was confirmed by
someone saving a quotation with it, and wins.

## The customer list

The master is the desk's Tally sundry debtors, imported whole:

```bash
npm run import:customers -- --dry-run   # what it would do, and what to fix in Tally
npm run import:customers                # 225 ledgers, matched on the ledger name
```

Re-runnable on a fresh export — rows are matched on the Tally ledger name, which
Tally keeps unique, so a second import updates rather than duplicating. Tally
owns the address, GSTIN, state, country and registration type and a re-import
overwrites them; what the desk has learned by *using* a row — how many
quotations, who they were addressed to, which salesperson owns the account — is
left alone.

**A customer is a ledger, not a name**, and this list is why. Fourteen ledgers
are spelled some version of "Datamatics Global Services Limited", seventeen
answer to "Morgan Stanley", and three Azentio sites share a name *and* a GSTIN,
differing only in their address. Thirty-nine GSTINs on the list are held by more
than one ledger. So:

- **"Read it with AI" never picks the customer.** It narrows the list and shows
  what it narrowed it to. A thread saying "Morgan Stanley" matches seventeen
  ledgers across ten GSTINs and three states — and the ship-to state decides
  IGST versus CGST+SGST, so guessing is guessing at the tax treatment. Until
  somebody chooses, the customer block stays empty.
- **The chooser leads with the address**, because for the Azentio rows it is the
  only thing that differs. So does the typeahead, which also searches the
  address and the GSTIN — `powai` and a pasted registration number both work.
- **The server refuses the save**, not just the button. A quotation whose
  customer name matches ledgers without naming one comes back 409 with the
  candidates. Typing a ledger's name *exactly* counts as naming it — Tally
  ledger names are unique — so quoting the same customer again is one keystroke,
  not a dialog.
- **A company not on the list is still quotable**, deliberately: "none of these"
  is one click, and the customer is added on save. New customers get quoted
  before Tally has them.

Quotations record `customer_id` alongside the name that printed, so which entity
was billed is answerable afterwards. It is null for the ones quoted off the list.

The import reports what it cannot fix — a GSTIN of the wrong shape is dropped
rather than stored, and a state that disagrees with the GSTIN registered against
it is named for the desk to settle in Tally. It found four such rows in the
current export and imported all 225 anyway.

## PDF export

The PDF is produced by converting the generated `.docx` — not by rendering the quotation a
second way — so the Word file and the PDF cannot disagree with each other. Two converters are
supported and whichever is present is detected at startup:

| Backend | Notes |
|---|---|
| **LibreOffice** | Headless, cross-platform, no Office needed. Preferred when present, and the only option on a Linux server. |
| **Microsoft Word** | Windows only, needs Office — but it renders a Word document with Word, and needs no administrator rights to set up. |

`/api/health` reports which one is in use. If neither is installed, PDF export switches itself
off cleanly: health reports `degraded`, the Download PDF button is disabled with the reason, and
the endpoint returns a 503 — **the `.docx` download is unaffected.**

Force one with `PDF_BACKEND=libreoffice|word` in `.env`, or point at an unusual install with
`SOFFICE_PATH` / `WINWORD_PATH`.

> Word is driven over COM. Microsoft advise against Office automation on a *server*; for a
> five-person desktop tool it is fine, and every conversion is serialised through one queue
> (see below) rather than run concurrently.

**The PDF is editable** — real text, no encryption, embedded fonts, and a tag tree — and there
are tests asserting each of those rather than the settings that produce them. The one that
matters is `BitmapMissingFonts`, whose Word default is TRUE and means *"if a font cannot be
embedded, draw that text as a picture instead"*: a quotation exported that way has no text at
all, the export still succeeds, and it would happen only for the customers whose document used
the wrong glyph. It is passed `false` explicitly.

Word subsets embedded fonts on PDF export and gives no way to stop it. That is fine here — the
letterhead is Times New Roman and Arial, which every machine already has — and it was measured
rather than assumed; see PROJECT-LOG §9.

## The two people who sign these

| | Rakhi Gupte (`RG`) | Linda D'mello (`LD`) |
|---|---|---|
| Contact | 022-40668809 | 40668803 |
| Email | rakhi.gupte@newtech.in | Linda.pdmello@newtech.**co**.in |
| Closing | call us at 40668812/88 | call us at 40668803/40668888 |

All four differ, the closing line included — it looks like a company constant and is not. Pick
the person with **Prepared by** in the editor and all four follow, because on this document they
are not four facts but one person: a quotation numbered `.../LD/` over Rakhi's direct line is one
neither of them can answer the phone for. Everything the picker sets stays editable.

They live in `SALESPEOPLE` in [shared/company.ts](shared/company.ts); a third person is a data
change. The closing numbers are stored on each quotation, so a number that changes later cannot
rewrite a document already with a customer.

## Layout

```
shared/     the one contract — §4 as Zod, money, financial year, company details
server/     Express, SQLite, the parser, document generation
web/        React, three screens
```

`shared/` is imported by both sides through the `@shared/*` path alias. §4's data model is
declared once there as Zod schemas, which then provide the TypeScript types, validate every
request, and constrain the LLM parser's output.

## Things worth knowing before you change anything

**A customer is a ledger, not a name.** See above. `customers.id` is the
identity and `quotes.customer_id` records it; `lower(name)` was UNIQUE until
004 and the desk's own list cannot survive that. Nothing may collapse two rows
because their names match.

**GST is 18%, one row, always.** The editor's tax dropdown is gone at the desk's request —
both documents they supplied print a single "GST 18%" row whatever the ship-to state.
`computeTotals` still knows how to split it into CGST + SGST and every quotation stores the mode
it was saved with, so putting the control back is a UI change and nothing else. Read the note
beside `GST_RATE_PERCENT` before you do.

**Money is integer paise, everywhere.** Nothing divides by 100 in floating point. `qty × rate`
is an exact integer, so §7's rule — sum the unrounded line amounts, apply tax to the subtotal,
round once — is exactly reproducible. A quotation that is one paisa off is a quotation the
customer's system rejects.

**Amber means "look here", and nothing else.** §9 reserves it. It now marks exactly two things:
a line the parser could not read, and a price that may be superseded. Use it decoratively and it
stops meaning either.

**PDF conversion is serialised on purpose.** Concurrent `soffice` invocations that share a user
profile directory collide — the second exits 0 having written nothing. Word automation is
likewise not built for concurrent use. `server/src/lib/pdf.ts` runs one at a time with an
isolated profile per call, and verifies the output file exists because the exit code does not
prove it. There is a test that fires three conversions at once.

**The document is the letterhead, not an improvement on it.**
`server/scripts/build-template.ts` reproduces `Quotation -- Format.docx`
paragraph for paragraph, and `web/src/components/DocumentPreview.tsx` mirrors
that file so the screen and the download say the same thing. Change one and
change the other. The single deliberate departure is the two blank paragraphs
before the signatory: they are signature whitespace that only fits while the
template is empty, and with five line items they push the name onto a second
page on its own.

**Never name a font in the template builder.** The letterhead's body inherits Times New Roman
from `docDefaults`, and 158 of the original's 166 text runs specify no font at all. Hard-coding
a face silently re-styles the whole quotation the day someone restyles the letterhead — and an
earlier version did exactly that, rendering it in Arial. Run `npm run preview` after any change
to `server/scripts/build-template.ts`.

## Where this departs from PROMPT.md

Each has a regression test. The full reasoning is in [PROJECT-LOG.md](PROJECT-LOG.md).

1. **The letterhead's body lived in a Word text box.** Rebuilt as a real table so docxtemplater's
   row loop is reliable. Header, footer, styles and the logo are copied through byte-identical —
   there is a test asserting exactly that. It also renders in Times New Roman, not Arial: 158 of
   the original's 166 text runs name no font at all.
2. **§7's Make column was added and then removed.** The letterhead has five
   columns and the instruction is to reproduce it, not improve it. The
   "Amount in words" line went the same way, and the tax row says "GST 18%"
   because that is the letterhead's own word — §7 argued for "IGST" on an
   out-of-state sale, which is arguably more correct. The desk has since gone
   further and removed the choice: **one GST 18% row on every quotation**, with
   no dropdown and no rate box, because both documents they supplied print
   exactly that whatever state the customer ships to. §7's CGST/SGST split still
   exists in `shared/money.ts` and nothing selects it.
3. **§6's comparison is gone entirely**, at the desk's request — see the note at the top.
4. **§5's parser assumes one line per item, and real mail does not.** Four threads out of the
   desk's mailbox broke it, and each is now a fixture: a quantity on its own line
   (`Qty- 04nos.`, whose unit defeats §5's trailing ``), an RFQ with no `Qty` keyword at all
   (`4 nos desktop`) and the product *after* the quantity, a forwarded chain whose attachment
   filename and `Total` rows both parsed as products, and a wrapped description whose product
   name sat three lines above its quantity.

Two smaller ones: the provider is Google Gemini, not Anthropic — §2 specified `claude-sonnet-4-6`
and the code moved to `gemini-3.6-flash` with a fallback chain in `server/src/lib/ai.ts`, which is
where the current model is decided rather than here — and the LLM parser uses structured outputs
rather than asking for bare JSON
and stripping fences — the response is constrained to the schema, then validated with the same
Zod schema §5 asked for. §5 puts that button there for "threads the regexes cannot handle —
tables pasted out of Excel"; a forwarded chain carrying several revisions is exactly that.

## Tests

```bash
npm test
```

`server/src/lib/parser.test.ts` is the one to read: it carries four real threads out of the
desk's mailbox, each added after it broke something. `server/src/lib/docx.test.ts` renders §11's
quotation and checks every label and amount against the document Newtech actually sent.
