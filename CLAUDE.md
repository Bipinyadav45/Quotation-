# Instructions for AI assistants

Read this before changing anything. It exists because several rules here look like
preferences and are not — breaking them produces a wrong quotation, and a wrong
quotation goes to a customer on company letterhead.

## What this is

Newtech Quotation Desk. A purchase desk pastes a customer's RFQ email thread into a
box; the app parses it, prices it, and renders a quotation onto the company letterhead
as `.docx` or PDF.

Single npm package. Express 5 API + React 18 SPA + **SQLite** (`better-sqlite3`).
`server/`, `web/` and `shared/` are plain folders joined by the `@shared/*` TypeScript
path alias — **not** workspaces. You cannot build or deploy `server/` without `shared/`.

Production runs **TypeScript directly through `tsx`**. Only the frontend is bundled
(`vite build` -> `web/dist`). There is no server compile step; `tsc` is `--noEmit` and
used only for typechecking.

## The five rules

**1. Money is integer paise. Always.**
Never a float, never a division by 100 in floating point. A quotation one paisa out is
one the customer's system rejects. `shared/` has the helpers — use them.

**2. A customer is a ledger, not a name.**
Fourteen ledgers are spelled some version of "Datamatics Global Services Limited";
seventeen answer to "Morgan Stanley" across 5 GSTINs and 3 states; three Azentio sites
share a name *and* a GSTIN and differ only by address. **Never collapse two rows
because their names match. Never pick one on the desk's behalf.** The ship-to state
decides the tax treatment, so guessing is a silent tax error. See `PROJECT-LOG.md` §8 —
this rule exists because the old code got it wrong.

**3. Migrations are forward-only and never edited.**
To change the schema, add `006_whatever.sql`. Never modify an applied file. There are no
down-migrations; rolling back means restoring a backup.

**4. Never write a secret into the repo.**
`.env` is gitignored and must stay that way. `web/bundle-safety.test.ts` greps the built
frontend for key-shaped strings and will fail the build if one leaks.

**5. Tests must pass before anything is pushed.**
`npm test` — all 444. `main` is protected and CI blocks the merge anyway, but finding
out locally is faster.

## Two things that differ between machines — this has already caused bugs

**PDF conversion has two backends and they behave differently.**
Developer laptops use **Microsoft Word** (Windows, COM). QA and production use
**LibreOffice** (Linux, in the container). They are not interchangeable:

- Word *rejects* a file it cannot open. LibreOffice renders an unrecognised file as
  **plain text** and returns a valid PDF of the raw bytes, exit code 0, no warning.
  `docxToPdf` now checks for the ZIP signature so both fail the same way. Do not
  remove that check.
- `pdf.test.ts` uses `it.runIf(config.pdfBackend)` — **on a machine with no converter
  those tests silently vanish and the suite still passes green.** If you change PDF
  code, verify CI ran them, not just your laptop.

**Conversion is serialised, one at a time, 90s timeout with one retry.** Worst case a
single request holds the queue ~180s. That is deliberate: concurrent LibreOffice calls
sharing a profile silently produce nothing, and Word COM is not concurrency-safe.

## Conventions to match

- **Commit messages**: imperative, and they explain *why*, not what. Look at
  `git log` — "Stop the PDF converter leaking a Word process on every kill" is the
  house style. Not `fix: pdf bug`.
- **Comments explain reasoning, not mechanics.** The codebase comments why a decision
  was made, often with the measurement behind it. Match that. Do not add comments that
  restate the code.
- **No new dependencies without a reason that survives scrutiny.** `xlsx` was rejected
  for being 7 MB with prototype-pollution history; `server/src/lib/xlsx.ts` is ~80 hand-
  written lines over `pizzip`, which was already present. `PROJECT-LOG.md` §2 lists what
  was deliberately not added and why.
- **No ORM, no query builder.** Hand-written SQL against `better-sqlite3`, deliberately.

## Workflow

`main` is protected — you cannot push to it, and neither can an administrator. Every
change goes through a branch and a merge request:

```
git checkout main && git pull
git checkout -b feature/short-description
# work, then
npm run typecheck && npm test
git commit -m "Explain why, in the imperative"
git push -u origin feature/short-description
```

CI runs build -> test -> and on `main`, publish -> deploy to QA. Tests run **inside the
Linux container**, against LibreOffice, not on the developer's Windows machine.

## Useful commands

| Command | What it does |
|---|---|
| `npm run dev` | Server + Vite together, http://localhost:5173 |
| `npm test` | The whole suite (444 tests) |
| `npm run typecheck` | `tsc --noEmit` |
| `npm run migrate -- --check` | Report pending migrations, change nothing |
| `npm run backup` | Safe DB snapshot (**uses `VACUUM INTO` — never copy the .db file**) |
| `npm run build:template` | Rebuild the .docx template from the letterhead |

**Never back up the database by copying `data/quotes.db`.** It runs in WAL mode; the
main file can be 4 KB while `-wal` holds megabytes. A file copy silently backs up
nothing. Use `npm run backup`.

## Before you claim something works

- Run it. `npm test` and `npm run typecheck`, both.
- If you touched PDF code, say plainly that your machine tested Word and CI tests
  LibreOffice.
- If you changed the schema, say a migration was added and that it is forward-only.
- Do not describe a change as verified when you have only read the code.

## Where the reasoning lives

`PROJECT-LOG.md` is an engineering journal, not a changelog — it records why decisions
were made and what was measured. **§10 is a reading order for newcomers.** §8 is the
customer-identity problem. §9 is four changes the desk asked for and what each one
touched.

`README.md` describes the application. `ONBOARDING.md` sets up a new machine.
