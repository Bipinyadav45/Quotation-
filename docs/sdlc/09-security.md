## Security Across the Lifecycle

*A `§N` in this file means a numbered subsection **of this file**. Other sections of the
framework are cited by filename (`07-deployment.md`), because the two numbering schemes
collide and have already been confused once.*

**What is in force today:** §0 (the deferral), §1 (the coding rules — enforced by the
tests and reviewers that exist), §2 (secrets — `bundle-safety.test.ts` runs in CI), §6
(runner posture, already configured) and §7 (data protection, partly). **Not in force:**
every job in §4 — none of them exist in `.gitlab-ci.yml`; the merge checklist at the end,
because `.gitlab/merge_request_templates/` does not exist and nothing puts the list in
front of a reviewer (`01-agile.md` owns that gap); the dependency-triage cadence in §3;
and all of §8, because production is not deployed.

### 0. The standing exception, stated first: TODO-SEC-01

**The application has no authentication of any kind.** There is no `helmet`, no `cors`, no
rate limiter, no session, no token — `package.json` contains none of them, and no route
consults an identity. Every endpoint answers any request that reaches the port. This is a
tracked deferral, and no other section of this framework may describe it as solved.

`server/src/routes/routes.test.ts` asserts the complete sorted list of **16** routes across
three routers. It does **not** cover `GET /api/health`, which is registered directly in
`server/src/index.ts` — 17 endpoints answer, 16 are guarded by the test.

| Exposed today | Consequence |
|---|---|
| `GET /customers` (`quote.ts:76`) | The customer master — 225 ledgers, GSTIN, address, state, contact — to anyone on the LAN |
| `GET /quotes`, `GET /quotes/:id`, `POST /price-history` | Every price Newtech has quoted. `POST` here is a **read**; the verb is not the guide to what a route discloses |
| `PUT /quotes/:id`, `POST /quotes/:id/status` | Silent edit of a priced document, including its customer — see §1 on why that is a tax error, not a typo |
| `DELETE /quotes/:id` (`quote.ts:706`) | `DELETE FROM quotes WHERE id = ?`. A hard delete. No soft-delete column, no restore short of a backup — and backups are not scheduled yet (§8). Unrecoverable **and** unattributable |
| `POST /parse/ai` | Spends the Gemini quota and ships the pasted thread to `generativelanguage.googleapis.com` (`ai.ts:24`) |
| `POST /render/pdf` | Drives LibreOffice on a concurrency-1 queue, 90 s timeout, one retry — ~180 s worst case per request (`pdf.ts:39,80`) |
| `GET /api/health` | Returns the applied-migration count, and the raw `better-sqlite3` error message when the database fails to open |

The route is `POST /parse/ai`. The docblock in `routes.test.ts` still says
`POST /api/parse/llm` — it was renamed when the AI provider changed; `05-testing.md` owns
that drift.

**What actually contains it:** QA is `http://192.168.1.40:8081`, LAN only — no public
exposure, no inbound NAT, no DNS (hosts files). That is an *availability* argument, not a
data-protection one: QA's customer master is the real one, 225 real ledgers with real
GSTINs. "It's only QA" does not apply to §7.

**Rule, binding on humans and AI agents: TODO-SEC-01 is a release gate, not a backlog
item.** It is **blocker zero** in the production gate list at §8, which this section owns —
`04-dev-workflow.md`, `07-deployment.md` and `10-roles.md` cross-reference that list rather
than publishing partial ones.

1. Production does not deploy while any mutating route is unauthenticated.
2. No MR may add a route that reads or destroys customer or price data before it closes.
3. Adding a route to a router **fails `routes.test.ts` deliberately**. Treat that red as the
   security review trigger.

**Fixing the hole in rule 3 (was: "the reviewer notices unaided").** Adding a route to
`index.ts` fails nothing, so the rule leaned on a human seeing an absence. The mechanism
that closes it: extract the express app construction in `server/src/index.ts` into an
exported `createApp()`, and change `routes.test.ts` to enumerate the routes registered on
the **app** — after mounting — instead of on the three routers. `GET /api/health` and
anything else mounted at the top level then sit inside the same deliberate red that already
works for router routes. **Until that lands, checklist item 1 is a reviewer check and is
marked as one.** No CODEOWNERS rule can be made to catch it: Code Owners is Premium in
full (§4).

