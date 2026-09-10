## Deployment, Release and Rollback

### What this section owns, and what it does not

This section is the single owner of the following, and states them completely:

- the facts about the intended production host and the **infrastructure** blockers in front of it
- **semantic version bump rules**
- the **deploy sequence**, including back-up-before-migrate
- **migration rollback policy** and the rollback procedure
- **production resource limits**
- the **digest chain** from `publish` to a running production container
- the required contents of a **GitLab Release description**

Everything else it used to explain now lives elsewhere. One line each; do not re-derive:

| Topic | Owner |
|---|---|
| The complete production precondition / gate list, **blocker zero = TODO-SEC-01** | `09-security.md` §0 |
| Severity scale (one scale, three levels) | `08-monitoring.md` |
| Registry retention, image cleanup, garbage collection | `08-monitoring.md` |
| `npm audit` / dependency-scanning **job definition** (flags, stage, blocking) | `06-cicd.md` |
| `npm audit` / dependency-triage **policy and cadence** | `09-security.md` |
| The `test` job, coverage extraction, the `test:no-skips` job | `06-cicd.md` |
| The test ladder, and which tests a change needs | `05-testing.md` |
| The self-skip guard inventory (8 guard sites, 10 test cases) | `05-testing.md` §9 |
| Issue and MR templates, DoR / DoD | `01-agile.md` |
| Role → GitLab permission matrix, and the protected-branch settings table | `10-roles.md` §2 |
| Branch naming and commit-message convention | `03-git.md` |
| The GitLab Free / Premium / Ultimate feature matrix | `06-cicd.md` §2 |
| `deploy:qa` mechanics as actually built | `06-cicd.md` §1 |
| The Word-vs-LibreOffice trap, explained | `05-testing.md` |

One duplication below is deliberate and is marked where it appears: the health-body check is
reproduced in full **because this section instructs you to copy it verbatim into `deploy:prod`**.

### How to read a rule here

Every rule carries its enforcement:

- **[machine]** — a named job, command or file fails when the rule is broken. The mechanism is given.
- **[checkbox]** — a line in the Release template (`01-agile.md` owns the template set); the deployer
  or reviewer is the enforcement, and opening a thread when it is missing is the only enforcement
  GitLab Free provides.
- **[recommended]** — nothing checks it. It is advice and is not called mandatory.

Nothing here is marked mandatory without a mechanism. A mandatory rule nothing can check teaches
the reader that the mandatory list is aspirational.

### What is in force today

**In force:** the QA row of the environment table, `deploy:qa` as built, and the measured facts
about `192.168.1.37`.

**Not in force — design only:** `deploy:prod`, the Release checklist, the production rollback
procedure, the smoke test, the `.gitlab/` templates, the version-bump gate. There is no production
container, no `deploy:prod` job, no second runner, no `.gitlab/` directory, and GitLab issues are
unused. Where something takes effect at Sprint 1 it says **From Sprint 1**.

### Status: QA is real, production does not exist

`.gitlab-ci.yml` has four stages — build, test, publish, deploy — and ends with a comment block
headed *"Production is deliberately absent."* That is still true. Nothing in this section describes
production as running.

| Environment | Host | How it runs | State today |
|---|---|---|---|
| dev | each developer's Windows laptop | `npm run dev` — `tsx watch server/src/index.ts` on `PORT=4000`, Vite on `WEB_PORT=5173` proxying `/api`. `PDF_BACKEND` blank, so whichever converter is installed wins; on at least one box that is none, and the PDF route returns 503 while `.docx` works. | live |
| QA | `192.168.1.40:8081` | container `quotation-qa`, started by `deploy:qa` **by digest**, `--memory=2g --cpus=2.0`, `-p 8081:4000`, volume `quotation_qa_data`, `-e TZ=Asia/Kolkata`. 225 Tally ledgers were imported into that volume once; the pipeline never seeds — redeploys mount the same named volume and leave the data alone. | live, healthy, 225 customers, LibreOffice at `/usr/bin/soffice`; redeployed on every green pipeline on `main` |
| production | `192.168.1.37:18080` (decided — see blocker 5) | **nothing exists**: no runner registered, no `deploy:prod` job, no volume, no container | blocked on 0–4 |

#### Blocker zero: TODO-SEC-01

**The application has no authentication.** All 16 routes are public, including
`GET /api/customers` — 225 real ledgers with GSTINs and addresses — and an unauthenticated
`DELETE /api/quotes/:id` that hard-deletes a priced document. Production does not deploy while that
is true.

This section does **not** publish a production gate list. **`09-security.md` §0 owns it**, and
TODO-SEC-01 is blocker zero on it. The four items below are the *infrastructure* blockers this
section contributes to that list; they are not the whole list, and a box that clears all four is
still not deployable.

#### Infrastructure blockers. Each is a prerequisite, not a preference.

1. **RAM.** 8 GB, ~491 MB free, already carrying Pickup Ops (`:3000`), Newtech Inventory (`:8000`),
   IIS (`:8080`) and AnyDesk (`:7070`). Docker Desktop's WSL2 VM takes what it likes unless told
   otherwise. Upgrade to 16 GB *first*, then cap the VM in `%USERPROFILE%\.wslconfig`
   (`memory=3GB`, `processors=1`). Uncapped, the first thing that dies is not the quotation desk —
   it is three apps that have users today, and none of their owners agreed to that trade.
