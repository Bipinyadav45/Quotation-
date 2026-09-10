## Monitoring, Maintenance and Incident Response

**Nothing described here is running today.** Uptime Kuma is not installed. No backup is scheduled. No log rotation is configured. There is no `.gitlab/` directory, no alert channel, no linter, no coverage tooling, and no external drive to back up to. GitLab issues exist and are unused. Every heading below is either a gap with an owner-less to-do, or a rule that already holds because the pipeline or a protected-branch setting enforces it. Anything that only starts when the process starts is marked **From Sprint 1 — not in force today**. Treat an unmarked claim as a bug in this document.

This section owns three things for the whole framework, and only these three:

1. **The severity scale** — one scale, three levels, used by every section (see *Severity* below).
2. **Availability monitoring, log retention, backups and the maintenance calendar** for the workstation and (when it exists) the production host.
3. **Registry image retention** — what may be deleted and what may never be, because a deleted digest is a rollback target that cannot be rebuilt.

Everything else that used to be restated here has an owner elsewhere and is now a cross-reference. In particular: the rollback procedure is `07-deployment.md`; the production precondition list is `09-security.md`; version numbering and the deploy sequence are `07-deployment.md`; the `test`, coverage and `test:no-skips` jobs and the `npm audit` job are `06-cicd.md`; dependency and audit policy and cadence are `09-security.md`; the protected-branch settings table and the role/permission matrix are `10-roles.md`.

The single machine that matters today is the workstation (HP Z6 G4, dual-homed `192.168.3.249` / `192.168.1.40`). It runs GitLab EE 19.3.1, the `qa` runner, the registry on `:5050`, and `quotation-qa` on `:8081`. Production does not exist yet (see `07-deployment.md` for why, and `09-security.md` for the gate list). So monitoring answers three questions and no others:

1. Can the desk quote right now — including the PDF path, not just "the port answers"?
2. Is the workstation about to run out of disk?
3. Did last night's backup actually happen, and did it contain the 225 ledgers?

Anything that does not answer one of those is not built.

| Build first | Deliberately not built | Why not |
|---|---|---|
| `/api/health` body says `"status":"ok"` | Prometheus / Grafana | Five developers, one host. A metrics stack is a second thing to keep alive on the machine that already fills its own disk. |
| Disk free on **C:** and **G:** | ELK / Loki / any aggregator | `docker logs` reaches every container from the same shell. Retention is 30 MB per container, on purpose. |
| Backup verified in the last 24 h | Sentry / hosted error tracking | No outbound internet path, and nothing to send from — production does not exist. |
| GitLab + registry + runner alive | APM / tracing | One process, one SQLite file, one serialised converter queue. The request log already carries `METHOD path status ms`. |
| Container log size caps | On-call rota / paging | Business hours, Asia/Kolkata, no rota, and saying otherwise would be a lie the first time someone is not paged. |

Monitoring here covers **availability only**. It cannot see the failure this project actually fears — IGST charged where CGST+SGST was due, because a ledger was guessed. The detector for that is the desk reading the document, and the fix is a regression test in house style. No monitor will ever be added that claims to check correctness.

### Uptime Kuma monitors — **gap: not installed**

```
docker run -d --name uptime-kuma --restart unless-stopped -p 3001:3001 \
  -v uptime-kuma:/app/data \
  --add-host gitlab.newtech.internal:192.168.3.249 \
  -v C:\certs\newtech-ca.crt:/certs/newtech-ca.crt:ro \
  -e NODE_EXTRA_CA_CERTS=/certs/newtech-ca.crt \
  -e TZ=Asia/Kolkata \
  --log-opt max-size=10m --log-opt max-file=3 \
  louislam/uptime-kuma
```

