# init-workspace-flow — state

Run started: 2026-09-04 21:13 UTC
Workspace: `/Users/chamathwor/Desktop/Projects/POC/rosetta-poc`
Rosetta: 3.1.13 (plugin, project scope)

> `TodoWrite` tooling is unavailable in this session. This file is the task ledger.

## Detection (Phase 1)

- mode: **plugin** (context contains "RUNNING AS A PLUGIN")
- plugin_active: **true**
- composite: **false** (single git repo, no sub-repository doc roots)
- file_count: _pending Phase 3_
- gain_json_status: **created** (IDE / tracker / CI answered by user; ops fields left as placeholders)

### User decisions captured this session

- Coding agents: Claude Code (VSCode + CLI). No Cursor/Codex/Copilot — avoids stacking competing instruction layers.
- Issue tracker: GitHub Issues. CI: GitHub Actions.
- Real-app bar: publicly launched to real strangers, minimum feature set; heavier trust-and-safety tooling may follow later.
- Database: self-hosted PostgreSQL on the droplet. Neon is dropped — supersedes `POC-BRIEF.md`.
- Droplet: $6/mo 1 GB + 2 GB swap (512 MB is not viable once Postgres is co-hosted).

### File inventory — `bootstrap_rosetta_files` roster

| File | Status |
|---|---|
| `gain.json` | present |
| `docs/CONTEXT.md` | **created** (Phase 7) |
| `docs/ARCHITECTURE.md` | **created** (Phase 7) |
| `docs/TODO.md` | **created** (Phase 7) |
| `docs/ASSUMPTIONS.md` | **created** (Phase 7) |
| `docs/TECHSTACK.md` | **created** |
| `docs/DEPENDENCIES.md` | **created** |
| `docs/CODEMAP.md` | **created** |
| `docs/REQUIREMENTS/` | **created** (Phase 8) — `INDEX.md`, `CHANGES.md` |
| `docs/PATTERNS/` | **created** |
| `agents/IMPLEMENTATION.md` | **created** (Phase 7) |
| `agents/MEMORY.md` | **created** (Phase 7) |
| `README.md` | **created** (Phase 7) |
| `plans/` | missing |
| `refsrc/` | missing |
| `docs/raw/` | missing |

Pre-existing human content (must be preserved): `POC-BRIEF.md`, `.claude/settings.json`.

## Phase ledger

| # | Phase | Status |
|---|---|---|
| 0 | prerequisites | done |
| 1 | context | **done** — mode=plugin, gain.json created |
| 2 | shells | **skipped** — plugin_active |
| 3 | discovery | **done** — 2026-09-04 21:30 UTC |
| 4 | rules | disabled |
| 5 | patterns | **done** — 2026-09-04 |
| 6 | code-graph | **done** — CODEMAP + typescript-lsp chosen |
| 7 | documentation | **done** — 2026-09-04, mode=install, all 5 target docs + TODO.md + README.md created |
| 8 | questions | **done** — 2026-09-04, eight user decisions applied to files |
| 9 | verification | **done** — 2026-09-04, workflow COMPLETE |

## Resolved in Phase 8

Eight user decisions, applied directly into the affected files (not merely recorded here):

1. **Cost record location**: `docs/EVALUATION-LOG.md`, append-only, one row per feature (file owned/created by orchestrator). Referenced from `docs/CONTEXT.md`, `docs/TODO.md`.
2. **IP + timestamp log retention: 30 days.** Written into `docs/CONTEXT.md`, `docs/ARCHITECTURE.md`, `gain.json` (`logging` field). Removed corresponding open item from `docs/ASSUMPTIONS.md`.
3. **Pre-moderation gate: Caddy basic auth**, reverse-proxy layer, no application code. Written into `docs/CONTEXT.md`, `docs/ARCHITECTURE.md` (deployment topology), `gain.json` (`gated launch` vocabulary — corrected from "invite code"). Removed the gating-mechanism item from `docs/ASSUMPTIONS.md`.
4. **Domain: free subdomain (DuckDNS-style) during gated phase; real registered domain required before public launch.** Written into `docs/ARCHITECTURE.md` (new "Domain" subsection), `docs/TECHSTACK.md`. `docs/TODO.md` now carries both "set up free subdomain" (gated) and "register real domain" (blocking, before public launch) as separate items. Removed the domain-name item from `docs/ASSUMPTIONS.md`.
5. **HTTP framework: Express.** Written into `docs/ARCHITECTURE.md` (new "HTTP framework" section), `docs/TECHSTACK.md`, `docs/DEPENDENCIES.md`. Removed the HTTP-framework item from `docs/ASSUMPTIONS.md`. `docs/TODO.md`'s "choose HTTP framework" item removed (superseded by cost-recording item).
6. **Password hashing: bcrypt, cost factor 12.** Written into `docs/ARCHITECTURE.md` (new "Password hashing" section), `docs/TECHSTACK.md`, `docs/DEPENDENCIES.md`. Removed the password-hashing item from `docs/ASSUMPTIONS.md`.
7. **Data model stays DRAFT**, explicit human-review gate before any migration in `src/db/`. Written into `docs/ARCHITECTURE.md` (data model section header + gate note). `docs/TODO.md` carries "human review of data model before first migration" as a blocking item. Removed the data-model item from `docs/ASSUMPTIONS.md` — the open question (what to do about it) is resolved even though the schema itself is still unreviewed.
8. **`docs/REQUIREMENTS/` created** with `INDEX.md` (four atomic moderation-gate requirements REQ-MOD-001..004) and `CHANGES.md`. No requirements invented beyond the four. File-inventory row in this document updated below.

