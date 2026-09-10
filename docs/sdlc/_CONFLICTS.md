# Cross-section consistency findings

Produced by an independent reviewer that read all ten sections together.
Each section owner must apply the resolutions that affect their section.

## Contradictions

### C1

**Claim A:** §7 (Deployment): "The production job must never build. The Dockerfile runs apt-get update in three stages, so a rebuild at tag time resolves different package versions and produces a different image than the one QA tested" — and therefore "Add rules: [{ if: $CI_COMMIT_TAG, when: never }, { when: on_success }] to both [build and test], give deploy:prod needs: []", with the digest arriving as a manual RELEASE_DIGEST variable copied from the GitLab Release.

**Claim B:** §6 (CI/CD): "`publish` must gain `- if: $CI_COMMIT_TAG =~ /^v/` at the same commit that adds `deploy:prod`, or the tag pipeline is rejected as invalid", with `deploy:prod` declared `needs: [publish]` and the schedule matrix marking build/typecheck/test as ✅ on a `v*` tag.

**Resolution:** §7 is right and §6's design silently destroys the property the whole file exists to protect. §6's chain requires build → test → publish to run on the tag pipeline, which means a rebuild at tag time — different apt layers, a different sha256, and QA tested bytes that never reach production. Resolve in §7's favour: build/test do not run on tags, publish stays default-branch-only, deploy:prod takes needs: [] and an explicit RELEASE_DIGEST. §6 must delete the tag column for build/test/publish and the needs: [publish] on deploy:prod. This is the single most load-bearing conflict in the set — both sections cannot be implemented.

### C2

**Claim A:** §9 (Security) §0: "TODO-SEC-01 is a release gate, not a backlog item. 1. Production does not deploy while any mutating route is unauthenticated." The app has "no helmet, no cors, no rate limiter, no session, no token" and DELETE /quotes/:id is a hard delete open to anyone on the LAN.

**Claim B:** §7 lists five production blockers (RAM, CPU measurement, backups, runner plumbing, port) and says "Until 1–5 are closed the desk stays on QA" — authentication is not among them. §10 §5: "Authority unlocks only when all four are true" (RAM, backups, monitoring, measured conversion time) — authentication is not among them. §4's eight-point production stage and §6's four-step pre-flight also omit it.

**Resolution:** §9 is right and it is the most serious omission in the framework. Three sections publish what read as complete production precondition lists and all three omit the hardest one. Fix: §9 owns the gate list; §7 §10 and §4 must each add "TODO-SEC-01 closed" as blocker zero and cross-reference §9 rather than restating a partial list. Note the secondary conflict: §9's own candidate fix ("front it with the IIS already running on :8080 using Windows Authentication") authenticates the proxy hop only, and §9 says so — so even §9 does not currently have a closing plan.

### C3

**Claim A:** §8 (Monitoring): "Rolling the image back does not roll the schema back. Migrations are forward-only, applied at boot, with no down-migrations; the old image runs against the migrated database, which is safe only if the migration was additive."

**Claim B:** §3 (Git): "Bad code and a migration landed: Redeploying the old digest is not sufficient — old code meets a schema it does not know. Restore the pre-deploy backup, then redeploy the old digest." §7 gives the same answer with a mandatory forensic backup first, a busybox restore, a chown 1000:1000, and the warning that the restored ref counter "will re-issue numbers the desk may already have emailed".

**Resolution:** §7 is right and must be the single owner. §8's "safe if additive" is a judgement call handed to whoever is on the box at 22:00, and every migration in this repo is additive right up until one is not — 004_customer_identity.sql is exactly the kind that changes meaning without dropping a column. §3's version is right in direction but omits the forensic copy and the reference-number hazard, so following §3 loses the rows the bad release wrote. Cut the rollback procedure from §3 and §8 entirely; both cross-reference §7.

### C4

**Claim A:** §1 DoD item 2: "`npm run typecheck` and `npm test` green locally", and later "On the number 444: that is CLAUDE.md's count with every gate open. On a laptop with no PDF converter, or with no web/dist built, you will see up to 10 fewer and the run still says green." §4 stage 9: "Both commands exit 0, and you know which of the ten skipped."

**Claim B:** §10 §7: "`npm test` on a fresh clone fails until `npm run build` has been run once — bundle-safety.test.ts ends with a non-conditional assertion that web/dist exists." §2: "Run `npm run build` before `npm test`". §6: "The web/dist pair is already protected — it('fails loudly if the bundle was never built') fails rather than skips."

**Resolution:** §10/§2/§6 are right; verified in web/bundle-safety.test.ts, whose third test is an unconditional expect(built).toBe(true). Without a build the suite is RED, not green-with-skips. §1's "the run still says green" is false for the web/dist pair and §4 stage 9's "both commands exit 0 and you know which of the ten skipped" is impossible — you cannot have a green run and skipped bundle tests. Fix §1 DoD item 2 to read `npm run build && npm run typecheck && npm test`, and correct the 444 note to say only the eight converter-gated tests can vanish quietly.

### C5

**Claim A:** §3: "`merge_access_level` 40 — Only maintainers merge. **You cannot merge your own MR.** This is the entire review guarantee." §5: "merge_access_level=40 (maintainers only, so no one merges their own branch)". §9 §5: "the merging maintainer is never the author".