Both flags on lines 3–5 are load-bearing. There is no DNS on this LAN and a container does not read the host's `hosts` file, so without `--add-host` the GitLab monitor is red forever. Uptime Kuma is Node, so `NODE_EXTRA_CA_CERTS` is how it trusts the internal CA; without it the HTTPS monitors fail on TLS and someone "fixes" it by ticking *Ignore TLS errors*, which then also ignores a genuinely broken cert.

**Six monitors for the workstation** — the set that answers the three questions:

| Monitor | Type | Target | Pass condition | Every |
|---|---|---|---|---|
| Quotation QA | HTTP **keyword** | `http://192.168.1.40:8081/api/health` | body contains `"status":"ok"` | 60 s |
| GitLab | HTTP keyword | `https://gitlab.newtech.internal/users/sign_in` | body contains `Sign in` | 5 min |
| Registry | HTTP | `https://gitlab.newtech.internal:5050/v2/` | accepted status `200-299,401` | 5 min |
| Backup verified | **Push** | 24 h heartbeat, 1 retry | scheduled task pings only on success | — |
| Runner alive | **Push** | 24 h heartbeat, 1 retry | daily scheduled pipeline pings | — |
| Workstation disk/RAM | **Push** | 1 h heartbeat | scheduled PowerShell task pings while thresholds hold | — |

**Four more for the production host, before production is allowed to move there.** `10-roles.md` §5 gate 3 requires monitoring that covers *the three incumbent applications, not only this one* — and it is right, because the risk being managed is evicting three apps that have users. The six monitors above do not satisfy that gate; these four do, and none of them exists:

| Monitor | Type | Target | Pass condition | Every |
|---|---|---|---|---|
| Pickup Ops (.37) | HTTP | `http://192.168.1.37:3000/` | **gap: pass condition unconfirmed.** We do not own this app. Ask its owner for a stable path and string; a status-only monitor has the same blind spot described below | 5 min |
| Newtech Inventory (.37) | HTTP | `http://192.168.1.37:8000/` | same gap, same question to the same owner | 5 min |
| IIS (.37) | HTTP keyword | `http://192.168.1.37:8080/` | a string from the page IIS actually serves — confirm it, do not assume `IIS` | 5 min |
| Production host disk/RAM | **Push** | 1 h heartbeat | scheduled task **on .37** | — |

Three practical notes on the `.37` monitors, because the gate is not met by writing them down:

- The three HTTP monitors target **IP addresses**, so they need no `hosts` entry and no CA — `--add-host` is only for `gitlab.newtech.internal`. What they do need is verified reachability from the workstation's `192.168.1.40` interface to `192.168.1.37:3000/8000/8080` through that laptop's Windows firewall. Check it with `Test-NetConnection 192.168.1.37 -Port 3000` before claiming the gate is closable.
- The disk/RAM heartbeat needs a **scheduled task on a machine this team does not administer**. That is an access request, not a config change. Owner: the SysAdmin hat (`10-roles.md`).
- The eventual `quotation-desk` production monitor targets **`http://192.168.1.37:18080/api/health`**, keyword `"status":"ok"`. Not 8081: `8081` is QA on `.40`, `8080` on `.37` is IIS, and `8081` on `.37` is unverified. `07-deployment.md` records the port (`18080`, from the 18080–18099 range reserved for new production apps) — take it from there, never from memory.

Ten monitors in total. Get the grace period on the push monitors from a retry, not from setting a 26-hour interval — Kuma's interval field is not guaranteed to accept an arbitrary value, and a heartbeat that silently refused to save is a monitor that is green because it is switched off.

**Keyword, never status code.** `server/src/index.ts` computes `status = !checks.database.ok ? 'error' : checks.pdf.ok ? 'ok' : 'degraded'` and returns **200 for `degraded`**. That is deliberate: a missing LibreOffice leaves the `.docx` path working, so the container must stay up. Only a database failure gives 503. A status-code monitor therefore sits green through a dead PDF converter, and the desk finds out by clicking the PDF button. `"status":"ok"` is the exact assertion `deploy:qa` already makes inside the container (`if (j.status !== 'ok')`, plus `checks.database.ok` and `checks.pdf.ok`); the external monitor must not be weaker than the deploy gate. The Dockerfile `HEALTHCHECK` has the same blind spot and its comment says so.

