# Implementation Summary

Brief, durable summary of implementation state, plus the high-level change log.
**This is the only changelog in the system.** No other doc carries a change history — `docs/CONTEXT.md`, `docs/ARCHITECTURE.md` and `docs/ASSUMPTIONS.md` describe present truth only.
Keep it concise. For detail, use git history and PRs rather than expanding this file.
Style: baseline first, then one h3 per change with date and a one-line description.

## Baseline (2026-09-04)

- **No application code exists.** Zero source files. `package.json` has not been created.
- **No infrastructure is provisioned.** No droplet, no database, no domain, no TLS certificate.
- **No deployment has occurred.** Not gated, not public.
- Repository contains: `POC-BRIEF.md` (pre-Rosetta human record), `gain.json`, `.gitignore`, `.prettierignore`, `.claude/settings.json`, and the `docs/` + `agents/` documentation set produced by the `init-workspace-flow` run.
- Rosetta 3.1.13 installed at project scope.
- Everything in `docs/ARCHITECTURE.md` and `docs/TECHSTACK.md` is **decided-and-unbuilt**, not implemented.

## Major Implemented Workstreams

None. No workstream has produced code.

## Change log

### Data model reviewed and approved: complete, 2026-09-04

- **P0 gate closed.** The AI-invented DRAFT schema in `docs/ARCHITECTURE.md` was reviewed table by table and replaced with an approved six-table schema carrying full DDL, indexes and constraints. Explicit user approval given.
- Four defects found in the draft: guests could not be banned; a guest could take a registered nickname; `messages.author` held two different kinds of value; "30-day retention" was ambiguous between deleting messages and erasing IPs.
- Reversals from the draft: guests now get a `users` row flagged `is_guest`; bans are by IP in their own table, time-limited; message ids are `uuid`; `users.is_admin` added (absent from the draft entirely).
- Retention rule adopted: an IP is kept only while operationally needed, then hard-erased; the record survives. Backup retention capped at 30 days so no dump outlives the data it holds.
- Documented and deliberately unbuilt: repeat-offender escalation via `hmac(ip, secret)`.
- New TODO items surfaced by the review: first-admin bootstrap, one scheduled maintenance task, no hard-delete path for message bodies, `pg_dump` retention cap. New open question: JWT lifetime, which now decides guest reaping.
- No DM tables. The baseline-feature reservation holds.
- No code and no migration written — `src/db/` is still empty. Built WITH Rosetta.

### Toolchain and language decision: complete, 2026-09-04

- Session-start `load-project-context` run; no code written.
- **Source language decided: TypeScript** (`docs/TECHSTACK.md`, `docs/DEPENDENCIES.md`, `docs/CODEMAP.md`). Compiled by `tsc` to `dist/`; systemd runs the build output. Closes a contradiction no `init-workspace-flow` phase caught: `docs/CONTEXT.md` mandated `typescript-lsp` while the stack docs described plain JavaScript.
- **Walking skeleton persists messages from day one** (`docs/CONTEXT.md` target state 1). Consequence: the DRAFT data model and the migration-tool choice moved into `docs/TODO.md` "Blocking the first line of code".
- Installed globally under Node v22.14.0: `typescript` **5.9.3**, `typescript-language-server` 5.3.0. Per-Node-version — lost on `nvm use` of another version.
- `typescript-lsp` plugin enabled and **validated**: `documentSymbol`, `hover`, `goToDefinition`, `findReferences` all return correct results. First attempt failed — `typescript@7.0.2` (native Go port) ships no `tsserver.js`; downgrading the global to the 5.x line fixed it.
- Cost: ~20k main-thread tokens, 0 subagent tokens, ~10 min wall clock. Built WITH Rosetta.

### Workspace initialization: complete through Phase 7, 2026-09-04

- `init-workspace-flow` run: `gain.json`, `docs/TECHSTACK.md`, `docs/CODEMAP.md`, `docs/DEPENDENCIES.md`, `docs/PATTERNS/` (5 prescribed patterns), `docs/CONTEXT.md`, `docs/ARCHITECTURE.md`, `docs/ASSUMPTIONS.md`, `agents/IMPLEMENTATION.md`, `agents/MEMORY.md`.
- Architecture transcribed from `POC-BRIEF.md`, with two user corrections applied that supersede the brief: self-hosted Postgres replaces Neon; droplet is $6/1 GB + 2 GB swap, not $4/512 MB.
- Project bar raised to publicly-launched-to-strangers with a staged launch model and a non-deferrable moderation floor.

### Template for future entries

### \<Workstream\>: \<status\>, \<date\>

- \<what changed, with keywords and file references — not a narrative\>
- \<cost record: tokens + wall-clock, per `docs/CONTEXT.md` evaluation guardrails\>
- \<built WITH or WITHOUT Rosetta — this must be recorded for every feature\>