2. **CPU cannot be fixed.** i3-1115G4, 2 cores. `server/src/lib/pdf.ts` runs a **queue of
   concurrency 1**, a **90 s hard timeout**, and **one retry** — so a single stuck conversion can
   hold the only converter for ~180 s while every other *Download PDF* waits behind it. QA hides
   this at `--cpus=2.0`. Measure conversion time on `.37` before promising the desk anything.
3. **Backups actually running.** `npm run backup` exists and is correct (`VACUUM INTO`, then it
   reopens the copy and counts migrations, customers and quotations — a backup nobody has read is a
   hypothesis). There is no schedule and no external drive; `08-monitoring.md` owns the schedule and
   the destination. This is not only a production problem: **the desk is using QA, so
   `quotation_qa_data` already holds real work and is backed up by nothing.**
   **Open and unowned:** whether the desk may issue *real customer quotations* from QA has never
   been decided, and that decision is what determines whether QA needs a backup schedule today or
   after the RAM upgrade. Until someone owns it, treat QA's volume as production data.
   **[recommended]**
4. **The runner's plumbing on `.37`.** No DNS on the LAN, and the registry is behind an internal CA.
   Before a deploy can pull anything, `.37` needs `gitlab.newtech.internal` in
   `C:\Windows\System32\drivers\etc\hosts`, and the CA at
   `%ProgramData%\Docker\certs.d\gitlab.newtech.internal:5050\ca.crt`. Missing either, `docker login`
   fails with `x509: certificate signed by unknown authority` and the deploy job dies before it has
   done anything.
5. **The port — decided here, recorded here: production is `18080`.**
   `8080` on `.37` is IIS. `8081` on `.37` was never verified free and must not be assumed, and it
   is already QA's port on `.40` — the same number on two boxes is how a runbook line gets run
   against the wrong machine. The site plan reserves **`18080`–`18099` for new production apps**;
   quotation-desk production takes **`18080`**. QA stays on `8081` on `.40`. `06-cicd.md` (whose
   skeleton had `8082`) and `09-security.md` (which recorded the port as "not chosen") reference
   this row rather than choosing again.

Until blocker zero and blockers 1–4 are closed, the desk stays on QA. Do not stand production up
"temporarily": a temporary box gets real quotations on it, and blocker 3 is what makes that
unrecoverable. **[recommended]** — nothing technical prevents someone running a container on `.37`;
the only enforcement is that no `deploy:prod` job exists to make it easy.

### Release authority when GitLab Free cannot require approvals

**From Sprint 1 — not in force today.** No `v*` tag has been cut and there is no Release.

Required MR approvals are Premium. In Free, a developer *can* click Approve and it blocks nothing.
Nobody should write "two approvals required" into this process, because nothing enforces it.

Three records carry the signatures instead. All three are Free-tier and none is an approval counter.
The live protected-branch and protected-tag settings are **owned by `10-roles.md` §2**, which also
holds the monthly API sweep that detects drift; only the consequences this section depends on are
stated here.

| Signature | What actually holds it up | Where it is recorded |
|---|---|---|
| Code reviewed | `merge_access_level=40`: **a Developer cannot merge their own work.** A Maintainer can, and nothing stops them — see below | "merged by X" on the MR |
| Release approved | protected tag `v*`, maintainers only | annotated tag author + the GitLab Release |
| Deploy authorised | `when: manual` job on a protected-tag pipeline | "played by X" on the job, and the Environments → production timeline |

**Say this plainly wherever the guarantee is claimed.** Verified against the project API:
`merge_method` is `merge`, `only_allow_merge_if_pipeline_succeeds=true`,
`only_allow_merge_if_all_discussions_are_resolved=true`, `squash_option=default_on`. **Nothing
prevents a Maintainer merging their own MR, and nothing prevents an author resolving their own
discussion threads.** The "the person who merges is the reviewer" guarantee holds for Developers,
because `merge_access_level=40` blocks them. It does **not** hold for Maintainers — who are the
people most likely to be merging. `10-roles.md` owns the headcount and the detective control.

Rules:

1. **The Release description carries three things or the deploy does not start.**
   - the **image digest** — **[machine]**: `deploy:prod` refuses to start with `RELEASE_DIGEST`
     unset (`test -n "$RELEASE_DIGEST"`) and asserts the running container against it after the pull.
   - the **migration filenames in this release**, or the word `none` — **[machine-generated,
     checkbox to paste]**: the job computes and prints the list rather than trusting anyone's memory:
     ```sh
     PREV_TAG=$(git describe --tags --abbrev=0 "${CI_COMMIT_TAG}^" 2>/dev/null || true)
     git diff --name-only "$PREV_TAG".."$CI_COMMIT_TAG" -- server/db/migrations/
     ```
     (`GIT_DEPTH: "0"` in the existing `variables:` block is what makes this work inside a job.)
   - the **pre-deploy backup filename** — **[machine]**: the filename is deterministic
     (`pre-$CI_COMMIT_TAG.db`) and the backup step fails the job if it is not written to both
     locations. Nothing is typed by hand.
2. **Tagger and deployer are different maintainers. [recommended]** GitLab Free cannot enforce it:
   the protected tag admits any maintainer, and the manual job admits anyone who may write to the
   protected ref. It is detectable after the fact — compare the annotated tag's tagger with
   `GET /projects/:id/deployments` → `user.username` — and that check belongs in **`10-roles.md`'s
   monthly sweep**. Until that sweep has a named owner and a fixed date, this is a recommendation,
   not a rule. When only one maintainer is available, write that in the Release description: a rule
   recorded as broken is worth more than one silently broken.
