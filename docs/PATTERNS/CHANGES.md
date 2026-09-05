# Pattern Changes

## 2026-09-04 — defects found by independent review of the converted patterns

A `reviewer` subagent compiled the templates against the real `tsconfig.json` rather than reading them, and found two HIGH defects in `jwt-session-cookies.md` that the conversion had walked past:

- **`expiresIn: '7d'` for registered users**, contradicting the 30-day lifetime decided the same day. A recorded decision silently reverted inside a template — the exact failure `docs/ARCHITECTURE.md`'s header warns about.
- **The template did not compile.** Untyped Express parameters (`TS7006`/`TS7031`) and `process.env.JWT_SECRET` typed `string | undefined` under `noUncheckedIndexedAccess`, which `jwt.sign` rejects (`TS2769`). Anyone copying it verbatim got a build break.

Both fixed and re-verified by compiling: corrected form exits 0, the original reproduces all three error classes.

Also from the same review:

- `GUEST_SESSION_TTL` / `USER_SESSION_TTL` removed from `.env.example`. They were speculative — absent from `REQUIRED`, read by nothing, and duplicating values `docs/ARCHITECTURE.md` records as decisions rather than tunables. That duplication is what let the 7d/30d contradiction exist. Lifetimes are now constants in one place.
- `env-config-secrets.md` gained two rules: `.env.example` may carry conventional non-fail-fast values, marked as such; and decided values stay as code constants, never environment variables.
- Template functions are now exported, so they can actually be imported as the module table intends.

## 2026-09-04 — all five patterns converted to TypeScript

Every template was written in JavaScript before the source language was decided. Left alone they prescribed the wrong module system and, in one case, a column that does not exist.

- `env-config-secrets.md` — CommonJS `module.exports` → ESM export, typed `Config` interface. Added a note that `noUncheckedIndexedAccess` makes `process.env[key]` possibly-undefined, and that the non-null assertions are sound only because the keys were checked immediately above. Corrected the stale claim that `.env.example` does not exist; it does, as of today.
- `jwt-session-cookies.md` — `require` → `import`, fences relabelled.
- `parameterized-pg-queries.md` — **factual defect**: selected `nickname` from `messages`, a column the approved data model does not have. Now `author_nickname`. Also added `deleted_at IS NULL`, which every user-facing read of `messages` needs because removal is a soft delete.
- `websocket-room-fanout.md` — removed `socket.roomId = roomId`. It does not typecheck against `@types/ws` and was never needed: the `close` and `error` handlers already capture `roomId` by closure.
- `untrusted-content-rendering.md` — typed, with an added warning that typing an argument says nothing about whether the value is trustworthy. Safety comes from `textContent`.

Client sources are TypeScript with their own `tsconfig.client.json` (`DOM` lib); the server config excludes `src/client`.

These remain **prescribed**, not extracted. `docs/TODO.md` still carries the item to re-derive them from real usage once code exists.


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
