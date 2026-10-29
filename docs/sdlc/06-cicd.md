## GitLab CI/CD Pipeline

**Status, read first.** §1 and §2 describe what exists today and what the licence tier actually
permits. **Everything from §3 onward is a plan — not built, not configured, not in force.** There
is no linter, no formatter, no coverage tooling, no scanner job, no `.gitlab/` templates, no
CODEOWNERS (it would do nothing — §2), no scheduled pipeline, no production job, no rollback job.
Production is not deployed. Rules below marked **From Sprint 1** bind nobody today.

One requirement sets the shape of `.gitlab-ci.yml`: **the artifact QA tested must be the artifact
production runs, provably.** Nothing downstream ever names a tag. The image is built once, pushed
once, and every later job addresses it by the immutable `sha256` digest the registry assigned on
push. Every job proposed below must preserve that chain — and the chain is fragile in one specific
way: the Dockerfile runs `apt-get update` in three stages, so **a rebuild resolves different
package versions and yields a different `sha256`.** A pipeline that rebuilds at tag time has
already broken the guarantee, silently, and nothing downstream can detect it. Production pulls the
digest QA tested. Production never builds.

Runner: one Docker-executor runner, tag `qa`, on the workstation (Xeon Gold 6140, 64 GB), with the
host Docker socket mounted. A job on that runner controls the host daemon, which is effectively
root on the machine that also hosts GitLab EE, the registry on `:5050`, and QA on `:8081`. That is
why production gets its own runner on the production host, restricted to protected tags — not this
one.

There is no `image:` key anywhere in `.gitlab-ci.yml`. The default image comes from
`/etc/gitlab-runner/config.toml` (`docker:29-cli`). Any job that needs something else must say so,
and any job that names `node:...` stops being able to talk to the daemon.

**What this section does not own.** One topic, one owner; everything here is a link, not a second
version:

| Topic | Owner |
|---|---|
| Severity scale (one scale, three levels) | `08-monitoring.md` |
| Production precondition / gate list — blocker zero is TODO-SEC-01 | `09-security.md` |
| Semantic version bump rules | `07-deployment.md` |
| Deploy sequence, including back-up-before-migrate and the first-deploy case | `07-deployment.md` |
| Migration rollback policy | `07-deployment.md` |
| Production resource limits, environment table and the production port | `07-deployment.md` |
| Image retention / registry cleanup (must never delete a digest that is still a rollback target) | `08-monitoring.md` |
| npm audit / dependency triage **policy and cadence**; the open advisories | `09-security.md` |
| The test ladder — which tests a change needs | `05-testing.md` |
| The self-skip guard inventory, and the Word-vs-LibreOffice trap | `05-testing.md` |
| Issue and MR templates, DoR / DoD content | `01-agile.md` |
| Role → GitLab permission matrix, protected-branch settings table | `10-roles.md` |
| Branch naming, commit convention | `03-git.md` |
| Dependency-addition rule and its dev-only carve-out | `09-security.md` §3 |

What **is** owned here: the job graph, the `test` job and coverage extraction, the `test:no-skips`
job, the `deps` job definition (flags, stage, blocking behaviour), the tier matrix, the runner
rules, and the digest chain.

### 1. What runs today

Verified against `.gitlab-ci.yml` at `f76a0d7`. Stages: `build → test → publish → deploy`.

| Job | `needs:` | `rules:` | What it actually does |
|---|---|---|---|
| `build` | — | all refs | `docker build --target test` and `--target runtime` from one Dockerfile. Both share every layer up to `npm run build`, so the second build is nearly free. No `docker login` — nothing is pushed and the base image is `node:22-bookworm-slim` from Docker Hub. |
| `test` | `[build]` | all refs | `docker run --rm $IMAGE:test-$SHORT_SHA npm run typecheck`, then `npm test`. Inside the image, against LibreOffice. |
| `publish` | `[test]` | `$CI_COMMIT_BRANCH == $CI_DEFAULT_BRANCH` | First `docker login` of the pipeline, push `$IMAGE:$CI_COMMIT_SHA`, then `docker inspect --format='{{index .RepoDigests 0}}'` into `artifacts:reports:dotenv` as `IMAGE_DIGEST`. |
| `deploy:qa` | `[publish]` | main only | Logs in **again** — `docker login` writes credentials to the *client* filesystem, and publish's died with its container; without this the pull returns "access forbidden". Pulls by digest, recreates `quotation-qa` (`--memory=2g --cpus=2.0 -p 8081:4000 -v quotation_qa_data:/app/data -e TZ=Asia/Kolkata`), asserts `docker inspect .Image` of the container equals `.Id` of the digest, polls `.State.Health.Status` for up to 180 s, then `docker exec … node -e "fetch('http://127.0.0.1:4000/api/health')"` and requires `status === 'ok'` **plus** `checks.database.ok` **plus** `checks.pdf.ok`. |

Also real: `default: tags:[qa], interruptible: true`; `GIT_DEPTH: "0"`. QA is live on host port
**8081**, healthy, serving 225 customers, with LibreOffice at `/usr/bin/soffice`.

Two comments in the file are scar tissue, not decoration. `curl http://127.0.0.1:8081/api/health`
from `deploy:qa` was wrong twice over — the job's `127.0.0.1` is the *job container*, not the host
publishing 8081, and `docker:29-cli` ships no curl, so the first run printed "curl: not found"
thirty times. And the Dockerfile healthcheck passes on `degraded` on purpose (a missing converter
must not kill the container), which is exactly why the job reads the body instead of trusting the
healthcheck.

