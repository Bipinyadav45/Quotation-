## Agile / Scrum Process

**What this section owns:** the sprint, the ceremonies, the roles that are *not* GitLab permissions (Sprint Host, Desk Liaison), story shape, Definition of Ready, the **Definition of Done — which is the single merge gate for the whole framework** — and the `.gitlab/` template file list. Everything else it used to explain now lives with its owner and is linked from here.

**Where the rest lives:**

| Topic | Owner |
|---|---|
| Severity scale (one scale, three levels) | `08-monitoring.md` |
| Production preconditions / the gate list (blocker zero = TODO-SEC-01) | `09-security.md` |
| Version bumps, deploy sequence, backup-before-migrate, migration rollback | `07-deployment.md` |
| Image retention / registry cleanup, and never deleting a digest that is still a rollback target | `08-monitoring.md` |
| `npm audit` job definition, the `test` job, coverage extraction, `test:no-skips` | `06-cicd.md` |
| `npm audit` policy, cadence and the named triage owner | `09-security.md` |
| The test ladder, the guard-test inventory, which tests a change needs | `05-testing.md` |
| Role → GitLab permission matrix, maintainer headcount, the protected-branch settings table and its monthly sweep | `10-roles.md` |
| Branch naming, commit convention, revert recipe | `03-git.md` |
| GitLab Free/Premium/Ultimate feature matrix | `06-cicd.md` §2 |
| WAL / `VACUUM INTO` / never `cp data/quotes.db` | `CLAUDE.md` rule 4, procedure in `07-deployment.md` |
| Word-vs-LibreOffice trap; ledger-identity arithmetic | `05-testing.md`; `CLAUDE.md` rule 2 |

### Status: this process is not running yet

Everything below is a proposal for Sprint 1. Nothing in it is in force today unless the table says so, and the document is dishonest if it pretends otherwise.

| Mechanism | State today | Evidence |
|---|---|---|
| Developers cannot merge; the pipeline and discussion gates hold the merge button | **In force** | Project settings, verified. The settings table itself and the monthly drift sweep are owned by `10-roles.md` §2 — cite the consequence, do not copy the table |
| A **maintainer** can merge their own MR, and can resolve their own threads | **In force, and it is the hole** | `merge_method=merge`, `only_allow_merge_if_pipeline_succeeds=true`, `only_allow_merge_if_all_discussions_are_resolved=true`, `squash_option=default_on` — verified via the API. Nothing in that set prevents a self-merge. Required approvals are Premium |
| Branch → MR → green pipeline → QA on `:8081` | **In force** | 5 merged MRs in `git log` (`fix/concurrent-migrations`, `fix/reject-non-docx`, `chore/qa-url-192-168-1-40`, `docs/onboarding-and-ai-guide`, `fix/qa-health-check`) |
| Issues, milestones, labels, boards | **Not used.** Zero issues carry the process | GitLab project |
| `.gitlab/issue_templates/`, `.gitlab/merge_request_templates/` | **Do not exist** | `ls .gitlab` — only `.gitlab-ci.yml` at root |
| `test:no-skips`, coverage, lint, `npm audit` jobs | **Do not exist** | `.gitlab-ci.yml` is `build → test → publish → deploy:qa`, nothing else |
| Sprint Host / Desk Liaison rotation | **Nobody assigned** | — |
| Retro, planning, walkthrough | **Never held** | — |
| Production | **Not deployed.** Blocker zero is TODO-SEC-01 (`09-security.md`); the infrastructure blockers are `07-deployment.md`'s | — |

**Decision, taken here so the framework stops taking both branches: GitLab issues are adopted at Sprint 1.** Until Sprint 1, the written record of *why* is the MR description and the commit body; from Sprint 1 the issue is the home for the work item, and the MR description stops being the alternative. Sections that route records to MR descriptions "because issues are unused" are describing today, not Sprint 1. Two homes for "why" is worse than one — so it is one, and the switch has a date.

**Sprint 1 is `Sprint 1 (14–25 Sep 2026)`** — Monday to Friday, a fortnight, Asia/Kolkata. It starts the day `.gitlab/` lands, not before; a sprint with no issue templates is five people pasting a checklist from memory. If the templates slip, Sprint 1 slips with them — say so at planning rather than starting a sprint whose gate is a paste.

Milestone dates are IST for a product reason, not a preference: the reference number carries the financial year (`shared/fy.ts` — `NCS/2026-27/Quotes/RG/031`, and 31 March falls in the *previous* FY), and the QA container runs `-e TZ=Asia/Kolkata` (`.gitlab-ci.yml`). A sprint booked in the wrong zone straddling 31 March/1 April changes the prefix on every quotation issued in it.