**No closing plan exists yet.** The candidate at §8 authenticates a proxy hop, not the
application. `_OPEN-QUESTIONS.md` item 56 is the live question: IIS + Windows Auth in front
of a loopback-bound container, or in-app auth — only in-app auth gives §9 an actor column.

### 1. Secure coding rules, and what goes wrong without each

| Rule | Where it lives | Checked by | What breaks if it slips |
|---|---|---|---|
| Every route with a body goes through `validateBody(schema)` | `server/src/middleware/validate.ts`; 9 of 9 such routes use it today | Reviewer today. Machine check available: extend `routes.test.ts` to assert every POST/PUT layer's handle stack contains `validateBody` | An unvalidated body reaches a handler and fails three call frames deep, as a 500 carrying an internal message |
| SQL binds values with `?` | 35 `.prepare()` sites in `server/src` outside tests | Reviewer today; see the grep test proposed below | — |
| The three template-literal `.prepare()` calls splice a **module constant**, never input | `priceHistory.ts:124` and `:145` splice `RECENT_ITEMS` (`:79`); two more are in tests splicing a table name | As above | The moment one splices `req.body`, the app has SQL injection over a 225-ledger customer master |
| Money is stored and compared **only as integer paise** | `rate_paise` columns, `shared/money.ts` | `06-cicd.md` owns the scoped eslint rule; reviewer until it lands | A float paise error puts a total on letterhead that the customer's system rejects |
| A customer is a ledger, never a name | `customerMatch.ts`, `extractCustomer.ts`, `quote.customer.test.ts` | Tests, and the reviewer | Ship-to state decides IGST vs CGST+SGST — the wrong ledger is a silent tax error on a filed document. The arithmetic behind this lives in `CLAUDE.md` |
| docxtemplater gets `paragraphLoop`, `linebreaks`, `nullGetter` and nothing else | `docx.ts:160` | Reviewer | Enabling the expression/angular parser makes user-supplied strings in the render model evaluable inside the template |

**The money rule, stated correctly.** `CLAUDE.md` says "never a division by 100" and that
is wrong as written — `shared/money.ts` divides by 100 six times (lines 53, 66, 92, 112,
158, 172) and every one of them sits inside `Math.floor` or `Math.round`, which is correct
integer arithmetic. A blanket ban is violated by the file it exists to protect, and the
first person to enforce it turns the check off. The rule is:

> **Money is stored, compared, summed and round-tripped only as integer paise. A division
> may appear only where its result is immediately floored or rounded back to an integer.
> Never store, compare, sum or round-trip a fractional rupee.**

Scope for the machine check (owned by `06-cicd.md` as an eslint `no-restricted-syntax`
rule): ban `/ 100`, `toFixed(` and `parseFloat(` in `server/src/**` and `shared/**`
**except `shared/money.ts`**, and exclude `web/src/**` entirely — `DocumentPreview.tsx`
uses `toFixed` for CSS column widths, which is not money. Scoped that way the rule passes
clean on today's tree, which is the only kind of rule that survives.

**Gaps — currently true, not yet fixed:**

| Gap | Evidence | Fix |
|---|---|---|
| The error handler returns `err.message` to the client | `index.ts:65` — `res.status(500).json({ error: err.message })` | Log it, return a generic body plus a correlation id. Today a `better-sqlite3` error hands the caller column names and a `docxToPdf` failure hands them an absolute host path |
| **Request bodies are almost unbounded.** `shared/schema.ts` contains no `.max()` at all. The only four bounds are `quote.ts:49` (initials ≤ 4), `:72` (`q` ≤ 120), `:73` (`limit` ≤ 25), `:92` (price-history lines ≤ 100) | grep `\.max(` | `items` on `POST /quote`, `PUT /quotes/:id` and `POST /render/*` is capped only by `express.json({ limit: '2mb' })` (`index.ts`). A 2 MB item array on `/render/pdf` holds the concurrency-1 converter for ~180 s — on a 2-core production host that is the whole machine. **Machine check, proposed:** `shared/schema.bounds.test.ts` walks the exported zod shapes and fails on any `ZodArray` or `ZodString` with no max. That turns checklist item 2 from a reviewer's memory into a red test |
| The request log records `req.originalUrl`, which carries the query string | `index.ts` | `GET /customers?q=Morgan+Stanley` puts a customer name in the log. Log `req.path`, or accept it consciously |
| No linter, no formatter, no coverage tooling, no `.gitlab/` templates, no CODEOWNERS | no eslint/prettier config; `@vitest/coverage-v8` absent | If `eslint` + `eslint-plugin-security` is proposed, it lands as one MR with the §3 justification, not as a rider on a feature |

