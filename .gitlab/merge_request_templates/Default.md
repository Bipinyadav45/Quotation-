<!--
The Definition of Done, as a checklist. Full text and the consequence of skipping each item:
docs/sdlc/01-agile.md#definition-of-done--the-single-merge-gate

Items 1-10 gate the merge. Items 11-14 close the issue.
Delete any line that genuinely does not apply, and say why in the notes at the bottom.
Do not delete a line because it is inconvenient - a hand-pasted checklist is the one that
loses item 4 and item 6, which are the two that catch a silently wrong document.
-->

## What changed, and why

<!-- The why, not the what. The diff already says what. -->

Closes #

## Gates the merge

- [ ] **1. Commits** are imperative and explain *why*. No `feat:`/`fix:` prefix — this repo uses none.
- [ ] **2. Green locally:** `npm run build && npm run typecheck && npm test`, in that order.
      Not just typecheck+test: `bundle-safety.test.ts` ends in an unconditional `expect(built).toBe(true)`,
      so with no `web/dist` the suite is **red**, not green-with-skips.
- [ ] **3. Pipeline green** — `build → test`, run inside the image on Linux with LibreOffice.
- [ ] **4. No skipped tests in CI.** In the container every precondition holds, so a skip means a
      guard stopped guarding. Eight tests self-skip without a converter or a build.
- [ ] **5. Schema change ⇒ a new `server/db/migrations/00N_*.sql`.** Never an edit to an applied file.
      There are no down-migrations; rollback means restoring a backup.
- [ ] **6. PDF or .docx change ⇒ state which backend you exercised:**
      *"my machine tested Word; CI tested LibreOffice."*
      Word **rejects** a file it cannot open; LibreOffice renders it as **plain text** and returns a
      valid PDF of the raw bytes, exit 0, no warning.
- [ ] **7. New dependency ⇒** size, last release, transitive count, and why nothing already present
      will do. (`xlsx` was rejected at 7 MB; `server/src/lib/xlsx.ts` is ~80 lines over `pizzip`.)
- [ ] **8. Branch is not behind `main`** — rebased, not merged-into.
- [ ] **9. Security checklist** in `docs/sdlc/09-security.md` is satisfied.
- [ ] **10. Merged by someone who is not the author.**

## Tests

<!--
Which level(s)? See the ladder: docs/sdlc/05-testing.md
  pure function -> extractCustomer.test.ts   database -> priceHistory.test.ts
  HTTP route    -> quote.customer.test.ts    document -> docx.test.ts
  UI wiring     -> screen-wiring.test.ts
Three that are forgotten:
  new endpoint     -> routes.test.ts asserts the complete route list
  new schema field -> screen-wiring.test.ts iterates QuoteSchema.shape
  new migration    -> DB tests with a frozen migration list will not see it
-->

- [ ] New or updated tests cover the new behaviour, at the lowest level that can actually fail.

## AI assistance

- [ ] This change was AI-assisted, and the commits carry a `Co-Authored-By:` trailer.
- [ ] I reviewed every line. I am not submitting anything I do not understand.

## Notes for the reviewer

<!-- Anything deleted above, and why. Anything you want looked at hardest. -->