### What we are not doing, and why

Five people, all of whom write code. A one-hour meeting with all five in it costs 5 dev-hours — 12.5% of the team's working day.

The ceremonies kept below cost **~10 dev-hours a sprint out of ~400** (planning 3.75, retro 2.5, daily notes 2.5, refinement 1.0, walkthrough 0.33). A daily standup would add **12.5 on its own** — more than everything else combined.

| Cut | Why | What replaces it |
|---|---|---|
| Daily standup meeting | 5 × 15 min × 10 days = 12.5 dev-hours a sprint, to say what a comment on the milestone issue says in writing and leaves searchable | Async written note — see *Sprint mechanics* |
| Story points / velocity | Free tier has no issue weights and no burndown chart, so a point has nowhere to live and nothing to plot on. Velocity at n=5 with no QA person is noise | Three size labels — see *Estimation* |
| Sprint Review as stakeholder ceremony | There is one stakeholder, the purchase desk, and they sit in the same building | 20-min walkthrough on QA, http://192.168.1.40:8081 |
| Scrum Master role | Nobody is free to be one | Sprint Host hat, rotates |
| Whole-team refinement | Four people listening while two argue about `parser.ts` | 30 min, two people |
| GitLab Service Desk (Free) for desk requests | Needs incoming email; the LAN has no DNS server (hosts files) and no public exposure | The Desk Liaison files the issue |

**Kept, and mandatory from Sprint 1:** planning, the async daily note, the QA walkthrough, the retrospective. None of the four has been held yet.

### Roles — the two hats this section owns

The **role → GitLab permission matrix, the maintainer headcount and who holds Owner are owned by `10-roles.md`.** Do not read a permission out of this table; read the sprint duty.

| Hat | Who | Held for |
|---|---|---|
| **Desk Liaison** | 1 dev, rotates each sprint | stands in for the absent Product Owner; owns the conversation with the purchase desk; the only person who may drop a Sev 1 on the team |
| **Sprint Host** | 1 dev, rotates each sprint, never the Desk Liaison in the same sprint | runs planning + retro, checks DoR, counts capacity by hand, keeps the milestone honest |

Both are **From Sprint 1 — not in force today.** Nobody is assigned.

**The one hard separation — and the hole in it.** The author of an MR is not the person who merges it.

- For a **Developer** this is enforced by a permission: they cannot merge, so someone else must read it. That half of the guarantee is real.
- For a **Maintainer's own MR it is enforced by nothing.** `merge_method=merge`, verified: GitLab lets a maintainer merge their own MR, and lets them resolve their own discussion threads. Required approval rules — the feature that would close this — are Premium. Say this plainly wherever the guarantee is claimed; a flat "you cannot merge your own MR" is false for exactly the people who do most of the merging.

> **Rule (discipline, not permission):** a maintainer's own MR is merged by another maintainer, and the MR body names who read it.
>
> **Enforcement — detective only:** the monthly API sweep in `10-roles.md` §2 (`GET /projects/:id/merge_requests?state=merged&target_branch=main`, flagging `author.username == merge_user.username`), whose named owner and fixed date `10-roles.md` sets, with the count published in `PROJECT-LOG.md`. **Until that sweep has an owner and a date this is a recommendation, not a mandatory rule** — and it has never been exercised: every merge to date carries the single root-admin account.

### Work hierarchy on GitLab Free

Do not write a process that assumes a Premium object. The tier matrix is owned by `06-cicd.md` §2; below is only what the *work hierarchy* has to substitute for.

| Missing object | What we use instead |
|---|---|
| Epics, roadmaps, iterations | Label `epic-<slug>` + one tracking issue whose description is a checklist of `- [ ] #123`; Free renders the completion count |
| Issue weights, burndown charts | `size-s` / `size-m` / `size-l` labels |
| Scoped labels (`key::value`) — no mutual exclusion | Flat labels, and the Sprint Host checks at planning that no issue carries two `size-` or two severity labels |
| Blocking issue links (`blocks` / `is blocked by`) | `blocked` label + a comment naming what blocks it and who owns the unblock |
| Multiple assignees | One assignee. One story = one branch = one MR |
| Multiple issue boards | The single Free board |
| Required MR approvals | Permissions, plus the discipline rule above. The person who clicks Merge is the reviewer and the merge event is the record — with the maintainer caveat stated above |

| Level | Object | Rule |
|---|---|---|
| **Epic** | `epic-<slug>` label + tracking issue (e.g. `epic-customer-identity`) | |
| **Feature** | Issue labelled `type-feature`, in the epic issue's checklist | |
| **User Story** | Issue. **One story = one branch = one MR** | The unit of estimation |
| **Task / sub-task** | A checkbox in the story description. Promote to its own issue only if a *different person* does it | |
| **Sprint** | Milestone, titled `Sprint 1 (14–25 Sep 2026)` | Two weeks |

