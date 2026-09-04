# Pattern Changes

## [2026-09-04] Initial prescribed pattern set (greenfield repo, no code to extract from)

- Created `INDEX.md`, `CHANGES.md`.
- Created 5 prescriptive pattern files, each traced to an existing decision in `POC-BRIEF.md` / `docs/TECHSTACK.md` / `docs/DEPENDENCIES.md` / `gain.json`:
  - `websocket-room-fanout.md`
  - `untrusted-content-rendering.md`
  - `parameterized-pg-queries.md`
  - `jwt-session-cookies.md`
  - `env-config-secrets.md`
- Skipped: HTTP framework request/response handling pattern, REST endpoint pattern, and DB migration pattern — at the time of writing no framework and no migration tool had been chosen. Prescribing a template ahead of that decision would be speculative, not grounded.

## [2026-09-04] Phase 8 decisions — framework resolved

- Express is now the decided HTTP framework, and bcrypt (cost 12) the password hash. The framework blocker above is lifted: a request/handling pattern can be written once real endpoints exist and a shape repeats. Do not write it speculatively now — the same reasoning that skipped it still applies until there is code to generalise from.
- Migration-tool blocker stands. No migration pattern until one is chosen.
- `jwt-session-cookies.md` updated: Express + `cookie-parser`.