Also updated as a consequence: `docs/DEPENDENCIES.md` gained `bcrypt` and `cookie-parser` as named production dependencies (closes the Phase 5 gap where `jwt-session-cookies.md` assumed `req.cookies` with no cookie middleware listed); `docs/PATTERNS/jwt-session-cookies.md` got a one-line note that the framework is Express and `cookie-parser` is the middleware.

## Still unresolved (open in `docs/ASSUMPTIONS.md`)

- Database migration tool: none chosen.
- Rate-limiting library: none chosen.
- Monitoring and logging stack: tool not chosen (retention period is now decided; the tool that enforces it is not).
- Test framework and linter: not chosen.
- Connection pooling configuration: unspecified.
- Backup and restore procedure: unproven.
- Droplet not provisioned; real cost unverified (now also missing real-domain cost).
- Single-instance capacity ceiling: never measured.
- Node.js LTS version: unpinned.
- Module decomposition: unverified inference, no code to validate against.
- User population description: unverified inference.
- Baseline-feature isolation: enforced by discipline only, no mechanical guard.

## Gaps logged for Phase 8 (historical — see "Resolved in Phase 8" above for what changed)

### From Phase 3 review (orchestrator, not self-reported by the subagent)

- Discovery reported "no conflicts" while real gaps remained. Logged here instead:
- `.gitignore` shipped without `node_modules/`, `.env` or log entries — a secret-leak path for the planned DB password and JWT signing key. **Fixed by orchestrator**; the phase did not catch it.
- No password-hashing dependency (`bcrypt`/`argon2`) despite registered accounts being a planned feature.
- No rate-limiting dependency despite rate limiting being a planned deliverable and a public-launch gate.
- No database migration tool chosen; `docs/CODEMAP.md` proposes `src/db/` for migrations with nothing to run them.
- HTTP framework (Express vs Fastify) still an open choice and must be settled before the walking skeleton.
- No `.env.example` committed to document required configuration.

- Greenfield repo: no source code exists yet. Discovery/patterns phases have no code to analyze — expect thin TECHSTACK/CODEMAP/PATTERNS output derived from the decided-but-unbuilt architecture.
- Project bar raised to "publicly launched, real strangers, minimum features" (user decision, this session). Not yet reflected in any doc.
- Database changed from Neon Postgres to self-hosted Postgres on the droplet (user decision, this session). `POC-BRIEF.md` still says Neon.
- Public-launch gating recommendation (open to strangers only at Phase 2 step 8, after rate limiting + moderation) — accepted in conversation, not yet written down.
- Non-deferrable minimum for public launch: report button, admin remove/ban, IP + timestamp logs, abuse contact. Needs to land as requirements.

### From Phase 5 (patterns)

- `docs/PATTERNS/` contains only 5 prescribed patterns, deliberately narrow — greenfield repo, no code to extract from. Not a substitute for real pattern extraction once code exists; Phase 5 should re-run in a later upgrade pass against actual usage.
- HTTP framework choice (Express vs Fastify, already logged as a Phase 3 gap) blocks writing a REST-endpoint / request-handling pattern. Skipped rather than guessed.
- No DB migration tool chosen (already logged as a Phase 3 gap) blocks a migration-file pattern. Skipped rather than guessed.
- Rate limiting and moderation are named deliverables (`POC-BRIEF.md`, `gain.json`) but have no chosen library/approach yet, so no pattern was written for either — same reasoning as above, not an oversight.
- `docs/PATTERNS/jwt-session-cookies.md` assumes `req.cookies` (a cookie-parsing middleware) is available; no such dependency is listed in `docs/DEPENDENCIES.md` yet. Needs to be added when the HTTP framework is chosen (e.g. `cookie-parser` for Express, `@fastify/cookie` for Fastify).

### From Phase 7 (documentation)

Prior Phase 3/5 gaps were transcribed into `docs/ASSUMPTIONS.md` and `docs/TODO.md` rather than restated here. New items found while writing:

- **The per-feature cost record has no home.** `POC-BRIEF.md` and `docs/CONTEXT.md` require recording token and wall-clock cost per feature as work happens, and state it cannot be reconstructed later. No file, format, or habit exists for it. This fails silently and irrecoverably — highest-risk open item in the repo. Phase 8 must decide where it lives, before any feature work.
- **Baseline-feature isolation is enforced by discipline only.** 1:1 DM must not be pre-designed, yet `gain.json` already carries a `DM` vocabulary entry. Nothing mechanically prevents a future session from designing it. Consider whether a stronger guard is warranted.
- **`docs/CODEMAP.md` line 21 says the layout "will be confirmed and detailed in Phase 7".** Phase 7 could not confirm it — there is still no code. The module table in `docs/ARCHITECTURE.md` is an agent proposal, not a confirmation. CODEMAP's forward reference is now stale and should point at first-code instead.
- **Contradiction between sources on the launch gate mechanism**: `gain.json` "gated launch" says *invite code*; the Phase 7 correction says *invite-code / basic-auth*. Not the same thing, and neither says whether it sits in Caddy or the app. Undecided.
- **Data model is entirely AI-inferred.** `users` / `rooms` / `messages` / `reports` / `moderation_actions` in `docs/ARCHITECTURE.md` came from feature descriptions, not from any human-authored source. Needs human review before `src/db/` is written.
- **User population in `docs/CONTEXT.md` is AI-inferred.** No source document describes users beyond "real strangers".
- **No domain registered, and it is a hard dependency** for Caddy automatic TLS *and* for the published abuse contact address required by the moderation floor. Not previously logged as a gap.
- **Total cost is unverified beyond the $6 droplet.** Domain cost is unpriced; `POC-BRIEF.md`'s "~$50-70/yr" figure assumed a free Neon database and no domain, so it is stale in both directions.
- **`docs/REQUIREMENTS/` does not exist** while the moderation floor (report / remove-ban / IP-timestamp logging with stated retention / abuse contact) was explicitly flagged in Phase 3 as needing to "land as requirements". Still has not.
- **No password-hashing library** — carried forward from Phase 3, unresolved, and now also logged in `docs/ASSUMPTIONS.md`.

## Phase 9 — Verification (independent audit)

**Status: COMPLETE.** Full roster present, `gain.json` valid JSON, `docs/CONTEXT.md` last line matches exactly, Neon appears only as a rejected alternative (POC-BRIEF.md exempt, untouched), Express is decided everywhere it matters, `.gitignore` covers `.env` and `node_modules/`, the four REQ-MOD requirements are atomic/testable/exactly-four, `docs/ASSUMPTIONS.md` holds no item resolved in Phase 8, the data model is DRAFT/UNAPPROVED/AI-INFERRED (not user-decided), and the 1:1 DM baseline feature has NOT been designed anywhere (no schema/endpoints/specs).

Findings (not fixed — reported for orchestrator/user decision):

- **MEDIUM** — `docs/PATTERNS/CHANGES.md:12` still reads "Express vs Fastify still open," contradicting the Phase 8 decision recorded everywhere else (`docs/ARCHITECTURE.md`, `docs/TECHSTACK.md`, `docs/DEPENDENCIES.md`, `docs/PATTERNS/jwt-session-cookies.md`). Stale historical claim now read as current status.
- **MEDIUM** — `docs/CODEMAP.md:21`, "This layout will be confirmed and detailed in Phase 7 ... once code structure stabilizes," is now a stale forward reference: Phase 7 ran and could not confirm it (no code exists), so the pointer dangles. Should point at first-code / a future upgrade pass instead.
- **LOW** — `agents/init-workspace-flow-state.md:126` (this file, historical Phase 7 log) still describes the gate mechanism as an unresolved "invite code / basic-auth" contradiction, which Phase 8 resolved to Caddy basic auth everywhere else. Left as-is deliberately as a historical record, but flagged in case it is read as current.
- No HIGH-severity findings. Deliberately checked hardest for: Neon-as-chosen (none found — correctly rejected, POC-BRIEF.md correctly left untouched), Express/Fastify still-open framing outside history (only the one CHANGES.md line, MEDIUM not HIGH since it's a change-log entry not a decision doc), DM baseline design leakage (none — `docs/ARCHITECTURE.md`'s data model has no DM table, only `users`/`rooms`/`messages`/`reports`/`moderation_actions`), data model masquerading as user-decided (it is correctly tagged AI-INFERRED/DRAFT/UNAPPROVED), and resolved assumptions left in `docs/ASSUMPTIONS.md` (all 12 entries there remain genuinely open, matching the "Still unresolved" list above).

Workflow marked **COMPLETE**. New chat session required before starting feature work — this session's context is polluted with init-specific state.
