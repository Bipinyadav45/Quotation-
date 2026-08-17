# Build prompt — Newtech Quotation Desk

> Paste this whole file into Claude Code in VS Code as the opening instruction, or keep it at the repo root and say: *"Read PROMPT.md and build it. Start with Milestone 1."*

---

## 1. What to build

A web application that turns a customer RFQ **email thread** into a **structured quotation** on Newtech letterhead, and — before it produces anything — shows a **line-by-line reconciliation of what the customer asked for against what we are about to quote**.

The reconciliation is the point of the product, not a nice-to-have. Quotations at Newtech are currently retyped by hand from email threads, and the errors that cost time are silent ones: a cable length changed from 1 mtr to 1.5 mtr, a brand name dropped from a description, a part code lost. Each of those sends the customer's procurement system back for another round. The app must catch them before the document is generated.

Company: Newtech Computer Services Pvt. Ltd., 6th Floor, Solaris-II, Opp L&T Gate-6, Saki Vihar Road, Powai, Mumbai 400072. Tel 022 40668888. CIN U99999MH1984PTC034412.

Users: the purchase desk (2–5 people). Internal tool. Not a public site.

---

## 2. Stack

| Layer | Choice | Why |
|---|---|---|
| Frontend | React 18 + Vite + TypeScript + Tailwind | Fast dev loop, typed line-item model |
| Backend | Node 20 + Express + TypeScript | Same language both sides |
| DOCX generation | `docxtemplater` + `pizzip` on the server | Injects into the **existing** .docx template so the letterhead image, fonts and margins survive untouched |
| PDF | `libreoffice --headless --convert-to pdf` shelled from the server | Optional, for emailing a PDF alongside |
| Storage | SQLite via `better-sqlite3` | Single file, no server to run. Holds quote history and the reference-number counter |
| LLM parsing | Anthropic Messages API, `claude-sonnet-4-6`, server-side only | API key never reaches the browser |

Do **not** generate the .docx in the browser. HTML-with-a-.doc-extension is a demo trick; it cannot carry the letterhead image and Word will flag it. Template injection on the server is the correct approach.

---

## 3. Repository layout

```
newtech-quotes/
  server/
    src/
      index.ts              Express bootstrap
      routes/parse.ts       POST /api/parse
      routes/quote.ts       POST /api/quote, GET /api/quotes, GET /api/quotes/:id
      routes/render.ts      POST /api/render/docx, /api/render/pdf
      lib/parser.ts         deterministic thread parser
      lib/reconcile.ts      request-vs-offer matching and drift detection
      lib/llmParser.ts      Claude fallback parser
      lib/docx.ts           docxtemplater wrapper
      lib/money.ts          Indian formatting + amount in words
      lib/refno.ts          reference number allocation
      db/schema.sql
    templates/
      quotation-template.docx     <- see section 8
  web/
    src/
      App.tsx
      pages/Source.tsx  Reconcile.tsx  QuoteEditor.tsx  Preview.tsx  History.tsx
      components/...
      lib/api.ts  types.ts
  .env.example
  README.md
```

---

## 4. Data model

```ts
type Role = 'request' | 'offer';

interface ParsedLine {
  id: string;
  raw: string;          // the source line, verbatim, for audit
  desc: string;         // description with qty/price stripped
  make: string;         // brand if detected
  partCode: string;     // e.g. BI-TCHUGP, MK540
  qty: number;
  rate: number;         // 0 when absent
  role: Role;
  source: 'pattern' | 'llm' | 'manual';
}

interface Flag {
  kind: 'spec' | 'brand' | 'qty' | 'price' | 'missing' | 'extra' | 'code';
  text: string;
  severity: 'warn' | 'block';
}

interface ReconciledPair {
  request: ParsedLine | null;
  offer: ParsedLine | null;
  score: number;        // 0..1 match confidence
  flags: Flag[];
}

interface QuoteItem {
  desc: string;
  make: string;
  partCode: string;
  hsn?: string;
  qty: number;
  rate: number;         // unit, exclusive of tax
}

interface Quote {
  id: string;
  ref: string;                 // NCS/2026-27/Quotes/RG/031
  date: string;                // ISO
  customer: { name: string; address: string; attention: string; gstin?: string; state?: string };
  contact: string;
  email: string;
  signatory: string;
  items: QuoteItem[];
  tax: { mode: 'IGST' | 'CGST+SGST'; rate: number };
  terms: { payment: string; delivery: string; prices: string; validity: string };
  totals: { sub: number; tax: number; total: number };
  sourceThread: string;        // keep the original email, always
  reconciliation: ReconciledPair[];
  createdAt: string;
}
```