3. **Verify the deploy gate on the first `v*` tag. [checkbox, one-off]** GitLab restricts jobs on a
   protected ref to users who may write to it, so a Developer should be unable to play
   `deploy:prod`. Have a Developer try it once, and record the date and the result in
   `PROJECT-LOG.md`. If they can play it, the gate is decoration and the job must move behind
   something real.
4. **Do not add CODEOWNERS.** Code Owners is Premium **in its entirety** — a `CODEOWNERS` file in
   GitLab Free is not parsed at all: it cannot request a reviewer and it cannot block a merge. A
   plain `REVIEWERS.md` is a human lookup table and nothing more; do not describe either as a
   mechanism. **[machine]**, cheaply, as one line in the existing `test` job:
   ```sh
   test ! -e CODEOWNERS && test ! -e .gitlab/CODEOWNERS && test ! -e docs/CODEOWNERS
   ```

**Gap:** there is no `.gitlab/` directory. The Release checklist *content* above is this section's;
the *file* it lands in belongs to the template set **owned by `01-agile.md`** (which settles the
capitalisation, since GitLab's template lookup is case-sensitive). Until it exists, the checklist is
improvised from memory at the worst possible moment.

### Version numbering

`package.json` is `0.1.0` and `"private": true`, and nothing reads the version at runtime — grep the
server, it is not there.

This is the single version policy for the framework; `03-git.md`'s table is deleted and links here.

| Bump | Trigger | Why |
|---|---|---|
| MINOR (`0.x.0`) | any release containing a file in `server/db/migrations/`, **or** a change to the rendered document, tax or rounding | both are things an image swap cannot undo; the version number should tell you the rollback is not free |
| PATCH (`0.1.x`) | everything else | image swap restores the previous state exactly |

**Deliberately not MINOR triggers:** a new route, a new field in the schema shapes, a new runtime
dependency. Those break `routes.test.ts` / `screen-wiring.test.ts` and they matter — but test
breakage is a *review* signal, not a *rollback cost*. The version number answers exactly one
question: **can I undo this release by swapping the image?** A new route swaps back cleanly; a
migration does not.

**[machine] — the migration half is a gate in `deploy:prod`.** A release that ships a migration
under a PATCH bump hides its rollback cost from whoever reads the tag at 22:00:

```sh
PREV_TAG=$(git describe --tags --abbrev=0 "${CI_COMMIT_TAG}^" 2>/dev/null || true)
if [ -n "$PREV_TAG" ]; then
  MIG=$(git diff --name-only "$PREV_TAG".."$CI_COMMIT_TAG" -- server/db/migrations/)
  P="${PREV_TAG#v}"; T="${CI_COMMIT_TAG#v}"
  if [ -n "$MIG" ] && [ "$(echo "$P" | cut -d. -f1-2)" = "$(echo "$T" | cut -d. -f1-2)" ]; then
    echo "This release contains migrations but bumps only PATCH:"; echo "$MIG"; exit 1
  fi
  # Proxy for "rendered document, tax or rounding". Printed, not enforced: these paths
  # are a proxy for a judgement, and a comment change inside one of them is not a MINOR.
  git diff --name-only "$PREV_TAG".."$CI_COMMIT_TAG" -- \
    server/templates/ server/src/lib/docx.ts shared/money.ts shared/states.ts shared/company.ts
fi
```

The document/tax/rounding half stays **[checkbox]**: the tagger states in the Release description
which trigger applied, because "did the number on the customer's page change?" is a judgement no
path list can make.

Stay on `0.x` until production runs; the first production release is `1.0.0`. **[recommended]** —
nothing stops a maintainer tagging `v1.0.0` today; the tagger is the enforcement.

Tags are **annotated** and protected (`v*`, maintainers only). **[machine]**, as the first line of
`deploy:prod`, because a lightweight tag has no author and therefore carries no "release approved"
signature at all:

```sh
test "$(git cat-file -t "$CI_COMMIT_TAG")" = tag || { echo "$CI_COMMIT_TAG is a lightweight tag"; exit 1; }
```

Tag messages follow the house commit convention — **owned by `03-git.md`**; the shape is:

```sh
git tag -a v0.2.0 -m "Cut 0.2.0 - a customer is a ledger, not a name"
```

**Gap: nothing tells you what a box is running.** Add `version` to the `/api/health` body. That is
safe against both source-as-text guards: `routes.test.ts` asserts the sorted route lists of the
three *routers* (`parseRoutes`, `quoteRoutes`, `renderRoutes`) and `/api/health` is registered
directly on `app` in `server/src/index.ts`, so it is not in that list; `screen-wiring.test.ts`
iterates `Object.keys(QuoteSchema.shape)`, which the health body is not. Adding a new *route* would
fail `routes.test.ts` — deliberately. (`09-security.md` proposes widening `routes.test.ts` to assert
the routes registered on the **app**. When that lands, adding a field to an existing body is still
safe, and adding a route to `index.ts` stops being invisible — which is the point.)

### Artifacts and the digest chain

Built once, pushed once, addressed forever by `sha256`. A tag can be moved onto different bytes; a
digest cannot.

| Step | Where the digest comes from |
|---|---|
| `publish` (main only) | `docker inspect --format='{{index .RepoDigests 0}}' "$IMAGE:$BUILD_TAG"` → `build.env` → `artifacts:reports:dotenv` |
| `deploy:qa` | `$IMAGE_DIGEST` from that dotenv artifact; login, pull, run, assert |
| GitLab Release | the tagger pastes that same digest into the Release description |
| `deploy:prod` (gap) | manual job variable `RELEASE_DIGEST`, copied from the Release, asserted after the pull |

The assertion, already in `deploy:qa` and to be copied verbatim into `deploy:prod`:

```sh
RUNNING=$(docker inspect --format='{{.Image}}' quotation-prod)
EXPECTED=$(docker inspect --format='{{.Id}}' "$RELEASE_DIGEST")
test "$RUNNING" = "$EXPECTED" || { echo "DIGEST MISMATCH - aborting"; exit 1; }
```

**The production job must never build.** The Dockerfile runs `apt-get update` in three stages, so a
rebuild at tag time resolves different package versions and produces a *different image* than the
one QA tested — which discards the entire reason this file addresses images by digest. Production
**pulls the digest QA tested**. It never rebuilds. This is the single most load-bearing property in
the framework: every other rule here exists to keep it true.

**Gap — tag pipelines rebuild today. [machine, once applied]** `publish` and `deploy:qa` are fenced
with `rules: if: $CI_COMMIT_BRANCH == $CI_DEFAULT_BRANCH` (false on a tag pipeline), but `build` and
`test` carry **no `rules:` at all** and therefore do run when you push `v0.2.0`. The fix:

- `build` and `test` get `rules: [{ if: $CI_COMMIT_TAG, when: never }, { when: on_success }]`
- `publish` stays default-branch-only — it does **not** gain an `$CI_COMMIT_TAG` rule
- `deploy:prod` takes `needs: []` and an explicit `RELEASE_DIGEST`
- `deploy:prod` sets `interruptible: false` — the `default:` block sets `interruptible: true` for
  every job, and a deploy GitLab is allowed to cancel mid-`docker run` can leave the host with no
  container
- `deploy:prod` carries **no `retry:`** — the default is no retry, and that is correct: a second run
  pulls the same digest and fails the same way

An earlier draft of `06-cicd.md` had the opposite design — `publish` gaining `if: $CI_COMMIT_TAG`,
`deploy:prod` declared `needs: [publish]`, and build/typecheck/test marked ✅ on a `v*` tag. That
chain requires build → test → publish to run on the tag pipeline, which is a rebuild at tag time: a
different sha256, and QA-tested bytes that never reach production. **This section wins**; if you
still find that design in `06-cicd.md`, it has not been reconciled yet.

**Registry retention** is owned by **`08-monitoring.md`** (cleanup policy, disk headroom, and the
`gitlab-ctl registry-garbage-collect` window). The one constraint this section imposes on that
policy, as the owner of rollback: **a digest named in a GitLab Release that has not been superseded
is a live rollback target and must never be deleted.** A plain "keep the last 10 tags" policy
violates that as soon as there are eleven releases.

### Configuration and secrets

| Variable | dev | QA (as actually deployed) | production (design) |
|---|---|---|---|
| `TZ` | host clock | `Asia/Kolkata` — `ENV` in the Dockerfile, re-passed as `-e` by `deploy:qa` | same, **never override** |
| `PDF_BACKEND` | blank → auto-detect | `libreoffice`, pinned in the Dockerfile | `libreoffice`, pinned |
| `DB_PATH` | `./data/quotes.db` | **not set** — the default resolves to `/app/data/quotes.db`, which is where `quotation_qa_data` is mounted | not set; volume `quotation_prod_data` at the same path |
| `GEMINI_API_KEY` | each developer's own, in `.env` | **not passed** — `deploy:qa`'s `docker run` carries only `-e TZ` | CI/CD variable, **Protected + Masked** |
| `BACKUP_DEST` | — | not used | host path for the off-volume pre-deploy backup: the same destination `08-monitoring.md`'s schedule writes to |
| `PORT` | 4000 | 4000 in the container, published as **8081** on `192.168.1.40` | 4000 in the container, published as **18080** on `192.168.1.37` |

Consequences, in order of how likely they are to bite:

- **`TZ` is not cosmetic.** `shared/fy.ts` derives the Indian financial year from the local clock,
  and the quotation reference carries it: `NCS/2026-27/Quotes/RG/001`. `shared/fy.test.ts` pins the
  boundary at 31 March / 1 April. A container on UTC hands the customer a document numbered in the
  wrong financial year, and the counter that issued it lives in the database.
  **[machine]** — asserted twice in `deploy:prod`: `docker exec quotation-prod printenv TZ` must be
  `Asia/Kolkata`, and the smoke test checks the FY segment of a live reference (below).
- **Never set `PDF_BACKEND=word` on a server.** The COM path once left 282 orphaned `WINWORD.EXE`
  processes and 12.7 GB of Office telemetry on one disk (`.env.example` records it; the commit body
  of `be96eb9` is the primary record). Pinning `libreoffice` also means a missing converter fails
  loudly instead of quietly downgrading `/api/health` to `degraded` and hiding the PDF button.
  **[machine]** — `docker exec quotation-prod printenv PDF_BACKEND` must be `libreoffice`, and the
  deploy run line passes no `-e PDF_BACKEND` at all.
- **Gap — QA has no API key, and nobody decided that.** With `GEMINI_API_KEY` absent,
  `/api/capabilities` reports the AI features off and the desk cannot exercise "Read the thread" on
  QA at all. Either pass the key to `deploy:qa` or write down that QA is deliberately AI-less; do
  not leave it as an accident of the `docker run` line.
- Production gets **no `.env` file**. Everything arrives as `-e` flags from the deploy job. Secrets
  exist only as CI/CD variables marked Protected, which in Free means they are exposed only to
  pipelines on protected refs — that, and not an approval, is what keeps a feature branch away from
  the production key.
- The key is server-side only, and `web/bundle-safety.test.ts` greps the built `web/dist` for the
  literal value to prove it never ships to the browser.

### Migrations on deploy — the deploy sequence

This is the authoritative deploy sequence. `04-dev-workflow.md` and `06-cicd.md` delete their backup
and migrate steps and cross-reference here. **Design — not in force today.**

Forward-only; there are no down migrations. `getDb()` applies pending files at boot inside
`BEGIN IMMEDIATE` with a re-check inside the lock (`server/src/db/migrate.ts`) — SQLite's default
`DEFERRED` let two connections both read `_migrations`, both decide `005_queries_numbers.sql` was
pending, and the loser die on `duplicate column name`.

There is **no separate migrate step**: migrations run at container boot. So the order is not
"back up, then migrate" — it is **back up while the old container is still up, then swap**.

Deploy order is not negotiable:

1. **Back up while the old container is still up.** `VACUUM INTO`, never `cp` — `quotes.db` was once
   4 KB while `quotes.db-wal` held 2.7 MB, so a file copy backs up an empty database and reports
   success. (CLAUDE.md rule 4 owns that fact; this is the operational procedure.) Order matters for
   a second reason: a read-only connection to a WAL database needs the `-shm`, which is live while
   the app is running.
   ```sh
   docker run --rm -v quotation_prod_data:/app/data "$RELEASE_DIGEST" \
     ./node_modules/.bin/tsx server/scripts/backup.ts \
     "/app/data/backups/pre-$CI_COMMIT_TAG.db"
   ```
   Two things about that command. `tsx` is a **runtime** dependency, so it survives
   `npm prune --omit=dev` and this works in the shipped image. And `backup.ts` **refuses to
   overwrite an existing destination** — a second attempt at the same tag dies here saying so. That
   is correct: add a suffix, never delete the first backup.
2. **Copy the backup off the volume, and fail the deploy if that copy fails. [machine]** A
   pre-deploy backup that lives only inside `quotation_prod_data` survives a bad migration but not a
   lost volume, a corrupt database file, or a `docker volume rm` typo during recovery — which are
   exactly the situations a rollback exists for. `$BACKUP_DEST` is the same destination
   `08-monitoring.md`'s schedule writes to (`G:\Backups\quotation` today, on a drive that is still
   unpurchased — until it exists this copy is a hedge against the process, not against losing `.37`,
   and the Release description should say so).
   ```sh
   docker run --rm -e TAG="$CI_COMMIT_TAG" \
     -v quotation_prod_data:/app/data -v "$BACKUP_DEST":/backup busybox sh -c '
       test -n "$TAG" || exit 1
       test ! -e "/backup/pre-$TAG.db" || { echo "off-volume backup pre-$TAG.db exists - add a suffix"; exit 1; }
       cp "/app/data/backups/pre-$TAG.db" "/backup/pre-$TAG.db"
       test -s "/backup/pre-$TAG.db"'
   ```
   Both copies are kept deliberately: the in-volume one is what step 3 of the rollback reads (fast,
   already on the box); the off-volume one is what you have left when the volume is gone.