All of it is **From Sprint 1** — there are no issues, labels or milestones today.

**CODEOWNERS is not an option, and not a half-option.** The whole feature is Premium: in Free a `CODEOWNERS` file is **not parsed at all** — it cannot request a reviewer, cannot appear on an MR, and cannot block a merge. Adding one would be a file nothing reads. A plain `REVIEWERS.md` is a **human lookup table only** — "who has been inside `pdf.ts`, `docx.ts`, `customerMatch.ts`, `importCustomers.ts` and `server/scripts/build-template.ts`" — so an author knows whose attention to ask for. It enforces nothing. Enforcement is the merge permission (`10-roles.md`).

### The `.gitlab/` templates — this section owns the file list

**Gap, and the gate on Sprint 1.** None of these files exist. GitLab's template lookup is **case-sensitive**, and a merge-request template named literally `Default.md` is applied automatically to every new MR — which is the only reason the DoD checklist ever reaches an author without being pasted. So the capitalisation below is load-bearing, not a style choice. One agreed list, one capitalisation:

| File | Content owned by |
|---|---|
| `.gitlab/merge_request_templates/Default.md` | **this section** — the Definition of Done checklist, with the security checklist linked (`09-security.md`), not copied |
| `.gitlab/issue_templates/Story.md` | **this section** — the DoR fields |
| `.gitlab/issue_templates/Bug.md` | **this section** — the DoR fields plus the severity label, whose scale is `08-monitoring.md`'s |
| `.gitlab/issue_templates/Debt.md` | **this section** — evidence, cost, and what it blocks |
| `.gitlab/issue_templates/Incident.md` | `08-monitoring.md` |
| `.gitlab/issue_templates/Release.md` | `07-deployment.md` |

Until they exist the checklist is pasted by hand, and a hand-pasted checklist is the one that loses the two items that catch a silently wrong document: the skip check and "Word vs LibreOffice". That is the argument for creating them *before* Sprint 1, not during it.

### Writing a story — a real one

> **As** the purchase desk,
> **I want** to be shown every ledger that could be the customer on this RFQ, with its GSTIN, state and address,
> **so that** I pick the right one instead of the app guessing and putting the wrong tax on company letterhead.

What makes it a story and not a wish: a customer is a **ledger, not a name**. Several ledgers share a name; some share a name *and* a GSTIN and differ only by address; the ship-to state decides IGST vs CGST+SGST, so guessing is a silent tax error. The arithmetic behind that — how many ledgers, how many spellings — is owned by `CLAUDE.md` rule 2, with `05-testing.md` owning the live discrepancy between the count in `CLAUDE.md` and the one in `server/src/routes/quote.customer.test.ts`. Cite the rule; do not re-derive the numbers here, because two copies drift and one of them already has.

Rejected version: *"Improve customer matching."* No actor, no consequence, nothing to assert.

### Acceptance criteria, and the tests they become

Each AC names the test that will prove it, in house grammar — `describe` is the *situation*, `it` completes the sentence, never "should", never the function name, ~1 in 3 in the X-not-Y form that carries the decision.

```
Given the master holds several ledgers answering to "Morgan Stanley" across three states
When the desk parses a thread whose ship-to reads "Morgan Stanley, Mumbai"
Then no quote row is written, and the chooser lists every candidate with GSTIN, state, address
  -> describe('an RFQ whose customer could be several ledgers')
       it('is held for the desk to choose, and writes nothing')

Given the desk has picked one ledger in the chooser
When the quotation is saved
Then quotes.customer_id holds that ledger id, and the tax mode follows its state
  -> describe('a ledger the desk chose')
       it('is stored by id, not by the name that was shown')
```

Two constraints on an AC that are not style. **Which kind of test a change needs — the ladder — is `05-testing.md`; these two are about how the AC itself is written:**

1. **Write the AC against the database, not the response.** `server/src/routes/quote.update.test.ts` says why in its own docblock: a route that answered 200 with the request echoed back and wrote nothing would satisfy an AC phrased "the response shows CGST" — and that *was* the bug (a Maharashtra quote saved CGST+SGST, switched on screen, and the downloaded PDF still printed CGST 9% + SGST 9%, because the download renders the stored row and the preview renders the draft). Phrase the Then clause as a stored row.
2. **A refusal AC says what was *not* written**, not only what the user saw.

