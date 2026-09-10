# Open questions raised by the section authors

1. Who are the maintainers? The draft asserted 'two of five' — I could not verify the GitLab Members list from the repo. The author-never-merges guarantee, and the 'other maintainer merges a maintainer's MR' rule, both depend on there being at least two.
2. Does the 'qa' runner have outbound access to registry.gitlab.com to pull SAST/Secret-Detection analyzer images? Written as unverified in the debt table; the answer decides whether that debt issue is even actionable.
3. Confirm Sprint 1 = 14–25 Sep 2026 (Mon–Fri fortnight, IST). It is written as starting only once .gitlab/ templates exist, which may push it a sprint.
4. Will the purchase desk actually attend a Friday 20-minute walkthrough, and who is their named person? Two mandatory items (the walkthrough and the Desk Liaison role) assume a named counterpart who does not exist in the context.
5. Should setup-workstation.ps1 and newtech-ca.crt be brought into the repository? Listed as debt; the counter-argument (a CA cert and a machine-setup script may be deliberately out-of-band) was not available to me.
6. Resources/List of Sundry Debtors with address and GSTIN.xlsx is tracked in git and holds 225 real ledgers with GSTINs and addresses, and importCustomers.test.ts reads it at module load. Whether that is acceptable is a governance decision I left alone — but the test suite cannot run without it.
7. CLAUDE.md's '444 tests' — is that the CI count (all gates open) or a developer-laptop count? I wrote it as the all-gates-open number; if it was recorded on a Windows box without web/dist, it is up to 10 low and DoD #2 will trip on the first MR.
8. The brief cites a '12.7 GB telemetry disk-fill' incident as a citable example, but there is no trace of it anywhere in the repo (PROJECT-LOG.md, ONBOARDING.md, README.md, CLAUDE.md, .gitlab-ci.yml). I left it out rather than invent detail. If it happened on the GitLab host, someone needs to write it down before any section cites it.
9. Who holds Maintainer on newtech/quotation-desk? The whole review guarantee rests on 'a maintainer other than the author merges'. With 5 developers, if only one person is Maintainer, that person's own MRs have no reviewer and the guarantee silently fails for them.
10. Should .gitlab/merge_request_templates/Default.md be created now as part of adopting this framework, or listed as a gap? I have written it as a gap; it is a 10-line file and could be closed immediately.
11. Is `npm audit --audit-level=high` (free, no GitLab licence needed) acceptable as a pipeline job, given the 5 untriaged advisories in PROJECT-LOG §7.6? That would turn the 'no dependency scanning' gap into a real gate without Ultimate.
12. Does the team want the AI-assistance line to be mandatory in every MR, or only when an agent wrote production code? The current text makes it unconditional.
13. Should CODEOWNERS be added even though it cannot block anything on Free (it is advisory without required approvals)? It would still route pdf.ts and migrate.ts to a named person by convention.
14. Who are the maintainers? All five MRs to date were authored and merged by the GitLab root admin account (gitlab_admin_10ccd4@example.com). The 'author never merges' rule needs at least two named maintainer accounts that are not the admin - decide who, before the next MR.
15. Who holds Maintainer, and how many? With 5 developers and `merge_access_level=40` as the entire review guarantee, a single maintainer means every MR waits on one person — and that maintainer's own MRs are merged by themselves, i.e. unreviewed. Does the process require a second maintainer to merge a maintainer's work?
16. Is issue-first actually mandatory from day one, given GitLab issues are unused today and there is no `.gitlab/issue_templates/`? Who writes the issue and MR templates, and does that land before or after the next feature?
17. Is `npm audit --omit=dev --audit-level=high` adopted, at what threshold, and who triages the 5 advisories already recorded in PROJECT-LOG §7.6 before it stops being `allow_failure: true`?
18. Is eslint/prettier adopted at all? If yes, someone must accept a repo-wide reformat MR; if no, the static-analysis GAP stays permanent and should be stated as a decision rather than a gap.
19. Coverage tooling is absent (`@vitest/coverage-v8` not installed, no coverage block in vitest.config.ts) and this section does not gate on it. Does a coverage number belong in the `test` job, or is the guard-test approach the deliberate substitute?
20. Nothing in the current pipeline creates a `v*` tag, yet the production design depends on protected tags and a GitLab Release carrying the digest. Who tags, on what cadence, and is the Release created by hand or by a job?
21. Should QA get its own scheduled `npm run backup` now, or does the backup schedule wait for the external drive and the production host decision?
22. Who owns each of the eight gaps in §10, and by when? There is no QA role, no product owner, and GitLab issues are currently unused, so an unowned gap list decays into a wish list.
23. Is the Datamatics ledger count fourteen (CLAUDE.md, and the framework brief) or sixteen (the docstring in server/src/routes/quote.customer.test.ts)? Someone with the Tally export must settle it and correct the loser.
24. Should the `npm audit` job block the pipeline or only report? Blocking today fails every pipeline immediately, because 5 transitive advisories already exist and are untriaged.
25. Should coverage be added to the existing `test` job (lengthening every pipeline on the same workstation that hosts GitLab, the runner and the QA instance) or run as a separate job only on `main`?
26. Who writes the 10-step manual QA checklist for QA at 192.168.1.40:8081, and does the `.gitlab/merge_request_templates/` directory get created as part of this framework or as a separate MR?
27. Is `npm run preview` expected before merging any change to the template, docx.ts or pdf.ts — and if so, how is a manual visual check evidenced in an MR, given screenshots cannot be enforced in Free?
28. When production is eventually deployed on the 2-core host, does the PDF queue budget (90 s, one retry) need to be re-tuned, and should a measured page-conversion time on that hardware become a merge-blocking assertion or a recorded baseline only?
29. Does QA get a GEMINI_API_KEY as a masked CI variable? Today deploy:qa passes only -e TZ, so every AI route is dark in QA and no pipeline can detect a dead key. Adding one means nightly Gemini quota spend and a secret on the QA container; leaving it out means the AI paths ship untested outside the developer's own machine.
30. Who owns the 192.168.1.37 RAM upgrade purchase, and what is the target (16 GB?). Every production job in section 3 is blocked behind it, and the gitlab-runner process on that laptop is an unbudgeted part of the cost.
31. Shell or Docker executor for the 'prod' runner on a 2-core Windows laptop? That decides whether the internal CA has to be trusted by Docker's cert store, by the Windows machine store, or both.
32. How many people hold Maintainer (merge_access_level=40)? With approvals unenforceable, the merge permission IS the review control, so the count and the leave-cover plan are the process.
33. Concrete date to flip `lint` from allow_failure:true to blocking. 'Four weeks' needs an anchor date and a named owner or it never happens.
34. Is outbound internet available from the qa runner for ghcr.io and the OSV vulnerability database, or does the OSV data need mirroring inside the LAN?
35. Registry retention: no cleanup policy exists, and every main merge pushes a ~1 GB runtime image to :5050 on the same disk as GitLab and QA. What is the keep window?
36. Who ratifies the 100% floor on shared/money.ts and shared/fy.ts, and what is the escape hatch when a legitimate change drops it to 99%?
37. Production port: keep 8081 on 192.168.1.37 (identical to QA's 8081 on .40, which will be confused in every runbook and chat message) or move production to a distinct port? Must be decided before the first deploy.
38. Are there at least two maintainers, so 'tagger and deployer are different people' is actually achievable? If not, the rule should be written as a single-maintainer exception from day one.
39. Should QA receive GEMINI_API_KEY? Today deploy:qa passes only -e TZ, so the desk cannot test the AI parse path on QA at all.
40. RAM target for 192.168.1.37 — 16 GB or 32 GB — and who buys the external backup drive that blocker 3 depends on?
41. Does production start from an empty database, or from a restored copy of quotation_qa_data (225 ledgers plus whatever quotations the desk has already created on QA)? This changes both the first-deploy backup handling and the smoke test's customer-count assertion.
42. Is the first production release 1.0.0, or does the project stay on 0.x after going live?
43. Registry retention numbers: how many recent tags to keep, and how long to hold untagged manifests, given the registry shares the workstation disk with GitLab itself.
44. Who owns the runbook for the other three apps on .37 (Pickup Ops, Inventory, IIS), and have they agreed to a Docker Desktop install on that machine?
45. Which notification channel actually reaches someone from the workstation? If outbound SMTP is blocked and there is no internal mail relay, the honest fallback is a dashboard checked at 09:30 IST — that needs a named person, not a rule.
46. Who holds Maintainer on newtech/quotation-desk today? The whole review and break-glass guarantee rests on that list, and this document cannot name it.
47. Is there budget and a decision on the external backup drive? Until it exists, G: is a hedge against a bad process, not against losing the workstation.
48. How much free space is on G: right now, and is it a separate physical disk from C:? A 'backup' onto another partition of the same spindle is not one.
49. Is GitLab EE itself running as a Docker Desktop container on the workstation, or installed natively? The reboot/login behaviour and the prune blast radius differ between the two.
50. Who owns the daily backup and disk scheduled tasks, and under which Windows account do they run (the account must be logged in or the task must be set to run whether or not the user is logged on)?
51. Does this GitLab instance expose container registry cleanup policies under Settings → Packages and registries? If not, registry pruning is a manual quarterly job.
52. Is the 26 h / 24 h heartbeat acceptable, or does the desk need to know the same morning a backup failed — which would mean a 09:30 dashboard check regardless of Kuma.
53. The prompt cited a '12.7GB telemetry disk-fill' as a real incident to reference. Nothing in PROJECT-LOG.md, README.md, CLAUDE.md, ONBOARDING.md or the CI config mentions it, so I did not cite it rather than invent detail. If it is real (GitLab/Runner telemetry filling the workstation disk?), it belongs in §6 as a runner-hygiene consequence — tell me the specifics.
54. Role split for the 5 people: I wrote 1 Owner + 2 Maintainers + 2 Developers so the headcount adds to 5 and 'the merger is not the author' stays satisfiable. The draft's table implied 6 people. Confirm the actual split and who holds Owner.
55. Is the Owner's GitLab admin account actually separate from their developer account? The draft asserted it as fact; I re-marked it as an open item.
56. TODO-SEC-01 mechanism: IIS-with-Windows-Auth in front of a 127.0.0.1-bound container, versus in-app auth. Only in-app auth gives §9 an actor column. Which one, and does the desk have AD accounts at all?
57. DPDP: who is the named person responsible for personal data, and what is the retention period for quotes and for the customer master? Both are unfilled.
58. Should the value-grep gap in bundle-safety.test.ts be closed by passing a masked+protected GEMINI_API_KEY into the test container, or accepted as a local-only guarantee and documented in the test comment? Passing a real key into a CI container is itself a exposure decision.
59. Rotation of GEMINI_API_KEY (TODO-SEC-02) needs an owner and a date. Who distributes the new key to the five machines, and by what out-of-band channel?
60. gitleaks over full history has never been run. If it finds a key already in history, is the decision rotate-and-accept (my recommendation) or rewrite history across 5 clones?
61. Who are A and B in practice? Specifically: who is the second Maintainer, given the SysAdmin/instance-admin/Owner hats are currently stacked on one person.
62. Is GitLab EE itself backed up (`gitlab-backup create` on a schedule)? Nothing in this repo records one, and if the workstation dies the MRs, threads and pipeline history die with it even though the commits survive in developers' clones.
63. Who owns the Google account behind GEMINI_API_KEY, and can they rotate it same-day on an offboarding? Nobody is named today.
64. Who approves the RAM upgrade and the external backup drive purchase, and by when? Both are hard prerequisites for production and neither has a budget owner in the context.
65. Is AnyDesk on 192.168.1.37 per-person or a shared credential? If shared, offboarding step 6 is a password rotation affecting everyone, not an access removal.
66. Adopt GitLab issues or abandon them? The doc currently routes written records to MR descriptions and PROJECT-LOG.md because issues are unused; that should be a decision, not a default.
67. Who runs the monthly API sweep (author == merge_user, and protected-branch drift), and where is the result recorded?