3. **The very first production deploy has no database to back up.** `backup.ts` exits non-zero with
   *"No database at … — nothing to back up"*, which would fail release `1.0.0` on step 1. Handle it
   **once, explicitly, in the job** — a guard on whether the volume already contains `quotes.db` —
   and never by making the backup step non-fatal. `|| true` on a backup step permanently disables
   the guard that protects every deploy after the first one.
4. Stop old, start new; the new container migrates at boot.
5. If a migration throws, the process exits and the container never reaches `healthy`. Nothing is
   half-deployed *at the container level* — but the **database may be partly changed**, because only
   the failing file rolls back, not the ones that already committed.
6. Recovery is the rollback below, restoring the backup from step 1.

**Rule for authors: run `npm run migrate -- --check` against a restored copy of the QA database
before tagging.** It changes nothing and exits non-zero when anything is pending, which is exactly
the assertion you want. A migration that works on an empty schema and not on 225 real ledgers is
found here or in production.
**[checkbox]** today — the tagger performs it and ticks it in the Release description; nothing
checks it, and it is not called mandatory. It becomes **[machine]** the day QA backups are scheduled
(blocker 3, `08-monitoring.md`): a job can then restore the most recent QA snapshot into a throwaway
volume and run the check against it.

### Health checks, and why health is not a smoke test