**Claim B:** §1: "For a maintainer's own MR it is enforced by nothing — GitLab lets a maintainer merge their own MR, and lets them resolve their own discussion threads... This one rule rests on discipline." §10 §2: "Rule, unenforceable in Free and therefore written down: a Maintainer never merges their own MR."

**Resolution:** §1 and §10 are right. §3's and §5's flat statements are false for the two (or three) people who actually hold Maintainer, i.e. for the people most likely to be merging. Compounding it, the sections disagree on how many people can merge: §9 §5 says "Five people, three with merge rights" (Owner + 2 Maintainers) and rests the guarantee on that third pair of hands; §10 §1 says Maintainer count 2 with the Owner being one of them, i.e. only two mergers and "one holiday away from nothing merging"; §1 declines to fix a number. Fix: §10 owns the role table and the headcount; §3 and §5 replace their claims with "a Developer cannot merge their own work; a Maintainer can, and does not", cross-referencing §10.

### C6

**Claim A:** §6 §4.5: "`docker exec` a script that POSTs a fixed RFQ, saves, renders .docx... Save with initials `CI`" — a blocking `smoke:qa` job on every main merge that writes a quote row into the QA database.

**Claim B:** §2 Stop List: "Never run the app, tests or migrations against QA (http://192.168.1.40:8081, volume quotation_qa_data) — 225 real customer ledgers are seeded there." §10 §4: "QA is only ever changed by deploy:qa... a hand-edited row in QA's copy of the 225 real ledgers persists forever and no pipeline will ever correct it."

**Resolution:** Unreconciled as written: §6 automates precisely what §2 forbids and §10 warns is uncorrectable, and it does it on every merge into a named volume nobody backs up (§7 blocker 3, §8). §6's `CI` initials isolate the ref counter but not the quotes table. Resolution: either the QA smoke is read-only (as §6 itself already requires for prod), or §2 and §10 carve out an explicit exception naming the CI actor and a cleanup step. Someone must own that decision before the job is written — it is a data-protection decision (§9 §7), not a CI decision.

### C7

**Claim A:** §3: "MINOR: Any new file in server/db/migrations/. Also any new route (it will fail routes.test.ts), any new field in the schema shapes, any new runtime dependency. PATCH: A behaviour fix with no migration, no new route, no new schema field."

**Claim B:** §7: "MINOR (0.x.0): any release containing a file in server/db/migrations/, **or a change to the rendered document, tax or rounding**. PATCH (0.1.x): everything else."

**Resolution:** They disagree in both directions: a rounding or letterhead change with no migration is PATCH under §3 and MINOR under §7; a new route or new runtime dependency is MINOR under §3 and PATCH under §7. §7's rationale is the better one ("the version number should tell you the rollback is not free"), and a document/tax/rounding change is exactly the change a customer sees. §3's route/schema/dependency triggers are about test breakage, not about whether an image swap undoes the change. Fix: §7 owns version policy as the union — MINOR = migration OR rendered-document/tax/rounding change; everything else PATCH. §3 deletes its table and links.

### C8

**Claim A:** §8: "npm audit triage — monthly. **5 advisories are open and untriaged**... GitLab Dependency Scanning and SAST are not available on Free — **this is the whole security programme**." No CI job.

**Claim B:** §6 target pipeline: job `deps` running "osv-scanner + npm audit --omit=dev", "ADVISORY on MR, BLOCKING at v*", with a `security-waivers.json` whose expired waivers fail the release. §9 §4: job `audit` running "npm audit --audit-level=high", allow_failure, in the `test` stage. §5: "a plain job — npm audit --omit=dev --audit-level=high — decided as report-only or blocking". §7: "npm audit as a non-blocking job".

**Resolution:** Four sections put npm audit in CI (with three different flag sets and three different blocking policies) and one says the programme is a monthly human triage with no job at all. Both can coexist only if said so: the job produces the number, the monthly triage produces the decisions. Fix: §6 owns the job definition (flags, stage, blocking policy) and §8 owns the triage cadence and the named owner of the five open advisories; §5, §7 and §9 cross-reference. Also settle the flags — `--omit=dev` and `--audit-level=high` are not the same policy and the five known advisories are all dev-tooling transitives, so `--omit=dev` may report zero and make the job look like it is working when it is measuring nothing.

### C9

**Claim A:** §6 §2 table lists under Ultimate: "SAST, Dependency Scanning, Container Scanning, License scanning, Security Dashboard, vulnerability report, MR security widget". §8 rule 3: "Never propose Prometheus, Grafana, ELK, Loki, Sentry, an APM, **or GitLab SAST/Dependency Scanning (not available on Free)**."

**Claim B:** §9 §4: "GitLab Free runs the SAST and Secret Detection analyzers as ordinary jobs; what Free does not have is the MR security widget, the Vulnerability Report, artifacts:reports:sast ingestion, or Scan Execution Policies." §1, §5 and §2 say the same.

**Resolution:** §9/§1/§5 are right and §6's own prose agrees with them elsewhere — §6 §2's next row concedes "Secret-Detection... job runs in any tier". The distinction that matters is analyzer vs. reporting surface: the SAST and Secret Detection templates execute on Free and emit JSON; Dependency Scanning and Container Scanning are Ultimate. Fix: §6 owns one tier table stating it precisely; §6's Ultimate row drops SAST, and §8 rule 3 drops SAST from its ban list (its point — no dashboard, no ingestion — survives intact).

### C10