Every quote stores its source thread and its reconciliation result. When a customer disputes a line six weeks later, the audit trail is in the record.

---

## 5. Parsing rules (`lib/parser.ts`)

Split the thread into blocks on `On <Day>, <Mon> <D>, <YYYY> at <time> <addr> wrote:` and on `From:` headers. Note the email address in each block header so we know which side wrote it.

Within each block, a line is a candidate item line if it contains a quantity **or** a price:

- Qty: `/\bqty\s*[-–:.]?\s*(?:nos?\.?\s*[-–:]?\s*)?(\d{1,4})\b/i`
- Rate: `/(?:rs\.?|inr|₹)\s*([\d,]+(?:\.\d{1,2})?)/i`
- Length: `/(\d+(?:\.\d+)?)\s*(?:mtr|mtrs|meter|metre|m)\b/gi`
- Part code: `/\b#?([A-Z]{2,}[-–]?[A-Z0-9]{3,})\b/g`, excluding USB, TYPE, GST, INR

Description = the text before the Qty match, with leading bullets/numbering and trailing `, - :` stripped.

Role assignment: a line carrying a price is an `offer`; a line with only a quantity is a `request`. Cross-check against the block's sender — a priced line in a customer block should be surfaced for manual reassignment rather than silently classified. **The UI must let a user flip any line's role.** Heuristics are a starting position, not a verdict.

Skip lines matching salutations, signature blocks and phone lines: `/^(thanks|regards|dear|hi\b|on\s|from:|sent:|to:|cc:|subject:|tel|did|cell|please call)/i`.

De-duplicate identical raw lines within a role — threads quote themselves repeatedly.

### LLM fallback (`lib/llmParser.ts`)

Exposed as a separate button, never automatic. Server-side call to `claude-sonnet-4-6`, `max_tokens: 2000`, instructed to return a bare JSON array of `ParsedLine` fields with no prose and no markdown fences. Validate the parse with zod before it reaches the client; on validation failure, return the pattern-parser result with a note rather than an error page.

---

## 6. Reconciliation rules (`lib/reconcile.ts`)

Match each `request` to its best unclaimed `offer`:

```
similarity = 2 * |tokens(a) ∩ tokens(b)| / (|tokens(a)| + |tokens(b)|)
             + 0.35 if a shared part code exists
```

Tokens are lowercased alphanumerics of length ≥ 2, minus a stop list (the, and, with, for, set, each, gst, qty, rs, port, ports, type). Accept a pairing at ≥ 0.42; below that the request is reported as **not quoted**. Any leftover offer is reported as **quoted but not requested**.

For each matched pair raise a flag when:

| Condition | kind | severity |
|---|---|---|
| First length value differs between request and offer | `spec` | block |
| A brand present in the request is absent from the offer | `brand` | block |
| Brand differs between the two | `brand` | block |
| A part code in the request is missing from the offer | `code` | block |
| Quantities differ | `qty` | warn |
| Offer has no rate | `price` | block |
| Requested line has no matching offer | `missing` | block |
| Offer has no matching request | `extra` | warn |

`block` severity does not prevent generating the document — it disables the one-click path and requires the user to tick "reviewed" on that line. The purchase desk sometimes upsizes deliberately; the app's job is to make sure it was deliberate.