**No TCP-port monitor.** It can never be red while the keyword monitor is green. It buys a second notification and nothing else.

**`/users/sign_in` for GitLab, not `/-/health`.** `/-/health`, `/-/readiness` and `/-/liveness` are restricted to the monitoring IP allowlist (localhost by default) and return **404** to everything else. A permanently red monitor is worse than no monitor: it trains the team to ignore red.

**Two things Kuma cannot do here.** It runs on the machine it watches, so it reports nothing when the workstation is off — and Docker Desktop on Windows does not start until a user logs in, so after the monthly reboot GitLab, the runner, `quotation-qa` and Kuma itself stay down at the login screen despite `--restart unless-stopped`. Logging in is part of the patch procedure, not an afterthought.

**Pick one channel and test it by running `docker stop quotation-qa`, then `docker start quotation-qa`.** An untested channel is decoration. If no channel reaches anyone without outbound internet, write that down and say plainly that the dashboard is checked at 09:30 IST by whoever opens the laptop — a human monitor, honestly labelled, beats an alert that goes nowhere.

### Disk, RAM, logs — **gap: no scheduled task exists**

| Signal | Threshold | How |
|---|---|---|
| C: free | warn < 15 %, alarm < 8 % | scheduled PowerShell task → Kuma push URL |
| G: free | warn < 15 % | same task, both volumes in one pass |
| RAM free | warn < 4 GB | `Get-Counter '\Memory\Available MBytes'` |
| Disk health | monthly | `Get-PhysicalDisk \| Get-StorageReliabilityCounter` |

Disk is the failure this environment has actually had: 282 orphaned `WINWORD.EXE` processes left **12.7 GB of Office telemetry** on a workstation (the incident recorded in the commit body of `be96eb9`, not in any prose document), which is why the Dockerfile pins `PDF_BACKEND=libreoffice` and why `.env.example` warns against the Word/COM backend on a server. Unbounded container logs are the same failure wearing a different hat — `quotation-qa` logs one line per API request forever, with `--restart unless-stopped` and no cap.

Any `.ps1` for these must be **ASCII-only** — PowerShell 5.1 cannot read a BOM-less UTF-8 file; the task then fails at 02:00 with a parser error nobody sees, and the push monitor goes red for the wrong reason. *Enforcement, honestly:* **recommended, not enforced, because there is nothing to enforce it against.** `git ls-files '*.ps1'` returns nothing — the one script that matters, `setup-workstation.ps1`, is handed over out of band and is not in the repository (`10-roles.md` §7 names that gap and nobody owns it). The check exists and is one line; it lands in CI with the first tracked `.ps1`, and until then no reviewer can see the file at all:

```sh
git ls-files '*.ps1' | xargs -r grep -nP '[^\x00-\x7F]' && { echo "non-ASCII in a .ps1"; exit 1; }
```

**Two log gaps to close in `.gitlab-ci.yml`** (the file has one owner — the SysAdmin/Owner hat in `10-roles.md` — and `06-cicd.md` sequences the edits; do not open a competing MR):

1. `deploy:qa`'s `docker run` sets `--memory=2g --cpus=2.0` but **no `--log-opt`**. Add `--log-opt max-size=10m --log-opt max-file=3`. Also set the same defaults in Docker Desktop → Docker Engine (`log-opts`), which covers GitLab, the runner and Kuma — the flag on the run command stays as belt and braces, because a Docker Desktop reinstall silently drops `daemon.json`. Verify either way with `docker inspect --format '{{json .HostConfig.LogConfig}}' quotation-qa`.
2. `deploy:qa` runs `docker rm -f quotation-qa` on every deploy, which **destroys the previous container's logs** — including the logs of the incident you are deploying a fix for. Add `docker logs --tail 2000 quotation-qa > qa-logs.txt || true` before the `rm`, published as a job artifact. This is the one edit that converts a human incident rule ("capture the logs first") into a machine one, so it is the first of the two to land.