**There is no browser test and there will not be one in this story.** `vitest.config.ts` sets `environment: 'node'`, there is no jsdom, no testing-library, no driver, and no React component is rendered anywhere in the suite. UI coverage is source-as-text (`web/src/screen-wiring.test.ts`) plus a human on QA. **Do not write an AC that can only be proved by clicking.**

### Definition of Ready — checked by the Sprint Host at planning

**From Sprint 1 — not in force today** (there is no Sprint Host and there are no issues). The check is a human one: the Sprint Host reads each candidate issue at planning and refuses the ones that fail. Nothing in Free can check any of it, and no job is proposed for it.

| # | Condition | What goes wrong without it |
|---|---|---|
| 1 | Actor / want / consequence, in the desk's words | "Improve customer matching" gets built as three different things by three people |
| 2 | At least one Given/When/Then, naming the money or tax consequence if there is one | Money is stored and compared **only as integer paise** — an AC written in rupees invites a fractional rupee into a comparison. See the money rule below |
| 3 | `size-s` or `size-m`. **`size-l` is not ready** — split it | A `size-l` cannot be reviewed in one MR, and an unreviewable MR gets merged on trust. This one *is* enforceable: the Sprint Host reads the label at planning |
| 4 | Named files or areas | |
| 5 | **Declared breakers:** the story names which existing guard tests this change will turn red on purpose | Undeclared, they read as a broken build and cost an afternoon — or worse, someone weakens the assertion to go green |
| 6 | No `blocked` label | |

**The money rule, stated correctly.** The blanket form — "never a division by 100" — is wrong and must not be repeated: `shared/money.ts` divides by 100 six times (lines 53, 66, 92, 112, 158, 172) and every one of them sits inside `Math.floor` or `Math.round`, which is correct integer arithmetic.

> Money is **stored and compared only as integer paise**. A division may appear **only where its result is immediately floored or rounded back to an integer**. Never store, compare, sum or round-trip a fractional rupee.

`CLAUDE.md` rule 1 still carries the older blanket phrasing and needs the same correction; until it does, the first person to enforce it literally will "fix" `shared/money.ts` into a bug. The machine check for the scoped version is `06-cicd.md` §4.1's eslint `no-restricted-syntax` rule — ban `/ 100`, `toFixed(`, `parseFloat(` in `server/src/**` and `shared/**`, **except** `shared/money.ts`, and exclude `web/src` entirely (`DocumentPreview.tsx` uses `toFixed` for CSS column widths, which is not money). It passes clean on today's tree. There is no linter installed yet.

**Declared breakers — the inventory lives in `05-testing.md` §5.** Two tests fail on purpose when you extend the app: adding a route, and adding a field to a schema shape. This section's obligation is only that the story *declares* them at DoR and the MR says they were updated deliberately. **Never widen the assertion to make it pass** — that deletes the guard and leaves the test.

### Definition of Done — the single merge gate

**This is the framework's one merge gate.** `04-dev-workflow.md`, `05-testing.md`, `09-security.md` and `10-roles.md` each hold a list that overlaps it; they cross-reference this one instead of running in parallel, because the MR template can carry only one checklist and the others would become optional by default. `09-security.md`'s security checklist is absorbed **by reference** at item 9 — not restated, not optional.

**Items 1–10 gate the merge. Items 11–14 close the issue** — `publish` and `deploy:qa` carry `rules: if $CI_COMMIT_BRANCH == $CI_DEFAULT_BRANCH`, so a feature branch only ever runs `build → test`. Nothing reaches QA before it is merged. (The pipeline as built is `06-cicd.md` §1; why nothing downstream ever rebuilds is `07-deployment.md`.)

