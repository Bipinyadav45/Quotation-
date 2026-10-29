## Mandatory Rules for AI Coding Agents

These rules bind any AI coding assistant working in `newtech/quotation-desk`, and the developer driving it. They are written as instructions **to the agent**. Claude Code reads `CLAUDE.md` (6 KB, at the repo root) automatically; every other assistant must be handed it before the first prompt of a session.

This ruleset is stricter than most because the output of this application is a **tax document printed on company letterhead and sent to a customer**. The ship-to state decides IGST versus CGST+SGST, so a plausible-looking guess is a silent tax error, not a UX shortcut. Every rule below cites the file, test or commit that paid for it.

### How to read the labels — and why they exist

A rule marked mandatory with nothing behind it teaches the reader that the whole list is optional. So every rule below carries the mechanism that actually catches it:

| Label | What stands behind the rule |
|---|---|
| **[machine]** | A command, test or server setting fails. Named inline, with the command you can run yourself. |
| **[reviewer]** | Nothing automated. The enforcement is the merging maintainer opening a discussion thread — the one gate GitLab Free really gives us. Becomes a checkbox when `.gitlab/merge_request_templates/` lands (**01-agile.md** owns the template inventory and its capitalisation). |
| **[recommended]** | No mechanism exists and none is proposed. Honest advice, not a rule. |
| **[from Sprint 1]** | Not in force today. Described so it is ready, not because it binds you now. |

**What is not in force today, and must not be written about as if it were:** GitLab issues exist and are unused, so there is no issue to link (**01-agile.md**); there is no `.gitlab/` directory, so no MR template and no checkbox; there is no linter, no formatter and no coverage tooling; no CI job checks skips, coverage, dependencies or secrets; production is not deployed (**07-deployment.md** §Status); and the application has **no authentication at all** (**09-security.md** §0, TODO-SEC-01 — blocker zero for production).

### 0. Before the first edit of a session

1. **Read `CLAUDE.md`.** [recommended] Five rules, two machine differences, one workflow. Nothing below replaces it — with one exception: **`CLAUDE.md` rule 1 is worded wrongly.** It says "never a division by 100", and `shared/money.ts` divides by 100 six times. Use §1 of this document for the money rule until `CLAUDE.md` is corrected.
2. **Branch before you commit.** [machine] `main` is protected: the server rejects the push and an administrator cannot override it. Work committed onto a local `main` cannot be pushed and has to be rebased onto a branch before it exists anywhere but your laptop. Branch naming and commit-message convention: **03-git.md**. The live protected-branch settings live in one place — **10-roles.md** §2 — and are not copied here.
3. **Build before you test.** [machine] `npm run build && npm run typecheck && npm test`. Without `web/dist` the suite is **red**, not green-with-skips: `web/bundle-safety.test.ts`'s third test is a non-conditional `expect(built).toBe(true)` with the message *"web/dist is missing — run `npm run build` before trusting the bundle-safety tests"*. Only the converter-gated tests vanish quietly (**05-testing.md** §9).
4. **For anything larger than a one-file fix, read `PROJECT-LOG.md` §10** (a five-item reading order), **§8** (why a customer is a ledger), **§2** (dependencies deliberately not added). [recommended] §10 warns that its own file names have drifted — `similarity.ts` was `tokenize.ts` — so trust the code over the list.
5. **Establish which PDF backend your machine has** before touching anything under `server/src/lib/pdf.ts`: `hasConverter = config.pdfBackend !== null`. [machine, by consequence] Word on Windows, LibreOffice in the container. They disagree; **05-testing.md** owns the explanation, and §5 below owns what you must say about it in the MR.

### 1. Do not invent business behaviour

The application refuses rather than guesses. So do you.