To investigate: `docker logs -t --since 24h quotation-qa`. The `-t` is not optional — the request-log line is `METHOD path status ms` with no timestamp of its own. `[error]` lines come from the Express error handler in `server/src/index.ts`. **Nothing alerts on a 500.** A 500 at 19:00 is found the next morning; accepted while there is no production and no out-of-hours quoting, and to be revisited the day either changes.

**A skipped test in CI is not an incident and is not graded here.** It is a broken guard and it blocks the merge: see `05-testing.md` §9 for the guard inventory and why a skip means a guard stopped guarding, and `06-cicd.md` for the `test:no-skips` job that decides it from the JUnit XML. Monitoring does not assign it a severity — a red pipeline wearing green is a merge gate, not an outage.

### Backups — **gap: script written, nothing scheduled, no external drive**

`npm run backup` uses `VACUUM INTO` and then reopens the copy and counts migrations, customers and quotations. It exits 1 on failure. It exists because the database runs in WAL mode and was measured at **4 KB in `quotes.db` while `quotes.db-wal` held 2.7 MB** — `cp data/quotes.db` backs up an empty database, reports success, and is discovered to be worthless on the day it is needed. (CLAUDE.md rule 4 owns that fact; `07-deployment.md` owns the deploy-time procedure. Nobody re-derives it.)

Three rules for the scheduled task when someone writes it:

1. **Write off the volume.** With no argument the script writes to `backups/` under the repo — the same disk as the database, the same disk that filled with telemetry. Pass a destination: `npm run backup -- "G:\Backups\quotes-$(Get-Date -Format yyyyMMdd-HHmmss).db"` (the script refuses to overwrite, so the timestamp is yours to supply). An external drive is still unpurchased; until it is, G: is a hedge against the process, not against the machine. **This rule binds the pre-deploy backup too:** a backup that lives inside the application's own volume survives a bad migration but not a lost volume, a corrupt database file, or a `docker volume rm` typo during recovery — so `07-deployment.md`'s deploy step must copy its pre-deploy file out to the same destination this schedule uses.
2. **Ping the push monitor only when the verified customer count is non-zero.** Exit 0 also happens when `DB_PATH` pointed somewhere else and a fresh, empty database was backed up perfectly. *Enforcement:* this is the whole mechanism — the script's own exit code and count decide whether the heartbeat is sent, and a missed heartbeat turns the monitor red without anybody remembering to check. Nothing else in this section is self-checking to that degree; copy the pattern.
3. **Prune in the same script** — keep 14 daily and 1 monthly. A backup job that fills C: is an outage it caused.

QA's data lives in the named volume `quotation_qa_data` and has **no backup at all**: the 225 seeded ledgers exist only there and in `Resources/List of Sundry Debtors with address and GSTIN.xlsx`. Re-importing recovers the *master data* and loses **every quotation the desk has saved**.

**That is an open decision, not a footnote, and it is not this section's to make.** `01-agile.md` says the desk may use the QA container to produce a document it needs today; `07-deployment.md` blocker 3 says the consequence is that `quotation_qa_data` already holds real work backed up by nothing. If the answer is "yes, the desk issues real quotations from QA", then QA needs the backup schedule above **today**, not after the RAM upgrade, and re-import stops being a recovery plan. Put the question to the desk and record the answer in `07-deployment.md`'s status; until it is answered, treat QA data as real and do not delete the volume.

### Maintenance calendar