| # | Condition | Enforced by | Consequence if skipped |
|---|---|---|---|
| 1 | Branch and commit convention — see `03-git.md`. Imperative commits that explain **why**, no conventional-commit prefix | Reviewer, and the merging maintainer who edits the squash message | The commit body is where this project's engineering record actually lives: the 282 orphaned `WINWORD.EXE` processes, 12.7 GB of Office telemetry in `%TEMP%\Diagnostics`, and `parser.ts` left at **zero bytes** by a write onto a full disk are recorded in the body of `be96eb9` and **in no prose document at all** |
| 2 | **`npm run build && npm run typecheck && npm test` green locally**, in that order | The author, then the `test` job (`06-cicd.md`) | Not "typecheck and test": `web/bundle-safety.test.ts` ends with an unconditional `expect(built).toBe(true)`, so on a fresh clone with no `web/dist` the suite is **red**, not green-with-skips. Local is Windows + Word; it is a smoke test, not the verdict — see 3 |
| 3 | Pipeline green: **build → test**, run inside `$IMAGE:$TEST_TAG` — Linux, LibreOffice | GitLab: `only_allow_merge_if_pipeline_succeeds=true` | Running on the host tests a renderer that never ships |
| 4 | **No skipped tests in CI** | The `test:no-skips` job (`06-cicd.md`), which asserts there is no `<skipped` in the JUnit XML and fails when the artifact is missing or holds zero test cases. **From the commit that adds that job — it does not exist today.** There is deliberately **no author-declared skip count**: a human stating a number they did not measure is exactly how a checklist item gets pasted without being performed | Guarded tests *vanish*, they do not fail. A skip in CI means a guard stopped guarding — and the guards in question are the ZIP-signature check and "no API key in any client bundle". Guard inventory: `05-testing.md` §9 |
| 5 | Schema change ⇒ a new `server/db/migrations/00N_*.sql`. **Never** an edit to an applied file | Reviewer + template checkbox; `npm run migrate -- --check` reports what is pending | Migrations are forward-only and there are no down-migrations. The rollback policy, the backup that must exist before one, and the restore procedure are owned by `07-deployment.md`; the WAL trap and `VACUUM INTO` are `CLAUDE.md` rule 4. Do not re-derive either here |
| 6 | PDF/docx change ⇒ the MR body says which backend the author exercised: *"my machine tested Word; CI tested LibreOffice."* | **Template checkbox in `Default.md`, with the reviewer opening a thread when it is missing** — CI cannot know what ran on a laptop, so this is reviewer-enforced by design. **Until that template exists it is "the reviewer asks", not a mandatory gate** | Why it matters — Word rejects an unopenable file; LibreOffice renders it as plain text and returns a valid PDF of the raw bytes, exit 0, no warning — is owned by `05-testing.md`, which holds the assertion that keeps it honest |
| 7 | New dependency ⇒ the MR body carries the fields required by `09-security.md` §3 (size, last release, transitive count, why hand-writing is worse) | Reviewer + template checkbox | `09-security.md` §3 holds the precedent and the dev-only carve-out. No ORM, no query builder |
| 8 | The branch is **not behind `main`** — rebase before asking for a merge | The merging maintainer, by hand. A green MR pipeline did **not** test the branch against `main` (merged-results pipelines are Premium). The Free mechanism nobody has taken yet is to set the project's merge method to *"Merge commit with semi-linear history"*, which refuses the merge until the branch is rebased; `merge_method` is `merge` today, and that settings change is owned by `10-roles.md` §2 | The two guard tests most likely to collide semantically without producing a textual conflict are exactly `routes.test.ts` and `screen-wiring.test.ts` |
| 9 | The security checklist in `09-security.md` is satisfied | Reviewer + template checkbox — the template links it, it is not copied | It carries items no other checklist has (`.max()` bounds on new array fields, no request data interpolated into a prepared statement), and while TODO-SEC-01 is open it also carries the rule that no MR may add a route that reads or destroys customer or price data |
| 10 | All discussions resolved, and merged by **someone who is not the author** | GitLab enforces resolution (`only_allow_merge_if_all_discussions_are_resolved=true`) but **not** authorship: a developer cannot merge their own work, a maintainer can and also can resolve their own threads. For a maintainer's MR the mechanism is the discipline rule above plus the monthly sweep in `10-roles.md` §2 | This is the review guarantee, and it is a permission for four-fifths of the team and a promise for the rest |
| 11 | **The merging maintainer stays with the pipeline** until `publish` and `deploy:qa` are green — about 10 minutes — and does not pick up the next thing until the deploy job has finished | A named duty; no machine check exists. Nothing alerts anyone: `06-cicd.md` defines no notification and Uptime Kuma is not installed (`08-monitoring.md`) | Otherwise `main` has moved, QA is still serving the previous digest, and the only person who might notice is whoever happens to open the pipeline page |
| 12 | **From Sprint 1.** After `publish → deploy:qa`, the story is exercised on http://192.168.1.40:8081 against the real ledger master by **someone who is not the author** | Named in the issue at planning; the Sprint Host checks it at retro. There is no QA person — this *is* QA | Note what QA does **not** prove: it runs at `--memory=2g --cpus=2.0`, roughly **double** the intended production shape, so "it was fine on QA" says nothing about the production container. `07-deployment.md` owns the production resource limits |
| 13 | **From Sprint 1.** The **verifier from item 12 closes the issue**, with a sentence saying what they observed on QA — not "done" | Sprint Host reconciles open issues against the milestone at retro | Items 12 and 13 are deliberately the same person. The author closing an issue that someone else verified is how "verified" quietly becomes "merged" |
| 14 | A decision or a measurement ⇒ `PROJECT-LOG.md`. A changed rule ⇒ `CLAUDE.md`. If the test count moved, `CLAUDE.md`'s "444" moves in the same MR | Reviewer + template checkbox | `PROJECT-LOG.md` §3 already says "Tests (10 files)" and lists `@anthropic-ai/sdk` as a runtime dependency. There are 27 test files, and the SDK went out in *"Switch the AI features from Anthropic to Google Gemini"* |

