## Git Strategy and Rules

**What is in force today:** the branch protections, the squash, the tag protection, and
the conventions below that a human reviewer applies by reading. **What is not:** every
CI check named here (none of them exist yet), the MR template (there is no `.gitlab/`
directory), issue links (GitLab issues are unused), tags (there are none), and the whole
hotfix path (production is not deployed). Each is labelled where it appears. Nothing in
this section is a rule that "should" be true — it is either enforced, or it says who
enforces it, or it says plainly that it is a recommendation.

### The model: one branch, squash-merged through an MR

`main`, short-lived branches off it, squash on merge, annotated `v*` tags for releases. Measured on this clone today, not aspirational: **61 commits, 5 merge commits (`!1`–`!5`), 0 tags, `"version": "0.1.0"` unchanged since the first commit `ec42755`.**

There is no `develop` branch and there will not be one. `publish` and `deploy:qa` both carry `rules: - if: $CI_COMMIT_BRANCH == $CI_DEFAULT_BRANCH`, so a commit on `develop` would be built, tested, and then deployed nowhere. Git Flow's `release/*` branches exist to maintain an old release while a new one is prepared; there is one QA instance and zero production instances, so there is nothing to maintain in parallel.

### What the protections buy you

The authoritative record of the live protected-branch and protected-tag settings — the
exact values, and the monthly API sweep that catches drift — is **10-roles.md §2**. Do not
copy the values here or anywhere else; five copies of a server configuration guarantee the
first drift is invisible. What follows is only the consequence each one has for how you work.

| Consequence you can rely on | Because of |
|---|---|
| **Nobody pushes to `main`** — not developers, not maintainers, not the instance admin. `git push origin main` is rejected server-side, always. | `push_access_level=0` |
| **A Developer cannot merge their own work.** Developers cannot merge at all. | `merge_access_level=40` |
| **A Maintainer *can* merge their own MR, and GitLab will not stop them.** So can the Owner. See the correction below. | nothing prevents it, on any tier |
| **Red pipeline, no merge button.** Note `interruptible: true` is set on all jobs: pushing again cancels the running pipeline, and a canceled pipeline is not a green one. | `only_allow_merge_if_pipeline_succeeds` |
| **Every thread resolved before merge.** This catches a thread nobody read; it does not catch a thread the author waved away, because **the author can resolve threads on their own MR** — nothing prevents that either. | `only_allow_merge_if_all_discussions_are_resolved` |
| **Your branch lands as one commit — and loses its body.** See "Commit messages". | `squash_option=default_on` |
| **Branch deleted server-side; your clone keeps the stale ref.** | `remove_source_branch_after_merge` |
| **Developers cannot cut a release tag.** | protected tags `v*`, maintainers only |

**Correction — "you cannot merge your own MR" is false, and this section used to say it.**
The guarantee holds for **Developers**: `merge_access_level=40` blocks them outright, so a
Developer's work is always merged by someone else. It does **not** hold for Maintainers or
the Owner. GitLab Free has no mechanism that stops a Maintainer merging their own MR, and
none that stops any author resolving their own discussion threads. State it the honest way:

> **A Developer cannot merge their own work. A Maintainer can, and does not.**

The second half of that sentence is a discipline rule, not a control. Its enforcement is the
detective sweep owned by **10-roles.md §2** (`GET /projects/:id/merge_requests?state=merged&target_branch=main`,
flagging any MR where `author.username == merge_user.username`), and the headcount question
— how many maintainers there are, and whether a second pair of hands is even available —
is 10-roles.md's too. **Not in force today: that sweep has no named owner and no fixed date.**
Until it has both, treat "a Maintainer never merges their own MR" as **recommended**, because
the history below shows it has never once held.

### What GitLab Free does not give you (the three rows that shape the git workflow)

The complete Free/Premium/Ultimate matrix, with the "what we do instead" column, is owned by
**06-cicd.md §2** — including the scanner tiers, which are commonly got wrong: SAST and
Secret Detection *do* run on Free and emit a JSON artifact only (no MR widget, no dashboard,
no tracking over time), while Dependency Scanning and Container Scanning are Ultimate-only
and do not run here at all. Three rows change how you branch and merge, so they are repeated
here as consequences:

| Feature | Tier | Consequence here |
|---|---|---|
| Required MR approvals | Premium | A developer can click Approve and it blocks **nothing**. Never write "2 approvals required" into a process on this instance — it is theatre. The enforcement is `merge_access_level=40`: for a Developer's MR, **the person who clicks Merge is the reviewer**. For a Maintainer's own MR there is no enforcement at all. |
| Code Owners | Premium | **The whole feature is Premium, not just the approval enforcement.** A `CODEOWNERS` file on Free is not parsed, cannot request a reviewer, and cannot block a merge. It does literally nothing. See "CODEOWNERS" below. |
| Merged results pipelines, merge trains | Premium | **Your green MR pipeline tested your branch, not your branch combined with `main`.** This is not theoretical for this repo: `routes.test.ts` asserts three complete sorted route lists with `toEqual`, and `screen-wiring.test.ts` iterates `Object.keys(CustomerSchema.shape)`, `QuoteItemSchema.shape` and `TermsSchema.shape`. Two MRs each adding a route are both green; the second one merged turns `main` red. Rebase onto `origin/main` and let the pipeline re-run before asking for a merge — and see the semi-linear setting below, which is the one way to make that a blocked button instead of an instruction. |

**Gap — the review guarantee has never actually been exercised.** All ten GitLab-side commits (5 squashes + 5 merges) carry one account: `Rohit Solunke <gitlab_admin_10ccd4@example.com>`, the instance root admin. On every MR to date the author of the landed commit and the merger are the same account. The permissions make author ≠ merger *possible*; the history does not yet show it *happening*. Prerequisite: at least two maintainer accounts that are real developers and not the root admin. The headcount is 10-roles.md's to fix.

**Gap — git identities.** 61 commits carry three identities (`Quotation Desk <dev@newtech.in>` ×30, `Newtech <newtech@newtech.co.in>` ×21, the admin ×10). None is a developer's own account. Set `user.email` to your GitLab account email on the new laptop or your commits do not link to a user and `git shortlog` credits nobody.

### Branch naming

**This section owns branch naming and the commit convention.** Both are complete and
authoritative here; nothing else in the framework should restate them.

`<type>/<kebab-case-why>`. Name the branch after the *why*, not the ticket: `fix/qa-health-check`, not `fix/issue-12`.

| Prefix | Use for | Real branches in this repo |
|---|---|---|
| `fix/` | wrong behaviour | `fix/reject-non-docx` (!1), `fix/concurrent-migrations` (!3), `fix/qa-health-check` (!5) |
| `chore/` | pipeline, config, deps | `chore/qa-url-192-168-1-40` (!2) |
| `docs/` | documentation only | `docs/onboarding-and-ai-guide` (!4) |
| `feature/` | new desk-visible capability | **Never used yet.** Every merged branch so far is `fix/`, `chore/` or `docs/`. `ONBOARDING.md` step 5 and `CLAUDE.md` both use `feature/…` in their examples, so the prefix is agreed; nothing has needed it. |
| `hotfix/` | — | **Meaningless today: production is not deployed.** |

The whole pattern, as a regex a machine can apply:

```
^(fix|feature|chore|docs|hotfix)/[a-z0-9]+(-[a-z0-9]+)*$
```

**Enforcement.** GitLab's branch-name push rule is Premium, so there is no server-side check
available on this instance. The available mechanism is a CI job — **not in force today; no
such job exists.** `.gitlab-ci.yml` is owned by the SysAdmin/Owner hat (10-roles.md) and the
order in which pipeline edits land is 06-cicd.md's, so this arrives through a human-reviewed
MR like any other pipeline change:

```yaml
lint:branch-name:
  stage: build
  image: alpine:3.20
  interruptible: true
  rules:
    - if: $CI_COMMIT_BRANCH && $CI_COMMIT_BRANCH != $CI_DEFAULT_BRANCH
  script:
    - |
      echo "$CI_COMMIT_BRANCH" | grep -Eq '^(fix|feature|chore|docs|hotfix)/[a-z0-9]+(-[a-z0-9]+)*$' \
        || { echo "branch name must be <type>/<kebab-case-why>, e.g. fix/qa-health-check"; exit 1; }
```

Until that job exists the rule is **recommended, and the reviewer is the enforcement** — a
badly named branch is a comment on the MR, not a blocked merge. Do not mark it mandatory in
the meantime; five branches have been named correctly by hand and no machine has ever looked.

**From Sprint 1 — not in force today.** GitLab issues are unused: zero issues carry any part
of the process. When issues are adopted at Sprint 1, the issue number goes in the **MR
description**, not in the branch name — the branch still says *why*. Issue linking, DoR and
DoD are owned by 01-agile.md.