**What today's pipeline does not prove, and people assume it does:**

1. **The AI paths are never exercised in QA.** `deploy:qa`'s `docker run` passes `-e
   TZ=Asia/Kolkata` and nothing else, and `.dockerignore` keeps `.env` out of the image.
   `aiAvailable()` is `config.geminiApiKey !== null` (`server/src/lib/ai.ts:80`), so
   `/api/capabilities` in QA returns `llm:false` and every AI route is dark. No health check
   anywhere calls Gemini, so **no pipeline job can detect an expired or revoked key** — only a real
   `POST /api/parse/ai` can.
2. **Ten tests can vanish and the job still passes.** Eight guard sites cover ten test cases; the
   inventory and the guard-by-guard table live in `05-testing.md` §9 — do not re-derive it here.
   The CI consequence is the part this section owns: **nothing in CI fails on a skip count.** One
   correction to the older text: the two `web/dist`-gated cases are not merely "protected" — the
   third bundle test is an unconditional `expect(built).toBe(true)`, so on a fresh clone with no
   `npm run build` the suite is **red, not green-with-skips**. Only the converter-gated cases
   vanish quietly. `test:no-skips` (§3) is the fix for those.
3. **No test report survives a failure.** `docker run --rm` with no reporter means a red `test` job
   leaves a log and nothing else.
4. **One test file is never typechecked.** `tsconfig.json` includes `shared`, `server/src`,
   `server/scripts`, `web/src` — `web/bundle-safety.test.ts` sits at `web/` root, outside all of
   them. A type error there reaches nobody, because `vitest run` does not typecheck either.
5. **A `v*` tag pipeline publishes nothing.** `$CI_COMMIT_BRANCH` is unset in a tag pipeline, so
   `publish` and `deploy:qa` both skip. That is not a defect to be fixed by adding a tag rule to
   `publish` — see §3: the tag pipeline must not build, test or publish anything. It must deploy a
   digest that already exists.
6. **Nobody is watching between "merged" and "QA is running the new bytes."** No notification of
   any kind is configured (§9).

**Gaps, plainly:** no lint, no formatter, no coverage tooling (`@vitest/coverage-v8` is absent from
`package.json`), no dependency or secret scanning job, no `.gitlab/` templates, no scheduled
pipelines, no `resource_group` on `deploy:qa`, no production job, no rollback job, no pipeline
notification. **CODEOWNERS is not on that list** — it is not a gap, it is a Premium feature that
would do nothing if added (§2). 29 test files, 450 tests.

### 2. Free tier: what we cannot buy our way around

This is the framework's single tier matrix. Other sections cite one row; nobody restates it.

| Feature | Tier — precisely | What we do instead |
|---|---|---|
| Merge request approval **rules** | Premium | Permissions only. Approvals may be clicked; they block nothing. **Never write "2 approvals required" — in Free it is a lie the tool will not enforce.** The settings table itself is owned by `10-roles.md` §2, which has the monthly API sweep that verifies it. |
| **Code Owners — the entire feature** | Premium | A `CODEOWNERS` file in Free is **not parsed at all**: it cannot request a reviewer, cannot suggest one, cannot block a merge, and produces no error to tell you so. Do not add one and do not design around one. A plain `REVIEWERS.md` is a human lookup table and nothing more — owner `10-roles.md`. |
| **SAST analyzer** (`SAST.gitlab-ci.yml`) | **Free — the analyzer runs** | Usable today. Findings emit as a **JSON artifact only**: no MR widget, no Security Dashboard, no vulnerability tracking over time (all Ultimate). Useful if someone opens the artifact; worthless if nobody does. |
| **Secret Detection analyzer** | **Free — the analyzer runs** | Same shape: JSON artifact, no report surface. We run `gitleaks` instead (§3), because a non-zero exit is a control and an unread report is not. |
| **Dependency Scanning** | **Ultimate only — does not run on Free at all** | An ordinary job: `osv-scanner` + `npm audit` (§4.6). Not GitLab's template — it will not execute. |
| **Container Scanning** | **Ultimate only — does not run on Free at all** | Nothing today. If it is ever wanted it is an ordinary `trivy` job, pinned by digest. |
| License scanning, Security Dashboard, Vulnerability Report, MR security widget, `artifacts:reports:sast` ingestion, Scan Execution / Scan Result Policies | Ultimate | `rules:` in this file, and job artifacts a human opens. There is no dashboard and there will not be one. |
| **Test coverage visualisation** (Cobertura → line-by-line annotation in the MR diff) | **Free — works** | Used, once `@vitest/coverage-v8` lands (§8). |
| Merge trains, pipelines for merged results | Premium | One runner and five developers; serialising merges by hand is not a hardship. The consequence that matters — a green MR pipeline did not test the branch against `main` — belongs to `03-git.md`. |
| Protected environments | Premium | Production job is `when: manual`, gated on a **protected tag** `v*` (maintainers only) and a **protected runner** tagged `prod` on the production host. |

Free and usable: `needs:` DAG, `rules:`, `workflow:rules`, `interruptible`, `resource_group`,
environments + `on_stop`, Releases, scheduled pipelines, `artifacts:reports:junit`,
`coverage_report` (Cobertura), `codequality`, `dotenv`, pipeline-status email integration.

**One correction that matters more than the table.** The project is configured
`merge_method=merge`, `only_allow_merge_if_pipeline_succeeds=true`,
`only_allow_merge_if_all_discussions_are_resolved=true`, `squash_option=default_on` (verified via
the API; the table itself is `10-roles.md` §2's). Two consequences for CI, stated plainly:

- **The pipeline is a real gate for everybody.** `only_allow_merge_if_pipeline_succeeds` is
  enforced by the server. It is the strongest control the tier gives us, which is why the jobs
  below are worth writing at all.
- **"The person who merges is the reviewer" holds for Developers only.** `merge_access_level=40`
  blocks a Developer from merging their own branch. **Nothing prevents a Maintainer merging their
  own MR, and nothing prevents an author resolving their own discussion threads.** Wherever that
  guarantee is claimed, it is claimed for Developers. For Maintainers it is a convention with a
  detective control behind it, not a gate — see `10-roles.md`.

### 3. Target pipeline — NOT BUILT

**From Sprint 1.** Nothing in this section exists. Today's stages are `build test publish deploy`,
four jobs, listed in §1. Target stages: `check → build → test → scan → publish → deploy → verify`.

| Job | Stage | needs | Runs on | Blocking? | Notes |
|---|---|---|---|---|---|
| `secrets` (gitleaks) | check | `[]` | branch, MR, main, **tag**, weekly | **BLOCKING, always** | `GIT_DEPTH: "0"` is already set (it was added so a future `git describe` would not lie), so full-history scanning needs no change. `.env` has never been committed (`git log --all -- .env` is empty) and `.env.example` lists names with empty values, so the first run should be clean — do not pre-write a `.gitleaksignore` for imagined findings. The one key-shaped string in the tree is a *regex* at `web/bundle-safety.test.ts:51`; if a generic rule catches it, ignore that one line by fingerprint, not the file. |
| `pinned-images` | check | `[]` | branch, MR, main, tag | **BLOCKING** | Three lines of grep that make §4.3 machine-checked instead of aspirational. |
| `lint` (eslint 9 flat config) | check | `[]` | branch, MR, main | Advisory until a named date, then **BLOCKING** with `--max-warnings=0` | Not a style rulebook — carries the house rules mechanically (§4.1). The date must be named in the MR that adds the job, or "advisory" is permanent. |
| `tests-touched` | check | `[]` | MR | **ADVISORY** — reviewer dismisses in a thread | §4.7. |
| `typecheck` | test | `[build]` | branch, MR, main | **BLOCKING** | Split out of `test` so a type error reports in ~30 s instead of behind the 180 s PDF tests. Add `web/bundle-safety.test.ts` to `tsconfig.json` `include` in the same change, or this job still cannot see it. |
| `test` | test | `[build]` | branch, MR, main | **BLOCKING** | JUnit + coverage, extracted with `docker cp`, exit code captured (§4.2). This section owns this job; `05-testing.md` owns which tests a change needs. |
| `test:no-skips` | test | `[test]` | branch, MR, main | **BLOCKING** | Fails if the JUnit XML contains any `<skipped`. Must itself fail when `junit.xml` is missing or holds zero testcases — same self-check discipline as `bundle-safety.test.ts`, or a lost artifact reads as a clean run. This is the framework's single skip check: `03-git.md`, `05-testing.md` and `07-deployment.md` drop their versions and link here, and no human is asked to declare a skip count. |
| `deps` (`osv-scanner` + two `npm audit` runs) | scan | `[]` | MR, main advisory; **tag blocking**; nightly | **ADVISORY on MR**, **BLOCKING at `v*`** | Job definition in §4.6. Triage policy, cadence and the named owner of the open advisories are **not** this section's — `09-security.md`. |
| `semgrep` (OSS) | scan | `[]` | MR advisory, weekly | **ADVISORY** | `p/typescript`, `p/nodejs`, plus two local rules that matter here: string-concatenated SQL (hand-written SQL, no ORM — this *is* the injection surface) and interpolated `child_process` arguments (`pdf.ts` spawns `soffice`). |
| `publish` | publish | `[test]` | **main only — never on a tag** | **BLOCKING** | Unchanged from today. Adding a tag rule here is the one change that destroys the digest guarantee; see the box below. |
| `deploy:qa` | deploy | `[publish]` | main, nightly | **BLOCKING** | Add `resource_group: qa` and `environment.on_stop` (§4.4). |
| `smoke:qa` | verify | `[deploy:qa]` | main, nightly | **BLOCKING** | Read-only against QA. The document-render smoke runs against a disposable container, never against QA's volume (§4.5). |
| `deploy:prod` | deploy | **`[]`** | `v*` tag only | manual, **BLOCKING when run** | `tags: [prod]`, `rules: $CI_COMMIT_TAG =~ /^v/`. Takes the digest as an explicit `RELEASE_DIGEST` variable copied from the GitLab Release — it does **not** depend on `publish`. Pull-based: no SSH key in GitLab, no inbound path to 192.168.1.37. Preconditions and sequence: §4.8. |
| `rollback:prod` | deploy | — | `v*` tag | manual, `environment: {name: production, action: stop}` | Procedure owned by `07-deployment.md`. |

> **The tag pipeline must not build, test or publish.** An earlier draft of this section said
> "`publish` must gain `- if: $CI_COMMIT_TAG =~ /^v/` at the same commit that adds `deploy:prod`,
> or the tag pipeline is rejected as invalid for needing a job that does not exist in it." That is
> wrong, and wrong in the most expensive possible way: it fixes the "invalid pipeline" error by
> making `build → test → publish` run on the tag, which rebuilds the image. Three `apt-get update`
> layers later you have a different `sha256`, and production runs bytes QA never saw. The correct
> fix for the same error is the other direction: **`deploy:prod` takes `needs: []`** and reads the
> digest from `RELEASE_DIGEST`, while `build` and `test` carry
> `rules: [{ if: $CI_COMMIT_TAG, when: never }, { when: on_success }]`. The tag pipeline then
> contains `secrets`, `pinned-images`, `deps` and a manual `deploy:prod`, and nothing in it can
> produce an image. `07-deployment.md` owns that sequence and was right; this section now matches
> it.
>
> A hand-copied digest is itself a rule nothing enforces, so it gets a mechanism — §4.9.

### 4. Rules, and what goes wrong without them

**4.1 — Lint rules carry domain decisions, not brace style.** Three `no-restricted-syntax` rules,
each of which passes clean on today's tree (checked):

- **The money rule, stated correctly.** Money is stored and compared **only as integer paise**. A
  division may appear **only where its result is immediately floored or rounded back to an
  integer**; never store, compare, sum or round-trip a fractional rupee. The blanket form of this
  rule — "never a division by 100", as `CLAUDE.md` currently words it — **is false on this
  codebase**: `shared/money.ts` divides by 100 six times (`money.ts:53,66,92,112,158,172`) and
  every one of them sits inside `Math.floor` or `Math.round`, which is correct integer arithmetic.
  `web/src/components/DocumentPreview.tsx:77,87,88` uses `toFixed` for CSS column percentages,
  which is not money at all. Written as a blanket ban the rule fires on the very file it exists to
  protect and is switched off in week one. Fix the wording wherever it appears, `CLAUDE.md`
  included.
  - **Mechanism, part one (eslint):** ban `/ 100`, `.toFixed(` and `parseFloat(` in
    `server/src/**` and `shared/**`, with `shared/money.ts` in `ignores` and `web/src/**` out of
    scope entirely —
    `{ selector: "BinaryExpression[operator='/'][right.value=100]", message: "Money is integer
    paise — divide only in shared/money.ts, and only inside Math.floor/Math.round." }`, plus
    `CallExpression[callee.property.name='toFixed']` and `CallExpression[callee.name='parseFloat']`.
  - **Mechanism, part two (a test, because eslint cannot express "immediately rounded"):** a
    source-text assertion in `shared/money.test.ts` — every line of `shared/money.ts` matching
    `/\s*100` must also match `Math\.(floor|round|trunc)\s*\(`. True of all six lines today, it is
    the same house pattern as `ai.test.ts` and `screen-wiring.test.ts` (which read source as text),
    and it is the only check that enforces the real rule *inside* the exempt file.
- Ban `it('should…')`. The suite has zero occurrences today; the rule keeps it that way.
- Type-aware `no-floating-promises`. `pdf.ts` spawns and kills `soffice`; an unawaited kill is how
  a converter process outlives its job. The Windows sibling of that bug once left 282 orphaned
  `WINWORD.EXE` processes and 12.7 GB of Office telemetry on a disk — recorded in the commit body
  of `be96eb9`.

Emit `artifacts:reports:codequality` from `eslint -f json` through a ~30-line mapper rather than
adding `eslint-formatter-gitlab`. `eslint` and `typescript-eslint` are far larger than the `xlsx`
package that was refused, and are still fine: they are dev-only, `npm prune --omit=dev` in the
`prod-deps` stage keeps them out of the runtime image, and they never see customer data. That
dev-only carve-out belongs next to the dependency rule itself — `09-security.md` §3.

**4.2 — Extract artifacts with `docker cp`, never `-v`, and capture the exit code.** On a
socket-bound runner, `-v "$PWD/out:/out"` resolves `$PWD` on the **host daemon**, not in the job
container — the same mistake class as `127.0.0.1` in `deploy:qa`, and it fails by producing an
empty directory rather than an error.

```
STATUS=0
docker run --name t-$CI_JOB_ID ... || STATUS=$?
...
exit $STATUS
```

with `docker cp` and `docker rm -f` in `after_script` and `artifacts: when: always`. Both halves
are load-bearing. Written the obvious way — `docker run` then `docker cp` in the same `script:` —
a failing run aborts under `set -e` before the `cp`, so the report is lost precisely when it is
wanted, and the named container is never reaped, on the daemon that also runs GitLab, the registry
and QA. And the usual field fix for that, `docker run ... || true`, throws the test result away:
the pipeline goes green on a red suite. Capture the status, then re-exit with it.

**4.3 — Pin scanner images by digest, and check it.** Proposing `zricethezav/gitleaks:latest`
inside the one file whose entire thesis is "a tag can drift, a digest cannot" is self-refuting. Pin
every third-party image the way the app's own image is pinned. **Mechanism** — job
`pinned-images`, `check` stage, `needs: []`, blocking:

```
grep -nE '^[[:space:]]*image:' .gitlab-ci.yml | grep -v '@sha256:' && \
  { echo "unpinned image above"; exit 1; } || true
```

Without the job, this rule survives exactly as long as the person who wrote it reviews every MR.

**4.4 — `resource_group: qa` on `deploy:qa`.** Without it, two merges to main inside the deploy
window both run `docker rm -f quotation-qa` and `docker run --name quotation-qa`. The second kills
the first mid-healthcheck, and the first's digest assertion then inspects the *other* pipeline's
container — a red "DIGEST MISMATCH" on a good commit, or a green deploy of an image that was never
asserted. Note the process consequence too, which no `resource_group` can fix: **QA reflects the
last merge, not your story.** Anyone verifying on QA can have the container replaced under them.

**4.5 — Smoke tests: read-only against QA, and write only to a disposable container.**

An earlier draft had `smoke:qa` POST a real RFQ into the QA container on every merge. That is
precisely what the agent Stop List forbids (`02-*`: never run the app, tests or migrations against
QA — 225 real customer ledgers are seeded there) and what `10-roles.md` warns is uncorrectable: a
row written into `quotation_qa_data` persists forever, nothing backs that volume up, and no
pipeline will ever remove it. Saving with `CI` initials would have isolated the reference counter,
not the `quotes` table. Split the job in two instead:

- **`smoke:qa` — read-only, blocking, on every main deploy.** `docker exec` into the running
  container and read: `GET /api/health` (`status === 'ok'`, `checks.database.ok`,
  `checks.pdf.ok`), `GET /api/capabilities`, and the migration-count assertion below. It writes
  nothing.
- **`smoke:render` — the write path, in a throwaway container.** Same digest, a fresh anonymous
  volume, no published port: the container boots, applies migrations into an empty database, the
  script POSTs a fixed RFQ, saves, renders `.docx`, opens it with `pizzip` (already a runtime
  dependency, present in the runtime image) and asserts `word/document.xml` contains the seeded
  ledger name and a paise figure. Then `docker rm -f` and `docker volume rm`. If the render path
  needs a ledger row, seed one through the same API inside that container — `Resources/` is
  deliberately in the image (§4.10), so the fixture is there. **No CI job writes to
  `quotation_qa_data`.** If anyone later wants the write path exercised against QA itself, that is
  a data-protection decision for `09-security.md` and the Stop List in `02-*`, not a CI decision,
  and it has not been taken.

Why the smoke reads the document rather than checking that a PDF exists: a PDF that exists proves
nothing, because of the Word-vs-LibreOffice difference — the explanation, and the assertion that
keeps it honest, live in `05-testing.md`.

One rule survives from the old design because it is about the counter, not the smoke: if a job ever
does write to a shared database, save with initials `CI`. `allocateRef` is an atomic UPSERT on
`ref_counters`, keyed `PRIMARY KEY (fy, initials)` (`001_init.sql:96-101`), and the counter is
dragged up and never reset — deleting the quote afterwards does not give the number back. A nightly
smoke saving as `RG` would walk a real salesperson's series by 365 a year.

**Add one assertion to both deploys:** `checks.database.detail` reports "*N* migration(s) applied".
Assert *N* equals the number of `.sql` files in `server/db/migrations/` (**5 today**). Migrations
are forward-only and applied at boot; a container that boots with a half-applied set is healthy,
green, and wrong.

**4.6 — The `deps` job (this section owns the job; `09-security.md` owns the policy).** Two audit
invocations, because `--omit=dev` and `--audit-level=high` are two different policies, and running
only the narrow one produces a job that reports zero while measuring nothing — the advisories open
against this tree are dev-tooling transitives, which `--omit=dev` hides by design.

```
npm audit --json > audit-full.json            # every dependency, dev included. Never fails
                                              # the job. This is the number the triage reads.
npm audit --omit=dev --audit-level=high       # runtime only, high and critical. This is the gate.
osv-scanner --lockfile=package-lock.json      # second opinion; catches what the npm advisory
                                              # database has not ingested.
```

- `osv-scanner` is a Go binary — **there is no `osv-scanner` package on npm** (`npm view
  osv-scanner` → 404), so `npx osv-scanner` fails. Use `image: ghcr.io/google/osv-scanner` pinned
  to a digest (§4.3).
- `audit-full.json` is an artifact with `expire_in: 90 days`, and the nightly run opens or updates
  one issue carrying the count. That count is the *input* to the triage; the cadence, the owner and
  the decisions are `09-security.md`'s.
- **Blocking policy:** advisory on MR and main, blocking at `v*`. Blocking on an unfixable
  transitive CVE on every MR gets the job deleted within a week; blocking at the release is where
  the decision actually belongs.
- The tag gate reads `security-waivers.json` at the repo root — CVE id, date, one-line reason,
  expiry date. An expired waiver fails the release. The file's *format* is defined here; **who may
  grant a waiver, and for how long, is `09-security.md`'s.**

**4.7 — `tests-touched`: a warning the reviewer must dismiss.** "Every behaviour change adds or
updates a test in the same MR" is checkable, and nothing checks it. MR-only job:

```
git diff --name-only origin/$CI_MERGE_REQUEST_TARGET_BRANCH_NAME...HEAD > changed.txt
grep -qE '^(server/src|shared)/' changed.txt && ! grep -q '\.test\.ts$' changed.txt && \
  { echo "source changed with no test change"; exit 1; }
```

It has honest false positives — a comment-only change, a rename — so it runs as
`allow_failure: true` and the enforcement is the reviewer opening a thread, which must be resolved
before the merge button unlocks. Per §2 the author can resolve that thread themselves, so this is a
prompt, not a gate, and it is listed as **recommended** in §10. Which tests a change actually needs
is `05-testing.md`'s ladder, not this job's business.

**4.8 — `deploy:prod` preconditions and sequence: not owned here.**

- The **production gate list** — what must be true before production exists at all — is
  `09-security.md`'s, and **blocker zero is TODO-SEC-01: the application has no authentication.**
  All 16 routes are public, including `GET /api/customers` (225 real ledgers with GSTINs and
  addresses) and an unauthenticated `DELETE /api/quotes/:id`. Any precondition list that omits it
  is incomplete — including the four-step pre-flight this section used to print, which is why that
  list is gone rather than corrected.
- The **deploy sequence** — back up while the old container is still up, then swap; the first
  deploy, where there is no database to back up and an unconditional backup step fails release
  1.0.0 at step one; where the backup file is written and copied to; the resource limits; the
  environment table and the production port — is `07-deployment.md`'s. This section's
  "`npm run backup` — `VACUUM INTO`" step is **deleted, not moved.**
- **Rollback**, including the fact that redeploying a previous digest against a migrated database
  is not sufficient, is `07-deployment.md`'s. This section's old §4.7 is deleted.
- **Registry retention** — never delete a digest that is still a rollback target — is
  `08-monitoring.md`'s. It is named here only because the digest chain is worthless if the digest
  is garbage-collected.
- **Production is not deployed**, and the reason (a shared 2-core / 8 GB laptop at 192.168.1.37
  with ~491 MB free, already running Pickup Ops `:3000`, Newtech Inventory `:8000`, IIS `:8080`
  and AnyDesk `:7070`) is stated once, in `07-deployment.md`. Everything else, this section
  included, says "production is not deployed — see `07-deployment.md`."

What remains CI's, and is written down nowhere else:

1. **The `prod` runner.** A separate GitLab Runner on 192.168.1.37, tag `prod`, marked *protected*
   so only protected-tag pipelines can reach it. Its own memory footprint is part of the RAM bill
   on that host.
2. **Two prerequisites nobody costs in.** The LAN has **no DNS server**, so
   `gitlab.newtech.internal` needs a hosts entry on 192.168.1.37, and the **internal CA** must be
   trusted by both git and the Docker client there — or the digest pull fails with a certificate
   error that reads like a network fault.
3. **The environment URL.** `http://192.168.1.37:18080` — the plan reserves 18080–18099 for new
   production apps, and quotation-desk production is 18080. It must **not** reuse 8081: 8080 on
   that host is IIS, 8081 there is unverified, and QA already answers on 8081 on the workstation.
   The authoritative environment table is `07-deployment.md`'s; this section only references it.

**4.9 — Prove `RELEASE_DIGEST` belongs to the tag.** `deploy:prod` takes the digest as a variable a
human pastes from the Release. A hand-copied 71-character string with no check is exactly the kind
of rule this section is supposed to stop writing. Mechanism — one Dockerfile label and two lines:

- `build` adds `--label org.opencontainers.image.revision=$CI_COMMIT_SHA` to the `--target runtime`
  build (same MR as `deploy:prod`).
- `deploy:prod`, after `docker pull "$RELEASE_DIGEST"`:

```
REV=$(docker inspect --format='{{index .Config.Labels "org.opencontainers.image.revision"}}' "$RELEASE_DIGEST")
[ "$REV" = "$CI_COMMIT_SHA" ] || { echo "RELEASE_DIGEST was built from $REV, not from tag $CI_COMMIT_TAG"; exit 1; }
```

A tag pipeline's `$CI_COMMIT_SHA` is the commit the tag points at, so a stale, mistyped or
wrong-branch digest fails before anything on the production host is stopped. The existing
container-vs-digest assertion (§1) still runs afterwards: this one checks the *input*, that one
checks the *result*.

**4.10 — `.dockerignore` is test infrastructure.** `Resources/`, `Quotation -- Format.docx` and the
two customer quotations are deliberately *not* ignored; `importCustomers.test.ts` alone asserts
against the real Tally export in 33 tests. An "obvious tidy-up" of `.dockerignore` makes those
tests fail or skip inside the image. Review a `.dockerignore` change as a test change.

### 5. Schedule matrix — target state, none of it configured

**From Sprint 1.** Read the `v*` column carefully: the blanks are the design, not an oversight.

| Job | Feature push | MR | main | `v*` tag | Nightly | Weekly |
|---|---|---|---|---|---|---|
| secrets | ✅ | ✅ | ✅ | ✅ | — | ✅ full history |
| pinned-images | ✅ | ✅ | ✅ | ✅ | — | — |
| lint | ✅ | ✅ | ✅ | — | — | — |
| tests-touched | — | ✅ advisory | — | — | — | — |
| build / typecheck / test / no-skips | ✅ | ✅ | ✅ | **never — a rebuild breaks the digest guarantee** | ✅ | — |
| deps | advisory | advisory | advisory | **blocking** | ✅ opens/updates an issue | — |
| semgrep | — | advisory | — | — | — | ✅ |
| publish | — | — | ✅ | **never** | — | — |
| deploy:qa + smoke:qa | — | — | ✅ | — | ✅ redeploy last digest | — |
| deploy:prod / rollback | — | — | — | manual | — | — |

`deps` can block at `v*` without violating the no-rebuild rule because it reads `package-lock.json`
and touches no image; it is the one gate the tag pipeline is allowed to carry.

Scheduled pipelines are Free; branch on a `$SCHEDULE_KIND` schedule variable. What a nightly
redeploy-and-smoke can prove: the container still boots, the database opens, LibreOffice still
converts, the migration count is right. What it **cannot** prove, and must not be advertised as
proving: anything about the Gemini key. QA holds no key at all today, and no endpoint validates one
(§1).

### 6. One runner: efficiency rules

1. `concurrent = 3` in `/etc/gitlab-runner/config.toml`. Not higher: every socket-bound job drives
   **one** daemon, parallel `docker build`s contend on the same layer cache, and the box is
   simultaneously GitLab EE, the registry and QA on `:8081` — the desk feels a runaway build.
2. `check` and `scan` jobs take `needs: []` and `image: node:22-bookworm-slim` (or the scanner's
   own pinned image), so they start immediately instead of queueing behind `build` and never touch
   the daemon.
3. Keep `interruptible: true` **and** enable *Settings → CI/CD → Auto-cancel redundant pipelines*.
   `interruptible` alone cancels nothing; three pushes in ten minutes means three full image builds.
4. Add `workflow:rules` so a push with an open MR does not run a branch pipeline and an MR pipeline
   for the same commit. On one runner that is a literal 2× queue.
5. Do not add `--no-cache` to `docker build`. Layer cache is local to the daemon and is why the
   second `--target` is nearly free.
6. For the node-image jobs only: `cache: {key: {files: [package-lock.json]}, paths: [.npm]}` with
   `npm ci --cache .npm --prefer-offline`.
7. `resource_group: qa` on `deploy:qa`, `resource_group: production` on both prod jobs.

### 7. Skeleton

Sketch, not a file to paste — the digest chain, the tag rules and the `docker cp` discipline are
the parts that must survive translation.

```yaml
stages: [check, build, test, scan, publish, deploy, verify]

workflow:
  rules:
    - if: $CI_PIPELINE_SOURCE == "merge_request_event"
    - if: $CI_COMMIT_BRANCH && $CI_OPEN_MERGE_REQUESTS
      when: never
    - if: $CI_COMMIT_BRANCH || $CI_COMMIT_TAG

default:
  tags: [qa]
  interruptible: true

.node: &node
  image: node:22-bookworm-slim@sha256:<pinned>
  needs: []
  cache: { key: {files: [package-lock.json]}, paths: [.npm] }

# A tag must never rebuild: three apt-get update layers make a new sha256,
# and production would then run bytes QA never tested.
.not-on-tags: &not-on-tags
  rules:
    - if: $CI_COMMIT_TAG
      when: never
    - when: on_success

secrets:
  stage: check
  needs: []
  image: ghcr.io/gitleaks/gitleaks@sha256:<pinned>
  script: [gitleaks detect --source . --redact]

build:
  stage: build
  <<: *not-on-tags
  script:
    - docker build --target test    -t "$IMAGE:$TEST_TAG"  .
    - docker build --target runtime -t "$IMAGE:$BUILD_TAG"
        --label org.opencontainers.image.revision=$CI_COMMIT_SHA .

test:
  stage: test
  needs: [build]
  <<: *not-on-tags
  script:
    - STATUS=0
    - docker run --name t-$CI_JOB_ID "$IMAGE:$TEST_TAG"
        npx vitest run --reporter=default --reporter=junit
        --outputFile.junit=/app/junit.xml --coverage || STATUS=$?
    - exit $STATUS
  after_script:            # runs even when the tests fail — that is the point
    - docker cp t-$CI_JOB_ID:/app/junit.xml junit.xml || true
    - docker cp t-$CI_JOB_ID:/app/coverage/cobertura-coverage.xml cobertura.xml || true
    - docker rm -f t-$CI_JOB_ID || true
  coverage: '/All files[^|]*\|[^|]*\s+([\d.]+)/'
  artifacts:
    when: always
    reports:
      junit: junit.xml
      coverage_report: { coverage_format: cobertura, path: cobertura.xml }

publish:
  stage: publish
  needs: [test]
  rules:
    - if: $CI_COMMIT_BRANCH == $CI_DEFAULT_BRANCH   # main only. Never a tag.

deploy:prod:
  stage: deploy
  tags: [prod]
  needs: []                 # nothing to build or test on a tag — see §3
  when: manual
  resource_group: production
  environment: { name: production, url: http://192.168.1.37:18080, on_stop: rollback:prod }
  rules: [{ if: '$CI_COMMIT_TAG =~ /^v/' }]
  script:
    - docker pull "$RELEASE_DIGEST"        # pasted from the Release; verified per §4.9
```

Two vitest details that bite: with more than one `--reporter`, the flag is
`--outputFile.junit=<path>`, not `--outputFile=`; and `coverage.reporters` must include both `text`
(for the `coverage:` regex to have anything to match) and `cobertura`.

### 8. Coverage: one new dependency, justified

`@vitest/coverage-v8` is the official provider, dev-only, and pruned out of the runtime image by
the existing `prod-deps` stage. **Pin it to the vitest line in use: `@vitest/coverage-v8@2.1.9`,
matching `vitest ^2.1.3`.** `npm i -D @vitest/coverage-v8` installs 5.0.0 today and vitest 2
refuses to start with it.

Publish the number for four weeks before setting any floor. Then set per-directory floors only
where a regression is a **tax error**: `shared/money.ts` and `shared/fy.ts` at 100 %,
`server/src/lib/` at 85 %. **No global threshold** — a project-wide percentage produces tests
written to move a number, and coverage is otherwise judged per diff in review (that reasoning is
`05-testing.md`'s; the floors and the job are this section's). A 100 % floor on `money.ts` is not a
number-chasing target: it is the tax code.

Read the resulting numbers knowing what they cannot see. Four of this suite's most deliberate
guards assert on **source text** rather than by executing it: `ai.test.ts` reads `ai.ts` as a
string, `bundle-safety.test.ts` greps `web/dist`, `screen-wiring.test.ts` reads `QuoteEditor.tsx`
alongside the functions it imports, `routes.test.ts` asserts the complete sorted route list.
`ai.ts` is one of the most carefully guarded files in the repo and will report near-zero coverage.
And do not chase a number under `web/`: environment is `node`, there is no jsdom, no
testing-library, and no React component is ever rendered — line coverage there measures nothing
real.

### 9. After the merge: who watches the pipeline

**The integration can be enabled today; the human half is From Sprint 1.** Nothing notifies anyone
of anything. If `publish` or `deploy:qa` fails after a merge, `main` has moved, QA is still serving
the previous digest, and the only person who might notice is whoever happens to open the pipeline
page.

- **Machine part:** enable *Settings → Integrations → Pipeline status emails* (Free) for failed
  pipelines on `main`, addressed to the maintainer group. It runs server-side, needs no runner and
  no new job. Alerting beyond that — and the severity of "QA is down during quoting hours" — is
  `08-monitoring.md`'s, which owns the framework's single three-level severity scale.
- **Human part:** the Maintainer who clicks Merge stays with the pipeline until `smoke:qa` is
  green. Nothing can enforce that, so it is written as an obligation of the release owner in
  `10-roles.md`, not as a mandatory rule here. **Measure the interval once the jobs exist and
  record the number** — until then "stay with it" has no duration and will not be honoured.

### 10. Every rule here, and what actually checks it

Nothing on this list is allowed to stay mandatory with no mechanism.

| Rule | Mechanism | Status |
|---|---|---|
| The running container is the digest that was tested | `deploy:qa` digest assertion | **In force today** |
| The pipeline must be green to merge | `only_allow_merge_if_pipeline_succeeds=true`, server-side | **In force today** |
| `RELEASE_DIGEST` was built from the tagged commit | image label + `deploy:prod` check (§4.9) | Planned with `deploy:prod` |
| The tag pipeline never rebuilds | `.not-on-tags` on `build`/`test`; `publish` default-branch-only; `deploy:prod` `needs: []` | Planned |
| No committed secret | `secrets` (gitleaks), blocking | Planned |
| No unpinned third-party image | `pinned-images` grep job, blocking (§4.3) | Planned |
| No silent skips | `test:no-skips` on the JUnit XML, blocking, self-checking (§3) | Planned |
| A test report survives a red run | `after_script` + `artifacts: when: always` (§4.2) | Planned |
| Money is integer paise | eslint `no-restricted-syntax` + the `money.test.ts` source-text assertion (§4.1) | Planned |
| Every migration applied on boot | migration-count assertion in both deploys (§4.5) | Planned |
| No CI job writes to QA's data | `smoke:qa` is read-only; the write path runs in a disposable container (§4.5) | Planned |
| Runtime dependencies free of high/critical CVEs | `deps`, blocking at `v*`, waivers with expiry (§4.6) | Planned |
| A behaviour change carries a test | `tests-touched`, advisory; reviewer opens a thread (§4.7) | Planned — **recommended, not mandatory** |
| Lint clean | `lint`, advisory until the date named in the MR that adds it, then blocking with `--max-warnings=0` | Planned |
| Author says which PDF backend they exercised | **No machine check exists** — CI cannot know what ran on a laptop. MR-template checkbox (`01-agile.md` owns the template), enforced by the reviewer opening a thread. Until that template exists it is honestly **"the reviewer asks"** | Not in force |
| A Maintainer does not merge their own MR | **Not enforceable in Free** (§2); detective control only, owned by `10-roles.md` | Not in force |

**Who owns `.gitlab-ci.yml`, and in what order the changes land.** Five sections propose edits to
one file, and several of them were mutually exclusive. The file is human-owned: agents do not edit
it (Stop List, `02-*`), and every job above is an ordinary MR reviewed by the SysAdmin/Owner hat
(`10-roles.md`). Order matters, because a branch pipeline runs root-capable jobs on the shared
runner *before* anyone reviews the change:

1. `pinned-images` + `secrets` — `check` stage, no daemon access, nothing depends on them.
2. `typecheck` split out of `test`, together with the `tsconfig.json` `include` fix.
3. `test` rewritten for JUnit + coverage + exit-code capture, then `test:no-skips` on top of it.
   That order or nothing: the no-skips job has no artifact to read until `test` produces one.
4. `resource_group: qa` and `environment.on_stop` on `deploy:qa`; then `smoke:qa` (read-only) and
   `smoke:render` (disposable container).
5. `lint` (advisory) with the eslint config and the `money.test.ts` assertion; then `deps`; then
   `semgrep`.
6. The tag work as one MR: `.not-on-tags` on `build`/`test`, the image label, `deploy:prod` with
   `needs: []` and the `RELEASE_DIGEST` check, `rollback:prod`. It cannot merge before the
   production preconditions in `09-security.md` and `07-deployment.md` are closed — it would put a
   manual deploy button in front of a host that cannot yet run the container.
