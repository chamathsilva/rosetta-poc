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

- **Walking skeleton** (2026-09-08): guest nickname join, single-room chat, WebSocket fan-out, persisted to Postgres. First application code in the project. `src/db/`, `src/server/`, `src/client/`, `src/shared/`. See changelog entry below for the full account.

## Change log

### Walking skeleton implemented and end-to-end verified: complete, 2026-09-08

**First application code in the project.** `coding-flow`, sized MEDIUM, four parallel/sequential batches (B0 scaffold+patterns solo, B1 db+server and B2 client in parallel, B3 integration solo), each independently verified by the orchestrator — files read in full, every gate command re-run directly, not accepted from subagent self-reports.

**Scope**: guest joins with a nickname, sends and receives messages in one hardcoded room, persisted to PostgreSQL. No registration, no multi-room, no presence, no moderation, no rate limiting — all explicitly out of scope. 1:1 DM untouched (protected no-Rosetta baseline).

**Gate history — the load-bearing fact of this feature.** The design was rejected and revised across **9 human review rounds** (~40 findings, all verified before acting, none disputed by the reviewing architect once evidence was shown). The plan was rejected once and revised twice more after implementation-time discoveries. In every round after the first, defects were found by the user, not by the AI review chain — the orchestrator's own verification passes checked citations (does this document quote its source correctly) and missed load-bearing assertions (is this claim actually true), which is where the real defects lived. Two exceptions: the architect caught the orchestrator's own wrong heap-memory arithmetic and a wrong claim about `pg`'s query-queueing behavior, both times by measuring or reading source rather than arguing.

**What execution caught that nine rounds of reading could not.** The moment a real, credentialed PostgreSQL instance existed (session 2026-09-08, a pre-existing system install on the user's machine, a role created via a live DBeaver session since the superuser password was unknown), running `npm run migrate` for the first time in this project's history printed CLI help text and did nothing — `node-pg-migrate` requires a positional `up`/`down` verb that had been missing from `package.json`'s script since round 4 of the design review. Nine design rounds, two plan rounds, and a full server implementation all verified the migration path, the file extension, and the CLI flag — none of them ran the command. Fixed in one word. Recorded in `agents/MEMORY.md` as a distinct failure class from the document-review misses above: some defects are only reachable by execution, and no amount of additional reading finds them.

**End-to-end verification (B3), first real run in this project**: real server process, real HTTP + WebSocket clients, two concurrent guest sessions, a hard `kill -9` and restart to prove nothing lived only in memory, direct database queries at every step rather than trusting an HTTP status code. All 19 SPECS acceptance criteria demonstrated against the real database. Full test suite: 79 tests, 79 pass, 0 fail, 0 skipped (up from 78/77/1-skipped before a database existed — the previously-deferred `AC-19` test now runs for real, including a test that proves a timed-out connection is *destroyed* rather than silently recycled, by checking the backend process id changes across a `max:1` pool).

**Zero genuine code defects found in the implementation itself** (B1 server, B2 client) by either the execution-based validation or the orchestrator's own full read-through of every file produced. The only defects found post-approval were the migration script (above) and one the orchestrator introduced and caught in itself: `TEST_DATABASE_URL` had been placed in the server's fail-fast `REQUIRED` config, which would have forced the production droplet to carry a variable it never uses — root-caused to the plan's own wording, corrected in both the code and the plan.

**Cost** (subagent tokens where individually tracked; orchestrator/main-thread cost not separately metered with the same rigor — see `docs/EVALUATION-LOG.md`'s standing note on main-thread token measurement being unreliable across turns):

| Phase | Tokens (subagent) | Notes |
|---|---|---|
| Design (9 rounds) | ~230,000 | Architect (opus), resumed with context each round, not respawned |
| Plan (tech-specs + plan, 2 review rounds + phase-5 review) | not separately totalled | Architect (opus) + one reviewer (sonnet, 118,218 tokens for phase-5 review alone) |
| B0 — scaffold, config, 10 pattern-file edits | 119,842 | Engineer (sonnet) |
| B1 — db + server | 232,070 | Engineer (sonnet), 108 tool uses |
| B2 — client | 93,417 | Engineer (sonnet) |
| B3 — end-to-end integration | 134,114 | Validator (sonnet), 60 tool uses |

**Built WITH Rosetta.** This is the feature the no-Rosetta 1:1 DM baseline will eventually be measured against — the design-phase cost in particular should not be blended into that comparison without note, since a 9-round human review gate is a property of this run's rigor, not necessarily of every future feature built the same way.

### Project scaffolded (adhoc-flow): complete, 2026-09-04

First workflow-driven run of the session. `adhoc-flow`, sized SMALL, orchestrator-executed with two independent review passes.

- **Scaffold**: `package.json` (ESM, Node 24 engines), `tsconfig.json`, `tsconfig.client.json`, `vite.config.ts`, `.nvmrc`, `.env.example`, `package-lock.json`. 161 packages, 0 vulnerabilities.
- **Client is React 19.2.8 + Vite 8.2.2** **[USER-DECIDED]**, departing from the pre-Rosetta static HTML/CSS/JS design. Recorded in `docs/ASSUMPTIONS.md` as `docs/CONTEXT.md` requires. React and Vite are devDependencies — build-time only — so **CI must build the client**; the droplet's `npm ci --omit=dev` cannot. New P0 in `docs/TODO.md`.
- **All five pattern files converted to TypeScript.** `parameterized-pg-queries.md` carried a factual defect — it selected `nickname` from `messages`, a column the approved schema does not have — and lacked the `deleted_at IS NULL` filter that soft delete makes mandatory. `untrusted-content-rendering.md` was rewritten for React, where the XSS surface is `dangerouslySetInnerHTML` and `javascript:` URLs rather than `innerHTML`.
- **Independent review found two HIGH defects in a file the orchestrator had just edited**: a 7-day registered-token lifetime contradicting the 30-day decision, and a template that did not compile under `noUncheckedIndexedAccess`. Both confirmed by compiling in each direction, then fixed.
- **Verification, not assertion**: `npm run typecheck` exit 0 across both configs; `npm run build` exit 0 producing `dist/server` and `dist/client`; a deliberate type error proved strictness is active; `bcrypt` hash and compare at cost 12 on Node 24.
- **Second independent review** of the React/Vite work found the server stub exited 0 silently — `main()` was exported and never invoked, so the placeholder that existed to fail loudly did nothing. Fixed and verified: exit code 1. It also flagged the missing Content-Security-Policy as a material gap for an app rendering attacker-controlled content, now a P0 tied to `server/http`.
- Two scaffold stubs exist in `src/` to prove the build pipeline. They carry no product behaviour and are listed for removal in `docs/TODO.md`.
- Node pinned to 24 (`.nvmrc`, `engines`), closing an open assumption. Built WITH Rosetta.

### Skeleton blockers resolved: complete, 2026-09-04

- **Migrations: `node-pg-migrate`.** Plain SQL on the same `pg` driver, no query builder, so the no-ORM pattern holds. Recorded as a **production** dependency, not a dev one — the droplet runs migrations at deploy, so an `npm ci --omit=dev` install must still contain it.
- **JWT lifetimes: 24 hours guest, 30 days registered.** Never specified by any source; surfaced only because guest reaping depends on it. The guest value also decides when a nickname returns to the pool.
- Both closed in `docs/ASSUMPTIONS.md`. `docs/TODO.md` "Blocking the first line of code" now holds only the first-admin bootstrap plus two mechanical P1 items.

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