`/api/health` returns **200 for `degraded`** on purpose: a missing PDF converter must not kill a
container whose `.docx` path is fine. The Dockerfile `HEALTHCHECK` only tests `r.ok`, so **it stays
green with the renderer completely dead.** Worse, `pdf.ts` initialises `status = 'ready'` from
`config.pdfBackend` and `warmUp()` is fire-and-forget at boot — so for the first seconds the body
says `pdf.ok: true` before any conversion has been proved, and flips to `error` only after the
warm-up fails.

`deploy:qa` therefore reads the body, from inside the container. **This snippet is reproduced here
deliberately — it is the one justified duplication in this section, because the instruction is to
copy it into `deploy:prod` unchanged.** (`06-cicd.md` §1 owns the description of `deploy:qa` as
built; nothing else about that job is restated here.)

```sh
docker exec quotation-prod node -e "
  fetch('http://127.0.0.1:4000/api/health').then(r=>r.json()).then(j=>{
    console.log(JSON.stringify(j));
    if (j.status !== 'ok') { console.error('status is ' + j.status); process.exit(1); }
    if (!j.checks.database.ok) { console.error('database not ok'); process.exit(1); }
    if (!j.checks.pdf.ok) { console.error('pdf converter not ok'); process.exit(1); }
  }).catch(e=>{ console.error(e.message); process.exit(1); });"
```