**Proposed machine check for the `?`-binding rule:** a test in house style —
`server/src/db/prepare-safety.test.ts` — that greps `server/src/**` for `.prepare(` calls
whose argument is a template literal containing `${`, and fails on any site not in a short
allowlist naming `priceHistory.ts:124` and `:145`. It is the same shape as
`bundle-safety.test.ts`: a grep with a self-check, so it cannot pass vacuously. Not
written.

### 2. Secrets

`GEMINI_API_KEY` is the only application secret (`config.ts:92`). It is optional — the app
is fully usable without it, and `/api/capabilities` says which features are off.

- `.env` is gitignored **and** `.dockerignore`d (`!.env.example` re-admits the template), so
  no image layer carries it.
- Boot logs `#` + `sha256(key).slice(0,8)`, never a prefix — two keys from one Google
  project share their opening characters, so a prefix proves nothing. `keyFingerprint()` in
  `index.ts` exists because an hour went into a "bad key" that was a stale process still
  holding the port.
- `web/bundle-safety.test.ts` greps the **built** `web/dist`, because a bundler inlines the
  value, not the name. It blocks the names `GEMINI_API_KEY`/`ANTHROPIC_API_KEY`, the shapes
  `sk-ant-…`/`AIza…`/`AQ.…`, and the markers `better-sqlite3`, `node:child_process`,
  `generativelanguage.googleapis.com`, `x-goog-api-key`. It carries a self-check —
  `it('fails loudly if the bundle was never built')`, an unconditional assertion — so it
  cannot pass vacuously. **Consequence for every author: run `npm run build` before
  `npm test`, or the suite is red, not green-with-skips.**
- **Honest gap:** the *value* grep reads `.env`, and `.env` is excluded from the image. In
  CI `realKeys` is empty and that loop asserts nothing; only the name and shape checks bite.
  The value guarantee is developer-machine-only. Either pass a masked+protected
  `GEMINI_API_KEY` into the test container, or say so in the test comment. Do not leave the
  reader believing CI checks it.
- **TODO-SEC-02, this week:** the live key has sat in plaintext on a developer desktop.
  Rotate in Google AI Studio, distribute out of band, confirm the new fingerprint in the QA
  container's boot log (`docker logs quotation-qa`), then revoke the old one. The
  fingerprint line is what makes "confirm" mean something.
- CI registry auth is `$CI_REGISTRY_PASSWORD`, job-scoped: no long-lived credential is
  stored in the project, and each job's credentials die with its container. Why every job
  has to log in again is `deploy:qa` mechanics — see `06-cicd.md`.

### 3. Dependencies — this section owns the policy and the triage cadence

New dependencies need a reason that survives scrutiny. `xlsx` was rejected at 7 MB with a
prototype-pollution history; `server/src/lib/xlsx.ts` is ~80 hand-written lines over
`pizzip`, which was already in the tree. An MR adding one states **size, last release,
transitive count, and why hand-writing it is worse**. Nine runtime dependencies today —
that number is a feature.

**The carve-out, stated next to the rule so it is not read as hypocrisy:** the bar is about
**runtime** dependencies, which reach real customer data and ship inside the image.
`eslint`, `typescript-eslint` and `@vitest/coverage-v8` are far larger than `xlsx` and are
still fine — they are dev-only, `npm prune --omit=dev` in the `prod-deps` stage keeps them
out of the runtime image, and they never see customer data. State which side of that line a
proposed package is on, in the MR description.

