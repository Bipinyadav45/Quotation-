## Testing Strategy

**Where we stand today.** 450 tests in 29 files, run by `npm test` (`vitest run`), `environment: 'node'`, `include: ['shared/**/*.test.ts', 'server/**/*.test.ts', 'web/**/*.test.ts']`. No jsdom, no testing-library, no browser driver; no React component is ever mounted. CI runs the suite inside the Dockerfile `test` stage (`node:22-bookworm-slim` + `libreoffice-writer` + `fonts-liberation`, `TZ=Asia/Kolkata`, `PDF_BACKEND=libreoffice`), never on a developer's Windows box — the developer has Word, QA and production have LibreOffice, and they are not the same renderer.

**Run `npm run build` before `npm test`.** On a fresh clone the suite is **red**, not green-with-skips: `web/bundle-safety.test.ts` ends with a non-conditional `expect(built).toBe(true)`. The 450 figure is the count with every gate open; only the **eight converter-gated tests** can vanish quietly (§9). There is no coverage tooling, no linter and no formatter in this repository, and none of the numbers below come from a coverage report.

> `PROJECT-LOG.md` §6 records "122 tests across 11 files" and names `reconcile.test.ts`, `tokenize.test.ts`, `assign.test.ts`, `diff.test.ts`, none of which exist any more. Read §6 as a dated verification record, not as an inventory. This section is the inventory.

### 0. What this section owns, and what it does not

This is a reconciled section. Where a topic belongs to another section it is one line and a link, deliberately — a second copy of a live configuration is how the first drift becomes invisible.

| Owned here | Owned elsewhere — do not restate |
|---|---|
| The test ladder (§2) and how to decide which tests a change needs (§4) | The `test` job, coverage extraction and the no-skips job → **06-cicd.md** |
| "The three that get forgotten" — `routes.test.ts`, `screen-wiring.test.ts`, the migration list (§5) | Coverage floors and the GitLab tier matrix → **06-cicd.md** |
| The self-skip guard inventory (§9) — 8 guard sites, 10 tests | `npm audit` / dependency-scanning **job** → 06-cicd.md; its **policy, cadence and owner** → **09-security.md** |
| The Word-vs-LibreOffice trap, and why the PDF assertions keep it honest (§9) | Production preconditions and blocker zero (TODO-SEC-01) → **09-security.md** |
| Test data management (§7) | Deploy sequence, backup-before-deploy, migration rollback, version bumps → **07-deployment.md**; image retention and the GC window → **08-monitoring.md** |
| The ledger-count discrepancy, until it is resolved (§10, gap 8) | Severity grading of any failure → **08-monitoring.md**, one scale, three levels |
| | Role → GitLab permission matrix and the protected-branch settings → **10-roles.md** §2; issue and MR templates, DoR/DoD → **01-agile.md**; branch naming and commit convention → **03-git.md** |

**Not in force today.** GitLab issues are unused, `.gitlab/` does not exist, no sprint has been run, production is not deployed. Everything below marked **From Sprint 1** describes intended practice, not current practice. Everything unmarked describes the suite as it exists in the repository today.

### 1. What a green pipeline proves, and what it does not

CI runs **all 450 tests on every pipeline**. There is no diff-based selection and none is planned.

> **A feature with zero tests passes green.** CI proves you did not break the 450 things already asserted. It cannot prove your new thing works.

Two paid-for examples of the gap:

- `POST /api/parse/llm` was deleted along with the `/reconcile` route beside it and **stayed gone for a week**. Nothing failed, because the button that calls it is hidden when no API key is set — which it was. That is why `routes.test.ts` now asserts the complete sorted route list. (Its docblock calls it `parse/llm` and the current route list calls it `parse/ai`, because the route was renamed when the AI provider changed. Same disappearance; the current list is authoritative.)
- The Download button rendered from the **saved row** while the preview rendered from the **draft**, so a tax mode changed after the save moved the preview and not the file. A customer received last week's document. Typecheck was green throughout: a dropped property on an object literal compiles.

**How the rule is actually enforced here.** Required-approval counters are Premium; in Free a developer *can* click Approve and it blocks nothing. The protected-branch settings that do the blocking live in **10-roles.md §2**, which also runs the monthly API sweep that verifies they have not drifted — they are not re-copied here. Two consequences of them are what this section leans on:

1. **The pipeline must be green** (`only_allow_merge_if_pipeline_succeeds`). This enforces *no regression*, and nothing else.
2. **Every discussion thread must be resolved** (`only_allow_merge_if_all_discussions_are_resolved`). This is the reviewer's only hard lever.

**State the merge guarantee accurately.** `merge_access_level=40` means **a Developer cannot merge their own work; a Maintainer can, and by convention does not.** `merge_method` is `merge`, and nothing in Free prevents a Maintainer merging their own MR — or prevents an author resolving their own discussion threads. For the two or three people who hold Maintainer, who are the people most likely to be merging, "whoever merges is the reviewer" is a convention, not a control. 10-roles.md owns the headcount and the detective control (the monthly sweep flagging `author.username == merge_user.username`). Do not write anywhere, in this section or another, that a maintainer cannot merge their own branch: it is false, and a false guarantee is worse than a named gap.

Given that, use the one hard lever deliberately:

| To say | Do this | Why it works |
|---|---|---|
| "This behaviour has no test" | Open a **discussion thread** on the diff | An unresolved thread blocks the merge button. This is the enforcement. |
| "Looks fine to me" | Approve, or comment | Advisory only in Free. Blocks nothing. |

Checking that new behaviour has a test is the merging maintainer's job, and an unresolved thread is how that job is made binding — with the honest caveat that on a maintainer's own MR the same person holds both ends of it.

### 2. The test ladder — pick the rung, copy the file

| Truth lives in | Rung | Copy the pattern from | What makes it that rung |
|---|---|---|---|
| A pure function | Unit | `server/src/lib/extractCustomer.test.ts` | `vi.hoisted` + `vi.mock` at the module boundary; `askAi` and `allCustomers` stubbed. **The master is stubbed, not seeded** — "a real table would only put SQL between the question and the answer, and the SQL is tested where it lives." Also `shared/money.test.ts`, `shared/fy.test.ts`, `server/src/lib/similarity.test.ts`, `validity.test.ts`, `refno.test.ts`. |
| SQL, a schema, a constraint | Database | `server/src/lib/priceHistory.test.ts` | Real DB in a `mkdtempSync` temp dir; schema assembled by **`readdirSync` over the whole migrations directory, filtered to `.sql`, sorted** — never a hand-listed subset. `vi.mock('../db/client.js', () => ({ getDb: () => db }))` **before** the top-level `await import`. |
| An HTTP contract, or a refusal | Route | `server/src/routes/quote.customer.test.ts` | Temp-file DB, real `migrate(db)`, `app.listen(0)`, real `fetch` against the assigned port. Same mock-before-`await import` order. Every refusal asserts the table is unchanged, because "the editor greys out its Save button and shows a chooser, and both of those are suggestions: the request is what writes a row." |
| Bytes in the delivered file | Document | `server/src/lib/docx.test.ts`, `server/src/lib/pdf.test.ts` | Unzip with PizZip and assert on `word/document.xml` — text *and* paragraph properties, because "printed nothing" and "printed a blank line" are the same string once tags are stripped. On the PDF side: real text extraction via `pdfjs-dist`, no encryption dictionary, page count. |
| A seam between screen and server | Source-as-text | `web/src/screen-wiring.test.ts`, `server/src/lib/ai.test.ts`, `web/bundle-safety.test.ts`, `server/src/routes/routes.test.ts` | Read the source (or the built bundle) and assert on structure, because the suite runs in node with no DOM and what is guarded — a field lost at a seam — is plain in the source. **Every one carries a self-check** so a regex that stopped matching fails instead of passing: `'no terms found — the regex has lost its footing'`, `'nothing handles a timeout'`, `it('fails loudly if the bundle was never built')`. |
| The rendered page as a picture | **No rung — manual** | `npm run preview` | Renders the DGSL quotation and the real sent document, converts both, rasterises page one of each into `.preview/` (gitignored). It found two defects that every text-extraction test passed: the document ran to **two pages**, and it rendered in **Arial instead of the letterhead's Times New Roman**. |

### 3. The rule, and what actually enforces it

