## Roles, Responsibilities and Governance

> **Reference convention.** `§N` means a numbered section *of this file*. Anything owned by
> another section is named by its filename — `07-deployment.md`, `09-security.md` — and is
> **not restated here**. This section owns: the hats, the headcount, the GitLab permission
> matrix, the protected-branch settings table, release *authority* (not release mechanics),
> onboarding/offboarding, escalation routing, and document ownership.
>
> **Status of this framework:** it describes a process that has **not started**. GitLab
> issues are unused (zero), there is no `.gitlab/` directory, no sprint has been run, and
> production is not deployed. Anything below marked **From Sprint 1** is a decision that has
> been taken and is *not in force today*.

### 1. Five people, and what a hat actually controls

Five developers. No QA, no PO, no scrum master. Roles are **hats**, not people; one person wears several, and nobody wears two hats on the same change.

| Hat | Count | What it actually controls | GitLab level |
|---|---|---|---|
| Developer | 5 (everyone) | Branches, MRs, tests. `npm run build && npm run typecheck && npm test` before push (the build first — see §7.7) | Developer |
| Maintainer | 2 | Clicks **Merge** — the only human gate on `main`. Pushes `v*` tags. Owns the release (§6) | Maintainer |
| SysAdmin | 1 | The HP Z6 (192.168.3.249 / 192.168.1.40): GitLab EE, the socket-bound `qa` runner, registry `:5050`, QA on `:8081`, disk headroom, the internal CA, the `newtech-ca.crt` + `setup-workstation.ps1` pair handed to new laptops — **and `.gitlab-ci.yml` itself** (§3) | Owner + root on the box |
| GitLab instance admin | 1 (same person today) | Creates accounts — signup is disabled, so this is the entire perimeter | Instance Admin |
| **Data protection (DPDP)** | 1 (the Owner) | **New — this hat did not exist and the responsibility was assigned to nobody.** Named responsible person under the DPDP Act, 2023: the retention decision `09-security.md` §7 leaves open, the BitLocker register (§7.8, §8.7), witnessing the offboarding deletion, and the undecided question of whether the desk may issue real customer quotations from QA (§4) | — (not a GitLab role) |

Fill real names into the table below and **nowhere else in this document**:

| Person | Hats |
|---|---|
| A | Owner, instance admin, SysAdmin, Maintainer, Data protection |
| B | Maintainer, Developer |
| C, D, E | Developer |

**Headcount is settled here, and other sections cite it.** Two Maintainers, one of whom is the Owner — so **two people can merge, not three**. Any section that rests the review guarantee on a third pair of hands is counting a person who does not exist.

**Gap — one box, one person.** A's workstation holds GitLab, the runner, the registry and QA. Developers' clones are full (`GIT_DEPTH: "0"`), so the *commits* survive that box dying; every merge request, review thread, pipeline record and pushed image does not — and Free records no audit events to reconstruct them from. Two Maintainers is also one holiday away from nothing merging. Promote a third once C, D or E has ~10 merged MRs.

### 2. What enforces review, and what is decoration

GitLab Free **cannot require approvals**. The Approve button exists, records a name, and blocks nothing. Approval rules, "prevent approval by author", **Code Owners in its entirety** (§10), push rules, merged-results pipelines and audit events are Premium or above. Do not write a process that leans on any of them. `06-cicd.md` §2 owns the full Free / Premium / Ultimate matrix; the four rows above are the only ones this section's governance depends on.

Configured today on `newtech/quotation-desk`, verified against the API. **This table is the single copy** — every other section states only the consequence it depends on and links here, because five verbatim copies of a live server configuration guarantee the first drift is invisible:

| Setting | Value | What it stops |
|---|---|---|
| `push_access_level` on `main` | `0` | Nobody pushes to `main` — administrators included (verified) |
| `merge_access_level` | `40` | Only Maintainers merge, so **a Developer cannot land their own work** |
| `merge_method` | `merge` (verified) | Nothing. It does **not** require the branch to be rebased — see the semi-linear note below |
| `only_allow_merge_if_pipeline_succeeds` | `true` | Merge is blocked until `build` and `test` pass **inside the Linux container**, against LibreOffice |
| `only_allow_merge_if_all_discussions_are_resolved` | `true` | An open thread is an unclickable Merge button — **but the author can resolve their own threads** (see below) |
| `squash_option` / `remove_source_branch_after_merge` | `default_on` / `true` | Branch noise |
| Protected tags `v*` | Maintainers only | An ordinary branch can never become a release tag |
| Signup | disabled | Accounts exist only because the instance admin made them |

**Say the limits of the guarantee plainly, because four other sections state it too strongly.**