**Scanning tiers, one row of the matrix in `06-cicd.md` §2, because it decides what is even
possible here:** GitLab **Dependency Scanning and Container Scanning are Ultimate** — they
do not run on Free at all. So dependency vulnerability work is an ordinary job
(`npm audit` / `osv-scanner`), never GitLab's template.

**Triage policy and cadence (owned here; the job that produces the numbers is owned by
`06-cicd.md`, which fixes the flags, stage and blocking policy — do not restate them):**

- **Monthly, first working week.** The job produces the number; the triage produces the
  decisions. Re-running the command and reading the same number is not triage.
- **Named owner: the Owner hat** (`10-roles.md`), until someone else is named in
  `PROJECT-LOG.md`. An unowned cadence is a cadence that has not started.
- **Five advisories are open and untriaged today** (`PROJECT-LOG.md` §7 item 6), all
  transitive through build tooling. Record one decision per advisory — fix, waive with an
  expiry, or accept with a reason — in `security-waivers.json` (`06-cicd.md` defines the
  file; this section defines what a valid entry means: CVE id, date, one-line reason, expiry
  no more than 90 days out).
- **Both sets get measured.** `--omit=dev` reports the production-reachable set and is the
  only set that may ever block a release. The full set including dev dependencies is what
  the monthly triage reads, because today's five are all dev-tooling transitives and an
  `--omit=dev`-only view reports zero — a job that looks like it is working while measuring
  nothing is worse than no job.
- **From Sprint 1** — not in force today; nothing runs, and the five advisories have been
  open since they were counted.

### 4. Scanning in CI — proposed, none of it exists yet

**From Sprint 1 — not in force today.** `.gitlab-ci.yml` contains none of these jobs.

Analyzer availability, precisely (the full tier matrix lives in `06-cicd.md` §2):
**SAST and Secret Detection analyzers run on GitLab Free** and emit a JSON artifact.
What Free does **not** have is the MR security widget, the Vulnerability Report,
`artifacts:reports:sast` ingestion, vulnerability tracking over time, or Scan Execution
Policies. So a finding is a line in a job log and "blocking" means the job exits non-zero.

| Job | Tool | Stage | Blocking |
|---|---|---|---|
| `secrets` | `gitleaks detect` over full history | `build`, `needs: []` — fails in seconds, before the image build | yes, day one |
| `sast` | `semgrep --config p/typescript --config p/owasp-top-ten` | `test` | `allow_failure: true` until it has run three consecutive green pipelines on `main`, then blocking |
| `dockerfile` | `hadolint` | `build` | `allow_failure: true` |

Dependency vulnerability scanning is the `deps` job — **owned by `06-cicd.md`** (flags,
stage, blocking policy, the `osv-scanner` image pin). The policy it enforces is §3 above.

`GIT_DEPTH: "0"` is already set (for `git describe`), so gitleaks gets full history free.
**Run it once before making it blocking**: if history is already dirty, the answer is
rotation, not a rewrite — history cannot be un-cloned.

**These jobs must not run on a tag pipeline.** They live in `build` and `test`, and
`07-deployment.md` establishes that build and test do not run on `v*` tags: the Dockerfile
runs `apt-get update` in three stages, so any rebuild at tag time resolves different package
versions and produces a different `sha256` than the one QA tested. Production pulls the
digest QA tested. A security job that quietly drags `build` onto the tag pipeline destroys
the property the whole pipeline exists to protect — add them with the same
`rules: [{ if: $CI_COMMIT_TAG, when: never }, { when: on_success }]` the other branch jobs
carry.

Three things will break these jobs on this runner specifically:

1. **No DNS on the LAN.** A scanner container that talks to `gitlab.newtech.internal` needs
   the hosts entry passed in; copy whatever the existing jobs rely on rather than inventing
   a resolver.
2. **Internal CA.** Anything calling the GitLab API over HTTPS needs the CA mounted, or it
   fails with a certificate error that looks like a network error.
3. **A job's `127.0.0.1` is the job container**, not the workstation publishing the port.