**Every behaviour change adds or updates a `*.test.ts` in the same merge request.**

That rule has stood in this framework with nothing behind it but the phrase "the maintainer who merges it owns that decision". It is machine-checkable, so name the machine:

| Layer | Mechanism | Status |
|---|---|---|
| Machine check | A CI job that runs `git diff --name-only origin/main...HEAD` and fails when the diff touches `server/src/**` or `shared/**` and touches no `*.test.ts`. It has real false positives (a comment change, a pure rename), so it runs as a **warning the reviewer must dismiss in a thread** — and that dismissal is itself recorded, because the thread must be resolved before the merge button unlocks. | **Not built.** The job belongs in `.gitlab-ci.yml`, which 06-cicd.md owns and 02-ai-rules.md puts behind a human gate — no agent adds it unasked. |
| Human check | A checkbox in the MR template: "behaviour changed → a test changed, or say here why not." | **Not built** — there is no `.gitlab/merge_request_templates/`. Template contents are 01-agile.md's. **From Sprint 1.** |
| Enforcement today | The reviewer opens a discussion thread on the diff (§1). | **In force**, and it is the only mechanism that exists right now. It depends entirely on the reviewer noticing. |

Until the first two exist this rule is **enforced by a person, not by the pipeline**. Say that, rather than printing MANDATORY next to something nothing checks.

House conventions, and what breaks without them:

| Convention | What goes wrong otherwise | What checks it |
|---|---|---|
| `describe` = the situation, `it` = the verb phrase completing it. Never "should", never the function name. | A name like `it('returns null')` tells the next reader nothing about which customer case broke. About a third of the suite uses an X-not-Y form (`'is refused, and writes nothing'`, `'rather than guessing'`) so the design decision survives in the name. | **Recommended, reviewer-enforced.** No linter exists, and no rule could judge a sentence. |
| **Assert the database, not the response.** | "A route that answered 200 and wrote nothing would pass." Refusal cases assert nothing was written. | **Reviewer-enforced**, and §4.5 makes it a hard requirement for the money, identity and document changes where it matters most. |
| Custom `expect` message as the second argument, stating the **consequence**. | `expect(text, 'the signature was stranded without its closing')` tells you what the customer sees. `expected true, got false` does not. | **Recommended, reviewer-enforced.** |
| No shared helpers, no `fixtures/`, every file builds its own `db()`. | Duplication is cheaper than a helper that six files depend on and nobody dares change. | **Machine-checkable, and clean today:** `find . -type d -name fixtures -not -path './node_modules/*'` returns nothing. A hit is the failure. |
| No snapshots, anywhere. Explicit expected values. | A snapshot of a wrong quotation is a green test. | **Machine-checkable, and clean today:** `grep -rn "toMatchSnapshot\|toMatchInlineSnapshot\|__snapshots__" --include=*.ts .` returns nothing outside `node_modules`. Belongs in the same warning job as the row above. |

### 4. How to decide which tests are required

This is a **selection procedure**, not a second merge gate. The single merge gate is 01-agile.md's Definition of Done, which cites this section rather than duplicating it.

