# TODO

Actionable work items not yet started. Decisions and unknowns belong in `docs/ASSUMPTIONS.md`; completed work belongs in `agents/IMPLEMENTATION.md`.
Each entry: an h3 header of the form `PRIORITY — WHEN — WHAT — WHERE`, with details in the body.
Style: terse, one item per header, grep-friendly.

An item leaves this file when it is done (→ `agents/IMPLEMENTATION.md`) or when it turns out to be an open decision (→ `docs/ASSUMPTIONS.md`).

## Blocking the first line of code

### P0 — before walking skeleton — establish the cost-recording habit — `docs/EVALUATION-LOG.md`

Per-feature token and wall-clock cost, plus with/without-Rosetta marking. Required by `docs/CONTEXT.md` evaluation guardrails. **Resolved (Phase 8): home is `docs/EVALUATION-LOG.md`, append-only, one row per feature.** Habit still needs to be exercised starting with the first feature.

### P1 — before first commit of code — commit `.env.example` — repo root

Documents required configuration (`JWT_SECRET`, `DATABASE_URL`, …). Referenced by `docs/PATTERNS/env-config-secrets.md`; does not exist.

## Blocking deployment (gated)

### P1 — before gated deploy — implement the launch gate — `docs/ARCHITECTURE.md`

**Resolved (Phase 8): Caddy basic auth**, enforced in the reverse proxy, above the application. No application code. Still needs implementing.

### P1 — before gated deploy — set up a free subdomain (DuckDNS-style) — `docs/ARCHITECTURE.md`

Resolved (Phase 8): free subdomain sufficient for the gated phase. Still needs doing.

### P0 — before public launch — register a real domain — `gain.json`, `docs/ARCHITECTURE.md`

**Blocking item.** Required before anonymous public access opens: the published abuse contact address must be genuine and stable, which a free subdomain does not satisfy.

### P1 — before gated deploy — choose a migration tool — `docs/DEPENDENCIES.md`

`docs/CODEMAP.md` proposes `src/db/` for migrations with nothing to run them.

## Blocking anonymous public access

### P0 — before public launch — implement the moderation floor — `src/server/moderation`

Report button, admin remove/ban, IP + timestamp logging (retention: 30 days), published abuse contact. All four are non-deferrable per `docs/CONTEXT.md` and now atomic requirements in `docs/REQUIREMENTS/`.

### P0 — before public launch — choose and implement rate limiting — `docs/TECHSTACK.md`

No library chosen. Public-launch gate.

### P0 — before first migration — human review of the data model — `docs/ARCHITECTURE.md`, `src/db/`

**Blocking item.** The `users`/`rooms`/`messages`/`reports`/`moderation_actions` schema in `docs/ARCHITECTURE.md` is AI-invented and marked DRAFT. It requires explicit human review before any migration is written in `src/db/`.

### P0 — before public launch — prove backup and restore — `docs/ARCHITECTURE.md`

Scheduled `pg_dump` plus a **tested restore**. A dump script alone does not close this item.

### P1 — before public launch — choose monitoring and logging — `gain.json`

Both are placeholders. The logging choice determines where retention is enforced.

## Evaluation work

### P1 — after accounts ship — run the no-Rosetta baseline feature — `agents/IMPLEMENTATION.md`

1:1 DM, built with plain Claude Code. **Do not pre-design it** — no specs, schema, endpoints, or plans before the baseline run. See `docs/CONTEXT.md`.

### P2 — after code exists — re-run pattern extraction — `docs/PATTERNS/INDEX.md`

Current patterns are prescribed, not extracted. Re-derive from actual usage (2+ occurrences).

### P2 — after deploy — verify real monthly cost against estimate — `agents/IMPLEMENTATION.md`

$6 droplet + domain. Neither provisioned nor priced in full.