**Do not add a CODEOWNERS file**, and do not add push rules to block `.env`. Push rules are
Premium, and **Code Owners is Premium in its entirety** — not merely the approval
enforcement. A `CODEOWNERS` file on Free is **not parsed at all**: it assigns nobody,
requests no reviewer, and blocks no merge. The file would be inert and would read, to the
next person, like a control that exists. If a "who knows this area" lookup is wanted, a
plain `REVIEWERS.md` is honest about being a human lookup table and nothing more.

**Ordering.** These are edits to `.gitlab-ci.yml`, which `02-ai-rules.md` puts behind a
human gate and which no one owns end to end. They land in the order `06-cicd.md` sets, one
MR each, never as a rider on a feature.

### 5. Least privilege in GitLab

**The role table, the headcount and the protected-branch settings live in `10-roles.md`**,
which also holds the monthly API sweep that verifies them. Five verbatim copies of a live
server configuration guarantee that the first drift is invisible, so this section states
only the consequences it depends on:

- **Required approvals are Premium.** In Free an approval does not block a merge, so an
  approval count is not a security control here.
- **The review guarantee is a permission, and it is only half a guarantee.**
  `merge_access_level=40` means a **Developer cannot merge their own work** — that half is
  enforced by the server and holds. **A Maintainer can merge their own MR, and nothing
  prevents it.** `merge_method` is `merge` (verified via the API), with
  `only_allow_merge_if_pipeline_succeeds=true`,
  `only_allow_merge_if_all_discussions_are_resolved=true` and `squash_option=default_on` —
  none of which look at who the author is. Nothing prevents an author resolving their own
  discussion threads either, so "all discussions resolved" gates a click, not a second pair
  of eyes.
- So: **"the merging maintainer is never the author" is a convention, not a control**, and
  it is the two or three people most likely to be merging who are unconstrained by it. It is
  written down as a recommendation, with a detective control after the fact — the monthly
  sweep in `10-roles.md` (`GET /projects/:id/merge_requests?state=merged&target_branch=main`,
  flagging `author.username == merge_user.username`) publishing its count in
  `PROJECT-LOG.md`. Without that owner and that date it is a sentence, and history shows it
  has never actually been exercised.
- Project stays **private**, forks off, signup disabled, runner **locked to this project**.
  Those four are what make §6's socket mount survivable.

**Open:** whether the Owner's admin identity is separated from their developer account. Not
done today.

### 6. Runner security

The `qa` runner mounts the host Docker socket, so **a CI job controls the host daemon —
effectively root on the workstation**. `.gitlab-ci.yml` says this in its header rather than
hiding it. Acceptable because the project is private, signup is disabled, there are no forks
and no outside contributors, five authenticated people can trigger it, and the workstation
holds QA data only. It stops being acceptable the moment the runner is shared with another
project — which matters, because the intent is to onboard inventory, pickup-ops and tracker
onto this same GitLab. **Each project gets its own locked runner; the `qa` runner is never
made shared or instance-level.**

Note what this means for review order: a branch pipeline runs root-capable jobs on the
workstation **before** anyone reviews the branch. Reviewing a `.gitlab-ci.yml` change in an
MR is therefore after the fact. That is one more reason CI edits are their own MR, from a
person, and never bundled with a feature.

Production gets a **separate runner on the production host, restricted to protected tags
(`v*`), pull-based** — no inbound connection to production from CI, no SSH key stored in
GitLab, and no path by which a feature branch reaches it.

### 7. Data protection (DPDP Act, 2023)

Developers hold unmodified copies of the real customer database by explicit decision: 225
ledgers, GSTINs, addresses, contact names, quoted prices.

- **Full-disk encryption on all five developer machines, the workstation, and any backup
  drive (BitLocker To Go). Mandatory — with a register, or it is not mandatory.** A stolen
  laptop is otherwise a reportable personal-data breach, not an IT inconvenience.
  **Mechanism:** each machine's `manage-bde -status` result is recorded as a dated line in
  `PROJECT-LOG.md` — machine, date, protection status, who checked — owned by the **SysAdmin
  hat** (`10-roles.md`), written at onboarding and confirmed at offboarding. Until that
  register holds a dated line per machine, this control is **claimed but unverified**, and
  saying so is better than a mandatory control that would fail an audit on day one.