1. **Write the acceptance criteria first**, as house-style sentences: `describe('a quotation whose ship-to state is unknown') it('is refused, and writes nothing')`. If you cannot phrase it, you do not yet understand the change.
2. **Place each criterion on the ladder (§2) by asking where the truth lives**, not where the code is. A rule the server enforces is tested at the route even when the button also greys out.
3. **Search for existing coverage:** `grep -rl "<exportedSymbol>" --include=*.test.ts .` Zero hits means zero coverage; a hit does not mean *this* behaviour is covered.
4. **Apply §5.** Those are non-negotiable.
5. **Escalate on criticality.** If the change touches integer paise, GSTIN, ship-to state, IGST vs CGST+SGST, ledger identity, reference-number allocation, a migration, or the rendered document, it needs **at least one DB-or-route test asserting the stored row**, plus **one refusal test asserting nothing was written**. Unit tests alone are insufficient: fourteen ledgers spell some version of "Datamatics Global Services Limited", seventeen answer to "Morgan Stanley" across 5 GSTINs and 3 states, and three Azentio sites share a name *and* a GSTIN and differ only by address (the arithmetic is CLAUDE.md's — see gap 8 for the one number still in dispute). The ship-to state picks the tax mode, so a guess is a silent tax error on company letterhead.
   > **State the money rule correctly when you test it.** CLAUDE.md's current wording — "never a division by 100" — is wrong as written and must not be repeated: `shared/money.ts` divides by 100 six times (lines 53, 66, 92, 112, 158, 172), and every one sits inside `Math.floor` or `Math.round`, which is correct integer arithmetic. The rule the tests hold the code to is: **money is stored and compared only as integer paise; a division may appear only where its result is immediately floored or rounded back to an integer; never store, compare, sum or round-trip a fractional rupee.** (`web/src/components/DocumentPreview.tsx` uses `toFixed` for CSS column widths — percentages, not money, and out of scope.) The scoped lint rule that would make this machine-checkable is 06-cicd.md's; a blanket ban on `/ 100` would fail on the very file it is meant to protect, and the first person to run it would switch it off.
6. **Every bug fix gets a test named for the situation that produced it.** Precedents: the vanished parse route → `routes.test.ts`; the download that shipped last week's tax mode → `screen-wiring.test.ts`; concurrent `soffice` sharing a profile directory, where the second call "either hangs or exits 0 having written nothing" → `pdf.test.ts`, which is why `pdf.ts` is a queue and not a function.
7. **Any test that reads source as text, or iterates a schema, asserts that its scan found something.** Without that, the test passes hardest at the moment it stops working. *Reviewer-enforced — no check can tell a deliberate self-check from a coincidence — but every existing source-as-text test carries one, so a new one without it is visibly the odd file out.*
8. **Report honestly.** End by listing which criteria are covered, at which rung, and which are not. Do not imply the suite covers what it does not. *Reviewer-enforced. **From Sprint 1** this belongs in the MR description through the template (01-agile.md).*

### 5. The three that get forgotten

| You changed | What happens | What to do |
|---|---|---|
| Added, removed or renamed an endpoint | `server/src/routes/routes.test.ts` fails — it asserts the complete sorted route list per router (`parseRoutes`, `quoteRoutes`, `renderRoutes`) | Add the line. Do not loosen the assertion; loosening it re-opens the week-long disappearance it was written for. |
| Added a field to `QuoteSchema` / `TermsSchema` / `CustomerSchema` / `QuoteItemSchema` | `web/src/screen-wiring.test.ts` fails — it iterates `Object.keys(QuoteSchema.shape)` and demands every key be in `DOCUMENT_FIELDS` or `NOT_COMPARED` | Classify the field, and add a `MOVED` entry if it reaches the document. The failure message names the unclassified keys. |
| Added a migration | **Nothing fails — that is the trap.** `customers.test.ts` and `importCustomers.test.ts` hard-code `SCHEMA = ['001_init.sql', '002_customers.sql', '003_warranty.sql', '004_customer_identity.sql']`; `server/src/db/cascade.test.ts` reads `001_init.sql` alone. `005_queries_numbers.sql` is invisible to all three. | Convert them to the `readdirSync` pattern in `priceHistory.test.ts`, whose own comment records why: 003 went in and that file "kept passing only because it happens not to touch the term columns — the next migration that does would have failed here for a reason nobody could see from the diff." **Gap — open (§10 gap 1).** |

**The migration trap has a machine check, and it is one grep.** Once the three files are converted, `grep -rn "SCHEMA = \[" --include=*.test.ts .` must return nothing outside `node_modules`; today it returns two hits (`customers.test.ts:20`, `importCustomers.test.ts:24`). It is the cheapest of the checks in this section and the only one with no false positives, so it belongs in the same warning job as §3's.

**A fourth is coming, and the fix lands in this section's territory.** `routes.test.ts` asserts the routes registered on the three **routers**, so anything mounted directly in `server/src/index.ts` — `/api/health`, and any new endpoint added there — sits outside the guard. 09-security.md's rule that no MR may add a route reading or destroying customer data before TODO-SEC-01 closes is leaning on a test that cannot see part of the surface. **Change `routes.test.ts` to assert the routes registered on the app**, not on the three routers. That converts a review instruction into the same deliberate red that already works for router routes. **Gap — open (§10 gap 9).**

Migrations are forward-only and never edited, and there are no down-migrations (CLAUDE.md rule 3). What that means operationally — the backup, the restore, what a rollback does to a migrated schema and to the reference-number counter — is **07-deployment.md**'s, in full and in one place. Do not follow a partial version of it from any other section, this one included.

One migration-runner behaviour is worth knowing here because the database tests depend on it: the runner takes `BEGIN IMMEDIATE` and re-checks `_migrations` inside the lock, because SQLite's default `BEGIN` is DEFERRED — two connections both read the table, both decided a file was pending, and the loser died on `duplicate column name`.

### 6. Which kinds of testing actually exist here

| Kind | Status | Where, and what it is worth |
|---|---|---|
| Unit, database, route | Strong | §2 |
| Contract | Real, two forms | `routes.test.ts` for the HTTP surface (with the `index.ts` hole above); the Zod schemas in `shared/` as the server↔web contract, policed by `screen-wiring.test.ts` iterating `.shape` |
| Negative / refusal | Strong, house rule | Refusals assert nothing was written |
| Edge case | Strong | Paise arithmetic and Indian grouping (`shared/money.test.ts`), FY boundaries on 1 April (`shared/fy.test.ts`), gapless reference series and two-connection allocation (`refno.test.ts`), the Datamatics and Morgan Stanley ledger spellings, three Azentio sites on one GSTIN |
| Regression | Strong | Bug → named test (§4.6) |
| Smoke | In CI only, on `main` | `deploy:qa` asserts the running container is the digest that was tested, then reads `/api/health` from **inside** the container and requires `status === 'ok'`, `checks.database.ok` **and** `checks.pdf.ok`. The mechanics of that job — the second `docker login`, why a job's `127.0.0.1` is the job and not the host, why `docker:29-cli` has no curl — are 06-cicd.md §1's. What matters from a testing standpoint: the Docker `HEALTHCHECK` alone is **not** enough, because it passes on `degraded` deliberately, so a missing converter does not kill the container. **The QA smoke must stay read-only.** A smoke that POSTs and saves a quote writes a row into QA's copy of the 225 real ledgers, which no pipeline will ever correct and nothing backs up; whether that is permitted is a data-protection decision (09-security.md), not a CI one, and it is **undecided** (`_CONFLICTS.md` C6). |
| Visual | Manual, and it has earned its keep | `npm run preview` (§2). Two customer-visible layout defects, both invisible to text extraction. |
| UI | Source-as-text only | No jsdom, no Selenium, no Cypress, and none proposed. This is not a placeholder for a browser suite — the seams that broke were visible in the source, and a driver on a Windows dev box would exercise a renderer nothing ships. |
| E2E | **None automated** | Manual, against QA at `http://192.168.1.40:8081` with the 225 imported ledgers. **Gap: no written script, and nowhere agreed to put one** — `.gitlab/` does not exist, and 01-agile.md owns the template set. Two things make manual E2E on QA hazardous rather than merely untidy: QA has **no authentication of any kind** (TODO-SEC-01, 09-security.md), so "only `deploy:qa` writes to QA" is a convention with no control behind it; and QA is redeployed on every merge to `main`, so the instance you are exercising can be replaced under you mid-verification. |
| Performance | **Effectively none** | `pdf.test.ts` bounds *page count*; its `120_000` and `180_000` are Vitest timeouts, not budgets — **nothing asserts a duration**. The real number is in `pdf.ts`: conversion is serialised, 90 s timeout, one retry, so a single request can hold the queue ~180 s. **Gap: that budget has never been measured on the intended production host**, and cannot be until that host exists — production is not deployed, and the host, its blockers, its ports and its resource limits are 07-deployment.md's. Whoever measures it must measure at production's limits, not QA's: QA runs `--memory=2g --cpus=2.0`, roughly double the intended production container, so "it was fine on QA" tells you nothing about the shape that has to run it. |
| Security | Partial, and narrower in CI than it looks | `web/bundle-safety.test.ts` greps the **built** `web/dist` for key names, key shapes and server-only imports (`better-sqlite3`, `node:child_process`, `x-goog-api-key`). Note the limit: `.env` is `.dockerignore`d, so the "real secret from .env" loop iterates **zero times in CI** — the name and shape checks still run, the value checks are dev-machine-only. **Gap: no dependency or container scanning today.** |

**On GitLab's own scanners, in one paragraph, because the tier matrix is 06-cicd.md §2's.** SAST and Secret Detection **do run** on Free — the analyzers execute and emit a JSON artifact; what Free lacks is the MR security widget, the Security Dashboard and vulnerability tracking over time. Dependency Scanning and Container Scanning are **Ultimate and do not run on Free at all**. Test-coverage visualisation (Cobertura → line-by-line MR diff annotation) is **Free and works**, which is the one row §8 depends on. So dependency checking here must be an ordinary job (`npm audit`, `osv-scanner`), never GitLab's template. The **job** — flags, stage, blocking policy — is 06-cicd.md's; the **triage policy, the cadence and the named owner** of the five open advisories (all transitive through build tooling, untriaged, `PROJECT-LOG.md` §7.6) are 09-security.md's. One note for whoever settles the flags: `--omit=dev` reports zero on exactly those five, which makes the job look like it is working while measuring nothing.

### 7. Test data management

- **No `fixtures/` directory, and none is to be added.** No shared helpers. Every file builds its own `db()`. Duplication is accepted; coupling between test files is not. *(Machine-checkable — §3.)*
- **File-local typed constants:** `DRAFT` in `quote.customer.test.ts`, `const QUOTE: Quote` in `pdf.test.ts`, `const SAVED: Quote` in `screen-wiring.test.ts`.
- **Small factories with `Partial<T>` overrides:** `const read = (over: Partial<ExtractedCustomer> = {}) => ({ ...defaults, ...over })`, `screenFor(quote)`.
- **Real artifacts beat fakes.** `importCustomers.test.ts` reads the actual Tally export at `Resources/List of Sundry Debtors with address and GSTIN.xlsx`; **33 tests depend on that file**, which is why both `.gitignore` and `.dockerignore` carry comments saying it is deliberately *not* excluded — excluding it would make those tests fail or silently skip in CI. A hand-built fixture would not carry Tally's `\x04` before "Not Applicable", the addresses flattened into one cell, or a GSTIN with a trailing carriage return. `docx.test.ts` reads the Morgan Stanley quotation the desk actually sent, and `render-preview.ts` the DGSL one.
- **Missing reference files throw, they do not skip.** `docx.test.ts` is the pattern: `if (!existsSync(SAMPLE_DOCX)) throw new Error(...)`. Same principle as §9 — a precondition that disappears must be loud.
- **Never seed a test with a real GSTIN belonging to a customer the test is not about.** *Reviewer-enforced, and unavoidably so: the reference artifacts above are full of real GSTINs, so any grep strict enough to catch a misuse would flag the fixtures we deliberately keep. The reviewer's question is "why is this ledger in this test?"*
- **Never point a test at QA.** Tests build their own database in a `mkdtempSync` temp directory; nothing in the suite may open `quotation_qa_data` or `http://192.168.1.40:8081`. Nothing prevents it — QA is unauthenticated — so this is a reviewer check with one cheap tripwire: `grep -rn "192.168.1.4" --include=*.test.ts .` returning a hit is a defect.

### 8. Coverage — a gap, and the reasoning that must survive it

`@vitest/coverage-v8` is **not installed** and `vitest.config.ts` has no `coverage` block. There is no coverage measurement of any kind today.

**The job that adds it, the extraction mechanics and the coverage policy are 06-cicd.md §8's** — one `test` job, defined in one place. This section previously carried a competing YAML block; it is removed rather than reconciled, because two sections rewriting the same job is how the first one to land makes the second unmergeable. What survives here is the reasoning, which is this section's to give.

**Format: Cobertura.** MR coverage visualisation is available on Free and annotates the diff line by line, which answers the one question review actually needs: *which lines this MR added are untested.* That matters more here than in most projects, because in Free the reviewer is the enforcement (§1), and today the reviewer has no view of it at all.

**No project-wide percentage threshold**, for reasons rather than squeamishness:

1. Large parts of the tree — every React component, `server/scripts/*`, the `index.ts` wiring — are unreachable without jsdom, so a global number would measure the absence of jsdom, not risk.
2. The source-as-text guards *read* files rather than execute them, so `screen-wiring.test.ts` and `ai.test.ts` score near zero while providing real protection. A threshold punishes them.
3. A threshold produces tests written to move a number.

None of those three objects to a **per-directory floor on the code where a regression is a tax error** — 06-cicd.md's `shared/money.ts` and `shared/fy.ts` at 100 %, `server/src/lib/` at 85 %, set only after the number has been published for four weeks. A floor on `money.ts` is not a number to chase; it is the tax code, it is fully unit-testable with no jsdom anywhere near it, and objections 1–3 do not reach it. Judge everything else per diff, in review.

**Three traps found while drafting the extraction, handed to 06-cicd.md rather than re-litigated here.** The exit code must be captured — `docker start -a "$CID" || STATUS=$?`, never `;` — because the runner aborts the job on the first failing command and a failing run's coverage is the interesting one. The report must be copied out **before** `docker rm`, and `docker run --rm` destroys it outright. And the paths inside the report are container paths rooted at `/app`, which is the first thing to check when the MR diff shows no annotations — not the reporter. A bind mount is not a shortcut past any of it: the runner is socket-bound to the host daemon, so the path the runner passes is resolved by the **daemon**, not by the job container — the same class of mistake as the job's `127.0.0.1`. `@vitest/coverage-v8` goes in `devDependencies`, pinned to the vitest 2.x line, so `npm ci` puts it in the build stage that the test stage inherits.

### 9. A skipped test in CI is a failure

This section owns the guard inventory. Verified against the source: **8 guard sites covering 10 test cases.**

| File | Guard | Tests it can remove | Of that file's total |
|---|---|---|---|
| `server/src/lib/pdf.test.ts` | 3 × `it.runIf(hasConverter)`, 2 × `it.runIf(config.pdfBackend)`, 1 × `describe.skipIf(!hasConverter)` over 3 tests | 8 | 10 |
| `web/bundle-safety.test.ts` | 2 × `it.runIf(built)` | 2 | 3 |

(`hasConverter` is `config.pdfBackend !== null` — the same condition spelled two ways in one file. Worth collapsing.)

The two files behave differently, and the difference is the whole point:

- **`bundle-safety.test.ts` is already backstopped.** Its third test, `it('fails loudly if the bundle was never built')`, is a non-conditional `expect(built).toBe(true)`. Without `npm run build` the suite is **red**, not green-with-skips. Those two gated tests cannot vanish quietly.
- **`pdf.test.ts` is not.** Its eight gated tests **vanish rather than fail**, and the suite still reports green.

On a developer machine the vanishing is correct: a laptop with no converter should not have a red suite. **In the test image every precondition holds** — the stage installs `libreoffice-writer`, pins `PDF_BACKEND=libreoffice`, and inherits `npm run build`, so `web/dist` exists. Therefore **a skip in CI means a guard stopped guarding**, which is exactly the failure these tests were written to catch. How such an event is graded when it happens is 08-monitoring.md's severity scale, not this section's; what this section asserts is that it is a red pipeline wearing green, and never a cosmetic finding.

**The mechanism is 06-cicd.md's `test:no-skips` job**, which fails when the JUnit XML contains any `<skipped` element, and also when the artifact is missing or holds zero test cases — so a job that never ran cannot pass it. This section previously proposed a `throw` at the top of `pdf.test.ts` instead; that version is withdrawn. Reading JUnit is better in three ways: it covers every file rather than the one we remembered to edit; it cannot be defeated by a future `it('… skipped …')` the way a `grep -q skipped test.log` can; and it does not require editing the guarded test file itself, which 02-ai-rules.md puts behind a human gate along with `.gitlab-ci.yml`. **Not in force: neither the job nor JUnit output exists today.** Until it does, "verify CI ran the PDF tests, not just your laptop" is a reviewer instruction — CLAUDE.md already says it for PDF changes — and nothing more. Do not replace it with a hand-declared skip count in an MR description: a human stating a number they did not measure is how a checklist item gets pasted without being performed.

**Why these particular eight are the ones you cannot afford to lose.** Word *rejects* a file it cannot open; LibreOffice renders unrecognised bytes as **plain text** and returns a valid PDF of them, exit 0, no warning. `server/src/lib/pdf.ts` closes that: `looksLikeDocx` is defined at line 387 and called from `docxToPdf` at line 398 — which settles the two different line numbers quoted elsewhere in this framework — so both backends now fail the same way, loudly, before conversion starts. The PDF tests are what keep that check honest. The same tests are the only thing asserting the PDF is real text rather than a picture of one: Word's `ExportAsFixedFormat` defaults `BitmapMissingFonts` to true, and a bitmapped quotation has nothing to select, search or copy, with no error to notice, for only the customers whose document happened to use the wrong glyph. If those tests silently stop running, nothing else notices before the customer does.

This is the one place in the framework that explains that trap. Other sections keep the one-line obligation — say plainly which backend your machine exercised — and link here for the reason.

### 10. The open gaps, in one place

| # | Gap | What it leaves open | Owner |
|---|---|---|---|
| 1 | Three test files freeze the migration list (`customers.test.ts`, `importCustomers.test.ts`, `cascade.test.ts`) | `005_queries_numbers.sql` is untested by all three. The next migration that touches their columns passes CI and fails in QA. Fix: the `readdirSync` pattern, then the `SCHEMA = [` grep (§5). | 05-testing |
| 2 | `pdf.test.ts` can lose 8 assertions to a skip and still report green | A converter missing from the image removes them silently, and the LibreOffice plain-text PDF reaches a customer. | Mechanism: 06-cicd (`test:no-skips`). This section states the requirement and owns the inventory. |
| 3 | No coverage tooling at all | The reviewer, who is the only enforcement in Free, has no view of which new lines are untested. | 06-cicd (job and floors); §8 here for the reasoning |
| 4 | No manual QA script, and no `.gitlab/` templates directory to hold one | E2E is whatever the merging maintainer remembers to click on QA. | 01-agile owns the template set; the script content is this section's to write. **From Sprint 1.** |
| 5 | No dependency or container scanning; GitLab's are Ultimate | 5 `npm audit` advisories, untriaged, with nobody watching for a sixth. | Job: 06-cicd. Policy, cadence and named owner: 09-security |
| 6 | Nothing measures the PDF budget on the intended production shape | 90 s + one retry (~180 s worst case) is unvalidated, and QA at 2g/2cpu is not that shape. | 07-deployment owns the host and the limits; the measurement itself is a testing task |
| 7 | `PROJECT-LOG.md` §6's test table is stale (122 tests, 11 files, four files that no longer exist) | A new developer reads it as the inventory and hunts for tests that were deleted. The log is append-only, so the correction is a new dated entry pointing here — never an edit to §6. | 05-testing (this section is the inventory) |
| 8 | `quote.customer.test.ts:22` says "sixteen spellings of Datamatics"; CLAUDE.md says fourteen | One of them is wrong, in the docstring for the rule that prevents a silent tax error. CLAUDE.md owns the arithmetic; this section owns the discrepancy until someone counts the ledgers and corrects whichever is wrong. | 05-testing, until resolved |
| 9 | `routes.test.ts` guards the three routers, not the app | Anything mounted in `index.ts` — `/api/health`, and any new route added there — sits outside the guard that 09-security.md's "no new data-reading route before TODO-SEC-01" rule depends on. | 05-testing |
| 10 | The grep-shaped checks in §3 and §5 (behaviour-change-without-test, no snapshots, no frozen `SCHEMA` list, no QA address in a test) have no job to live in | They stay reviewer-enforced, and reviewer-enforced rules degrade quietly. | 06-cicd owns `.gitlab-ci.yml` and the order edits land in; this section owns the check definitions above |

**Blocker zero, so nobody reads the list above as complete.** Production does not deploy while the application has no authentication: TODO-SEC-01 is open, all 16 routes are public, including a `GET /api/customers` that returns 225 real ledgers with GSTINs and addresses and an unauthenticated `DELETE /api/quotes/:id`. The full production precondition list is **09-security.md**'s; the host, its RAM blocker, the port and the deploy sequence are **07-deployment.md**'s. No amount of closing testing gaps closes that one, and a test suite cannot substitute for it.