`docker exec`, not `curl` from the job: a CI job's `127.0.0.1` is the job container, not the host
publishing the port, and `docker:29-cli` ships no `curl` — the first run printed `curl: not found`
thirty times and then failed the grep.

The wait loop is 45 × 4 s = 180 s against a `HEALTHCHECK` with `--start-period=45s`. On `.37`'s two
cores the boot-time LibreOffice warm-up is slower than on the workstation; measure it there and
raise `start-period` if needed, or the deploy job will fail on a container that was merely slow.

**Gap — there is no smoke test. [machine, once written]** Add `server/scripts/smoke.ts`, run with
`docker exec quotation-prod ./node_modules/.bin/tsx server/scripts/smoke.ts` after the health check.
Its spec already exists: PROJECT-LOG §6's hand-run production smoke test of 17 August 2026. Rebuild
it from today's route list, though — that log calls `POST /api/reconcile`, which no longer exists;
`server/src/routes/routes.test.ts` holds the truth. At minimum it must assert:

| Assertion | What it catches |
|---|---|
| `GET /api/customers` is non-empty and matches the count in the Release description | an empty or wrong volume mounted |
| `GET /api/next-ref` returns a reference whose financial-year segment matches `financialYear(new Date())` | `TZ` drift — the wrong FY on a customer-facing document |
| a fixed quotation through `POST /api/render/docx`, then open the bytes with **pizzip** (a runtime dependency) and assert `word/document.xml` parses and carries the expected total | the Word-vs-LibreOffice trap — `05-testing.md` owns the explanation; the short version is that a converted PDF proves nothing |
| `POST /api/render/pdf` completes, starts `%PDF`, exceeds a byte floor | the converter actually ran, rather than `checks.pdf.ok` being an un-warmed default |

The production smoke test is **read-only apart from the render calls**, which persist nothing: it
must not save a quotation, and `GET /api/next-ref` peeks rather than allocating, so it burns no
reference number. (Whether the *QA* smoke test may write into `quotation_qa_data` is an open
decision that `06-cicd.md`, `02-ai-rules.md` and `10-roles.md` currently answer differently. It is a
data-protection decision, not a CI one.)

Text-level PDF assertions stay in `pdf.test.ts`: `pdfjs-dist` is a devDependency and is pruned out
of the runtime image.

**Skipped tests.** A skip in CI is a red pipeline wearing green. The check that catches it is
`test:no-skips`, **owned by `06-cicd.md`** — it reads the JUnit XML and fails when the artifact is
missing. The guard inventory is **owned by `05-testing.md` §9**. This section previously proposed
its own version of both; deleted.

### The production deploy job (design, not deployed)

- **A second runner, installed on `192.168.1.37`**, tag `prod`, registered as **protected** so it
  only picks up protected-ref jobs. The deploy is then **pull-based**: production needs no inbound
  connection and **no SSH key is stored in GitLab**. The existing `qa` runner is socket-bound on the
  workstation, which is effectively root there; the same will be true on `.37`, which is why that
  runner must never accept a feature-branch job.
- Prefer the **shell executor** with the Docker CLI on `.37` over the docker executor: the docker
  executor pulls a `docker:cli` image for every job, and blocker 1 is RAM.
- `when: manual`, `rules: [{ if: $CI_COMMIT_TAG =~ /^v/ }]`, `needs: []`, `interruptible: false`, no
  `retry:`, `environment: { name: production, url: http://192.168.1.37:18080 }`. In Free,
  `environment:` buys the deployment record and the rollback button on the Environments page — it
  does **not** restrict who may deploy. Protected Environments is Premium; the protected tag and the
  protected runner are the gate.
- `docker login` inside the job. Credentials are written to the *client*, not the daemon, and died
  with the `publish` container.
- **Resource limits are mandatory — and asserted, so the word means something. [machine]** Docker
  applies none by default. Unlimited next to Pickup Ops, Inventory and IIS on two cores is how you
  take down three working apps to ship one that has no users yet.