- Newtech is a **Data Fiduciary**, and a Data Fiduciary duty cannot sit unassigned: until a
  name is recorded in `PROJECT-LOG.md`, **the Owner holds it by default**. `10-roles.md` has
  no data-protection hat; adding one is the fix. **Still open, not decided:** the retention
  period, and whether the desk's customers have been told anything at all.
- `data/` and `backups/` are gitignored. Never commit a `.db`. Never copy `data/quotes.db` —
  WAL mode makes a file copy silently back up nothing; use `npm run backup` (`VACUUM INTO`).
  The rule is `CLAUDE.md` rule 4; the operational procedure is `07-deployment.md`.
- **The tension, stated plainly.** `Resources/List of Sundry Debtors with address and
  GSTIN.xlsx` and two real customer quotations at the repo root *are* tracked in git,
  deliberately — 33 tests in `importCustomers.test.ts` read the real spreadsheet because
  every quirk they guard (Tally's `\x04` before "Not Applicable", flattened addresses, a
  GSTIN with a trailing carriage return) came out of it. `Supporting Documents/` is ignored;
  `Resources/` is **deliberately not ignored**, which means anything dropped into that folder
  is committed by the next `git add -A`. Mitigation: private project, no forks, never public.
  Residual risk: history cannot be un-cloned. Do not add more.
- **The test image carries that data; the shipped image does not.** `--target test` inherits
  `COPY . .`, so `$IMAGE:$TEST_TAG` contains `Resources/` and both real customer `.docx`
  files. It is built on the workstation and **never pushed** — `publish` pushes `$BUILD_TAG`
  only, and the `runtime` stage copies only `node_modules`, `web/dist`, `shared/`, `server/`.
  Adding `docker push "$IMAGE:$TEST_TAG"` — for layer caching, say — puts 225 real ledgers in
  the registry on `:5050`. It must never be added.
- Thread text sent to `POST /parse/ai` leaves the LAN for Google. The desk must be told this
  in as many words; nothing in the UI says it today.
- **Writes to QA are a data-protection decision, and this section makes it: the QA smoke
  test is read-only.** `02-ai-rules.md` forbids running the app, tests or migrations against
  QA; `10-roles.md` notes that a hand-written row in QA's copy of the 225 real ledgers
  persists forever because no pipeline will ever correct it and nothing backs that volume up.
  A proposed `smoke:qa` job that POSTs a quote violates both. **A CI job may read from QA —
  `GET /api/health`, `GET /api/capabilities`, a `GET` that counts customers — and may not
  write to it.** If a write-path smoke test is judged necessary later, it runs against a
  throwaway container on a fresh volume, never `quotation_qa_data`, and that exception is
  recorded here before the job is written. Whether the desk may issue *real* quotations from
  QA is the separate undecided question, and it decides whether QA needs a backup schedule
  today rather than after the RAM upgrade.

### 8. Production preconditions — the gate list (this section owns it)

**Production is not deployed.** This is the complete list of what must be true before it is;
no other section publishes a rival list. `04-dev-workflow.md`, `07-deployment.md` and
`10-roles.md` cite this table. The host status behind gate 1 — 192.168.1.37, i3-1115G4, 2
cores, 8 GB with ~491 MB free, already running Pickup Ops `:3000`, Newtech Inventory `:8000`,
IIS `:8080` and AnyDesk `:7070` — is owned by `07-deployment.md`.

