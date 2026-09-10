<!-- Definition of Ready: docs/sdlc/01-agile.md. A story that fails DoR does not enter a sprint. -->

## Story

**As** <!-- the purchase desk / a developer / the release manager -->
**I want**
**so that** <!-- the consequence. If you cannot finish this line, it is not a story yet. -->

## Acceptance criteria

<!--
Each AC names the test that will prove it. House grammar:
  describe = the situation (noun phrase)   it = what happens (verb phrase)
  Never "should". Never the function name in the it.
-->

1. **Given** … **when** … **then** …
   → test: `server/src/…/x.test.ts` — `describe('…') it('…')`
2.

## Out of scope

<!-- What this story deliberately does NOT do. Prevents silent scope growth. -->

## Definition of Ready

- [ ] Actor, want and consequence are all present
- [ ] Acceptance criteria are testable, and each names its test
- [ ] Test level(s) identified — see the ladder in `docs/sdlc/05-testing.md`
- [ ] Does it touch a **migration**? Forward-only, never edit an applied file
- [ ] Does it touch **PDF/.docx**? Then Word vs LibreOffice must be exercised — `docs/sdlc/05-testing.md`
- [ ] Does it touch **money**? Integer paise only; division only inside `Math.floor`/`Math.round`
- [ ] Does it touch **customer identity**? A customer is a ledger, not a name — never pick one for the desk
- [ ] Dependencies and blockers named, with who owns the unblock
- [ ] Sized `size-s` / `size-m` / `size-l` (`size-l` must be split first)

/label ~type-feature