**On the number 444:** that is `CLAUDE.md`'s count with every gate open. Only the **eight converter-gated tests in `pdf.test.ts` can vanish quietly** — on a laptop with neither Word nor LibreOffice you see 436 and the run still says green. The two `web/bundle-safety.test.ts` guards do **not** vanish quietly: the third test in that file is unconditional, so a missing `web/dist` turns the suite red instead of thinning it. CI's count is the authority. (Guard-site arithmetic: `05-testing.md` §9.)

### When a merged story fails verification on QA

Verification is post-merge by design, so this is the most likely lifecycle event in the process — and it was the one nobody had written down.

| Question | Answer |
|---|---|
| Who decides revert vs fix-forward? | The **merging maintainer**, with the author. The default is **fix-forward through a new MR**. Revert (recipe in `03-git.md`) only when `main` is unsafe to build on, or the desk is depending on QA right now |
| Never | Hot-fix QA by hand. QA changes only through `deploy:qa` — a hand-edited row in QA's copy of the real ledger master persists forever, and no pipeline will ever correct it |
| Does the issue reopen? | Yes. It reopens and stays in the current milestone; the fix MR closes it |
| Does it count against the sprint? | It is not re-estimated and it does not get a second size label. If the fix costs more than the original `size-`, something of equal size leaves the milestone the same day — the same trade as a mid-sprint change |
| Who tells the desk? | The **Desk Liaison**, the same day, if the desk had been told the story was ready |

**QA reflects the last merge, not your story.** There is no `resource_group: qa`, so someone else's merge can redeploy QA underneath you while you are looking at it (`06-cicd.md` §4.4 owns the CI fix). Until that lands: say in your daily note that you are verifying, check the pipeline list before you start, and re-verify after any merge that landed while you were in the app.

### Sprint mechanics

**From Sprint 1 — none of these has been held.**

| Activity | When | Duration | Mandatory | Who runs it |
|---|---|---|---|---|
| Planning — including the **Sprint Host counting capacity by hand** (see *Estimation*) and a DoR read on every candidate | Mon week 1, 10:00 IST | ≤45 min | **yes** | Sprint Host; Desk Liaison brings the desk's asks |
| Daily note — comment on the milestone tracking issue: *yesterday / today / blocked* | by 10:30 IST | ≤3 lines | **yes** | each dev |
| Live sync | Mon & Thu 09:45 | 15 min | no — skip if no `blocked` label is open | Sprint Host |
| Refinement | Wed week 2 | 30 min | **yes** | Sprint Host + Desk Liaison only |
| QA walkthrough on `:8081` | Fri week 2 | 20 min | **yes** | Desk Liaison, with the purchase desk present |
| Retrospective | Fri week 2, after the walkthrough | 30 min | **yes** | Sprint Host |

Retro output is **issues, not feelings**: at least one `debt` or `process` issue enters the next milestone, or the retro did not happen.

### Estimation — three sizes, no points

| Label | Means |
|---|---|
| `size-s` | ≤ half a day for one dev |
| `size-m` | ≤ 2 days for one dev |
| `size-l` | more than 2 days — **cannot enter a milestone.** Split at refinement |

**Capacity is a planning heuristic, not a rule: 3 `size-m` equivalents per developer per sprint**, at most 6 of 10 working days. Nothing in Free can sum three labels across a milestone — no weights, no burndown, no aggregate label report — so the mechanism is the Sprint Host counting labels by hand at planning, which is why that is written into the ceremony table. When the count goes over, something comes out. The `size-l` exclusion *is* enforceable, by the same human read at DoR.

The other four days are not slack: they are reviewing other people's MRs (nobody merges their own), exercising someone else's story on QA (DoD 12), staying with the pipeline after a merge (DoD 11), and the sprint's debt issue.