```sh
docker run -d --name quotation-prod --restart unless-stopped \
  --memory=1g --memory-swap=1g --cpus=1.0 --pids-limit=256 \
  -p 18080:4000 -v quotation_prod_data:/app/data \
  -e TZ=Asia/Kolkata -e GEMINI_API_KEY="$GEMINI_API_KEY" \
  "$RELEASE_DIGEST"

# The limits are the point; prove they were applied rather than trusting the line above.
docker inspect --format='{{.HostConfig.Memory}} {{.HostConfig.NanoCpus}} {{.HostConfig.PidsLimit}}' \
  quotation-prod | grep -qx '1073741824 1000000000 256' \
  || { echo "resource limits not applied - aborting"; docker rm -f quotation-prod; exit 1; }

docker exec quotation-prod printenv TZ          | grep -qx 'Asia/Kolkata' || exit 1
docker exec quotation-prod printenv PDF_BACKEND | grep -qx 'libreoffice' || exit 1
```

Deliberately tighter than QA's `--memory=2g --cpus=2.0`. **QA is roughly double the intended
production shape, so "it was fine on QA" tells you nothing about a 1 GB / 1 CPU container on a
2-core i3** — no section should describe QA as the place the production shape is exercised.
`--cpus=1.0` leaves a core for the other three apps and makes PDF conversion slower; that is the
trade, and it is the right one. Watch `--memory-swap=1g` (no swap) during the first weeks: a
LibreOffice conversion that crosses 1 GB is OOM-killed mid-render, `--restart unless-stopped` brings
the container back, and the desk sees a failed download with nothing obvious in the app log. Check
`docker inspect --format='{{.State.OOMKilled}}'` before blaming the renderer.

Any pre-flight "assert N GB free RAM" check elsewhere in the framework must be stated against these
numbers, not against QA's.

### When a deploy fails

| Fails at | What it means | Action |
|---|---|---|
| `docker login` / `pull` | `x509: unknown authority` or an unresolvable host — blocker 4 was never done on `.37` | fix hosts file / CA, re-run. Nothing has changed on the box. |
| digest assertion | the tag moved, or the wrong `RELEASE_DIGEST` was pasted | stop. Never `--force` past this: the whole pipeline exists to make this comparison meaningful. |
| resource-limit assertion | the `docker run` line was edited | the job removes the container it just started. Fix the line; do not start it by hand. |
| never reaches `healthy` | usually a migration threw at boot; sometimes just a slow warm-up on two cores | `docker logs --tail 40 quotation-prod`. Migration → roll back. Slow → raise `start-period`, not the retry count. |
| health body `degraded` | LibreOffice missing, or `HOME` unwritable (the image chowns `/home/node` because LibreOffice writes there on first run) | the desk can still download `.docx`. Roll back within the hour — do not leave a box in `degraded` and call it deployed. |
| smoke test | green health, broken render | roll back. This is the LibreOffice-plain-text trap; the customer would have received a PDF of raw XML. |

The job must not retry and hope. A second run pulls the same digest and fails the same way.

**Who is watching.** The person who plays `deploy:prod` stays with it until the smoke test passes or
the rollback completes. The same obligation applies after a merge to `main`, where `publish` or
`deploy:qa` can fail while `main` has already moved and QA is still serving the previous digest —
today nothing notices that but a human opening the pipeline page. `10-roles.md` makes the merging
Maintainer the release owner and owns how long they must stay with it. **[recommended]** here:
nothing alerts anyone, `08-monitoring.md` owns notification, and Uptime Kuma is planned, not
installed.

Grade the failure on the **one severity scale owned by `08-monitoring.md`**. This section defines no
severities of its own.

### Rollback

**This section is the single owner of the rollback procedure.** `03-git.md` and `08-monitoring.md`
cross-reference here and state no procedure of their own. In particular, "an image rollback is safe
if the migration was additive" is **not** the rule: that is a judgement handed to whoever is on the
box at 22:00, and every migration in this repository is additive right up until one is not —
`004_customer_identity.sql` is exactly the kind that changes meaning without dropping a column.

Run on `192.168.1.37`. `$PREV` is the previous release's digest, taken from its GitLab Release.
`docker login` first — the credentials from the deploy job are gone.

Do **not** use the Environments page "Rollback" button for a release that contained a migration: it
re-runs a deployment job, which swaps the image and does not restore the database.

**No migration in the release** — swap the image, keep the data:

```sh
docker rm -f quotation-prod
docker pull "$PREV"
docker run -d --name quotation-prod --restart unless-stopped \
  --memory=1g --memory-swap=1g --cpus=1.0 --pids-limit=256 \
  -p 18080:4000 -v quotation_prod_data:/app/data \
  -e TZ=Asia/Kolkata -e GEMINI_API_KEY="$GEMINI_API_KEY" "$PREV"
docker inspect --format='{{.Image}}' quotation-prod
docker inspect --format='{{.Id}}' "$PREV"   # these two must match
```

**The release contained a migration** — an image swap is not a rollback. There are no down
migrations, so the old code meets a schema it does not know:

```sh
# 1. Preserve what the bad release wrote, before you overwrite it. Old container still up.
docker run --rm -v quotation_prod_data:/app/data "$PREV" \
  ./node_modules/.bin/tsx server/scripts/backup.ts \
  "/app/data/backups/forensic-$(date +%Y%m%d-%H%M%S).db"

# 2. Stop the app so nothing holds the WAL.
docker rm -f quotation-prod

# 3. Put the pre-deploy backup back, sidecars removed, owned by the app user.
#    busybox runs as root: without the chown, uid 1000 (node) gets
#    "attempt to write a readonly database" on the first quotation.
docker run --rm -v quotation_prod_data:/app/data busybox sh -c \
  'rm -f /app/data/quotes.db /app/data/quotes.db-wal /app/data/quotes.db-shm && \
   cp /app/data/backups/pre-vX.Y.Z.db /app/data/quotes.db && \
   chown 1000:1000 /app/data/quotes.db'

# 4. Fast-forward the reference counter (below) BEFORE anything can save a quotation.

# 5. Start the previous digest, assert it (above), then run the health-body check.
docker run -d --name quotation-prod --restart unless-stopped \
  --memory=1g --memory-swap=1g --cpus=1.0 --pids-limit=256 \
  -p 18080:4000 -v quotation_prod_data:/app/data \
  -e TZ=Asia/Kolkata -e GEMINI_API_KEY="$GEMINI_API_KEY" "$PREV"
```