| Task | Cadence | Rule and consequence |
|---|---|---|
| Windows Update, workstation | monthly, Saturday IST | Everything restarts. Announce, log in after the reboot so Docker Desktop starts, then confirm every monitor green. Three of them are push heartbeats and go red on their own; the HTTP ones need eyes. |
| Purge stale build images | monthly | `docker image ls --format '{{.Repository}}:{{.Tag}}' \| grep -E ':(test-\|[0-9a-f]{40}$)' \| xargs -r docker rmi`. Every pipeline on **any** branch builds `test-$CI_COMMIT_SHORT_SHA` locally; these are **tagged**, so `docker image prune -f` never touches them and they accumulate forever. Use `docker rmi` **without `-f`** — Docker refuses to delete the image a running container uses, which is exactly the protection QA needs. |
| `docker builder prune --filter until=168h` | monthly | Build cache is the other half of the same growth. |
| **Never** `docker system prune -a` or `--volumes` | always | One daemon serves GitLab, the socket-bound runner and QA. `--volumes` deletes `quotation_qa_data` — the 225 seeded ledgers plus every saved quotation, unbacked-up — and GitLab's volumes alongside it. *Enforcement: none is possible.* Docker offers no per-command lock. This is a Stop List entry (`02-ai-rules.md`) enforced by the human at the keyboard, and the only real compensating control is the QA backup schedule that does not exist. Do not read "never" here as "checked". |
| Registry retention and garbage collection | quarterly review, GC monthly | **Owned here. See below — it has its own rules, because getting it wrong destroys a rollback target.** |
| Certificate work | on adding a host | The 2036 expiry is not the risk. Adding any host — the production laptop at `192.168.1.37`, or a second interface — means **reissuing the server certificate with the new IP in the SAN** and editing every client's `hosts` file, because there is no DNS. "Add a host" and "reissue the cert" are one task, never two. |
| GitLab upgrade | quarterly | Below. |
| Dependency audit and bumps | — | Not owned here. `06-cicd.md` owns the job (flags, stage, blocking policy); `09-security.md` owns the policy, the cadence, the five open advisories and the named owner of their triage. This section deliberately states neither a number nor a schedule for them. |

**Registry retention — this section's rule, and the one deletion that is unrecoverable.**

1. **Never delete a digest that is still a rollback target.** A digest is a rollback target while it is (a) running on QA or production, or (b) named by a Release that has not been superseded by a later *deployed* release. There is no re-creating it: the Dockerfile runs `apt-get update` in three stages, so rebuilding the same commit resolves different package versions and produces a **different `sha256`**. Delete the digest and the rollback target is gone permanently — the bytes QA tested cannot be reconstructed, only approximated. (The same fact is why production pulls the tested digest and never rebuilds; `07-deployment.md` owns the job graph that guarantees it.)
2. **GitLab's cleanup policy cannot express rule 1.** It matches tag names and keeps *N* — it cannot read Releases and does not know which digest one names. So the policy is a blunt instrument set conservatively: **keep at least (number of non-superseded Releases + 10) tags**, recompute *N* from the Release list at the quarterly review, and never let a "tidy up" MR lower it without checking the Release list first.
3. **Confirm the feature before relying on it.** Cleanup policies are Free, but confirm the policy page exists under Settings → Packages and registries on this instance (EE 19.3.1) before writing a procedure around it.
4. **`gitlab-ctl registry-garbage-collect` only in the monthly Windows-Update window.** It takes the registry offline, and a `publish` or `deploy:qa` running at that moment fails on a pull that has no obvious cause.
5. **Growth is slow and that is measured, not assumed:** only `main` pipelines push (`rules: if $CI_COMMIT_BRANCH == $CI_DEFAULT_BRANCH`), so the registry grows one image per merge, not per pipeline. A quarterly size check is enough. *Enforcement:* the C:-free alarm at < 8 % is the backstop that catches a wrong assumption here; the quarterly review itself is a calendar item owned by the SysAdmin hat (`10-roles.md`) and happens only because a person is named.