**Claim A:** §7: "The port. `8081` is free on `.37`, but QA is also 8081 on .40" — and then both the deploy:prod run command and the environment URL use 8081 (`-p 8081:4000`, `url: http://192.168.1.37:8081`).

**Claim B:** §6 skeleton: `environment: { name: production, url: http://192.168.1.37:8082 ... }`. §9 §8: "Port chosen clear of 3000/8000/8080/7070 — **not chosen**."

**Resolution:** §9 is right that it is undecided; §7 and §6 have each quietly decided it differently, and §7 decided it two ways inside one section (it flags the 8081/8081 collision as a problem, then uses 8081 anyway). Pick one, record it in §7's environment table, and have §6 and §9 reference it. On a host already running :3000, :8000, :8080 and :7070, an unrecorded port choice is the kind of thing that gets discovered by an outage in Pickup Ops.

### C11

**Claim A:** §8: "Incident → issue → log. Every Sev 1 and Sev 2 gets a GitLab issue labelled `incident` and `Sev1`/`Sev2`, closed by the MR that fixes it." §2: "No MR without a linked issue that passed DoR. Quote the issue number in the MR description." §1: issues, milestones and labels are the backbone of Sprint 1.

**Claim B:** §10 §9: "Say it out loud, then write it where it will be found — **the MR description or PROJECT-LOG.md, because GitLab issues exist and are unused**." §10 §12: "Issue discipline: Issues exist, unused. Decide: adopt them, or delete the tab from the workflow. **Two homes for 'why' is worse than one**." §1 itself: "Issues, milestones, labels, boards — **Not used.** Zero issues carry the process", and Sprint 1 "starts the day .gitlab/ lands, not before".

**Resolution:** §10 correctly identifies the fork and then the framework takes both branches: §1, §2, §4, §5, §8 and §9 all mandate issue-linked work while §10 routes incidents away from issues. §1's own honesty ("nothing in it is in force today") makes §2's "No MR without a linked issue" a rule for a system that does not exist. Fix: make the decision explicitly — adopt issues at Sprint 1 — then §10 §9 drops the MR-description alternative, and §2 marks its issue-linking rule as effective from Sprint 1 rather than now.

### C12

**Claim A:** §1 bug table: four severities. S1 = "a quotation is wrong on paper"; **S2 = "Desk blocked, output correct: parse fails on a real thread, the conversion queue wedged, QA down"**; S3 workaroundable; S4 cosmetic.

**Claim B:** §8 incident table: three severities. **Sev 1 = "A wrong document reached a customer, or the desk cannot quote" — example: "QA down during quoting hours"**; Sev 2 = degraded but working; Sev 3 = cosmetic, including "a skipped test in CI". §9 uses a third scale (S1–S3) for security only.

**Resolution:** Three scales, and the same event — QA down while the desk is quoting — is S2 in §1 and Sev 1 in §8. Also §8 grades "a skipped test in CI" as Sev 3 while §2, §5, §6, §9 and §10 all say a skip in CI is a red pipeline wearing green. Fix: §8 owns one severity scale for the whole framework (three levels is right — there is no production, so a fourth is theatre); §1's bug table becomes a mapping from severity to milestone treatment only, and §9 maps its security severities onto the same scale.

### C13

**Claim A:** §8 backup rule 1: "**Write off the volume.** With no argument the script writes to `backups/` under the repo — the same disk as the database, the same disk that filled with telemetry. Pass a destination: `npm run backup -- "G:\Backups\..."`."

**Claim B:** §7 deploy step 1 writes the pre-deploy backup **into the application's own volume**: `docker run --rm -v quotation_prod_data:/app/data "$RELEASE_DIGEST" ... backup.ts "/app/data/backups/pre-$CI_COMMIT_TAG.db"`, and §7's rollback then reads it back from the same volume.

**Resolution:** §8 is right on the principle and §7 violates it in the one place it matters most. A pre-deploy backup living inside quotation_prod_data survives a bad migration but not a lost volume, a corrupted database file, or a `docker volume rm` typo during recovery. Fix: §7's backup step must also copy the file off the volume to the same destination §8's schedule uses, and §7 should say which. Related: §7 correctly notes backup.ts refuses to overwrite, which is why the timestamp/tag is in the filename — keep that.

### C14

**Claim A:** §4 production rule 4: "**`npm run backup` before `npm run migrate`, always.**" §6 §4.6 pre-flight step 2: "`npm run backup` — VACUUM INTO", unconditional.

**Claim B:** §7: "**The very first production deploy has no database to back up.** backup.ts exits non-zero with 'No database at … — nothing to back up', which would fail release 1.0.0 on step 1. Handle it once, explicitly, in the job — not by making the backup step non-fatal forever."

**Resolution:** §7 is right and has found a real day-one failure in the other two sections' procedure. An unconditional "always back up" makes the first production deploy fail at its first step, and the obvious field fix — `|| true` — permanently disables the guard that protects every deploy after it. Fix: §7 owns the deploy sequence; §4 and §6 delete their backup steps and cross-reference it. Second-order: §4 says "backup before migrate" as if there is a separate migrate step, while §7 and §6 both say migrations are applied at container boot — so the correct ordering is "back up while the old container is still up, then swap", which only §7 states.

### C15

**Claim A:** §1 DoD item 9: "the QA container runs `--memory=2g --cpus=2.0`, **the only place the intended production shape is exercised at all**." §2 §5: "QA runs with --memory=2g --cpus=2.0; the target host cannot give that today."

