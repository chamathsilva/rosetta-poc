# TODO

Actionable work items not yet started. Decisions and unknowns belong in `docs/ASSUMPTIONS.md`; completed work belongs in `agents/IMPLEMENTATION.md`.
Each entry: an h3 header of the form `PRIORITY — WHEN — WHAT — WHERE`, with details in the body.
Style: terse, one item per header, grep-friendly.

An item leaves this file when it is done (→ `agents/IMPLEMENTATION.md`) or when it turns out to be an open decision (→ `docs/ASSUMPTIONS.md`).

## Blocking the first line of code

### P0 — before walking skeleton — establish the cost-recording habit — `docs/EVALUATION-LOG.md`

Per-feature token and wall-clock cost, plus with/without-Rosetta marking. Required by `docs/CONTEXT.md` evaluation guardrails. **Resolved (Phase 8): home is `docs/EVALUATION-LOG.md`, append-only, one row per feature.** Habit still needs to be exercised starting with the first feature.

## Blocking deployment (gated)

### P0 — before gated deploy — ship the CI-built client to the droplet — `.github/workflows/`

The droplet installs with `npm ci --omit=dev`, and React/Vite are devDependencies, so the droplet cannot build the client. Without a shipped build the deploy produces a server with no UI, and nothing fails loudly.

**Half done, 2026-09-08.** `.github/workflows/ci.yml` builds the client and uploads `dist/client` as an artifact. **Nothing consumes that artifact** — no deploy workflow exists, so the remaining half is a CD job that downloads it onto the droplet.

### P1 — before the AI review is useful — add the `CLAUDE_CODE_OAUTH_TOKEN` secret — repository settings

`.github/workflows/claude-code-review.yml` and `claude.yml` reference a secret that does not exist yet, so both jobs fail on every PR until it is added. Run `/install-github-app` in an interactive Claude Code session. Deliberately not a required status check, so the missing secret cannot block a merge.

### P1 — replaced by the walking skeleton — remove the scaffold stubs — `src/`

`src/server/index.ts` and `src/client/main.tsx` are build-verification stubs with no product behaviour. `src/server/index.ts` throws if called. They exist to prove the build pipeline end to end and must be replaced, not extended.

### P1 — before gated deploy — verify `bcrypt` loads on the droplet — `docs/DEPENDENCIES.md`

`bcrypt` is a native module. npm 11 blocks install scripts by default, so it works locally only because the package ships a prebuilt binary for darwin-arm64. If no prebuild matches the droplet's architecture, `npm ci` succeeds and the server then fails at first import. Verify before relying on the deploy, or approve the install script explicitly.

### P0 — before gated deploy — trust the proxy for client IPs — `src/server`

`messages.ip` is captured from `req.socket.remoteAddress`. Once Caddy fronts the process this records **Caddy's address, not the client's**, so every row carries the same useless value and nothing fails visibly. Requires a **trusted-proxy-aware `X-Forwarded-For` extractor in the upgrade handler itself**, plus Caddy configured to set the header. Express `trust proxy` is **not sufficient and not applicable**: a raw `http.Server` `'upgrade'` event never enters the Express middleware chain, so the setting cannot affect the request the IP is actually read from. Express `trust proxy` still covers `POST /api/join` and `GET /api/session`; the WebSocket path needs its own extractor. Corrected 2026-09-07 — the original wording named a remediation that cannot work for the path that captures the IP. **REQ-MOD-003 (IP + timestamp logging) is unsatisfiable until this is done** — the column would be populated but worthless. Raised by the walking-skeleton design 2026-09-05; the feature itself runs locally and is unaffected.

### P1 — before gated deploy — implement the launch gate — `docs/ARCHITECTURE.md`

**Resolved (Phase 8): Caddy basic auth**, enforced in the reverse proxy, above the application. No application code. Still needs implementing.

### P1 — before gated deploy — set up a free subdomain (DuckDNS-style) — `docs/ARCHITECTURE.md`

Resolved (Phase 8): free subdomain sufficient for the gated phase. Still needs doing.

### P0 — before public launch — register a real domain — `gain.json`, `docs/ARCHITECTURE.md`

**Blocking item.** Required before anonymous public access opens: the published abuse contact address must be genuine and stable, which a free subdomain does not satisfy.

## Blocking anonymous public access

### P0 — before public launch — one scheduled maintenance task — `src/db/`

Three statements, one task, one thing to monitor: null `messages.ip` older than 30 days; null `bans.ip` more than 30 days past `expires_at`; delete guest `users` rows whose `last_seen_at` is older than 24 hours, the guest JWT lifetime. Do not split into three cron entries — the retention promise must be enforced in one place that can be pointed at.

### P1 — before public launch — no hard-delete path for message bodies — `src/server/moderation`

Known limitation, accepted at the 2026-09-04 data model review. Moderation removal is a soft delete (`messages.deleted_at`), so a removed message keeps its body. A legal takedown or an erasure request would need a genuine delete. Not a blocker behind the Caddy gate.

### P1 — before public launch — cap `pg_dump` retention at 30 days — `docs/ARCHITECTURE.md`

Privacy control, not storage housekeeping. A dump that outlives the retention window keeps erased IPs in plaintext and makes the 30-day promise false.

### P0 — with `server/http` — send a Content-Security-Policy header — `src/server/http`

Raised by independent review 2026-09-04: React's escaping is currently the only XSS defence, and it is defeated by a single bad line. A CSP survives one. `script-src 'self'` without `'unsafe-inline'` is compatible with Vite's hashed output, so this does not need the policy loosened to work. Build it with `server/http`, not as a later hardening pass. Rule recorded in `docs/PATTERNS/untrusted-content-rendering.md`.

### P0 — before the moderation floor — bootstrap the first admin — `src/db/`

Nothing in the application can create the first admin: `bans.created_by` and `moderation_actions.actor_id` both require an existing admin row. Needs a seed migration or a documented manual `UPDATE users SET is_admin = true`. Surfaced by the 2026-09-04 data model review.

**Reclassified 2026-09-05** from "before walking skeleton". It never blocked the skeleton — that feature touches no admin, no bans and no moderation actions, and migrates only `users`/`rooms`/`messages`. The misfiling was identified verbally during the skeleton design and left unedited for three rounds, formally blocking implementation the whole time.

### P0 — before public launch — implement the moderation floor — `src/server/moderation`

Report button, admin remove/ban, IP + timestamp logging (retention: 30 days), published abuse contact. All four are non-deferrable per `docs/CONTEXT.md` and now atomic requirements in `docs/REQUIREMENTS/`.

### P0 — before public launch — choose and implement rate limiting — `docs/TECHSTACK.md`

No library chosen. Public-launch gate.

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