**GitLab upgrades (EE 19.3.1).** Take `gitlab-backup create` **and** copy `/etc/gitlab` — the secrets live there and are not in the backup, and without them the restored instance cannot decrypt CI variables. Never jump a major version: patch to the latest of the current minor, follow the documented required stop versions one hop at a time, and confirm Admin → Monitoring → Background Migrations is clear before the next hop. Upgrade the runner with the server and do not let it get ahead of it; GitLab does not support a runner newer than the instance.

### Severity — one scale for the whole framework

Three levels, because there is no production; a fourth would be theatre. Every other section maps onto this scale rather than inventing its own: `01-agile.md`'s bug labels decide *milestone treatment* only, and `09-security.md`'s security severities map here for response.

| Sev | Means | Examples | First action | Recorded as |
|---|---|---|---|---|
| **1** | A wrong document reached a customer, **or** the desk cannot produce a correct document at all right now | IGST charged where CGST+SGST was due; two ledgers collapsed into one; **QA down during quoting hours**; the conversion queue wedged with no workaround | Stop other work. Tell the desk to hold sending. **Capture `docker logs -t --since 24h quotation-qa > incident.txt` before anything is redeployed** — `deploy:qa` runs `docker rm -f` and the logs go with the container. Fix the same day; never wait for planning | Dated `PROJECT-LOG.md` subsection **in the same MR as the fix**, plus a regression test in house style. **From Sprint 1:** also an issue labelled `incident` + `Sev1`, closed by that MR |
| **2** | Degraded but working — a documented workaround still produces the **correct** document | `/api/health` reports `degraded`, PDF button off, `.docx` unaffected; parse fails on a real thread and the desk enters the lines by hand | Same day or next, normal branch → MR flow. No hot-fix on QA | Regression test always. `PROJECT-LOG.md` only if the cause was a design assumption rather than a typo. **From Sprint 1:** issue labelled `incident` + `Sev2` |
| **3** | Cosmetic or internal — no effect on a document and no effect on the desk's ability to produce one | Log noise, a runner flake, a mislabelled button | Backlog | A line in the MR description. **From Sprint 1:** an ordinary issue, scheduled |

Three consequences worth stating plainly, because they are where the old scales disagreed:

- **QA down while the desk is quoting is Sev 1, not Sev 2.** With no production, QA *is* the desk's tool. "Output would be correct if the thing were up" is not a mitigation.
- **A skipped test in CI has no severity.** It is a merge gate, not an incident (see above, and `06-cicd.md`).
- **A Sev 1 is fixed today; a Sev 2 is fixed in the current sprint; a Sev 3 enters the backlog.** That is the missing rule about when an incident becomes a sprint item — it is the severity, not a negotiation.

`09-security.md` maps onto this: a vulnerability becomes a Sev 1 incident the moment it is being exploited or is reachable from outside the LAN. Until then — and this is the important case — an *open, known* exposure such as TODO-SEC-01 is a **standing risk on the production gate list**, not an open incident. It is blocker zero for production, and `09-security.md` owns it.

### Incident response

**Ownership.** No rota, no QA role, no on-call. Business hours, Asia/Kolkata. Whoever notices a Sev 1 declares it in the team channel and owns it until they hand it over by name.

**Who merges the fix, stated honestly.** A **Developer** cannot merge their own work — `merge_access_level=40` blocks them, and for a developer-authored fix "the person who merges is the reviewer" is a real guarantee. A **Maintainer** can merge their own MR, and can resolve their own discussion threads; nothing in GitLab Free prevents either. So under Sev 1 pressure, a maintainer fixing their own bug is reviewed by nobody unless they choose otherwise. That is a discipline rule, and `10-roles.md` §2 owns both the settings table and the monthly API sweep (`author.username == merge_user.username`) that detects when it slipped. Do not restate the settings here; depend only on the consequence.