GitLab Free *does* have time tracking (`/estimate`, `/spend`). We decline it: nothing in Free reads it — no burndown, no aggregate report — so it would be a number entered and never looked at. Numbers that matter here go into `PROJECT-LOG.md` next to the thing they measured (90 s conversion timeout, one retry, ~180 s worst case; the ledger count; the QA container's 2 GB / 2 CPU).

### Bug and incident handling — sprint treatment only

**The severity scale is owned by `08-monitoring.md`: one scale, three levels, for the whole framework.** This section no longer defines severities and no longer runs a fourth level. What it owns is what a severity *does to the sprint*.

| Severity (`08-monitoring.md`) | Sprint treatment | Who decides |
|---|---|---|
| **Sev 1** | Drop current work. Fix branch the same day. It never waits for planning | Desk Liaison, no debate |
| **Sev 2** | Into the **current** milestone, ahead of features. Something of equal size leaves the milestone the same day | Sprint Host |
| **Sev 3** | Next milestone, or backlog as `size-s` | Refinement |

**Same-day fix, or sprint item?** A Sev 1 is always same-day, and always gets an issue afterwards even when the fix went first (from Sprint 1). A Sev 2 is a sprint item unless the desk is blocked *right now*, in which case it is scheduled like a Sev 1 and re-labelled afterwards. A Sev 3 never interrupts.

**What gets written down — once, so the four competing thresholds in this framework collapse into one:** every Sev 1 and Sev 2 gets (a) a regression test **named after the situation that produced it**, in the house X-not-Y form, and (b) a dated `PROJECT-LOG.md` entry. `08-monitoring.md` owns the incident issue and the postmortem; this section owns only the rule that the regression test ships **in the fix MR**, not as a follow-up. The existing tests are shaped this way and their docblocks carry the incident — `routes.test.ts`, `screen-wiring.test.ts` and `quote.update.test.ts` each open by naming the bug they exist for. Match that.

### Technical debt — named, evidenced, budgeted

**From Sprint 1: one `debt` issue lands in every milestone**, checked by the Sprint Host at planning. There is no machine check and there cannot be one in Free; with no Sprint Host there is no budget, and the list below only grows.

| Debt | Evidence | What it costs |
|---|---|---|
| **Two frozen migration lists** | `server/src/lib/customers.test.ts:20` and `server/src/lib/importCustomers.test.ts:24` both hardcode `['001_init.sql','002_customers.sql','003_warranty.sql','004_customer_identity.sql']`. `005_queries_numbers.sql` is in neither | Those tests build a schema the app no longer has, and they go on passing while doing it. `server/src/lib/priceHistory.test.ts:20` already does it correctly — `readdirSync(MIGRATIONS).filter(.sql).sort()` — with a comment explaining that 003 kept it passing only by luck. Copy that |
| No linter, no formatter | No eslint or prettier config in the repo. `.gitattributes` normalises line endings; nothing else is checked | Style is decided by whoever merges, in review, on a Friday — and the scoped money rule above has no enforcer at all until eslint lands (`06-cicd.md` §4.1) |
| No coverage tooling at all | `@vitest/coverage-v8` absent from `package.json`; `vitest.config.ts` has no `coverage` block | We cannot say what 444 tests miss, only that there are 444. The coverage extraction and the per-directory floors are owned by `06-cicd.md`; the reasoning about why a global percentage is meaningless here is `05-testing.md`'s |
| No dependency or security scanning in the pipeline | `.gitlab-ci.yml` is `build → test → publish → deploy:qa`, nothing else | Precisely: **SAST and Secret Detection analyzers do run on Free** and emit a JSON artifact — no MR widget, no Security Dashboard, no vulnerability tracking over time (all Ultimate) — so a job has to read the artifact and fail on its own. **Dependency Scanning and Container Scanning are Ultimate only and do not run on Free at all**, so dependency checking must be an ordinary job (`npm audit` / `osv-scanner`), never GitLab's template. Tier matrix: `06-cicd.md` §2. **Unverified:** whether the `qa` runner can pull analyzer images from `registry.gitlab.com` — check before writing the issue |
| 5 untriaged `npm audit` advisories | `PROJECT-LOG.md` §7 item 6 — all transitive through build tooling | The job that produces the number is owned by `06-cicd.md`; the **policy, the cadence and the named owner of these five** are owned by `09-security.md`. Note the trap that section has to settle: all five are dev-tooling transitives, so `--omit=dev` may report zero and make the job look like it is working while measuring nothing |
| Backup script written, never scheduled; no monitoring | `npm run backup` exists; no schedule, no external drive purchased; Uptime Kuma planned, not installed | An unscheduled backup is the same as no backup on the day a migration goes wrong. The schedule and its destination are `08-monitoring.md`'s; deploy-time backups are `07-deployment.md`'s |
| Onboarding artefacts are not in the repository | `ONBOARDING.md` hands a new dev three files; `setup-workstation.ps1` and `newtech-ca.crt` are not tracked (`find . -name '*.ps1'` → nothing) | The script that configures every developer's machine has no review path, no history and no test — and it is exactly the file the PowerShell 5.1 trap applies to (5.1 cannot read a BOM-less UTF-8 file, so it must stay ASCII-only; one pasted em-dash breaks setup for the next hire) |
| `PROJECT-LOG.md` §3 is stale, and nothing marks it superseded | Says "Tests (10 files)" and lists `@anthropic-ai/sdk` as a runtime dependency; `05-testing.md` has found the same rot in §6 of the log | 27 test files; the SDK was removed. The log is append-only and past entries are never rewritten (`10-roles.md` §10) — so the fix is **a new dated entry that names the superseded one**, and writing it is the debt issue's deliverable. Counts in a journal go stale; dated entries with reasoning do not |

**Corrected, so nobody re-opens it as debt:** test-database isolation is already right. Every test that touches the database mocks the client — `vi.mock('../db/client.js', () => ({ getDb: () => db }))` in `cascade.test.ts`, `priceHistory.test.ts`, `quote.customer.test.ts`, `quote.ref.test.ts`, `quote.update.test.ts`, `quote.warranty.test.ts` — and points it at `:memory:` or an `mkdtempSync` file. No test file opens `data/quotes.db`.

Debt is **not** fixed opportunistically inside a feature MR. Its own issue, its own MR, its own log line — because a refactor smuggled into a feature branch is one the reviewer reads as part of the feature and skims, and the review is the only gate we have.

### Mid-sprint changes, blockers, and urgency

| Situation | Rule |
|---|---|
| **The desk asks for something mid-sprint** | They may. Something of equal size leaves the milestone the *same day*, and the Desk Liaison comments *why* on the issue that left. No silent growth. Only a Sev 1 skips the trade |
| **Blockers** | Blocking links are Premium. Use the `blocked` label plus a comment naming what blocks it and who owns the unblock. Still labelled after 24 h ⇒ it appears in the daily note until it clears. Cross-project references (`newtech/inventory#12`) work in Free, and will matter as inventory, pickup-ops and tracker onboard |
| **Urgent "production" issue** | **Production is not deployed.** Blocker zero is TODO-SEC-01 — the application has no authentication of any kind — see `09-security.md`, which owns the complete precondition list; the infrastructure blockers are `07-deployment.md`'s. Today "urgent" means QA is broken or the desk cannot issue a real quotation. There is no override: `main` has `push_access_level=0`, so nobody can push, administrators included. Branch, MR, green pipeline, a maintainer merges. The pipeline is the floor on response time |
| **The desk needs a document right now** | **OPEN — this section cannot decide it alone, and the framework currently answers it three different ways.** Whether the purchase desk may issue *real customer* quotations from the QA container is a data-protection decision (`09-security.md`) with a backup consequence (`07-deployment.md`: `quotation_qa_data` is backed up by nothing, and QA recovery today means re-importing the ledger master and losing every quotation in it). Take the decision at Sprint 1 planning and record it here. **Until it is taken, treat QA output as disposable and do not send it to a customer.** What is *not* open: we do not merge unreviewed code to shorten a wait |

**When production lands:** see `07-deployment.md` (host, blockers, ports, deploy sequence, rollback, version bumps) and `09-security.md` (blocker zero). Nothing about production belongs in this section beyond one sprint consequence: **no story may be accepted whose acceptance criteria can only be proved in production.**

### For AI agents working this process

`02-ai-rules.md` is the full set; these are the ones this section owns.

1. Read `CLAUDE.md` first. It loads automatically and it outranks convenience — with one correction pending in it, the money rule (item 8 below).
2. **From Sprint 1:** no MR without a linked issue that passed DoR, and quote the issue number in the MR description. **Not in force today** — GitLab issues are unused, so today the MR description *is* the record.
3. Branch and commit convention: `03-git.md`. Never a conventional-commit prefix; imperative, and say *why*.
4. Never add a dependency without the fields `09-security.md` §3 requires, in the MR body.
5. State which tests you **ran** and on which backend, and run `npm run build` before `npm test` — without `web/dist` the suite is red, not green. "Looks correct" is not a test result.
6. A new route, or a new field in a schema shape, will turn a guard test red on purpose. Update it deliberately; **never weaken the assertion.** Inventory: `05-testing.md` §5.
7. Do not write a test that renders a React component or drives a browser. `environment: 'node'`, no jsdom, no driver — it will not run here.
8. **Money is stored and compared only as integer paise. A division may appear only where its result is immediately floored or rounded back to an integer** — `shared/money.ts` does exactly that, six times, and is correct. Never store, compare, sum or round-trip a fractional rupee.
9. Never `cp data/quotes.db` (`CLAUDE.md` rule 4). Never edit an applied migration. A customer is a ledger, not a name.
