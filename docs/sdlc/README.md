# Newtech SDLC Operating Framework

How work gets from a request by the purchase desk to a running quotation, for a team of five
developers who use AI assistants heavily.

> ### ⚠️ Most of this is not in force yet
>
> Read this first or the rest is misleading. What is **actually running today**:
>
> | | |
> |---|---|
> | ✅ In force | Protected `main` (nobody pushes), maintainer-only merge, pipeline must pass, discussions must resolve, squash on merge, protected `v*` tags |
> | ✅ In force | `build → test → publish → deploy:qa`, tests run on Linux + LibreOffice inside the image, images pinned by sha256 digest |
> | ✅ In force | QA at http://192.168.1.40:8081, seeded with 225 real ledgers |
> | ❌ Not started | Sprints, issues, estimation, ceremonies. **GitLab issues are unused.** |
> | ❌ Not created | `.gitlab/` templates, linter, coverage tooling, dependency scanning |
> | ❌ Not deployed | **Production.** Blocked on a RAM upgrade to a shared laptop already running three other business apps |
> | ❌ Not closed | **TODO-SEC-01 — the application has no authentication at all** |
>
> Sections mark future practice as **"From Sprint 1"**. If a rule is not marked, it is live now.

## The sections

| # | Section | What it owns |
|---|---|---|
| 1 | [Agile / Scrum Process](01-agile.md) | Sprints, story shape, DoR, and the **Definition of Done — the single merge gate** |
| 2 | [Rules for AI Coding Agents](02-ai-rules.md) | Binding instructions for AI assistants, and the hard stop-list |
| 3 | [Git Strategy and Rules](03-git.md) | Branch naming, commit convention, rebase/squash, revert recipe |
| 4 | [Development Workflow](04-dev-workflow.md) | The story lifecycle, stage by stage, with entry/exit criteria |
| 5 | [Testing Strategy](05-testing.md) | **The test ladder** — which tests a change needs, and how to know |
| 6 | [GitLab CI/CD Pipeline](06-cicd.md) | Every job, what blocks vs warns, and the Free/Premium feature matrix |
| 7 | [Deployment, Release, Rollback](07-deployment.md) | Version bumps, the deploy sequence, backup-before-migrate, rollback |
| 8 | [Monitoring and Maintenance](08-monitoring.md) | What to watch, **the one severity scale**, incident response, retention |
| 9 | [Security Across the Lifecycle](09-security.md) | **The production gate list**, secrets, the security review checklist |
| 10 | [Roles and Governance](10-roles.md) | Who may do what, mapped to real GitLab permission levels |

Each section names one owner per topic and cross-references rather than restating, because a rule
written in four places drifts in three of them.

## If you read only one thing

**Developers:** [the Definition of Done](01-agile.md#definition-of-done--the-single-merge-gate) —
14 items, each with the consequence of skipping it.

**AI agents:** [`../../CLAUDE.md`](../../CLAUDE.md), then [02-ai-rules.md](02-ai-rules.md).

**Setting up a machine:** [`../../ONBOARDING.md`](../../ONBOARDING.md).

## How this was written, and its known weak points

Ten sections drafted independently, each then rewritten by an adversarial editor whose only brief
was deleting anything that would be equally true of any Node project. An independent reviewer then
read all ten together and found **20 contradictions, 12 unenforceable rules and 12 gaps at the
seams**; a reconciliation pass applied those findings. The findings are kept in
[`_CONFLICTS.md`](_CONFLICTS.md) as a record of what was decided and why.

Three things this framework cannot fix, and does not pretend to:

1. **A maintainer can merge their own merge request.** Required approvals are a Premium feature.
   For a *developer* the guarantee is real — `merge_access_level=40` means they cannot merge, so
   somebody else must read it. For a maintainer it rests on discipline alone. Named openly in
   §1 and §10 rather than papered over.
2. **`CODEOWNERS` does nothing here.** Code Owners is entirely Premium — the file is not parsed,
   cannot request a reviewer, cannot block a merge.
3. **Some rules have no machine check.** Each such rule is either downgraded to *recommended* or
   turned into a template checkbox with a named human. None are left marked mandatory with nothing
   enforcing them.

## Decisions still needed

[`_OPEN-QUESTIONS.md`](_OPEN-QUESTIONS.md) holds 67 questions the authors could not settle. They
collapse into a handful, and **the first blocks the most**:

| Decision | Why it blocks |
|---|---|
| **Who holds Maintainer, and how many?** | Nine of the 67 questions are this one. The entire review guarantee is `merge_access_level=40`. All merge requests so far were authored *and* merged by the `root` admin account. |
| Are GitLab issues adopted, or abandoned? | Roughly a third of the framework assumes issue-first. If they are not adopted, that third must be rewritten to route through MR descriptions. |
| Does `npm audit` block or report? | Five advisories already exist. Blocking today fails every pipeline immediately. |
| Is a linter adopted? | Someone must accept a repo-wide reformat. Otherwise static analysis stays a permanent gap. |
| Production host: RAM upgrade, and the port | 8081 collides with QA's; the plan reserves 18080. |
| Who owns rotating `GEMINI_API_KEY`? | It has sat in plaintext on a developer desktop. |