| # | Gate | State |
|---|---|---|
| **0** | **TODO-SEC-01 closed — no unauthenticated route reads or destroys customer or price data** (§0) | **not done. Blocker zero. No other gate closing changes this one** |
| 1 | RAM upgrade on 192.168.1.37 | **hard prerequisite, not done** |
| 2 | Resource caps decided for a 2-core host, and measured | QA runs `--memory=2g --cpus=2.0`, which is roughly *double* the intended production shape — "it was fine on QA" therefore proves nothing about production. `07-deployment.md` owns the production numbers and the measured PDF conversion time on that host |
| 3 | Port chosen clear of `:3000`, `:8000`, `:8080`, `:7070` | **decided: 18080** (the plan reserves 18080–18099 for new production apps). Production must **not** reuse 8081: that is QA's port on `.40`, `:8080` on `.37` is IIS, and 8081 on `.37` is unverified. Recorded in `07-deployment.md`'s environment table; anything still saying 8081 or 8082 for production is stale |
| 4 | Container runs unprivileged | done — `USER node` in the Dockerfile |
| 5 | Backups scheduled, held off the application volume, and a restore rehearsed on QA | **script exists; no schedule, drive not purchased.** The deploy-time backup step and the rollback procedure are `07-deployment.md`'s |
| 6 | Monitoring installed, covering the three incumbent apps as well as this one | planned, not installed (`08-monitoring.md`) |
| 7 | Production runner installed, tag-restricted, pull-based (§6) | not installed |
| 8 | Reference-number reconciliation after a restore has a written procedure and a named person | not written. Every restore re-issues numbers the desk may already have emailed |

Candidate for closing gate 0 on that host: bind the container to `127.0.0.1` and front it
with the **IIS already running on `:8080`** using Windows Authentication — no new service, no
session code, no extra process on a machine with 491 MB free. Not decided. Note that it
authenticates the *proxy hop* only: the app still has no identity of its own, so §9 does not
close with it, and the actor columns §9 needs never arrive.

### 9. Audit logging

GitLab Free records the actor for every push, MR, merge, tag and deployment. That is the
change-audit trail and it is sufficient. Premium *Audit Events* is absent — accept it, do not
design around it. Its one real hole is settings: a maintainer or owner *can* unprotect `main`
and Free keeps no record of it, which is why `08-monitoring.md`'s break-glass rule is
disclose-and-restore.

**The application has no audit trail, because it has no identity.** `DELETE /api/quotes/:id`
logs `[quotes] deleted <ref>` and the request line — attributable to an IP at best, and the
delete is a hard delete. Add `actor` columns in the **same migration that lands
authentication** (`006_…`, forward-only, `BEGIN IMMEDIATE` with a re-check inside the lock —
the deferred-transaction race that produced intermittent "duplicate column name" failures in
CI is documented at `server/src/db/migrate.ts:46`). There are no down-migrations: rolling
back means restoring a backup (`07-deployment.md`), which is why gate 5 blocks this one.

### 10. Incident and vulnerability handling

Nothing is internet-facing, so there are no external reporters. Internally: file a
**confidential** GitLab issue (Free supports these), tell the Owner the same day.
**From Sprint 1** for the issue half — GitLab issues are unused today; until then the record
goes in `PROJECT-LOG.md` with the same content.

**One severity scale for the whole framework, owned by `08-monitoring.md`.** Security work
does not get its own. This is the mapping, not a second scale:

| Scale | Security examples | Security-specific first action |
|---|---|---|
| **Sev 1** | Key leaked; customer data left the building; a device holding the customer database lost or stolen | Contain today. Rotate per §2 and **confirm the new fingerprint in the boot log** — that line is what makes "rotated" verifiable. File the record before the fix, not after. For a lost device, the DPDP breach clock starts the moment it is known (§7) |
| **Sev 2** | Unauthenticated surface widened; a reachable CVE in a **runtime** dependency | Fix within the week, through the normal branch → MR flow |
| **Sev 3** | Hardening gap; a scanner finding on an unreachable path; a dev-only advisory | Next planned MR, or the monthly triage (§3) |

Note the one place the mapping is not obvious: `08-monitoring.md` grades a skipped test in CI
as Sev 3, and for a *runner flake* that is right. A skip that hides a guard which stopped
guarding is not cosmetic — the `test:no-skips` job (`06-cicd.md`) is what makes the
distinction machine-visible instead of a judgement call.

---

## Security checklist for a merge request

**Status: from Sprint 1 as a template.** `.gitlab/merge_request_templates/` does not exist,
so nothing puts this list in front of anyone today — it works only if the merging maintainer
opens this file. `01-agile.md` owns the template gap and its Definition of Done is the single
merge gate; the DoD absorbs this list **by reference** ("security checklist, 09-security.md")
rather than copying it, because five parallel checklists means four of them are optional by
default.