**Claim B:** §7: production gets "`--memory=1g --memory-swap=1g --cpus=1.0 --pids-limit=256`... **Deliberately tighter than QA's --memory=2g --cpus=2.0. --cpus=1.0 leaves a core for the other three apps and makes PDF conversion slower — that is the trade.**"

**Resolution:** §7 is right and §1's claim is the dangerous one: QA at 2g/2cpu is not the intended production shape, it is roughly double it, so "it was fine on QA" tells you nothing about a 1g/1cpu container on a 2-core i3 — which is precisely the point §2 makes two paragraphs later. Fix: strike "the only place the intended production shape is exercised" from §1; §7 owns the production resource limits and §6 §4.6's "assert ≥ 2 GB free RAM" pre-flight should be restated against §7's numbers.

### C16

**Claim A:** §10 §3: "This project already filled a disk once: 282 orphaned WINWORD.EXE processes wrote 12.7 GB of Office telemetry into %TEMP%\Diagnostics and **truncated a source file mid-write (server/src/lib/pdf.ts)**." §1's own conflict note: "I did not cite the '12.7GB telemetry disk-fill' incident — **there is no trace of it in this repository**."

**Claim B:** §3: "`be96eb9` is the model: 282 orphaned WINWORD.EXE processes, 12.7 GB of Office telemetry in %TEMP%\Diagnostics, a full disk, and **`parser.ts` left at zero bytes** by a write that landed on it."

**Resolution:** §3 is right on both counts, verified against the commit body of be96eb9: the file left at ZERO BYTES was parser.ts, not pdf.ts, and the incident is very much in this repository — it is in `git log`, just not in PROJECT-LOG.md, README.md, ONBOARDING.md or .gitlab-ci.yml, which is what §1 actually checked. Fix §10's file name; fix §1's assertion to "recorded in the commit body of be96eb9, not in any prose document" — that is itself the strongest evidence for §3's rule that the commit body is where this project's engineering record lives.

### C17

**Claim A:** §7 gap 6: "Configure a policy (cleanup policies are Free) and add one exception in writing: **never delete a digest named in a GitLab Release that has not been superseded** — that digest is the rollback target."

**Claim B:** §8 maintenance calendar: "Before enabling a cleanup policy... **keep at least the deployed digest plus the last 10 tags**, and run `gitlab-ctl registry-garbage-collect` only in the monthly window."

**Resolution:** A last-10-tags policy will eventually delete a released digest that is still someone's rollback target — §7's exception and §8's rule are not compatible once there are more than ten releases. §7 is right on the requirement; §8 is right that the policy has to be bounded or the disk that hosts GitLab, the runner, the registry and QA fills. Fix: one policy, owned by §7 (release/rollback), expressed as "keep every digest referenced by a non-superseded Release, plus the last 10 otherwise"; §8 keeps the garbage-collect window and the disk-headroom ownership.

### C18

**Claim A:** §8: six Uptime Kuma monitors — Quotation QA, GitLab, Registry, backup heartbeat, runner heartbeat, workstation disk/RAM — all on the workstation, with the honest caveat that "it runs on the machine it watches".

**Claim B:** §10 §5 gate 3: production authority unlocks only when "**Monitoring installed** (Uptime Kuma is planned, not installed) **covering the three incumbent apps, not only this one**."

**Resolution:** §10's gate is not satisfiable by §8's monitor set — none of the six watches Pickup Ops (:3000), Newtech Inventory (:8000) or IIS (:8080), and §8 never mentions them. §10's requirement is the right one (the risk being managed is evicting three apps that have users), so §8 must add three keyword monitors on 192.168.1.37 and a disk/RAM heartbeat for that host — which also means Kuma needs a hosts entry and reachability to .37. Until then, §10's gate 3 is unmeetable and production stays blocked for a reason nobody has costed.

### C19

**Claim A:** §5 §8: "**No project-wide percentage threshold**... 3. A threshold produces tests written to move a number. **Judge coverage per diff, in review.**" Implementation: `docker create` / `docker start -a` / `docker cp`, `npm test -- --coverage.enabled --coverage.provider=v8`, coverage regex `'/All files\s*\|\s*([\d.]+)/'`.

**Claim B:** §6 §8: "Publish the number for four weeks before setting any floor. Then **set per-directory floors** only where a regression is a tax error: **shared/money.ts and shared/fy.ts at 100 %, server/src/lib/ at 85 %.** No global threshold." Implementation: `docker run --name t-$CI_JOB_ID`, `npx vitest run --reporter=default --reporter=junit`, after_script `docker cp`, regex `'/All files[^|]*\|[^|]*\s+([\d.]+)/'`, plus pinning `@vitest/coverage-v8@2.1.9`.

**Resolution:** Two sections rewrite the same `test` job two different ways and disagree on whether thresholds exist at all. Only one can land. §6's version is better engineered (it splits typecheck out, captures JUnit as well as coverage, pins the provider to the vitest 2.x line, and uses after_script so extraction survives a red run), and §6's per-directory floors are the honest reconciliation of §5's objection — a 100% floor on money.ts is not a number-chasing target, it is the tax code. Fix: §6 owns the `test` job and the coverage policy; §5 keeps the *reasoning* about why global thresholds and web/ coverage are meaningless and drops its YAML. Note both must adopt §5's exit-code discipline (`|| STATUS=$?`) — §6's `docker run` form loses the exit code the same way.