If step 3 cannot find the in-volume backup — a lost or recreated volume — restore the off-volume
copy written by deploy step 2, mounted the same way: add `-v "$BACKUP_DEST":/backup` and
`cp /backup/pre-vX.Y.Z.db /app/data/quotes.db`.

#### Step 4: the reference counter, and why every restore re-issues numbers

`allocateRef` is a single atomic UPSERT on `ref_counters (fy, initials, last_seq)`, and the counter
**only moves forward**. Restoring a backup moves it *backwards*, so the desk's next save re-issues a
reference number that a quotation created after the backup already carries — and that quotation may
already have been emailed to a customer. This is a guaranteed consequence of every restore, not an
edge case, and it is the reason step 4 exists rather than an instruction to "check before the desk
sends anything".

Drag the restored counter up to the highest number the bad release handed out, using `max()` for the
same reason `claimRef` does: a gap in the series is harmless, a duplicate is not.

```sh
docker run --rm -w /app -e FORENSIC="/app/data/backups/forensic-YYYYmmdd-HHMMSS.db" \
  -v quotation_prod_data:/app/data "$PREV" node -e "
    const D = require('better-sqlite3');
    const db = new D('/app/data/quotes.db');
    db.prepare('ATTACH ? AS bad').run(process.env.FORENSIC);
    const rows = db.prepare('SELECT fy, initials, last_seq FROM bad.ref_counters').all();
    const up = db.prepare('INSERT INTO ref_counters (fy, initials, last_seq) VALUES (?,?,?) ' +
      'ON CONFLICT (fy, initials) DO UPDATE SET last_seq = max(last_seq, excluded.last_seq)');
    for (const r of rows) up.run(r.fy, r.initials, r.last_seq);
    console.log('counters fast-forwarded:', JSON.stringify(rows));
  "
```

**What step 3 costs, and who talks to the desk.** Every quotation created between the pre-deploy
backup and now is gone from the live database. Step 1 exists so those rows can be read out of the
forensic copy by hand — a manual recovery, not an automatic one. The person who played the deploy
owns this conversation (`10-roles.md` names the release owner) and must, in this order:

1. tell the desk **before** starting, and stop them saving;
2. note the window (backup timestamp → `docker rm -f` time) in the bad release's GitLab Release
   description;
3. run step 4, so no number is re-issued;
4. list the references that exist only in the forensic copy — `SELECT ref FROM bad.quotes` minus the
   live set — and hand that list to the desk, because those documents may already have been emailed
   and no longer exist in the app.

This is the concrete price of forward-only migrations, and the reason a migration forces a MINOR
bump.

### Gap register

Everything above marked as a gap, in one place, with where it goes. **None of these is done.**

| # | Gap | Lands in | Owner |
|---|---|---|---|
| 0 | **TODO-SEC-01 — no authentication on 16 public routes** | blocker zero on the production gate list | `09-security.md` §0 |
| 1 | Release checklist is improvised | the Release template (`.gitlab/` does not exist) | content here; file set in `01-agile.md` |
| 2 | No smoke test | `server/scripts/smoke.ts` + a step in `deploy:prod` | here |
| 3 | Running version is invisible | `version` in the `/api/health` body | here |
| 4 | `build` / `test` run on tag pipelines, so a tag rebuilds | `rules:` on both jobs; `needs: []` on `deploy:prod` | policy here, job graph in `06-cicd.md` |
| 5 | No production job, no protected runner on `.37` | `deploy:prod` + a `prod`-tagged protected runner | here |
| 6 | Pre-deploy backup would live only inside the app's own volume | the off-volume copy step, `$BACKUP_DEST` | step here; destination in `08-monitoring.md` |
| 7 | Backups written but not scheduled — including QA, which holds real work | schedule + external drive (unpurchased) | `08-monitoring.md` |
| 8 | QA silently has no `GEMINI_API_KEY` | decide, then either add `-e` to `deploy:qa` or record the decision | here |
| 9 | Registry cleanup policy | GitLab registry settings, honouring "never delete a non-superseded released digest" | `08-monitoring.md` |
| 10 | Nothing asserts 0 skipped tests | `test:no-skips` | `06-cicd.md` |
| 11 | No linter and no formatter, so several rules here have no static check | a lint job, if one is ever added | `06-cicd.md` |

Not doing, and why: required MR approvals, Protected Environments and Code Owners are **Premium** —
and Code Owners is Premium in full, so a `CODEOWNERS` file in Free is inert, not merely unenforced.
For everything else about tiers — which analyzers actually run on Free, which are Ultimate, and what
the free substitute is — see the one tier matrix in **`06-cicd.md` §2**. The `npm audit` job is
defined in **`06-cicd.md`**; its policy, cadence and the open advisories are owned by
**`09-security.md`**.