**Break-glass.** There is no separate path to `main`: `push_access_level=0` means nobody pushes, administrators included (verified). Even under a Sev 1 the route is branch → MR → green pipeline → maintainer merges. Be honest about what that guarantee is worth: a maintainer or owner *can* unprotect the branch in project settings, and GitLab Free keeps no audit log of that change. So the rule is procedural, not technical — **if you unprotect `main`, say so in the incident record at the moment you do it, and restore it within the hour**; a commit on `main` with no MR behind it is visible in the graph afterwards. The one lever short of that is temporarily clearing `only_allow_merge_if_pipeline_succeeds`, under the same disclose-and-restore rule. GitLab Free cannot require approvals and Code Owners is entirely a Premium feature, so there is no approval gate to lean on — under time pressure the standard gets stricter, not looser.

**Rollback — see `07-deployment.md`.** It owns the whole procedure: redeploying the previous digest, the forensic copy taken first, the backup restore when a migration is involved, and the reference-number hazard afterwards. The only part that belongs to this section is the Sev 1 first action above — capture the container logs *before* the redeploy, because `deploy:qa` destroys them. Do not decide at 22:00 whether a migration was "additive enough" to skip the restore; that judgement is exactly what `07-deployment.md` exists to take away from you.

**Nobody is watching between "Merged" and "QA is running the new bytes".** If `publish` or `deploy:qa` fails after a merge, `main` has moved, QA is still serving the previous digest, and no alert exists. Rule: **the merging Maintainer stays with the main pipeline until `deploy:qa` is green** — roughly four minutes — and if it is red, that is theirs to fix or revert before they pick up other work. `10-roles.md` already makes them the release owner. *Enforcement:* human today. The machine version is a pipeline-failure email to the user who triggered the pipeline, which requires that this instance can send mail at all — check Admin → Settings before writing it into a procedure, and if it cannot, say so rather than assuming the mail arrives.

**Incident → record.** Today the record is a dated `PROJECT-LOG.md` subsection in the same MR as the fix, plus the regression test. **From Sprint 1 — not in force today:** every Sev 1 and Sev 2 also gets a GitLab issue labelled `incident` and `Sev1`/`Sev2`, closed by the MR that fixes it, and `.gitlab/issue_templates/Incident.md` carries four prompts — what the desk saw, when, what was actually wrong, what stops it recurring. There is no `.gitlab/` directory yet; `01-agile.md` owns the complete template list and its capitalisation.

**Postmortems are not a new artifact.** `PROJECT-LOG.md` already records why things happened, with the measurement attached — §4.4 (the letterhead body living in a Word text box, found by the visual check that the text-extraction tests could not see) and §7 item 1 (the `winget` install that stalled 25 minutes because the session was not elevated) are postmortems in all but name. A Sev 1 or 2 that changed code adds a dated subsection **in the same MR as the fix**, plus a regression test whose name carries the decision — `it('is refused, rather than defaulting to CGST+SGST')`. No blame, no template ceremony, and a number wherever a number exists. *Enforcement:* the reviewer, and nothing else. There is no way to detect a missing log entry mechanically. **From Sprint 1** it becomes a checkbox in `.gitlab/merge_request_templates/` that the reviewer opens a thread on when it is unticked; until that template exists, this is honestly "the reviewer asks".

### Before production can be monitored

Production is not deployed. **This section does not carry the blocker list and neither should any other:** the hardware blockers and their numbers live in `07-deployment.md`, and the production **gate list** — with **TODO-SEC-01 as blocker zero**, because all 16 routes are unauthenticated including `GET /api/customers` and a `DELETE /api/quotes/:id` open to anyone on the LAN — lives in `09-security.md`. Any list here that looked complete would be one of four incomplete lists, which is how the hardest blocker went missing in the first place.

What this section owes production is narrower and is entirely unbuilt:

1. **The four `.37` monitors above**, including the three incumbent apps. `10-roles.md` §5 gate 3 is unmeetable until they exist, and nobody has costed the access needed to put a scheduled task on that laptop.
2. **A backup schedule for production data** that writes off the volume (backup rule 1) — and the same schedule for QA the day the desk's use of QA is confirmed as real work.
3. **The measurement that nobody has taken**: DOCX→PDF conversion wall-clock and CPU time under the production container's limits. `07-deployment.md` owns those limits and deliberately sets them *tighter* than QA's `--memory=2g --cpus=2.0`, so QA timings do not answer the question. Conversion is CPU-bound and serialised, 90 s timeout with one retry, so one request can hold the queue ~180 s — on a two-core shared laptop that is how the three incumbent apps get starved. Take the measurement before promising a date, and monitor the incumbents from day one so the eviction shows up as a red monitor rather than as a phone call.

### Rules for AI agents

1. Never state that monitoring, alerting, backups or log rotation are in place. None of it is installed. Write "gap".
2. Never propose a health check on HTTP status alone: 200 includes `degraded`, and a degraded deploy means the desk cannot produce a PDF while every monitor stays green. Check the body for `"status":"ok"`.
3. Never propose Prometheus, Grafana, ELK, Loki, Sentry or an APM for this project. On GitLab tiers, be precise rather than sweeping: **SAST and Secret Detection do run on Free** — as ordinary jobs emitting a JSON artifact, with no MR widget, no Security Dashboard and no vulnerability tracking over time — while **Dependency Scanning and Container Scanning are Ultimate-only and must not be proposed**. Dependency scanning here is an ordinary `npm audit` / `osv-scanner` job. `06-cicd.md` §2 owns the tier table; `09-security.md` owns the policy. Cite a row, do not re-derive the matrix.
4. Never run `docker system prune -a` or add `--volumes` anywhere: one daemon holds GitLab, the runner and `quotation_qa_data`, which has no backup and holds saved quotations as well as the 225 ledgers.
5. Never suggest `cp data/quotes.db` — WAL mode, 4 KB main file against a 2.7 MB `-wal`. `npm run backup` (`VACUUM INTO`) only. CLAUDE.md rule 4 owns the fact; `07-deployment.md` owns the procedure.
6. Any `.ps1` you add must be ASCII-only (PowerShell 5.1 cannot read BOM-less UTF-8) and must add no runtime dependency.
7. Never write a required-approvals rule, an approval count, or a CODEOWNERS-based review into a process document. GitLab Free cannot require approvals, and **Code Owners is entirely Premium — a `CODEOWNERS` file on Free is not parsed at all: it requests no reviewer, assigns nobody, and blocks no merge.** A plain `REVIEWERS.md` is a human lookup table and nothing more. When you describe the review guarantee, say it the way this section does: a Developer cannot merge their own work; a Maintainer can, and undertakes not to.
8. An incident writeup goes into `PROJECT-LOG.md` as a dated subsection in the same MR as the fix — not into a new `INCIDENTS.md`, not into an issue comment alone.
9. Never propose a job graph in which the tag or production pipeline rebuilds the image. The Dockerfile runs `apt-get update` in three stages, so a rebuild yields a different `sha256` than the one QA tested, and the digest guarantee — the reason the pipeline exists — is gone. Production pulls the tested digest. See `07-deployment.md` and `06-cicd.md`.
10. Never delete a registry digest that is running anywhere or is named by a Release that has not been superseded. It cannot be rebuilt; see the retention rules above.
11. Do not restate the production precondition list, the rollback procedure, the version-bump rules, the deploy sequence, the test/coverage/no-skips jobs, the test ladder, the role matrix, the branch and commit conventions, or the `.gitlab/` template list. Each has exactly one owner: `09-security.md`, `07-deployment.md`, `07-deployment.md`, `07-deployment.md`, `06-cicd.md`, `05-testing.md`, `10-roles.md`, `03-git.md`, `01-agile.md`. Cite the owner; a second copy is how the first drift becomes invisible.
12. Adding a route or a schema field deliberately fails a guard test. See `05-testing.md` §5 — it owns both, including the correct paths. Update the assertion in the same MR; never weaken the guard.