### C20

**Claim A:** §3 MR rule 3 proposes a skip check by grepping the log: "`if grep -q "skipped" test.log; then ... exit 1; fi`". §5 §9 proposes a source-level throw: "`if (process.env.CI && !hasConverter) { throw new Error(...) }`" at the top of pdf.test.ts. §6 proposes a separate job: "`test:no-skips` — Fails if the JUnit XML contains any `<skipped`". §7 gap 3 assigns it to "the `test` job in .gitlab-ci.yml".

**Claim B:** §2 Stop List: "Never touch `.gitlab-ci.yml`, Dockerfile, .env*, .gitignore, protected-branch or protected-tag settings" without explicit developer approval, and "Never add a new `it.runIf` / `describe.skipIf`" — while three of the four proposals above are edits to .gitlab-ci.yml and one is an edit to the guarded test file itself.

**Resolution:** One gap, four mechanisms, no owner, and every mechanism lands in a file §2 puts behind a human gate. §6's `test:no-skips` reading JUnit is the right one — it is machine-checked, it fails when the artifact is missing (§6 says so), and it does not depend on grepping a word that can appear in a test name (§3's grep would also match any future `it('... skipped ...')`). Fix: §6 owns it; §3, §5 and §7 delete their versions and cross-reference; §2 adds an explicit line that CI-job additions are a human-owned MR, so the two sections stop reading as contradictory.

## Unenforceable rules

### U1

**Rule:** "A maintainer's own MR is merged by the **other** maintainer" (§1), "The merging maintainer is not the author" (§9 checklist item 14), "a Maintainer never merges their own MR" (§10 §2). GitLab Free cannot prevent it and, per §3, all ten GitLab-side commits to date carry the single root-admin account — the rule has never actually been exercised.

**Fix:** The mechanism already exists and is unowned: §10 §2's monthly sweep, `GET /projects/:id/merge_requests?state=merged&target_branch=main` flagging `author.username == merge_user.username`. Give it a named owner and a fixed date, publish the count in PROJECT-LOG, and it becomes a detective control with teeth. Without an owner, downgrade it to a recommendation — a mandatory rule that nothing checks and that history shows has never held teaches the team that the mandatory list is aspirational.

### U2

**Rule:** "The merging maintainer edits the squash commit message before clicking Merge and pastes the why into it" (§3 rule 3). Nothing checks this, and §3 documents that it has been violated on 5 of 5 merges — "The five commits with no body are exactly the five that came through an MR."

**Fix:** Machine-checkable: a scheduled job (or a `test`-stage step) that runs `git log origin/main --format='%H%n%b' -n 20` and warns on any commit whose body is empty. Or accept reality and make the MR description the canonical record (§3 rule 2 already says it survives the squash), demoting rule 3 to a recommendation. Do not leave a rule standing with a 0-for-5 compliance record.

### U3

**Rule:** "Rebase before asking for a merge" / "the merging Maintainer confirms the branch is not behind `main`" (§3, §10 §2). Nothing in Free enforces it and it appears in no checklist.

**Fix:** There is a real Free-tier mechanism nobody named: set the project's **merge method to "Merge commit with semi-linear history"**, which refuses the merge until the source branch has been rebased onto the target. It preserves the merge commit that §3 wants to keep (unlike fast-forward-only, which §3 correctly rejects), and it converts this from an unenforceable instruction into a blocked merge button.

### U4

**Rule:** DoD item 4: "**Skip audit — author states the CI skip count**" (§1), and "the `test` job shows `skipped 0`" (§9 checklist item 9). A human declaration of a number the human did not measure.

**Fix:** Replace with §6's `test:no-skips` job asserting no `<skipped` in the JUnit XML, and failing when the artifact is missing or holds zero testcases. Then delete the human declaration entirely — it is the machine's job, and asking for it by hand is how DoD items get pasted without being performed (§1 says exactly this about hand-pasted checklists).

### U5

**Rule:** "MR body says in words: *'my machine tested Word; CI tested LibreOffice'*" (§1 DoD 6, §2, §4, §9 checklist 10, §10 §11.5). Restated five times and checked by nothing.

**Fix:** There is no automated check available (CI cannot know what ran on a laptop), so this must be a template checkbox in `.gitlab/merge_request_templates/`, gated by the reviewer opening a thread when it is missing — which is the one enforcement Free actually provides. Until that template exists, downgrade it honestly to "the reviewer asks". Note the related claim that *is* checkable and currently is not: whether the author ran `npm run build` first, which is now decidable because bundle-safety fails without web/dist.

### U6

**Rule:** "**No MR without a linked issue that passed DoR**. Quote the issue number in the MR description" (§2 rule 2), plus §1's DoR table and "One `debt` issue lands in every milestone. Enforced by the Sprint Host at planning."