- **The Developer case is machine-enforced.** `merge_access_level=40` means C, D or E physically cannot merge their own MR. For them, "the person who merges is the reviewer" is a fact.
- **The Maintainer case is not enforced by anything.** GitLab Free lets a Maintainer merge their own MR, and lets any author resolve their own discussion threads. So for the two people doing most of the merging, both controls in the table above are self-serviceable. This is a rule, not a mechanism.
- **The person who clicks Merge is the reviewer of record**, accountable as if they wrote it. Objections are raised as **threads**, never as Approve/Reject — a thread blocks the merge (unless the author clears it), an approval never does.

**Rule: a Maintainer never merges their own MR. The other one does.** Nothing prevents it, so it is a *detective* control, and §2's sweep below is the detector. It is mandatory because it is checked — not because GitLab enforces it.

**No merge-request pipelines run** — `.gitlab-ci.yml` has no `workflow:` rules, so the pipeline attached to an MR is the *branch* pipeline for its head commit. Nothing tests the merge result. Merged-results pipelines are Premium. Today the substitute is manual: **the merging Maintainer confirms the branch is not behind `main`** before clicking. A branch green against a stale base has merged a red `main` before.

**Recommended change, and it converts that instruction into a blocked button:** set `merge_method` to **"Merge commit with semi-linear history"** (Free). GitLab then refuses the merge until the source branch has been rebased onto the target, while still writing the merge commit `03-git.md` wants to keep. It is one project setting, it is free, and it is the only mechanism in this framework that turns "please rebase" into something a human cannot forget. **Not configured today** — `merge_method` is `merge`. Until it is, the rebase check is a reviewer obligation with no machine behind it, and it belongs on the MR template (`01-agile.md` owns the template set).

**The monthly sweep — owned by the Owner hat, first working day of each month, count published in `PROJECT-LOG.md`.** It was previously listed as a gap with no owner; a mandatory rule nobody checks teaches the team the mandatory list is aspirational. All Free API, all cheap:

1. **Self-merge detection.** `GET /api/v4/projects/:id/merge_requests?state=merged&target_branch=main&per_page=100`, then flag any MR where `author.username == merge_user.username` (`merged_by.username` on older API versions):
   `jq '.[] | select(.author.username == .merge_user.username) | {iid, title, author: .author.username}'`
   A hit is a conversation, not a rollback. Zero hits is also a result — write the number down.
2. **Settings drift.** `GET /api/v4/projects/:id` and `GET /api/v4/projects/:id/protected_branches`, compared against the table above. An instance admin can change any of them silently and Free logs nothing.

Two numbers, one line in the log, ten minutes. If the Owner stops running it, the self-merge rule drops to **recommended** the same month — say so out loud rather than leaving it marked mandatory.

### 3. The trust boundary nobody voted for: the `qa` runner

`.gitlab-ci.yml` says it plainly: the runner mounts the host Docker socket, so **a CI job can control the host daemon, which is effectively root on the machine that hosts GitLab, the registry and QA.** The `build` and `test` jobs have no branch rules — they run on every push, from any Developer, before any review.

Consequences that follow, and are not negotiable:

- **Reviewing `.gitlab-ci.yml` in an MR is after the fact.** A pipeline change executes as root on push. `.gitlab-ci.yml` review catches mistakes, not malice. The control that catches malice is account issuance — which is why signup is disabled and why the instance-admin hat is not handed around.
- **The real perimeter is "who has an account", not "who can merge".** Offboarding (§8) is therefore urgent, not tidy.
- Every pipeline leaves two more images on that daemon — `:test-<short sha>` and `:<full sha>` — and **nothing prunes them.** Only the runtime image is pushed; the test images accumulate on the box. The disk that fills takes source control, CI, the registry and QA down in one stroke. This project already filled a disk once: 282 orphaned `WINWORD.EXE` processes wrote 12.7 GB of Office telemetry into `%TEMP%\Diagnostics`, and a write that landed on the full disk left **`server/src/lib/parser.ts` at zero bytes** (commit `be96eb9` — the incident is recorded in the commit body, not in any prose document, which is itself the argument for `03-git.md`'s commit-message rule).
- **SysAdmin owns disk headroom and holds the retention hat; the policy itself is `08-monitoring.md`'s.** One constraint travels with the hat and must survive whatever policy is written: **never delete a digest that is still a rollback target.** A "keep the last N tags" rule deletes a released digest on release N+1, and that digest is the only thing production can be rolled back to (`07-deployment.md`).
- The eventual production deploy gets a **separate runner on the production host, restricted to protected tags** — already the stated design at the foot of `.gitlab-ci.yml`, precisely so a feature branch can never reach production.

**`.gitlab-ci.yml` has one owner: the SysAdmin hat.** Five sections currently propose eleven-plus edits to this file — coverage extraction, `test:no-skips`, secret and lint jobs, `deps`, `resource_group: qa`, log options, pre-`rm` log capture, tag rules, `deploy:prod`, `rollback:prod` — and several are mutually exclusive. They land in this order, one MR each, because the first three change the shape the next five have to fit:

1. **Tag rules first** — `build` and `test` get `rules: [{ if: $CI_COMMIT_TAG, when: never }, { when: on_success }]`, `publish` stays default-branch-only. Nothing else can be reasoned about until the tag pipeline is known not to rebuild (§5).
2. `resource_group: qa` and log options — cheap, no dependencies, stops the QA race.
3. The `test` job rewrite: coverage extraction and JUnit, exactly once, `06-cicd.md`'s version (`05-testing.md` keeps the reasoning, not the YAML).
4. `test:no-skips`, which needs the JUnit artifact from step 3.
5. `deps` (`06-cicd.md` owns the job; `09-security.md` owns the policy and cadence).
6. `deploy:prod` / `rollback:prod` — blocked on §5 anyway.

A Maintainer merging an MR that reorders these owes the SysAdmin a conversation first. An AI agent may not open one at all without saying so in the MR title (§11.1).

### 4. Permissions matrix

This is the authoritative role → permission map; other sections cite rows from it.

| Action | Developer | Maintainer | Owner | Instance admin |
|---|---|---|---|---|
| Push a feature branch (and thereby run root-capable CI) | Yes | Yes | Yes | Yes |
| Push to `main` | **No** | **No** | **No** | **No** (verified) |
| Merge an MR into `main` | No | Yes | Yes | Only as a project member |
| Merge own MR | **Cannot** (`merge_access_level=40`) | **Never** — rule only; nothing prevents it (§2) | Never — rule only | — |
| Resolve a discussion thread on own MR | Yes (nothing prevents it) | Yes | Yes | — |
| Create/push a `v*` tag | No | Yes | Yes | — |
| Run / retry a pipeline job | Yes | Yes | Yes | Yes |
| Edit `.gitlab-ci.yml` | Yes on a branch — **it runs before review** | Merges it, after the SysAdmin agrees the ordering (§3) | Owns the file | — |
| Change protected branch / tag rules, or `merge_method` | No | Yes | Yes | Yes (unlogged in Free) |
| Add a project member | No | Up to Maintainer | Any | Any |
| Create a GitLab account | No | No | No | **Yes, only** |
| Register or retag the `qa` runner | No | No | Yes | Yes |
| Restart / replace the QA container by hand | **No** | **No** | Outage recovery only, then re-run `deploy:qa` | — |
| `docker exec` into QA, edit its database | No | No | SysAdmin only | — |
| Write a row into QA's database from CI | **Undecided — no job may do this yet** (see below) | | | |
| Restore `quotes.db` from a backup | No | No | SysAdmin only | — |
| Reconcile re-issued reference numbers with the desk after a restore | No | No | **Owner, before the desk sends anything** (§9) | — |
| Decide DPDP retention; hold the BitLocker register | No | No | **Data protection hat** | — |
| Run the monthly governance sweep (§2) | No | No | **Owner** | — |
| Deploy to production | **Nobody. Production does not exist** | | | |

**There are no CI/CD variables holding secrets, and nothing to hand out.** The pipeline authenticates to the registry with the predefined `$CI_REGISTRY_USER` / `$CI_REGISTRY_PASSWORD` job credentials, which expire with the job. `GEMINI_API_KEY` is **not** in CI — the whole 450-test suite runs without it; it lives only in each developer's local `.env`. If someone adds a CI variable, that changes and this row must change with it.

**QA is only ever changed by `deploy:qa`.** The job re-pulls by `sha256` digest and then asserts the running container is that digest; `06-cicd.md` §1 owns the mechanics and why each step is written the way it is. The governance point is the one that outlives the mechanics: **a hand-started container breaks the promise twice** — until the next merge QA is answering with bytes nobody tested, and at the next merge `docker rm -f quotation-qa` deletes it and the hand-fix leaves no trace. Data survives (the named volume `quotation_qa_data`), which is worse, not better: a hand-edited row in QA's copy of the 225 real ledgers persists forever and no pipeline will ever correct it.

**Open decision, and it is this section's to route, not CI's.** `06-cicd.md` proposes a `smoke:qa` job that POSTs a quotation into QA on every merge; `02-ai-rules.md`'s Stop List forbids writing to QA at all. Both cannot stand. Because QA holds 225 real ledgers and has no authentication (`09-security.md` §0), this is a **data-protection decision, taken by the Data protection hat and recorded in `PROJECT-LOG.md`**, before the job is written. Two acceptable outcomes: the smoke test is **read-only**, or the Stop List gains an explicit carve-out naming the CI actor *and* a cleanup step. Until one is recorded, **no job writes to QA** — and that prohibition is honest only for as long as nobody merges the job.

### 5. Production deployment authority

Production is **not deployed**, `.gitlab-ci.yml` has no production job, and **no one has authority to create one today**. The host, its three incumbent apps, the RAM blocker, the CPU measurement and the port (production is `18080`, *not* QA's `8081`) are all owned by **`07-deployment.md` § Status** — that section has the numbered blocker list and the environment table. Do not re-derive them here.

**The gate list is owned by `09-security.md` §8, and blocker zero is TODO-SEC-01** — the application has no authentication, all 16 routes are public including `GET /api/customers` (225 real ledgers with GSTINs and addresses) and an unauthenticated hard `DELETE /api/quotes/:id`. This section previously published a four-item precondition list that omitted it; a partial list that reads as complete is worse than no list, because it can be satisfied. **There is one gate list. It is `09-security.md` §8.**

Two things this section does own, and they survive the cut:

1. **The monitoring gate is only met when the monitoring covers the three incumbent apps, not only this one.** The risk being managed is evicting Pickup Ops, Newtech Inventory and IIS from a machine with ~491 MB free — so a monitor set that watches only the quotation desk does not close it. `08-monitoring.md`'s six planned Uptime Kuma monitors currently watch none of the three. Until they do, that gate is unmeetable and production is blocked for a reason nobody has costed.
2. **Authority itself.** When `09-security.md` §8's gates are closed and the Owner has recorded the evidence in `PROJECT-LOG.md`: **the Owner approves in writing, a Maintainer executes, the other Maintainer reviews the release diff.** Two people, always. The job is manual, restricted to protected tags, and runs on a runner installed on the production host so CI needs no inbound path and GitLab stores no SSH key.

**One release rule that is an authority question, not a CI question: production runs the digest QA tested, and never rebuilds.** The Dockerfile runs `apt-get update` in three stages, so a rebuild at tag time resolves different package versions and yields a different `sha256` — different bytes from the ones that were tested. A Maintainer may not approve a release whose pipeline rebuilds at tag time; that is not a release, it is an untested build with a version number. The corrected job graph is `07-deployment.md`'s (`build`/`test` excluded on tags, `deploy:prod` with `needs: []` and an explicit digest).

### 6. What "release" means today

There is no release ceremony, because there is nowhere to release to. **Merging to `main` is the release**: `publish` and `deploy:qa` are gated on `$CI_COMMIT_BRANCH == $CI_DEFAULT_BRANCH` and fire automatically. A `v*` tag today runs `build` and `test` and then stops — `CI_COMMIT_BRANCH` is unset on a tag pipeline, so publish never runs. Tagging is a bookmark, not a deployment. (Version *numbering* — which change is MINOR and which is PATCH — is `07-deployment.md` § Version numbering. Branch names and commit style are `03-git.md`.)

So the merging Maintainer owns the release, and owns three checks the pipeline cannot yet make for them:

| Check | Mechanism | Why |
|---|---|---|
| The branch is not behind `main` | **None today.** Becomes machine-enforced the day `merge_method` is set to semi-linear (§2); until then the Maintainer looks, and it belongs on the MR template | No merged-results pipelines in Free (§2) |
| **Zero skipped tests in the container** | **From the commit that adds `test:no-skips`** (`06-cicd.md` owns that job — it fails on any `<skipped` in the JUnit XML, and fails when the artifact is missing). Until it lands, the Maintainer reads the test job log. That is a *recommendation with a named person*, not a gate | A skip in CI means a guard stopped guarding. The guard inventory — 8 guard sites covering 10 test cases — is `05-testing.md` §9's table; do not re-count it here |
| `deploy:qa` reported health `ok`, not `degraded` | **Machine-enforced already** — the job reads `/api/health` from inside the container and fails on anything but `ok` | The container's own healthcheck deliberately passes on `degraded` so a missing converter cannot kill it. Read the job's line, do not assume it |

**And one obligation nobody had: stay with the pipeline.** Between "MR merged" and "QA is running the new bytes" nobody was watching — if `publish` or `deploy:qa` fails after a merge, `main` has moved, QA is still serving the previous digest, and nothing alerts anyone (`08-monitoring.md`: Uptime Kuma is not installed). **The merging Maintainer stays on the `main` pipeline page until `deploy:qa` is green — typically 3–6 minutes — and if it fails, says so in the team channel before starting anything else.** A red `deploy:qa` on `main` is a Sev 2 at least: the desk is on the previous digest and does not know it.

**QA reflects the last merge, not your story.** There is no `resource_group: qa`, so a merge can `docker rm -f quotation-qa` underneath someone verifying on it. Verify before or after a merge, not across one, and re-check after any merge that lands mid-verification.

Then one paragraph in `PROJECT-LOG.md` if anything was learned or measured. `PROJECT-LOG.md` is a journal, not a changelog — "merged MR !47" is not an entry.

**Gap:** a Release Manager rotation is worth having when production exists. Today it would be ceremony over an automatic job.

### 7. Onboarding

Machine setup is **`ONBOARDING.md`** (7 steps, ~30 minutes, ending at `npm run dev` on http://localhost:5173). Do not duplicate it. Governance adds only this:

1. The instance admin creates the account — signup is disabled — at **Developer**. Never Maintainer on day one.
2. `newtech-ca.crt` and `setup-workstation.ps1` are handed over **out of band**, and the SSH host fingerprint in Step 5 is checked, not skipped. There is no DNS on this LAN and no public exposure; the hosts file and that certificate are the whole trust chain.
3. `setup-workstation.ps1` stays **ASCII-only**. PowerShell 5.1 cannot read a BOM-less UTF-8 file, so one pasted em dash or curly quote breaks new-laptop setup for everyone after you. **Gap, and it is owned: the SysAdmin puts both files into the repository** (`tools/workstation/`), because today the first command a new developer runs on a bare machine is a script no reviewer has seen, no CI job lints and no test runs. An ASCII-only rule on an untracked file is a wish.
4. They read `PROJECT-LOG.md` §10 (reading order) and §8 (customer identity) before their first MR, and `CLAUDE.md` themselves — their AI assistant already reads it automatically, and the five rules there are correctness, not style. **Read §10 of this section first for the money rule**: `CLAUDE.md` rule 1 is currently mis-stated and the corrected wording lives there until a Maintainer fixes it.
5. First MR is deliberately small, and the Maintainer who merges it explains the review out loud.
6. **They are told in writing that their clone contains real customer data.** `Resources/List of Sundry Debtors with address and GSTIN.xlsx` — 225 Tally ledgers with real GSTINs and addresses — is deliberately **not** gitignored, because 33 tests in `importCustomers.test.ts` assert against the real export (Tally's `\x04` before "Not Applicable", addresses flattened into one cell, a GSTIN with a trailing carriage return); a hand-built fixture would carry none of it. `data/`, `backups/` and `Supporting Documents/` are gitignored and handed over separately.
7. Note for their own sanity: `npm test` on a fresh clone **fails** until `npm run build` has been run once — `bundle-safety.test.ts` ends with a non-conditional assertion that `web/dist` exists, precisely so its two `runIf` tests cannot pass vacuously. The correct local command is `npm run build && npm run typecheck && npm test`. Without the build the suite is **red**, not green-with-skips.
8. **BitLocker, and the register that makes it real.** `09-security.md` §7 makes full-disk encryption mandatory on all five laptops, the workstation and any backup drive. Nobody was collecting the evidence, which made it a sentence rather than a control. The **Data protection hat** runs `manage-bde -status` at onboarding and records one dated line per machine in `PROJECT-LOG.md`; it is re-confirmed at offboarding (§8.7). If nobody will keep the register, the rule drops to **recommended** — a documented mandatory control that would fail an audit on day one is worse than an honest gap.

### 8. Offboarding — same day, by the GitLab instance admin

| # | Action | Consequence if skipped |
|---|---|---|
| 1 | **Block** the GitLab user. Do not delete | Deleting reassigns their MRs, notes and threads to the Ghost User. With no audit events in Free, the review history is the only record of who reviewed what — deletion destroys it |
| 2 | Revoke PATs, SSH keys, sessions, impersonation tokens | An SSH key still on the instance can push a branch, and a branch push runs root-capable CI on the workstation (§3) |
| 3 | Remove from project members | And from the group, once inventory / pickup-ops / tracker are onboarded alongside |
| 4 | Rotate the Gemini API key | It is in their `.env` in plaintext. There is no CI variable to update; each remaining developer replaces the line in their own `.env`. Nothing else breaks — the suite never needed it |
| 5 | If they held the runner registration token or were an instance admin, rotate it | A registration token buys a runner on the socket-bound host, i.e. root |
| 6 | Remove their AnyDesk access to 192.168.1.37 | That laptop runs three live business apps |
| 7 | **Delete local customer data, witnessed by the Data protection hat**: `data/quotes.db` + `-wal` + `-shm`, `backups/`, `Supporting Documents/`, and the clone itself (which contains the debtors export). Close the machine's line in the BitLocker register (§7.8) | This is the step that matters. Real GSTINs and addresses on a departed laptop are the exposure; the GitLab account is not. "Witnessed" previously named no witness, which meant it was not witnessed |
| 8 | One line in `PROJECT-LOG.md` confirming 1–7, signed by the instance admin and the witness | It is the only record that exists |

### 9. Escalation

`08-monitoring.md` owns the **one severity scale** for this whole framework — three levels, Sev 1 / Sev 2 / Sev 3. This table routes situations to people; it does not define its own severities, and the "P1" that used to appear here is gone.

| Situation | First | Then |
|---|---|---|
| Red pipeline on `main` | Author of the merged MR | The Maintainer who merged it. Revert first, diagnose after — `main` red blocks everyone's merges |
| `publish` or `deploy:qa` red after a merge | The merging Maintainer, who is still watching (§6) | SysAdmin. QA is serving the previous digest and the desk does not know |
| Runner offline, registry unreachable, QA down, **disk filling** | SysAdmin | Owner. All four live on one box; treat a disk warning as a **Sev 1**, not housekeeping |
| Wrong number on a customer-facing quotation | Whoever noticed → a Maintainer immediately | Owner. It is a defect: a failing test first, then the fix. Assert the database, not the response |
| Secret committed | Any developer → instance admin **within the hour** | Rotate first, rewrite history second. The repo is internal but every clone is a copy |
| Ambiguous customer shipped on a real quotation | Maintainer | Owner. Wrong ship-to state = wrong IGST vs CGST+SGST on company letterhead. A tax error, not a typo |
| QA database corrupt | SysAdmin restores from a backup — migrations are forward-only, there is no down path (`07-deployment.md` owns the restore procedure) | Owner **must reconcile reference numbers with the desk before it sends anything.** `allocateRef` is an atomic UPSERT on a forward-only counter, so a restore *will* re-issue numbers that may already have been emailed. This is guaranteed by every restore, not an edge case, and it is the Owner's call to the desk — not the SysAdmin's problem to notice |

No pager, no rota: five people in one office. Say it out loud, then write it down.

**Where it gets written: a GitLab issue, labelled per `08-monitoring.md`. From Sprint 1 — not in force today.** The fork this section used to leave open ("issues exist and are unused, so use the MR description") is now closed in favour of adopting issues, because six other sections already assume them and two homes for "why" is worse than one. Until the first `.gitlab/issue_templates/` file lands there are zero issues, so today's record is `PROJECT-LOG.md` — and that ends the day `.gitlab/` lands, which is also the day Sprint 1 starts (`01-agile.md`).

### 10. Document ownership — one fact, one home

| Document | Owns | Never contains | Changed by |
|---|---|---|---|
| `README.md` | What the app does, how to run it, the two signatories (RG / LD) and why their four contact details are two sets, the PDF backends | Process, roles, infrastructure | Any developer, in the MR that changes the behaviour |
| `PROJECT-LOG.md` | **Why** — decisions, measurements, corrections. Append-only | Instructions; it is not a manual | Whoever made the decision. Past entries are never rewritten to match a later one — a later entry supersedes an earlier one and says which |
| `PROMPT.md` | The original specification | Corrections. §4 of the log records four places the spec was wrong — **the spec is not edited to match reality** | Effectively frozen |
| `CLAUDE.md` | Rules binding AI assistants: integer paise, ledger-not-name, forward-only migrations, never `cp` the `.db`, Word-vs-LibreOffice, commit style | Roles, permissions, release process | Maintainer only |
| `ONBOARDING.md` | New machine, step by step, plain English | Why decisions were made | Any developer who hit a gap doing it |
| `.gitlab-ci.yml` | Deployment mechanics **and their reasoning, in comments** | — | SysAdmin owns it, a Maintainer merges it — and remember it executes before review (§3) |
| `docs/sdlc/` | This framework, ten sections, **one owner per topic** (map below) | Setup steps, app behaviour | Owner or a Maintainer |

**The single-owner map**, so nobody has to guess where a rule lives:

| Topic | Owner |
|---|---|
| Severity scale (one scale, three levels) | `08-monitoring.md` |
| Production precondition / gate list (**blocker zero = TODO-SEC-01**) | `09-security.md` |
| Semantic version bump rules | `07-deployment.md` |
| Deploy sequence, incl. backup-before-migrate and the first-deploy-has-no-database case | `07-deployment.md` |
| Migration rollback policy | `07-deployment.md` |
| Image retention / registry cleanup (**never delete a live rollback target**) | `08-monitoring.md` |
| `npm audit` / dependency triage — the **job** | `06-cicd.md` |
| `npm audit` / dependency triage — the **policy and cadence** | `09-security.md` |
| The `test` job, coverage extraction, `test:no-skips` | `06-cicd.md` |
| The test ladder, and which tests a change needs | `05-testing.md` |
| Issue and MR templates, DoR / DoD content — **the single merge gate** | `01-agile.md` |
| GitLab Free / Premium / Ultimate feature matrix | `06-cicd.md` §2 |
| Branch naming and commit convention | `03-git.md` |
| The AI Stop List | `02-ai-rules.md` |
| Role → GitLab permission matrix, protected-branch settings, release authority | **this section** |

**One fact has one home; everything else links to it.** If an MR makes two documents disagree, the MR is wrong — fix the owning document in the same MR. `CLAUDE.md` wins on code rules, this framework wins on process, `PROJECT-LOG.md` wins on history and is never rewritten.

**Do not add a `CODEOWNERS` file — the entire feature is Premium, not just its enforcement.** In GitLab Free a `CODEOWNERS` file is **not parsed at all**: it cannot request a reviewer, cannot mark anyone as an owner, cannot block a merge, and produces no UI. It would sit in the repository reading as if it did all four. If a "who knows what" lookup is wanted, a plain `REVIEWERS.md` is honest — it is a **human lookup table only**, with no mechanism behind it, and it must say so on its first line.

**Correction owed to `CLAUDE.md`, rule 1.** As written there — *"never a division by 100"* — the rule is **wrong, and the codebase it protects already violates it**: `shared/money.ts` divides by 100 six times (lines 53, 66, 92, 112, 158, 172) and every one is inside `Math.floor` or `Math.round`, which is correct integer arithmetic. A rule the code breaks on purpose is a rule the next person switches off. **The real rule, and the wording to use everywhere until `CLAUDE.md` is fixed by a Maintainer:**

> Money is stored and compared **only as integer paise**. A division may appear only where its result is **immediately floored or rounded back to an integer**. Never store, compare, sum or round-trip a fractional rupee.

Scoped that way it is also machine-checkable — an eslint `no-restricted-syntax` rule banning `/ 100`, `toFixed(` and `parseFloat(` in `server/src/**` and `shared/**` **except `shared/money.ts`**, with `web/src/**` excluded entirely (`DocumentPreview.tsx` uses `toFixed` for CSS column widths). `06-cicd.md` §4.1 owns that job. It passes clean on today's tree; the blanket version does not.

### 11. What an AI agent may not do

`02-ai-rules.md` is the full Stop List. This section carries only the **permission-shaped** rules — the ones that are about authority rather than about code. An agent acts with the permissions of the human running it. That human is the author and is accountable for every line.

1. **May not merge, tag, change protected settings or `merge_method`, or edit `.gitlab-ci.yml` without saying so in the MR title** — a pipeline change is code execution on the GitLab host (§3), and the file has an owner (§3).
2. **May not edit an applied migration.** Add `006_*.sql`. There is no down path; rolling back means restoring a backup (`07-deployment.md` owns the procedure), and backups are not yet scheduled.
   *Machine check, and it does not exist yet:* a `test`-stage step running `git diff --name-only --diff-filter=M origin/main...HEAD -- server/db/migrations/` and failing on any output — modifications rejected, additions allowed. One command, no new dependency. Until it lands, this is the reviewer's job.
3. **May not add a dependency** without the justification `09-security.md` §3 requires (size, last release, transitive count, why hand-writing is worse). The `xlsx` precedent lives there; do not re-argue it here.
4. **May not weaken a guard.** A new route is *supposed to* fail `routes.test.ts`; a new schema field is *supposed to* fail `screen-wiring.test.ts`. Update the expected list, never loosen the assertion, and never delete the self-check that stops a source-reading test passing vacuously. `05-testing.md` §5 owns the list and the route-name drift in it.
5. **May not claim a PDF change works from a Windows/Word run.** Say it plainly in the MR: *"my machine tested Word; CI tested LibreOffice."* `05-testing.md` owns why the two differ. **Nothing checks this and CI cannot** — it has no way to know what ran on a laptop. Until `.gitlab/merge_request_templates/Default.md` exists (`01-agile.md` owns the template set), the enforcement is **the reviewer opening a thread when the sentence is missing**, which is the one gate Free actually provides. Stated honestly: today it is "the reviewer asks".
6. **May not report a change as verified from reading the code.** Run `npm run build && npm run typecheck && npm test`, and say which. The build is not optional — without it the suite is red (§7.7), which also means "did the author build?" is now decidable from a green run.
7. **Commit messages and branch names follow `03-git.md`.** One line only, because it is not this section's rule: imperative, and they explain *why*; there is no `feat:` / `fix:` anywhere in this history and none is to be introduced.

### 12. Mandatory, with the mechanism named — and what is honestly missing

**The single merge gate is `01-agile.md`'s Definition of Done.** It is not restated here, and this section does not run a parallel checklist; five competing checklists means the MR template can only carry one and the other four become optional by default. What follows is the **governance** subset, each row naming what actually enforces it. Nothing below is marked mandatory without a mechanism.

| Rule | What enforces it | Standing |
|---|---|---|
| Every change goes through a branch and an MR | `push_access_level=0`, verified | **Mandatory** — machine |
| A Developer never merges their own work | `merge_access_level=40` | **Mandatory** — machine |
| A Maintainer never merges their own MR | Nothing prevents it. The Owner's monthly API sweep detects it (§2), count in `PROJECT-LOG.md` | **Mandatory** — detective, from the first sweep. Drops to *recommended* the month the sweep is skipped |
| Green pipeline **in the container** | `only_allow_merge_if_pipeline_succeeds` | **Mandatory** — machine |
| Every thread resolved | `only_allow_merge_if_all_discussions_are_resolved` — **the author can self-resolve** | **Mandatory**, but self-serviceable; say so rather than overselling it |
| Zero skipped tests in CI | `test:no-skips` (`06-cicd.md`) — **not built** | **Recommended** today, the merging Maintainer reads the log. Mandatory the day the job lands |
| Branch not behind `main` before merge | Nothing today; semi-linear `merge_method` would make it a blocked button (§2) | **Recommended** today; MR-template checkbox + reviewer |
| Money is integer paise (wording in §10) | Scoped eslint rule proposed in `06-cicd.md` §4.1 — **no linter exists** | **Mandatory** — reviewer-enforced until the rule lands |
| A customer is a ledger, never a name | `quote.customer.test.ts`, `importCustomers.test.ts` | **Mandatory** — machine. Arithmetic lives in `CLAUDE.md` rule 2 |
| Migrations forward-only, never edited | Nothing today; the one-line `git diff --diff-filter=M` check in §11.2 would fix it | **Mandatory** — reviewer-enforced until that step lands |
| `npm run backup`, never `cp quotes.db` | `CLAUDE.md` rule 4; **no schedule exists**, no drive purchased | **Mandatory in principle, not in force** — the largest gap in this framework |
| No secret in the repo | `web/bundle-safety.test.ts` greps the built bundle; GitLab Secret Detection also runs on Free (JSON artifact only, no widget) | **Mandatory** — machine, partial |
| QA changed only by `deploy:qa` | Nothing prevents a hand-run container, and QA has no authentication at all (`09-security.md` §0). The pending CI-writer decision is §4's | **Mandatory** — role rule, honestly unenforceable; the only real fix is TODO-SEC-01 |
| Deploy by **digest**, never by tag; production never rebuilds | `deploy:qa` asserts the running digest. No production job exists (§5) | **Mandatory** — machine on QA, authority rule for production |
| Offboarding checklist within one day | Named person (instance admin) + witness + a log line (§8) | **Mandatory** — procedural, with a name against it |

**Gaps — real, and none of them pretend to be practice today:**

| Gap | Status | The honest note |
|---|---|---|
| Backups running | Script written, **no schedule, drive not purchased** | The single largest risk in this table |
| Monitoring | Uptime Kuma planned, not installed | Nothing watches QA, the workstation disk, or the three apps on `.37` whose eviction is the real production risk (§5) |
| Image pruning / registry cleanup | None | Two images per pipeline, forever, on the box that hosts everything. Policy is `08-monitoring.md`'s; the constraint is §3's |
| Coverage tooling | `@vitest/coverage-v8` absent, no `coverage` block in `vitest.config.ts` | A new dependency needing a reason that survives §11.3. Job and thresholds are `06-cicd.md`'s |
| Linter / formatter | None | Adding one rewrites every file in a single MR and ruins `git blame` on a repo whose history is its memory. If adopted: one formatting-only commit, recorded in `PROJECT-LOG.md`, `--ignore-rev`'d. Note the asymmetry is fine — eslint is dev-only, which is why §11.3's size test does not reject it |
| Dependency / security scanning | None. `npm audit` reports 5 untriaged advisories (log §7.6) | Tier facts are `06-cicd.md` §2's: **SAST and Secret Detection run on Free** (JSON artifact only — no MR widget, no dashboard, no tracking over time); **Dependency Scanning and Container Scanning are Ultimate and do not run at all**. So dependency scanning must be an ordinary job. Job: `06-cicd.md`. Policy, cadence and the owner of the five open advisories: `09-security.md` |
| `.gitlab/` templates | Absent — no directory | The cheapest item here, and four rules in this section are waiting on it. Complete list and capitalisation: `01-agile.md` (GitLab's template lookup is case-sensitive) |
| Issue discipline | **Decided: adopt at Sprint 1.** Zero issues today | No longer an open fork (§9). Nothing in it is in force until `.gitlab/` lands |
| `setup-workstation.ps1` / `newtech-ca.crt` untracked | Handed over out of band | Owned now: SysAdmin puts them in the repo (§7.3) |
| BitLocker register | Rule exists in `09-security.md`, evidence collected by nobody | Owned now: Data protection hat, one dated line per machine (§7.8) |
| Third Maintainer | Not appointed | See §1 |
| Whether the desk may issue real quotations from QA | Undecided; three sections assume different answers | Decides whether QA needs a backup schedule **today** or after the RAM upgrade. Data protection hat, recorded in `PROJECT-LOG.md` (§4) |

### 13. If you only do five things

1. **Never merge your own work.** Approvals cannot be required in Free; the merge button is the entire review guarantee — and for the two Maintainers it is a promise, not a lock (§2), which is why the monthly sweep exists.
2. **Green in the container, with zero skips.** Ten test cases behind eight guard sites can vanish silently (`05-testing.md` §9). A skip in CI is a guard that stopped guarding.
3. **`npm run backup`, on a schedule, to a drive that exists.** Never `cp quotes.db` — `CLAUDE.md` rule 4 explains why, `07-deployment.md` has the procedure.
4. **Never guess a customer.** Ambiguous ledger → refuse and write nothing. The wrong ship-to state is a silent tax error on company letterhead (`CLAUDE.md` rule 2).
5. **Do not deploy production until `09-security.md` §8's gates are closed — starting with TODO-SEC-01.** The app has no authentication at all, and the host has ~491 MB free and three live business apps on it. That is not a deployment, it is an outage with a date on it.