The maintainer who merges runs this. Any "no" blocks the merge. The right-hand column says
what would actually catch it — where that column says *reviewer*, the reviewer **is** the
control, and a missing item is a discussion thread, not a shrug.

| # | Check | Caught by |
|---|---|---|
| 1 | **Route added or changed?** Is the new surface justified, and does it read or destroy customer/price data with no auth (§0)? | `routes.test.ts` goes red for router routes. **Reviewer** for anything mounted in `index.ts` — until the `createApp()` fix in §0 lands, this is the known hole |
| 2 | **Body-taking route?** It goes through `validateBody(schema)`, and any new array or free-text field carries a `.max()`. Four bounds exist today; an unbounded `items` array plus `POST /render/pdf` is a 180-second denial of service on a 2-core host | **Reviewer.** Machine checks are specified in §1 and not written |
| 3 | **New SQL?** Values bind with `?`. No `${}` carrying request data into `.prepare()` — a module constant is the only interpolation the codebase permits | **Reviewer.** `prepare-safety.test.ts` (§1) would make it a red test |
| 4 | **Nothing added to a log line, error message, or test fixture** that is a key, GSTIN, customer name, address or thread body. The error handler already returns `err.message`; do not widen that | **Reviewer.** `gitleaks` catches key *shapes* only, and only once §4 lands |
| 5 | **`git diff --stat` shows** no `.env`, no `*.db`, nothing under `data/` or `backups/`, and no new file under `Resources/` — that folder is deliberately un-ignored and will be committed silently | **Reviewer today.** Machine-checkable and worth doing: a step in the `secrets` job failing on `git diff --name-only origin/main...HEAD` matching `^(\.env\|data/\|backups/\|Resources/)` |
| 6 | **Money touched?** Integer paise stored and compared; a `/ 100` only where the result is immediately floored or rounded (§1). Not the blanket "never `/100`" — that ban is wrong and `shared/money.ts` breaks it correctly six times | **Reviewer**, until the scoped eslint rule (`06-cicd.md`) lands |
| 7 | **Customer identity touched?** Ledger-keyed. Ambiguity is refused and writes nothing — assert the database, not the response | `quote.customer.test.ts`, plus the reviewer |
| 8 | **New dependency?** Size, last release, transitive count, why hand-writing it is worse, and runtime-vs-dev-only, in the MR description (§3) | **Reviewer** |
| 9 | **Pipeline green with no skipped tests** | `test:no-skips` (`06-cicd.md`) reads the JUnit XML and fails on any `<skipped`, and fails if the artifact is missing. **The author does not declare a skip count** — a hand-typed number nobody measured is how checklists get pasted without being performed. Why a skip matters: `05-testing.md` |
| 10 | **PDF or template touched?** Say in the MR which backend you exercised — your machine tested Word, CI tested LibreOffice | **Reviewer**, via a template checkbox once `.gitlab/` exists. CI cannot know what ran on a laptop. The trap itself is explained once, in `05-testing.md` |
| 11 | **Bundle changed?** Run `npm run build && npm run typecheck && npm test` locally, where `.env` exists and the value grep actually bites. CI's does not (§2) | `bundle-safety.test.ts` in CI for names and shapes; **author** for the value grep |
| 12 | **Schema field added?** `screen-wiring.test.ts` will fail; it was updated deliberately, not silenced (`05-testing.md`) | The test |
| 13 | **Migration added?** Forward-only, `BEGIN IMMEDIATE`, re-check inside the lock, and it does not backfill personal data into a table nobody governs | **Reviewer.** Rollback policy: `07-deployment.md` |
| 14 | **Branch rebased on `main`?** A green MR pipeline did not test the branch against `main` — merged-results pipelines are Premium. A stale branch can silently reinstate a route or a check that `main` removed | **Reviewer** (`03-git.md`, `10-roles.md`) |
| 15 | **Recommended, not enforced: the merging maintainer is not the author.** True by permission for Developers; nothing stops a Maintainer (§5) | Monthly detective sweep in `10-roles.md`. Do not read this as a control that holds at merge time |
| 16 | **All discussions resolved** — GitLab blocks the merge otherwise. Note the author can resolve their own threads, so this blocks until someone clicks, not until someone reviews | Server-enforced, weakly |
