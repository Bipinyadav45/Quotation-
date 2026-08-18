# Newtech Quotation Desk

Turns a customer RFQ email thread into a quotation on Newtech letterhead — and, before it
produces anything, shows a line-by-line reconciliation of what the customer asked for against
what we are about to quote.

The reconciliation is the point. Quotations here are retyped by hand from email threads, and
the errors that cost time are silent ones: a cable length changed from 1 mtr to 1.5 mtr, a
brand dropped from a description, a part code lost. Each of those sends the customer's
procurement system back for another round.

Built to [PROMPT.md](PROMPT.md).

## Running it

```bash
npm install
cp .env.example .env      # fill in ANTHROPIC_API_KEY if you want the Claude parser
npm run build:template    # rebuilds the .docx template from the letterhead
npm run dev               # http://localhost:5173
```

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

## Layout

```
shared/     the one contract — §4 as Zod, money, financial year, company details
server/     Express, SQLite, the parser, the reconciler, document generation
web/        React, five screens
```

`shared/` is imported by both sides through the `@shared/*` path alias. §4's data model is
declared once there as Zod schemas, which then provide the TypeScript types, validate every
request, and constrain the LLM parser's output.

## Three things worth knowing before you change anything

**Money is integer paise, everywhere.** Nothing divides by 100 in floating point. `qty × rate`
is an exact integer, so §7's rule — sum the unrounded line amounts, apply tax to the subtotal,
round once — is exactly reproducible. A quotation that is one paisa off is a quotation the
customer's system rejects.

**Amber means "look here", and nothing else.** §9 reserves it for drift flags. If you reach for
`drift-*` in Tailwind and you are not rendering a `Flag`, you are about to cost that colour its
meaning.

**PDF conversion is serialised on purpose.** Concurrent `soffice` invocations that share a user
profile directory collide — the second exits 0 having written nothing. Word automation is
likewise not built for concurrent use. `server/src/lib/pdf.ts` runs one at a time with an
isolated profile per call, and verifies the output file exists because the exit code does not
prove it. There is a test that fires three conversions at once.

**Never name a font in the template builder.** The letterhead's body inherits Times New Roman
from `docDefaults`, and 158 of the original's 166 text runs specify no font at all. Hard-coding
a face silently re-styles the whole quotation the day someone restyles the letterhead — and an
earlier version did exactly that, rendering it in Arial. Run `npm run preview` after any change
to `server/scripts/build-template.ts`.

## Where this departs from PROMPT.md

Four places, each with a regression test. The full reasoning is in the plan; the short version:

1. **The letterhead's body lived in a Word text box.** Rebuilt as a real table so docxtemplater's
   row loop is reliable. Header, footer, styles and the logo are copied through byte-identical —
   there is a test asserting exactly that.
2. **§7's Make column** takes the item table from five columns to six.
3. **§6's tokenizer discarded the differences it exists to catch.** `USB-C` became `usb` and
   `1.5` vanished entirely, so near-identical cable variants all scored 1.0 against each other
   and pairing fell to iteration order. Hyphenated compounds and number+unit now survive, and
   pairing uses optimal assignment rather than greedy — checked against brute force.
4. **§6 required brand flags but §5 never defined brand extraction.** "Black i" is two words
   with a lowercase second token; no capitalisation heuristic finds it. There is a `makes` table
   instead, which also carries the manufacturer address §11 needs for Ariba.

Two smaller ones: the model is `claude-sonnet-5` (§2's `claude-sonnet-4-6` still works but is a
generation behind), and the LLM parser uses structured outputs rather than asking for bare JSON
and stripping fences — the response is constrained to the schema, then validated with the same
Zod schema §5 asked for.

## Tests

```bash
npm test
```

The one that matters most is `server/src/lib/reconcile.test.ts`: §11's thread, five requests,
five offers, and **exactly two flags** — the 1 mtr / 1.5 mtr length change on line 2 and the
dropped "Black i" on line 3. `server/src/lib/docx.test.ts` renders that quotation and checks
every label and amount against the document Newtech actually sent.