---

## 7. Quotation rules

**Reference number** — format `NCS/<FY>/Quotes/<initials>/<seq>`, e.g. `NCS/2026-27/Quotes/RG/031`. Financial year runs April to March. Sequence is per financial year, allocated by the server on save, zero-padded to 3. Never allocate on page load; a page opened and abandoned must not burn a number.

**Tax** — Newtech is registered in Maharashtra. Ship-to in Maharashtra → CGST 9% + SGST 9% as two rows. Any other state → IGST 18% as one row. Default the mode from the customer's state and let it be overridden. The current manual quotes just say "GST 18%", which is wrong on the face of it for an out-of-state buyer.

**Rounding** — compute per line as `qty × rate`, sum to subtotal, apply tax to the subtotal, round the total to 2 decimals. Do not round intermediate lines.

**Formatting** — Indian digit grouping throughout (`toLocaleString('en-IN')`): 1,50,000.00, not 150,000.00. Amounts always to 2 decimals. Serial numbers and quantities zero-padded to 2 digits, matching the existing house style.

**Amount in words** — Indian system, crore/lakh/thousand, e.g. "Rupees Thirteen Thousand Five Hundred Seventy Only". Include paise when non-zero.

**Make column** — carry the manufacturer for every line and print it. Customers on Ariba and SAP need the manufacturer name to raise a PR, and if it isn't on the quote they come back and ask, which costs a day. Keep an optional manufacturer-address field for the same reason.

**Terms** — defaults, all editable: payment 100% Advance; delivery 1-2 Weeks after PO; prices All-inclusive as per the quote; validity end of the current month.

---

## 8. Document generation (`lib/docx.ts`)

Take the existing hand-made quotation .docx, delete the body content, and leave docxtemplater tags in place. The header (letterhead image), footer (address / CIN strip), fonts, margins and table borders stay exactly as they are — this is the whole reason for template injection rather than document construction.

Template tags:

```
{ref}  {dateLong}
{customerName}  {customerAddress}  {attention}  {contact}  {email}

table row loop:
{#items}{sr}  {desc}  {make}  {rate}  {qty}  {amount}{/items}

{subTotal}
{#taxRows}{taxLabel}  {taxAmount}{/taxRows}
{grandTotal}  {amountWords}
{payment} {delivery} {pricesTerm} {validity}  {signatory}
```

All numbers are formatted as strings **before** they reach the template — docxtemplater must never see a raw float.

`POST /api/render/docx` returns the file as an attachment named `Quotation-<CustomerFirstWord>-<date>.docx`. PDF endpoint shells LibreOffice on the produced .docx.

Verify the output by converting to PDF and rasterising the first page during development — read the image and confirm the letterhead, the table borders and the totals block all render as they do in the hand-made original.

---

## 9. Screens

**1 · Email thread.** Large monospace textarea. Buttons: Parse thread, Parse with Claude, Clear, Load sample. Optional .eml / .msg upload later.

**2 · Ask vs quote.** Two-column rows, customer on the left, our line on the right, flags beneath in a dashed strip. Each row has a role toggle and a "reviewed" tick. A counter at the top: *N lines · M needing a look*. Two build buttons: **Build with our wording** and **Build with the customer's wording** — the second reuses the customer's descriptions verbatim, which is usually what avoids the round-trip.

**3 · Quotation.** Header fields plus an inline-editable item table with live subtotal, tax rows and total. Add line, delete line, drag to reorder.

**4 · Document.** On-screen render matching the .docx layout, then Download .docx, Download PDF, Copy for Word, Save to history.

**5 · History.** Table of saved quotes: ref, date, customer, total, status. Open a past quote, clone it as the basis for a revision (new ref, `Rev 1` noted), or re-download.

### Look