**Gap — the hotfix path has never been exercised.** Production is not deployed, and the list
of things that must be true before it is belongs to **09-security.md**, whose blocker zero is
TODO-SEC-01: the application has no authentication of any kind. All 16 routes are public,
including `GET /api/customers` (225 real customers with GSTINs and addresses) and an
unauthenticated `DELETE /api/quotes/:id`. Any precondition list that omits that one is
incomplete. Once production does run: if `main` is deployable, branch from `main`; if `main`
carries unreleased commits, branch from the deployed tag, MR back into `main`, and cut the
next patch tag. Rehearse that against QA *before* the first production deploy, not during the
first incident.

### Commit messages

Imperative, sentence case, explain **why**, no prefix. **Zero conventional-commit prefixes exist in 61 commits** — a `feat:` or `fix:` in an MR is a review comment, not a preference.

```
Stop the PDF converter leaking a Word process on every kill
Identify a customer by ledger, not by name
Take the web port from .env too, and stop Vite drifting off it
Refuse to convert something that is not a .docx
Check QA health from somewhere that can actually see it
```

Measured: subject length min 32, median 60, max 81 characters. Nothing enforces it — there is no commit-msg hook, no linter and no formatter anywhere in the repo — so treat ~72 as the target and 81 as the observed ceiling. Length is **recommended**; the prefix ban is checkable and should be checked (below).

**56 of 61 commits carry a body**, and the bodies are where this project's engineering record actually lives. `be96eb9` is the model: 282 orphaned `WINWORD.EXE` processes, 12.7 GB of Office telemetry in `%TEMP%\Diagnostics`, a full disk, and **`parser.ts` left at zero bytes** by a write that landed on it. None of that is in the subject line. That incident is recorded in the commit body of `be96eb9` and nowhere else — not in `PROJECT-LOG.md`, `README.md`, `ONBOARDING.md` or `.gitlab-ci.yml` — which is itself the strongest argument for the rule.

**The five commits with no body are exactly the five that came through an MR.** Squash discarded them:

| | |
|---|---|
| Branch commit `e7d3fa0` | subject + a 16-line body explaining the Word-versus-LibreOffice divergence the fix exists for (the trap itself is 05-testing.md's to explain) |
| What landed on `main` (`40c4ce7`) | the subject. Nothing else. |
| The merge commit `775d4fa` | the same subject plus `See merge request newtech/quotation-desk!1` |

The branch is deleted server-side after merge, so that reasoning now exists only in GitLab's database. `ae46c14` lost the same way: the `BEGIN IMMEDIATE` race analysis (`dbb0baa`, ~25 lines, with the reproduction — six concurrent openers, five times over) is not in `git log`.

**Rules that follow:**

1. **Write the body on your branch commit anyway** — the reviewer reads it in the MR.
2. **Put the same reasoning in the MR description.** This is the canonical record: it is what survives the squash in GitLab, and the reviewer sees it before the merge rather than after.
3. **Recommended — was mandatory, and is 0 for 5.** The merging maintainer edits the squash commit message before clicking Merge and pastes the why into it. It is an editable box in the merge widget; leaving it at the default is how `40c4ce7` ended up as a bare subject. Nothing checks this and it has been skipped on every merge to date, so it is written down as a recommendation rather than a rule the list pretends is binding. The detective control — to be added to the monthly sweep in **10-roles.md §2**, next to the author-equals-merger check — is one command:
   ```bash
   for c in $(git log origin/main -n 20 --format=%H); do
     [ -z "$(git log -1 --format=%b "$c")" ] && echo "$c landed with no body"
   done
   ```
   Merge commits pass, because they carry `See merge request …`; what this prints is exactly the squashes that lost their reasoning. Publish the count in `PROJECT-LOG.md`.
4. **Squash also rewrote the author:** `e7d3fa0` was authored by `Newtech <newtech@newtech.co.in>` and `40c4ce7` is authored by the merger. Do not expect `git log --author` or `git blame` to find the author of merged work.

**Enforcement of the prefix ban.** Machine-checkable, and **not in force today** — the job
does not exist. `GIT_DEPTH: "0"` is already set in `.gitlab-ci.yml`, so the full history is
present and the range resolves once `main` has been fetched:

```yaml
lint:commit-messages:
  stage: build
  image: alpine/git:latest
  interruptible: true
  rules:
    - if: $CI_COMMIT_BRANCH && $CI_COMMIT_BRANCH != $CI_DEFAULT_BRANCH
  script:
    - git fetch --quiet origin "$CI_DEFAULT_BRANCH"
    - |
      if git log --format='%s' "origin/$CI_DEFAULT_BRANCH..HEAD" \
         | grep -Eiq '^(feat|fix|chore|docs|refactor|test|perf|build|ci|style)(\([^)]*\))?!?: '; then
        echo "no conventional-commit prefixes in this repo - match git log"; exit 1
      fi
```

A missing body is a **warning, not a failure** — a genuinely trivial commit legitimately has
none. The same job can print the subjects of body-less commits with `allow_failure: true` and
let the reviewer decide. Until either exists, both are reviewer-enforced.

### MR rules

The single merge gate — the checklist a reviewer works through — is **01-agile.md's
Definition of Done**, which absorbs 09-security.md's security checklist by reference. What
follows are the git-specific obligations; they belong on the MR template, not in a sixth
parallel checklist.

1. **One MR, one reason.** If the title needs "and" twice, split it. (`!2` needed one "and" and it was already two things.)
2. **A green MR pipeline proves the tests pass in the container. It does not prove the deploy works, and it did not test your branch against `main`.** Branch pipelines run `build` + `test` only. `!2` exists because `deploy:qa` came back "access forbidden" *after* `!1` merged; the mechanics of that job, and why it has to log in again, are 06-cicd.md §1's.
3. **Rebase onto `origin/main` before asking for a merge**, and say in the thread that you did. Free has no merged-results pipeline, so this is the only thing standing between two independently-green MRs and a red `main`. Enforcement today: **nothing** — it is in no checklist and no job. The available Free-tier mechanism is a project setting nobody has set: **merge method "Merge commit with semi-linear history"** (`merge_method=rebase_merge` via the API; the instance is on `merge_method=merge` today, verified). It refuses the merge until the source branch has been rebased onto the target, it keeps the merge commit this section wants to keep, and it turns this rule from an instruction into a blocked button. The cost is honest: pressing GitLab's Rebase button starts a new pipeline and `only_allow_merge_if_pipeline_succeeds` makes you wait for it — which is the point. **Not in force today; changing the setting is a 10-roles.md decision.**
4. **A skipped test in CI means a guard stopped guarding.** The guard inventory — 8 guard sites covering 10 test cases — is 05-testing.md §9's, and the check that fails the pipeline on a skip is 06-cicd.md's `test:no-skips` job reading the JUnit XML. Do not add a competing check here: this section previously proposed grepping the log for the word "skipped", which would also fire on any future test whose *name* contains it. **Not in force today** — the job does not exist, so a skip currently passes silently.
5. **Say which PDF backend you exercised.** Your laptop ran Word; CI ran LibreOffice. The explanation is 05-testing.md's; the obligation here is one sentence in the MR description. Nothing can check it — CI cannot know what ran on a laptop — so this is a **template checkbox with the reviewer as the enforcement**, and until `.gitlab/` exists, "the reviewer asks".
6. **Schema change:** say that a migration was added and that it is forward-only. The next free number is `006_*.sql` — `001`–`005` are applied. What a rollback then costs, and how one is performed, are 07-deployment.md's.
7. **Never edit or renumber an applied migration.** This one *is* machine-checkable and should be checked (**not in force today**): a modification, deletion or rename under `server/db/migrations/` fails; an addition passes.
   ```yaml
   - git fetch --quiet origin "$CI_DEFAULT_BRANCH"
   - |
     changed=$(git diff --diff-filter=MDR --name-only "origin/$CI_DEFAULT_BRANCH...HEAD" -- server/db/migrations/)
     if [ -n "$changed" ]; then echo "applied migrations are immutable: $changed"; exit 1; fi
   ```
8. **A Developer's MR is merged by someone else — that part is enforced. A Maintainer's is not.** See the correction above, and 10-roles.md §2.

**Gap: there is no `.gitlab/` directory and no MR template.** The complete template inventory
— and the agreed capitalisation, which matters because GitLab's template lookup is
case-sensitive — is owned by **01-agile.md**. What this section needs on the MR template is
four checkboxes: rebased onto `main` (until semi-linear is set), which PDF backend you
exercised, migration added and forward-only, and "does this MR touch `shared/`,
`server/db/migrations/`, `server/templates/quotation-template.docx`, `.gitlab-ci.yml` or
`Dockerfile`? name who you pulled in". Those are the things a maintainer currently has to
remember unaided, and each of them has already cost this project a bug.

### Merge, squash, rebase

| Operation | When | Command / setting |
|---|---|---|
| **Squash** | Every MR. Default on. Edit the squash message first (recommended — see above). | GitLab merge button |
| **Merge commit** | GitLab writes one on top of the squashed commit (`74be293` has parents `5665434` and `77d012d`). Leave it — it is the only in-git record of who merged. | automatic |
| **Rebase** | To pick up `main` and to resolve conflicts. Your branch history is disposable; squash discards it. Rebase before asking for a merge — Free has no merged-results pipelines. | `git fetch origin && git rebase origin/main` |
| **Merge `main` into your branch** | Never. It pollutes the diff the reviewer reads and buries the change under `main`'s commits. | — |
| **Semi-linear history** | **Recommended change, not set today.** `merge_method` is `merge` (verified via the API). `rebase_merge` keeps the merge commit *and* blocks the merge button until the branch has been rebased — see MR rule 3. | project setting; 10-roles.md decides |
| **Fast-forward only** | Not configured. Do not turn it on: it removes the merge commit, and with approvals unavailable on Free that commit is the only record of review that lives in the repository rather than in GitLab's database. | — |

### CODEOWNERS

**Do not create one.** Code Owners is Premium *in its entirety* — not merely the approval
enforcement. On Free the file is not parsed at all: it will not request a reviewer, will not
appear in the sidebar, and cannot block a merge. A file named `CODEOWNERS` in this repository
would advertise an enforcement that does not exist, and it would be believed.

The need behind it is real — `shared/`, `server/db/migrations/`,
`server/templates/quotation-template.docx`, `.gitlab-ci.yml` and `Dockerfile` are the files
where a bad merge is expensive. Two honest options, neither pretending to be a control:

- put that list on the MR template as the last checkbox ("does this MR touch any of these?
  name who you pulled in"), where it costs nothing and claims nothing; and/or
- keep a plain `REVIEWERS.md` — **a human lookup table only.** Nothing reads it, nothing
  enforces it, and it must say so in its first line.

### Tags

Zero tags. `v*` is protected and ready; nothing has been cut.

**Which bump a release gets — MAJOR, MINOR or PATCH, and their triggers — is owned by
07-deployment.md.** This section used to carry a competing table keyed to test breakage (a
new route, a new schema field, a new dependency); that was the wrong axis. A version number
exists to tell an operator whether swapping the image back undoes the change, which is a
release question, not a test question. See 07-deployment.md.

The git mechanics of cutting one, which are this section's:

- annotated tags only — `git tag -a v1.1.0 -m "…"`;
- from `main` only, and only at a commit whose pipeline is green and whose image was
  published;
- `package.json`'s `version` must already match — bump it in the release MR, then tag the
  resulting `main` commit;
- **tags never move.** Protected tags stop a Developer creating `v*` at all; nothing
  technically stops a Maintainer deleting one and re-cutting it, so that is a human rule with
  the reviewer and the monthly sweep behind it: cut a new tag, never move an old one;
- `GIT_DEPTH: "0"` is already set, so `git describe` will not lie once there is something to
  describe.

**Gap: a tag does nothing today — and the fix must not be "let the tag pipeline build".**
`publish` and `deploy:qa` are gated on `$CI_COMMIT_BRANCH == $CI_DEFAULT_BRANCH`, and a tag
pipeline has no `CI_COMMIT_BRANCH`, so pushing `v1.0.0` today runs `build` and `test` and
stops: no image, no deploy, no GitLab Release. The production job that consumes the tag is
sketched at the bottom of `.gitlab-ci.yml` and does not exist yet.

When it is written, the tag pipeline must **not** rebuild. The `Dockerfile` runs `apt-get
update` in three stages, so a rebuild at tag time resolves different package versions and
produces a different `sha256` than the one QA tested — which destroys the single guarantee
the whole pipeline exists to provide. **Production pulls the digest QA tested.** The job
graph that achieves that (build and test excluded on tags, `publish` staying
default-branch-only, `deploy:prod` with `needs: []` and an explicit release digest) is
07-deployment.md's, and it is the load-bearing decision in this framework. See
07-deployment.md.

### Merge conflicts

| File | Resolution | Why not the obvious thing |
|---|---|---|
| `package-lock.json` | Take `main`'s version, `npm install`, commit the result. | `.gitattributes` marks it `-diff`. Hand-merging a lockfile produces a tree npm never generated. |
| `server/templates/quotation-template.docx` | `npm run build:template`. Never pick a side. | Marked `binary` in `.gitattributes` — git cannot merge it, and the tests compare rendered output against it. |
| Two branches both adding `006_*.sql` | Renumber **yours** to the next free number, then `npm run migrate -- --check`. | Never edit or renumber an applied file: the `_migrations` table records what ran, and forward-only means there is no way back. |
| `routes.test.ts`, `screen-wiring.test.ts` | Resolve by union, then run the whole suite. Never weaken the assertion — 05-testing.md §5 explains why they are written that way. | Both assert complete lists deliberately, so two branches adding endpoints or schema fields always collide — and can collide *semantically*, with no textual conflict at all, because Free runs no merged-results pipeline. This is the predicted failure that MR rule 3 exists to prevent. |

Resolve by rebasing onto `origin/main`, then force-push with lease.

### Force push

| Target | Allowed |
|---|---|
| Your own unmerged branch | Yes — `git push --force-with-lease origin <branch>` |
| A branch under active review | Only after saying so in the MR thread; it resets what the reviewer already read |
| `main` | Impossible. `push_access_level=0`. |
| An existing `v*` tag | Never. Tags do not move; cut a new one. |

**The gotcha:** `--force-with-lease` compares against a remote-tracking ref. Push to a *URL* instead of `origin` — tempting on a LAN with no DNS, where `gitlab.newtech.internal` resolves only through hosts files — and there is no tracking ref to compare, so it errors with `stale info` or checks nothing. Always push to `origin`. Plain `--force-with-lease` on git 2.50 (what is installed here) also implies `--force-if-includes`, which catches the case where a background fetch updated your tracking ref but you never looked at what arrived; spelling the lease out as `--force-with-lease=<ref>:<sha>` **turns that protection off**.

### Branch deletion

GitLab deletes the source branch server-side; your clone keeps the stale ref. This clone still lists `origin/chore/qa-url-192-168-1-40` and `origin/fix/concurrent-migrations`, both merged months ago.

**Squash makes `git branch --merged` lie.** Here, `git branch --merged main` prints only `main`, while five merged branches sit beside it — each 1–2 commits "ahead" of `main`, because the squashed commit that carries their work is not their tip. `git branch -d` therefore refuses all five.

```
git checkout main && git pull --prune
git branch -D fix/qa-health-check          # -D, not -d; squash means -d refuses
```

Delete the local branch when its MR shows Merged. Never judge by `--merged`.

### Undoing a bad merge (the git operation only)

Rolling back a *deployment* — which digest to redeploy, whether the database must be restored
first, the forensic copy to take before touching anything, and the reference-number hazard a
restore creates — is **07-deployment.md's**, single owner, whole procedure. Do not follow a
rollback recipe from this section: there no longer is one, and the version that used to sit
here omitted the forensic copy, so following it lost rows.

What is git's, and stays here:

```
git revert -m 1 <merge-sha>      # on a branch, then an MR
```

`-m 1` is required — a merge commit has two parents and git will not guess which is
"mainline". `-m 1` is the `main` side. Force-push is not an option on `main` and never will be.

Who decides between reverting and fixing forward when a merged story then fails verification
on QA is not settled anywhere in this framework, and this section is not the place to settle
it — noted so it is not mistaken for decided.

### For AI agents

- Never push to `main` (it is refused anyway), never create or move a tag, never plain `--force`. Use `--force-with-lease`, on `origin`, on a branch you created.
- Never `git add -A` or `git add .` blind. `Resources/` is deliberately **tracked** — `importCustomers.test.ts` reads the real Tally export and 33 tests assert against its quirks. `Supporting Documents/` and `data/` are deliberately ignored. Read `.gitignore`, which explains both, and `d185ab9`.
- Never edit or renumber an applied migration. Add `006_…`.
- No `feat:`/`fix:` prefixes. Match `git log`.
- Write the body on the commit **and** in the MR description — squash keeps only the subject, and five commits' worth of reasoning has already been lost that way. The MR description is the canonical copy.
- Do not open an MR until `npm run build`, `npm run typecheck` and `npm test` all pass locally — `build` first, because `web/bundle-safety.test.ts` ends in an unconditional assertion that `web/dist` exists, so without it the suite is **red**, not green-with-skips. State plainly that your machine tested Word while CI tested LibreOffice.
- Do not edit `.gitlab-ci.yml`, the `Dockerfile`, `.env*`, `.gitattributes`, `.gitignore`, or any protected-branch or protected-tag setting. Every CI job proposed in this section is a human-owned MR (the Stop List is 02-ai-rules.md's; the order in which pipeline edits land is 06-cicd.md's). Propose the YAML in the MR description; do not commit it.
