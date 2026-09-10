<!-- Severity scale is owned by docs/sdlc/08-monitoring.md. One scale, three levels. -->

## What happens

## What should happen

## How to reproduce

1.
2.

**Environment:** <!-- local (Windows/Word) | QA 192.168.1.40:8081 (Linux/LibreOffice) | production -->

> Which one matters. Word **rejects** a file it cannot open; LibreOffice renders it as plain text
> and returns a valid PDF of the raw bytes with exit 0. A bug that reproduces on only one is a
> backend difference, not a mystery.

## Evidence

<!-- Job URL, container logs (`docker logs quotation-qa`), the failing assertion, a screenshot. -->

## The regression test

- [ ] A test that **fails before the fix and passes after** is part of the fix.
      A bug fixed without one is a bug scheduled to return.

Test file:

/label ~type-bug