Internal back-office tool for a 40-year-old infrastructure business, not a SaaS landing page. Cream paper ground, ink-dark text, a single deep-blue accent for navigation and primaries, and an amber reserved exclusively for drift flags — amber must never appear decoratively, so that its presence always means "look here". Monospace for reference numbers, quantities, money and field labels; a serif only inside the document preview so it reads as paper. Dense over airy. No cards with drop shadows, no gradients, no rounded pills.

Keyboard focus must be visible, the whole thing usable at 1280px on the desk machines, and the reconciliation screen legible when printed.

---

## 10. Milestones

1. Repo scaffold, both apps running, `/api/health` green, Tailwind and the palette wired.
2. `lib/parser.ts` + `lib/reconcile.ts` with unit tests against the sample thread in section 11. This is the core; get it right before any UI work.
3. Screens 1 and 2 against the real endpoints.
4. Quote editor with totals, tax mode, reference allocation, SQLite persistence.
5. Template injection and .docx download. Verify the rendered page visually.
6. History, clone-as-revision, PDF, LLM fallback parser.

Write tests as you go for: parser line extraction, Indian number formatting, amount-in-words across crore/lakh boundaries, financial-year reference rollover on 1 April, and every flag type in the section 6 table.

---

## 11. Sample thread — use as the primary test fixture

```
On Fri, Jul 10, 2026 at 5:52 PM rakhi gupte <rakhi.gupte@newtech.in> wrote:
Black i USB-C to USB-A 1.5 mtr, Qty- 02 -  Rs. 550 + gst each
Black i USB-C to USB-C 1.5 mtr,  Qty- 02  - Rs. 850 + gst each
Lightning to USB A 1.5 mtr, Qty- 02 - Rs. 1,250 + gst each
Black i USB Type C Docking Station with USB A and USB C ports - BI-TCHUGP, Qty - 01 - Rs. 2750+ gst each
Logitech Wireless Keyboard and Mouse Set #MK540, Qty- 01 - Rs. 3,450 + gst each

On Fri, Jul 10, 2026 at 1:24 PM <Subhransu.Kar@morganstanley.com> wrote:
Black i USB-C to USB-A 1.5 mtr, Qty- 02
Black i USB-C to USB-C 1 mtr,  Qty- 02
Black i Lightning to USB A 1.5 mtr, Qty- 02
Black i USB Type C Docking Station with USB A and USB C ports - BI-TCHUGP, Qty - 01
Logitech Wireless Keyboard and Mouse Set #MK540, Qty- 01
```

Expected parse: 5 requests, 5 offers, all five pairs matched.

Expected flags — the tests must assert exactly these two:

- Line 2 — `spec`, block: customer asked 1 mtr, quote says 1.5 mtr.
- Line 3 — `brand`, block: make "Black i" dropped from the quoted description.

Expected totals: subtotal 11,500.00 · IGST 18% 2,070.00 · total 13,570.00 · "Rupees Thirteen Thousand Five Hundred Seventy Only".

Customer: Morgan Stanley Advantage Services Pvt Ltd, Campus 8B, Sarjapur, Marathahalli Outer Ring Road, Bengaluru 560103. Attention Mr. Subhransu Kar. Karnataka ship-to, so IGST.

A follow-up in the real thread asked for the manufacturer's address for Ariba — Black i distributes from Bengaluru 560002. That is the case for the make and manufacturer-address fields; treat it as a requirement, not trivia.

---

## 12. Environment

```
ANTHROPIC_API_KEY=      # server only, never exposed to the browser
PORT=4000
DB_PATH=./data/quotes.db
TEMPLATE_PATH=./templates/quotation-template.docx
```

`.env` in `.gitignore`. Ship `.env.example`. No API key in any client bundle, no key in the repo.

---

## 13. Working agreement for Claude Code

- Show the plan for a milestone before writing files, then build it.
- Small commits, one concern each.
- No placeholder or mock data outside tests — wire the real endpoint or leave the button out.
- If a rule in this file turns out to be wrong once you see the real data, say so rather than coding around it.