| Situation | What the app does, and where | What an agent must not do | Enforcement |
|---|---|---|---|
| A pasted RFQ names a customer matching several ledgers | Refuses, **writes nothing**, and returns the candidate ledgers plus a chooser — `server/src/routes/quote.customer.test.ts`, `describe('a quotation whose customer could be several ledgers')`, `it('names the ledgers rather than saying "please select a customer"')` | Pick "the best match". A customer is a ledger, not a name (`CLAUDE.md` rule 2 owns the arithmetic; **05-testing.md** owns the drift between its count and the test's) | [machine] — that test |
| Money anywhere | Integer paise, through `shared/money.ts` (`parseRupeesToPaise`, `lineAmountPaise`, `computeTotals`, `formatPaise`) | Store, compare, sum or round-trip a fractional rupee. See the box below — the blanket "never divide by 100" you may have read elsewhere is wrong | [reviewer] today; the lint rule is **06-cicd.md**'s to add |
| The request is under-specified | Ask **one** concrete question and stop | Choose a default and mention it in passing. The house pattern for uncertainty is a refusal that names the options, not a silent decision | [reviewer] |
| A route would read or destroy customer or price data | Refuse to add it. All 16 routes are public today — including `GET /api/customers` (225 real ledgers with GSTINs and addresses) and an unauthenticated `DELETE /api/quotes/:id` | Add one and note the risk in passing. TODO-SEC-01 is blocker zero — **09-security.md** §0 owns the gate | [reviewer], and weakly: `routes.test.ts` asserts the three **routers**, so anything mounted straight onto the app in `server/src/index.ts` (as `/api/health` is) fails nothing |
| You spot a second bug while fixing the first | Say so in the MR and leave it | Fold it in. The MR squashes to one commit whose subject is the *why* sentence — scope creep makes that subject a lie and leaves nothing separately revertable, and the source branch is deleted on merge | [reviewer] |
| You changed a seam — the `@shared/*` alias, `server/src/db/migrate.ts`, the PDF queue, the parse pipeline | Explain it in prose in the MR description, before the diff | Leave it to be discovered in review | [reviewer] — and note the limit: unresolved discussions do block the merge, but **nothing stops the author resolving their own thread**, so this gate is only as strong as the person holding it |

> **The money rule, stated correctly.** Money is stored and compared **only as integer paise**. A division may appear **only** where its result is immediately floored or rounded back to an integer. `shared/money.ts` does exactly that at lines 53, 66, 92, 112, 158 and 172 — every one inside `Math.floor` or `Math.round` — and every one of them is correct. Never store, compare, sum or round-trip a fractional rupee. A quotation one paisa out is one the customer's system rejects.
>
> **Scope of the ban:** `/ 100`, `toFixed(`, `parseFloat(` are forbidden in `server/src/**` and `shared/**` **except `shared/money.ts`**. `web/src` is excluded — `web/src/components/DocumentPreview.tsx` uses `toFixed(2)` for CSS column widths, which is a percentage, not money.
>
> **Check it yourself before you push** [reviewer, with a command]:
>
> ```
> git diff origin/main...HEAD -- server/src shared | grep -nE '^\+.*(/ *100|toFixed\(|parseFloat\()'
> ```
>
> Any hit outside `shared/money.ts` must be explained in the MR description. The equivalent `no-restricted-syntax` ESLint rule passes clean on today's tree; adding it (and ESLint) is **06-cicd.md**'s job to define, not yours to install.

### 2. Inspect before creating; never reach for npm first

- `server/src/lib/xlsx.ts` is ~80 hand-written lines over `pizzip` (already a dependency) rather than a spreadsheet package. Running `npm install xlsx`, `exceljs` or any spreadsheet library breaks this rule outright. The precedent, and the fields a dependency MR must carry, belong to **09-security.md** §3.
- No ORM, no query builder. Hand-written SQL against `better-sqlite3`.
- **A new dependency needs explicit developer approval before install.** [reviewer] `PROJECT-LOG.md` §2 records what was refused and why. The detection is trivial and worth doing by hand: `git diff --name-only origin/main...HEAD | grep -E 'package(-lock)?\.json'` — if that prints anything, the MR description must carry the **09-security.md** §3 fields.
- Do not refactor or reformat files you were not asked to touch. [reviewer] There is **no ESLint and no Prettier in this repo** (§8), so a reformat is not a no-op: it is unreviewable diff noise with no tool to arbitrate it, in an MR a maintainer has to read line by line.

### 3. Tests: generate them, never weaken them

**Production code and its tests land in the same commit.** [reviewer today] The check that would make this machine-enforced does not exist yet: compare `git diff --name-only origin/main...HEAD` and fail when it touches `server/src/**` or `shared/**` without touching any `*.test.ts`. It has false positives (a pure comment change), so it belongs in CI as a warning the reviewer dismisses in a thread — defining it is **06-cicd.md**'s job. Until it lands, run the diff yourself and say in the MR which behaviours you added tests for.

Match the house form exactly — the ladder, the file to copy for each rung, and the naming and assertion conventions are **05-testing.md** §2. Two house rules an agent gets wrong most often, kept here because they change what you write rather than where you put it: assert the **database**, not the response (*a route that answered 200 and wrote nothing would pass*), and give `expect` a second-argument message stating the **consequence**, e.g. `` `a changed ${field} goes unnoticed, so the download stays the older document` ``.

`vitest.config.ts` sets `environment: 'node'` and includes only `shared/**`, `server/**`, `web/**` `*.test.ts`. There is no jsdom, no testing-library, no browser driver, and no React component is ever rendered. Screen guards read the **source as text** instead — `web/src/screen-wiring.test.ts` says why in its header. Do not propose jsdom, Playwright, Cypress or any E2E layer.

**When the suite goes red:**

| Symptom | What it actually means | Forbidden |
|---|---|---|
| `routes.test.ts` fails after you added an endpoint | Working as designed — a deliberate breaker. **05-testing.md** §5 owns the explanation | Relaxing `toEqual` to `toContain` or `arrayContaining`. Add your route to the right array |
| `screen-wiring.test.ts` fails after you added a schema field | Working as designed — the other deliberate breaker. **05-testing.md** §5 | Adding your field to `NOT_COMPARED` to go green. Classify it honestly and wire it through the preview and the download |
| A source-as-text guard passes suspiciously fast | Each carries a self-check — e.g. `screen-wiring.test.ts:91`, `expect(printed.length, 'no customer fields found — the regex has lost its footing').toBeGreaterThan(2)` | Deleting the self-check. It is the only thing stopping the guard passing on zero matches after a rename |
| `looksLikeDocx()` in `server/src/lib/pdf.ts` looks redundant | It is not: the two PDF backends fail differently, and this is the check that makes them fail the same way. **05-testing.md** owns the Word-vs-LibreOffice explanation | Removing it, or the `PK` signature check behind it |
| PDF tests are slow | Conversion is serialised: 90 s timeout, one retry, worst case ~180 s. Test timeouts of `180_000` / `300_000` are deliberate. Concurrent `soffice` calls sharing a profile exit 0 having written nothing | Reducing a timeout, or `.skip` |

**Diagnose; never disable.** [reviewer] You may not delete, `.skip`, `.todo`, `.only`, weaken an assertion or relax an expected value to make a pipeline green. If a test is genuinely wrong, say in the MR *why the old expectation was wrong* and let a human decide. A grep the reviewer can run: `git diff origin/main...HEAD | grep -nE '^\+.*(\.skip|\.only|\.todo|runIf|skipIf)'`.

**The self-skipping guards are not yours to touch or to extend.** 8 guard sites covering 10 test cases; **05-testing.md** §9 owns the inventory and the "a skip in CI is a failure" rule. Consequences you own:

- Run `npm run build` before `npm test` (§0.3) — otherwise the suite is red, and if you force past it nothing checked the built bundle for the real key values read out of `.env`.
- Inside the container every converter precondition holds, so a skip in CI means a guard stopped guarding — treat it as a failure and report it. The `test:no-skips` job that would catch this automatically is **06-cicd.md**'s to add; today it is your report and the reviewer's eyes. [reviewer]
- Never add a new `runIf` / `skipIf`. [reviewer]
- Never claim PDF work is verified from a Windows run: **your machine tested Word, CI tests LibreOffice, and they disagree.** [reviewer — see §5]

### 4. Migrations, backups and the data files tests depend on

Forward-only. To change the schema add `server/db/migrations/006_*.sql`; never edit `001_init` … `005_queries_numbers`, and never write a down-migration. What rollback then means operationally — the pre-deploy backup, the forensic copy, the restore, and the reference-number hazard it creates — is **07-deployment.md** §Rollback. Do not restate it and do not invent a shortcut around it.

- Do not "simplify" `BEGIN IMMEDIATE` plus the re-check inside the lock in `server/src/db/migrate.ts`. SQLite's default `BEGIN` is DEFERRED: two connections both read `_migrations`, both decide a file is pending, and the loser dies on `duplicate column name`.
- Verify with `npm run migrate -- --check` — reports, changes nothing. [machine]
- **Never edit an applied migration.** [reviewer, with a command] Nothing checks this today; the check is one line and the reviewer should run it: `git diff --diff-filter=M --name-only origin/main...HEAD -- server/db/migrations/` must print nothing. Turning that into a job is **06-cicd.md**'s call.
- Back up with `npm run backup` (`VACUUM INTO`). **Never `cp data/quotes.db`** — `CLAUDE.md` rule 4 owns the reason, **07-deployment.md** owns the procedure and the destination. Neither is re-derived here.
- **Never gitignore or delete `Resources/List of Sundry Debtors with address and GSTIN.xlsx`.** [machine] 33 tests in `server/src/lib/importCustomers.test.ts` read that real export — Tally's `\x04` before "Not Applicable", addresses flattened into one cell, a GSTIN with a trailing carriage return. The file is read at module scope (`const SHEET = readFileSync(FILE)`), so removing it makes the whole suite **error at collection with ENOENT** — loudly, not silently. The forbidden "fix" is stubbing the fixture or excluding the test file to get green; the reasoning is written into `.gitignore` itself.

### 5. Risks to state in the MR description, unprompted

The single merge gate is **01-agile.md**'s Definition of Done [from Sprint 1 — no template exists, so nothing collects these today]. This section is not a second gate: it is the short list of disclosures specific to an AI-written change, and the reviewer asks for them until a template checkbox does.

| Risk | The specific thing to say | Enforcement |
|---|---|---|
| Secrets | `.env` is gitignored and stays that way; `web/bundle-safety.test.ts` greps `web/dist` for `GEMINI_API_KEY` / `ANTHROPIC_API_KEY`, for key-shaped literals, and for the **actual values** parsed out of `.env` — but only after `npm run build`. No scanning of any kind runs in this pipeline today (§8) | [machine] for the bundle, once built; [reviewer] for everything else |
| Performance | Production is **not deployed**, and the intended production container is deliberately *tighter* than QA's — so "it was fine on QA" is not evidence it fits production. The host, the blockers and the resource limits are **07-deployment.md** §Status and §The production deploy job. Do not restate the numbers; do state that you have not measured on the target | [reviewer] |
| Compatibility — PDF | One line, in words: *"my machine tested Word; CI tested LibreOffice."* There is no automated check and CI cannot know what ran on a laptop, so the honest statement of enforcement is: **the reviewer asks** | [reviewer] |
| Compatibility — PowerShell | Any `.ps1` you write — `setup-workstation.ps1` from `ONBOARDING.md` is the live example — must be **ASCII-only**: PowerShell 5.1 cannot read a BOM-less UTF-8 file, and this is the first command a new developer runs on a machine with nothing installed. Honest gap: that script is handed over out of band and is **not in the repository**, so no reviewer sees it, no job lints it and no test runs it | [recommended] until the script is version-controlled |
| Whether you built | Now decidable, so say it and mean it: `npm run build && npm run typecheck && npm test` | [machine] — the suite is red without `web/dist` |

### 6. Declaring AI assistance

**Commits.** [reviewer, with a command] Keep the trailer already in use — 50 of the 61 commits in `git log` carry it (the rest are mostly GitLab merge commits):

```
Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>
```

Last line of the body, blank line before it. Countable before you push: `git log origin/main..HEAD --format=%b | grep -ci co-authored-by`, against your commit count. Subject-line style and the ban on `feat:` / `fix:` prefixes belong to **03-git.md** §Commit messages — follow it there; the trailer is the only part this section owns. It is git-native and invisible in `git log --oneline`, which is why it survives the squash without polluting the history.

**Merge requests.** [reviewer] One line: `AI assistance: <what the agent did> / <what the human verified by running it>`. There is no `.gitlab/` directory and no MR template, so this line is typed by hand and is easy to forget. **01-agile.md** owns the template inventory that will eventually carry it as a checkbox [from Sprint 1].

**Never claim you ran something you did not.** Run `npm run build && npm run typecheck && npm test` (450 tests, 29 files) and say so, or say plainly that you only read the code — and if your local run reports skipped tests, report the skip count too.

### 7. Stop List — never, without explicit developer approval

| Never | Because | Enforcement |
|---|---|---|
| `npm install` anything | The dependency bar, and the fields a dependency MR must carry: **09-security.md** §3 | [reviewer] — `package.json` in the diff |
| Delete, `.skip`, `.only` or weaken a test | A guard that stops guarding does not go red. **05-testing.md** §9 | [reviewer]; `test:no-skips` is proposed in **06-cicd.md** |
| Add a new `it.runIf` / `describe.skipIf` | There are already 8 guard sites covering 10 tests, and each one is a test that vanishes rather than fails | [reviewer] |
| Edit an applied migration, or write a down-migration | Forward-only; rollback is a restore, and **07-deployment.md** owns what that costs. No backup schedule is running yet (§8) | [reviewer] — `git diff --diff-filter=M … server/db/migrations/` |
| `cp data/quotes.db` as a backup | WAL: you back up a file that may hold nothing while the `-wal` file holds the data. `CLAUDE.md` rule 4 | [reviewer] |
| Pick a customer ledger when the name is ambiguous | Silent tax error: ship-to state decides IGST vs CGST+SGST | [machine] — `quote.customer.test.ts` |
| Store, compare, sum or round-trip a fractional rupee; use `/ 100`, `toFixed(` or `parseFloat(` in `server/src/**` or `shared/**` outside `shared/money.ts` | Integer paise, always. The blanket "never divide by 100" is wrong and must not be repeated — see §1 | [reviewer] — the grep in §1; ESLint rule proposed in **06-cicd.md** |
| Push to `main` | The server refuses it, for everyone including admins | [machine] |
| Merge your own MR | A **Developer** cannot — `merge_access_level=40` blocks them. A **Maintainer** can, and GitLab Free will not stop them; that they do not is discipline, backed by **10-roles.md** §2's monthly API sweep. State it that way; never imply the server prevents it | [machine] for Developers, [detective] for Maintainers |
| Touch `.gitlab-ci.yml`, `Dockerfile`, `.env*`, `.gitignore`, protected-branch or protected-tag settings | The `qa` runner mounts the host Docker socket — a CI job is effectively root on the workstation that also hosts GitLab, the registry and QA, and a branch pipeline runs those jobs *before* anyone reviews the YAML | [reviewer] — and **10-roles.md** owns `.gitlab-ci.yml` |
| Commit a CI job yourself — including the ones other sections ask for (`test:no-skips`, lint, coverage extraction, `deps`, secret scanning) | Not a contradiction with those sections: **adding a CI job is a human-owned MR.** Propose the YAML in an MR description; do not push it. **06-cicd.md** owns the job definitions and the order in which they land | [reviewer] |
| Propose or write a pipeline where the tag or production stage **rebuilds** the image | The digest guarantee is the point of the pipeline. The Dockerfile runs `apt-get update` in three stages, so a rebuild resolves different package versions and yields a different `sha256` — production would run bytes QA never tested. Production **pulls the digest QA tested**. **07-deployment.md** owns the release chain | [machine, by consequence] — the digest assertion in `deploy:qa` |
| "Fix" CI by curling `127.0.0.1` from a job, or by dropping a `docker login` | Both were already paid for; **06-cicd.md** §1 explains the runner and registry mechanics | [reviewer] |
| Force-push, amend a pushed branch, or `git commit --no-verify` | The maintainer reviewing it loses the diff under them, and unresolved discussions pinned to rewritten lines block the merge | [reviewer] |
| Run the app, tests or migrations against QA (`http://192.168.1.40:8081`, volume `quotation_qa_data`) | 225 real customer ledgers are seeded there, nothing backs that volume up, and a hand-edited row is uncorrectable — no pipeline will ever fix it. **Open decision, stated plainly:** **06-cicd.md** §4.5 proposes a `smoke:qa` job that writes a quotation row into QA on every merge. Either that smoke is read-only, or this Stop List gains a named exception for the CI actor plus a cleanup step. It is a data-protection decision (**09-security.md** §7), not a CI one. **Until it is decided in writing, this prohibition stands and binds agents without exception** | [reviewer] — no technical control exists short of closing TODO-SEC-01 |
| Add a route that reads, mutates or destroys customer or price data | Every route is unauthenticated today; TODO-SEC-01 (**09-security.md** §0) is blocker zero | [reviewer] — and note `routes.test.ts` guards the three routers only |
| Print or paste `.env` contents into a transcript, MR or commit | Live `GEMINI_API_KEY`. `bundle-safety.test.ts` can grep the bundle for it; it cannot grep a merge request | [reviewer] |
| Reformat or refactor outside the task | No linter exists to arbitrate the diff | [reviewer] |

### 8. Gaps this ruleset leans on and does not yet have

| Gap (verified absent today) | Consequence for an agent |
|---|---|
| **No authentication anywhere.** All 16 routes are public, including `GET /api/customers` (225 real ledgers with GSTINs and addresses) and an unauthenticated `DELETE /api/quotes/:id` | TODO-SEC-01 is **blocker zero** for production, and the precondition list is **09-security.md** §0's, not this document's. Do not widen the public surface while it is open |
| Production not deployed | Every performance, resource, host and port claim belongs to **07-deployment.md** §Status. "It was fine on QA" proves nothing about a smaller container on a busier host |
| No ESLint, no Prettier | "Formatting" is never a valid reason to touch a line, and the money rule has no automated enforcer (§1) |
| No coverage tooling (`@vitest/coverage-v8` not installed, no `coverage` block in `vitest.config.ts`) | You may not claim coverage improved. Say which behaviours you added tests for. The plan and any future floors are **06-cicd.md** §8's. Note that Cobertura coverage visualisation in the MR diff **is a Free feature** and would work once a provider is installed |
| No `.gitlab/` templates | The AI-assistance line and a "tests added, none weakened" checkbox are manual. **01-agile.md** owns the template list and its capitalisation — GitLab's lookup is case-sensitive, so one agreed spelling matters |
| GitLab issues exist and are unused | There is no issue to link today. Issue-linked work is **[from Sprint 1]** and belongs to **01-agile.md**; an agent quoting an issue number today is quoting nothing |
| No `CODEOWNERS`, and one would not help | **Code Owners is entirely a Premium feature — not merely the approval enforcement, the whole thing.** A `CODEOWNERS` file on Free is not parsed: it cannot request a reviewer and it cannot block a merge. Never propose one as a working mechanism. A plain `REVIEWERS.md` would be a human lookup table and nothing more. Nothing routes `pdf.ts` or `migrate.ts` to a particular reviewer |
| No scanning of any kind runs in the pipeline | Precisely, so nobody proposes the wrong thing: **SAST runs on Free** as an ordinary analyzer job and emits a JSON artifact only — no MR widget, no Security Dashboard, no vulnerability tracking over time (all Ultimate). **Secret Detection: the same.** **Dependency Scanning and Container Scanning are Ultimate only and do not run on Free at all** — so dependency checking must be an ordinary job (`npm audit` / `osv-scanner`), never GitLab's template. **06-cicd.md** §2 owns the tier matrix and the job definition; **09-security.md** owns the triage policy and cadence for the 5 open `npm audit` advisories (all transitive through build tooling, untriaged — `PROJECT-LOG.md` §7.6) |
| No backups running (script written, schedule not set, external drive not purchased) | "Rollback means restoring a backup" currently means restoring a backup somebody remembered to take by hand — **07-deployment.md** for the procedure, **08-monitoring.md** for the schedule that does not exist |
| No monitoring (Uptime Kuma planned, not installed) | Nobody is told when QA stops answering. Severity levels and incident handling are **08-monitoring.md**'s single three-level scale — do not invent a second one |

**What actually enforces review here.** Required merge-request approvals are a GitLab **Premium** feature; on Free an approval is a comment that does not block a merge (**06-cicd.md** §2 owns the tier matrix). What is verified on this instance: `merge_method = merge`, `only_allow_merge_if_pipeline_succeeds = true`, `only_allow_merge_if_all_discussions_are_resolved = true`, `squash_option = default_on`, `merge_access_level = 40`. Read that honestly:

- **For a Developer's MR the guarantee holds.** They cannot merge their own work, so the person who merges is someone else — the reviewer.
- **For a Maintainer's MR it holds by discipline only.** Nothing prevents a maintainer merging their own MR, and nothing prevents an author resolving their own discussion threads. The detective control is **10-roles.md** §2's monthly sweep (`GET /projects/:id/merge_requests?state=merged&target_branch=main`, flagging `author.username == merge_user.username`).

An agent must never propose routing around that, never propose "self-merge since approvals aren't enforced anyway", never propose a `CODEOWNERS` file as though it would do something, and never suggest buying the constraint away.