**Fix:** Unenforceable twice over: GitLab issues are unused today (§1's own status table says so, §10 §12 confirms), and there is no Sprint Host. Downgrade all of it to "from Sprint 1" and mark it as not in force, exactly as §1 does at its top — then have §2 say the same, since §2 currently reads as a rule binding agents today.

### U7

**Rule:** "**Capacity: 3 `size-m` equivalents per developer per sprint**" and the `size-s`/`size-m`/`size-l` labels with "`size-l` cannot enter a milestone" (§1).

**Fix:** GitLab Free has no issue weights, no burndown and no aggregate label report — §1 says so itself when rejecting story points. Nothing can sum three labels across a milestone. Either the Sprint Host counts by hand at planning (name that as the mechanism, in the ceremony table) or downgrade capacity to a planning heuristic. The `size-l` exclusion is enforceable by the Sprint Host's DoR check at planning; the per-developer capacity is not.

### U8

**Rule:** "**Every behaviour change adds or updates a `*.test.ts` in the same merge request**" (§5 §3), and "Production code and its tests land in the same commit" (§2 §3).

**Fix:** This one is genuinely machine-checkable and no section proposes the check: a CI job comparing `git diff --name-only origin/main...HEAD` and failing when it touches `server/src/**` or `shared/**` without touching any `*.test.ts`. It has false positives (a pure comment change), so run it as a warning that the reviewer must dismiss in a thread — which is the enforcement Free gives. Far stronger than "the maintainer who merges it owns that decision".

### U9

**Rule:** "**BitLocker on all five developer machines, the workstation, and any backup drive (BitLocker To Go). Mandatory.** Verify with `manage-bde -status`" (§9 §7).

**Fix:** Nobody collects the output and there is no register, so this is currently a sentence. Make it a dated line in PROJECT-LOG per machine, owned by the SysAdmin hat, refreshed at onboarding (§10 §7) and confirmed at offboarding (§10 §8 step 7). If no one will own the register, downgrade to a recommendation — because the alternative is a documented mandatory control that would fail an audit on day one, which is worse than an honest gap.

### U10

**Rule:** "**Never run the app, tests or migrations against QA** (http://192.168.1.40:8081...)" (§2 Stop List) and "QA is only ever changed by `deploy:qa`" (§10 §4).

**Fix:** Nothing prevents it — the URL appears in nine of the ten sections, QA has no authentication of any kind (§9 §0), and §6 proposes a CI job that writes to it on every merge. There is no technical control available short of closing TODO-SEC-01. Enforcement here is honesty about the exception: name the CI smoke test as the one permitted writer, or make it read-only. Leaving both the prohibition and the job in the framework teaches that Stop List entries are negotiable.

### U11

**Rule:** "No MR may add a route that reads or destroys customer or price data before [TODO-SEC-01] closes" (§9 §0). §9 itself notes the hole: "Adding one to `index.ts` fails nothing — so a new endpoint there needs the reviewer to notice unaided."

**Fix:** Close the hole rather than relying on the reviewer: change `routes.test.ts` to assert the routes registered on the **app**, not on the three routers, so `/api/health` and anything else mounted in `index.ts` is inside the guard. That converts an unenforceable review instruction into the same deliberate red that already works for router routes — and it is the mechanism §9's rule is explicitly leaning on.

### U12

**Rule:** "Money is integer paise. **Never** a float, never `/100`" stated as a blanket ban (§2, §9 checklist 6, §10 §12, CLAUDE.md).

**Fix:** As written it is already violated by the codebase it protects — `shared/money.ts` divides by 100 six times and `web/src/components/DocumentPreview.tsx` uses `toFixed` for CSS column widths. §6 §4.1 has the correct scoping (ban `/ 100`, `toFixed(`, `parseFloat(` in `server/src/**` and `shared/**` **except** `shared/money.ts`, exclude `web/src` entirely) and it is enforceable as an eslint `no-restricted-syntax` rule that passes clean on today's tree. Adopt §6's scoped wording everywhere the blanket version currently appears, or the first person to run the linter turns it off.

## Duplication (pick one owner, others cross-reference)

- **The Word-vs-LibreOffice trap** appears in all ten sections, four times with the full sentence ("Word rejects an unopenable file; LibreOffice renders it as plain text and returns a valid PDF of the raw bytes, exit 0, no warning") and with three different line references for the guard (§2 says `pdf.ts:398`, §9 says `pdf.ts:388`; the function is defined at 387 and called at 398). Owner: **§5 (Testing Strategy)**, which is where the assertion that keeps it honest lives. §1 DoD 6, §2, §4 stage 9, §7, §9 checklist 10 and §10 §11.5 keep the one-line obligation ("say which backend you exercised") and drop the explanation.
- **WAL mode / never `cp data/quotes.db` / `VACUUM INTO`** with the 4 KB-vs-2.7 MB measurement appears in §1, §2, §3, §4, §5, §7, §8, §9 and §10 — nine restatements of one fact. Owner: **CLAUDE.md** (it is already rule 4 there) with **§7** owning the operational procedure. Everything else cites, nobody re-derives.
- **The protected-branch settings table** (push_access_level=0, merge_access_level=40, only_allow_merge_if_pipeline_succeeds, only_allow_merge_if_all_discussions_are_resolved, squash_option=default_on, protected tags v*) is reproduced in full in §1, §3, §5, §9 and §10, and partially in §4 and §8. Five verbatim copies of a live server configuration guarantees that the first drift is invisible. Owner: **§10 §2**, which already has the monthly API sweep that verifies it. Everyone else states only the consequence they depend on.
- **The GitLab Free/Premium/Ultimate feature matrix** (approvals, Code Owners, merged-results pipelines, merge trains, Protected Environments, Dependency/Container Scanning, SAST) appears in §1, §2, §3, §5, §6, §7, §8, §9 and §10 — and, as flagged above, they already disagree about SAST. Owner: **§6 §2**, the only section that lays it out as a matrix with the "what we do instead" column. Every other section cites one row.
- **The self-skip guard inventory** appears in nine sections with four different framings — "eight self-skipping guards" (§2), "eight self-skip guards... seven it.runIf and one describe.skipIf" (§3), "10 tests are gated" (§1), "Eight guard sites make ten tests" (§5), "eight tests... plus two" (§10). Verified against the source: **8 guard sites (5 `it.runIf` + 1 `describe.skipIf` in pdf.test.ts, 2 `it.runIf` in bundle-safety.test.ts) covering 10 test cases.** Owner: **§5 §9**, which has the correct table. Everyone else says "a skip in CI means a guard stopped guarding" and links.
- **The ledger-identity numbers** (14 Datamatics spellings, 17 Morgan Stanley across 5 GSTINs and 3 states, 3 Azentio sites on one GSTIN, 225 ledgers) appear in §1, §2, §4, §5, §9 and §10. §5 has already caught the drift in the source ("quote.customer.test.ts says sixteen spellings; CLAUDE.md says fourteen"). Owner: **CLAUDE.md**, with §5 owning the discrepancy until it is resolved; the process sections cite "a customer is a ledger, not a name" without the arithmetic.
- **The `xlsx` rejection precedent** (7 MB, prototype-pollution history, ~80 hand-written lines over pizzip) appears in §1 DoD 7, §2 §2 and §2 §7, §3, §4 stage 4, §8, §9 §3 and §10 §11.3. Owner: **§9 §3** (Dependencies), which states the required MR fields (size, last release, transitive count, why hand-writing is worse). Note §6 §4.1 is the only section that handles the asymmetry honestly — eslint is far larger and still fine because it is dev-only — and that carve-out needs to live next to the rule, not four sections away.
- **"Adding a route fails routes.test.ts / adding a schema field fails screen-wiring.test.ts, update deliberately, never weaken"** appears in §1 (DoD declared breakers), §2, §3, §4 stage 4, §5 §5, §8 rule 9, §9 checklist 1 and 12, and §10 §11.4. Owner: **§5 §5** ("The three that get forgotten"). Note §8 cites the wrong path (`server/src/routes.test.ts`; it is `server/src/routes/routes.test.ts`) and §10 names the vanished route `POST /parse/ai` while §1/§2/§4/§5 name it `POST /api/parse/llm` — the docblock says llm, the current list says ai, because the route was renamed when the AI provider changed. One owner ends both drifts.
- **The production blocker paragraph** (192.168.1.37, i3-1115G4, 2 cores, 8 GB with ~491 MB free, Pickup Ops :3000 / Inventory :8000 / IIS :8080 / AnyDesk :7070, RAM upgrade is a hard prerequisite, LibreOffice is CPU-bound, 90 s + one retry ≈ 180 s) is restated nearly in full in §1, §2, §4, §5, §6, §7, §8, §9 and §10. Owner: **§7 §Status**, which has the fullest version and the numbered blocker list. Everyone else says "production is not deployed — see §7".
- **The `deploy:qa` mechanics** (login again because docker login writes to the client; a job's 127.0.0.1 is the job container; docker:29-cli ships no curl; the digest assertion; health read from inside the container) are re-explained in §3, §4 stage 16 and 17, §5, §6 §1, §7, §8 and §10 §4. Owner: **§6 §1**, which is the description of the file as built. §7 legitimately repeats the health-check snippet because it is telling you to copy it into deploy:prod — that is the one justified duplication and should say so.
- **The `.gitlab/` templates gap** is reported in §1, §2, §3, §4, §5, §7, §8 and §10, each naming a different subset of files and two different capitalisations (`.gitlab/merge_request_templates/default.md` in §1 vs `Default.md` in §2/§3/§4). Owner: **§1**, which should carry the complete list — story, bug, debt, Release (§7), Incident (§8), and one MR template — with one agreed capitalisation, since GitLab's template lookup is case-sensitive.
- **Merge-gate checklists exist five times over**: §1's 11-item Definition of Done, §2's MR-description obligations, §4's per-stage "Done when" column, §5 §4's eight-step "how to decide which tests are required", §9's 15-item security checklist, and §10 §12's mandatory list. They are not identical — §9 requires `.max()` bounds on new array fields and no request data in `${}` prepares, which appear in no other checklist; §1's DoD omits `npm run build`, which §2 and §10 require. Owner: **§1's DoD is the single merge gate**, and it must absorb §9's items by reference ("security checklist, §9") rather than by parallel list; §4, §5 and §10 cross-reference it. Five checklists means the MR template can only carry one of them, and the other four become optional by default.

## Gaps at the seams

- **Between 'MR merged' and 'QA is running the new bytes' nobody is watching.** §4 stage 15 says a failure at publish or deploy leaves the tested image built and you "fix forward"; §6 lists no notification; §8 states plainly that nothing alerts anyone and Uptime Kuma is not installed. So if `publish` or `deploy:qa` fails after a merge, `main` has moved, QA is still serving the previous digest, and the only person who might notice is whoever happens to open the pipeline page. Nobody is assigned to watch the main pipeline after clicking Merge. Assign it to the merging Maintainer (§10 already makes them the release owner) and say how long they must stay with it.
- **A story that merges green and then fails QA verification has no defined path.** §1 DoD 9 puts QA verification *after* the merge; §4 stage 17 says never hot-fix QA and "fix forward through a new MR"; §3 gives a revert recipe for a bad merge; nothing says who chooses between revert and fix-forward, whether the issue reopens, whether the story counts against the sprint, or what the desk is told. This is the single most likely lifecycle event in a process where verification is post-merge by design, and it is the one nobody wrote.
- **QA is redeployed on every merge, which can silently invalidate someone else's in-flight verification.** §6 §4.4 identifies the technical race (no `resource_group: qa`) but frames it as a CI correctness problem. The process consequence is unaddressed: developer B is exercising story X on QA when developer A's merge does `docker rm -f quotation-qa`. §1 DoD 9 and §4 stage 17 both assume QA is stable while you look at it. Nothing says "QA reflects the last merge, not your story", and nothing sequences verification against merges.
- **Who closes the story is never named.** §1 DoD 10 says "Issue closed with a sentence saying what was observed on QA" and §4 stage 19 says "Close the issue" — both in the passive voice. Author? The non-author who verified on QA (DoD 9)? The Sprint Host? With no product owner and no QA role this is exactly the handoff that gets dropped, and DoD 9 and DoD 10 are performed by different people under §1's own rules.
- **A production incident has no defined route into the backlog** — and cannot, because production does not exist and the sections disagree about whether issues are used at all. §8 says every Sev 1/2 gets a labelled GitLab issue closed by the fixing MR plus a dated PROJECT-LOG subsection plus a regression test; §1 says every S1/S2 gets a regression test and a log line "if the cause was a design assumption rather than a typo"; §4 stage 19 says PROJECT-LOG only for a decision or a measurement; §10 says write it in the MR description because issues are unused. Four thresholds for what gets recorded, no owner for the postmortem, and no rule about when an incident becomes a *sprint* item versus a same-day fix.
- **Nobody owns `.gitlab-ci.yml`, and eleven-plus conflicting edits to it are proposed across five sections.** §2 forbids agents touching it; §10 §3 notes that reviewing it in an MR is after the fact because branch pipelines run root-capable jobs before review; §5, §6, §7, §8 and §9 each propose edits (coverage extraction, no-skips, secrets, lint, deps, semgrep, hadolint, resource_group, log-opts, pre-`rm` log capture, tag rules, deploy:prod, rollback:prod). There is no sequencing, no owner, and — per the contradictions above — several of these edits are mutually exclusive. Name a single owner (the SysAdmin/Owner hat in §10) and an order of application, or the first three that land will make the next five unmergeable.
- **Whether the purchase desk may issue real customer quotations from QA is undecided, and three sections assume different answers.** §1 says yes explicitly ("The desk needs a document right now → They use the QA container already running on its tested digest"); §7 blocker 3 says the consequence is that "`quotation_qa_data` already holds real work and is backed up by nothing"; §8 says recovery for QA is re-importing the 225 ledgers from the spreadsheet — which recovers the master and loses every quotation. This one decision determines whether QA needs a backup schedule *today* or after the RAM upgrade, and it is the difference between a data-loss inconvenience and losing documents a customer has been sent.
- **A restore re-issues reference numbers the desk may already have emailed, and nobody owns the reconciliation.** §7 is the only section that spots it ("the counter in the restored database will re-issue numbers the desk may already have emailed. Check that before the desk sends anything"). There is no procedure for checking, no record of what was issued outside the database, and no named person who talks to the desk. Given `allocateRef` is an atomic UPSERT on a counter that only moves forward, this is a guaranteed consequence of every restore, not an edge case.
- **Onboarding hands over two files that are not in the repository and that nobody can review.** §1's debt table and §10 §7 both note that `setup-workstation.ps1` and `newtech-ca.crt` are handed over out of band and are untracked, while §2, §8 and §10 all impose an ASCII-only rule on a script no reviewer sees, no CI job lints, and no test runs. It is the first command a new developer executes on a machine with nothing installed. Nobody owns getting it into version control.
- **DPDP responsibility is named as an open item and assigned to nobody.** §9 §7: "Newtech is a Data Fiduciary... Retention period and a named responsible person are **open items**, not decided." §10's role table has Developer, Maintainer, SysAdmin and instance admin — no data-protection hat. Meanwhile §9 mandates BitLocker on five laptops with `manage-bde -status` verification and nobody collects the results, and §10 §8 step 7 makes witnessed deletion of local customer data an offboarding step with no named witness.
- **The rebase-before-merge requirement lives in no checklist.** §3 and §10 both establish that a green MR pipeline did not test the branch against `main` (merged-results pipelines are Premium) and that the merging Maintainer must confirm the branch is not behind. It is absent from §1's Definition of Done, absent from §9's 15-item security checklist, and absent from §4's stage 15. The two guard tests most likely to collide semantically without a textual conflict — `routes.test.ts` and `screen-wiring.test.ts` — are named in §3's conflict table, so this is a known, predicted failure with no gate in front of it.
- **The stale PROJECT-LOG tables have two finders and no fixer.** §1 flags §3 of the log (10 test files, @anthropic-ai/sdk as a runtime dependency); §5 flags §6 of the log (122 tests, 11 files, four files that no longer exist). §10 §10 rules that PROJECT-LOG is append-only and "past entries are never rewritten to match a later one" — which is right for a journal, but means both stale tables stay authoritative-looking forever with no mechanism to mark them superseded. §4's stage-19 rule ("log only a decision or a measurement") gives nobody a reason to write the correction.
