# TODO

Actionable work items not yet started. Decisions and unknowns belong in `docs/ASSUMPTIONS.md`; completed work belongs in `agents/IMPLEMENTATION.md`.
Each entry: an h3 header of the form `PRIORITY — WHEN — WHAT — WHERE`, with details in the body.
Style: terse, one item per header, grep-friendly.

An item leaves this file when it is done (→ `agents/IMPLEMENTATION.md`) or when it turns out to be an open decision (→ `docs/ASSUMPTIONS.md`).

## Blocking the first line of code

### P0 — before walking skeleton — establish the cost-recording habit — `docs/EVALUATION-LOG.md`

Per-feature token and wall-clock cost, plus with/without-Rosetta marking. Required by `docs/CONTEXT.md` evaluation guardrails. **Resolved (Phase 8): home is `docs/EVALUATION-LOG.md`, append-only, one row per feature.** Habit still needs to be exercised starting with the first feature.

## Blocking deployment (gated)

### P1 — with the deploy job — name the client artifact by the head SHA — `.github/workflows/ci.yml`

On `pull_request` events `github.sha` is the ephemeral merge commit, so the artifact uploaded by the build job is `client-<merge sha>` — a commit that exists in no branch.

**Reprioritized 2026-09-08 (gated-deploy design), P1 → P2, and the justification rewritten, not merely re-ordered.** The gated-deploy workflow (`.github/workflows/deploy.yml`) does not consume CI's artifact at all — it rebuilds on its own runner (`plans/gated-deploy/architecture-notes.md` §3.1–§3.2), so this defect cannot cause a deploy lookup failure; that was the original justification and it is now false. The item survives for a different, smaller reason: CI's artifact remains the human-facing record of "what did this PR build," and naming it after a commit that exists in no branch is misleading to a person reading the Actions UI, not to a machine. Fix: `client-${{ github.event.pull_request.head.sha || github.sha }}`.

### P1 — on the first PR after this merges — prove the AI reviewer actually reviews — `.github/workflows/claude-code-review.yml`

**It never has.** Three test PRs on 2026-09-08 all produced a green `claude-review` check with no review: two were skipped by the action's workflow validation (the file must match the version on the **default branch**, which then had no Claude workflows at all), and the third died on `claude-code-action#1290`. The default branch is now `develop` and the plugin config is removed, but a check that reports SUCCESS when it skips cannot be trusted on appearance. Confirm on the first PR that touches no workflow file: the job should take minutes, not seconds, and should comment. A deliberate defect that passes lint and typecheck — a socket added to a room `Set` with no close/error cleanup — is the cheapest probe.

### P2 — before public launch — the Claude workflows have no fork or draft guard — `.github/workflows/`

The vendor-generated workflows were kept over guarded alternatives **[USER-DECIDED — 2026-09-08]**. Consequence on a **public** repository: a pull request from a stranger's fork triggers them, and GitHub withholds secrets from fork runs, so the checks fail on every outside contribution. Draft PRs are also reviewed, which spends tokens on unfinished work. Neither is a required check, so neither blocks a merge. Revisit if outside PRs ever arrive.

### P1 — before gated deploy — verify `bcrypt` loads on the droplet — `docs/DEPENDENCIES.md`

**Rationale corrected 2026-09-08 (gated-deploy plan review); the action item survives, the reasoning it used to carry does not.** The previous wording asserted two things, both wrong: that npm 11 blocks install scripts by default (it is npm v12 that will; npm 11.16+ only warns — `agents/TEMP/gated-deploy/discovery-notes.md` §6), and that `bcrypt` depends on a prebuilt binary happening to exist for the target architecture (`bcrypt@6.0.0`, the version pinned here, dropped `node-pre-gyp` for `prebuildify` and ships prebuilt binaries — including `linux-x64/bcrypt.glibc.node`, which matches an Ubuntu 24.04 droplet — inside the package tarball itself; no install script runs for it on any platform). What is genuinely still open: nobody has run `require('bcrypt').hashSync(...)` on the real droplet's OS/arch/glibc combination. `.github/workflows/deploy.yml` now runs that exact smoke test on the new release before every stop/flip (`plans/gated-deploy/architecture-notes.md` §3.4), so the check is automated going forward — but it has not yet executed on real hardware, because no droplet exists (**[HOST]**, blocked on the runbook). Do not mark this done before that first real run.

### P0 — before gated deploy — trust the proxy for client IPs — `src/server`

**Closed by code, 2026-09-08.** `src/server/net/client-ip.ts` (`extractClientIp`) trusts `X-Forwarded-For` only when the immediate TCP peer is loopback, wired into the WebSocket upgrade path at `src/server/ws/upgrade.ts:96`; `deploy/Caddyfile` replaces (not appends) the header with the real peer. See `docs/ARCHITECTURE.md` "Trusted-proxy client IP". Local behaviour is test-covered; the end-to-end proof that a real public IP (not `127.0.0.1`) lands in `messages.ip` is a runbook step against the live host (**[HOST]**, not yet run).

### P1 — before gated deploy — implement the launch gate — `docs/ARCHITECTURE.md`

**Closed by code, 2026-09-08.** `deploy/Caddyfile` enforces `basic_auth` above the application in a contiguous, deletable block, per the Phase 8 resolution (Caddy basic auth, no application code). Applying the config to a live Caddy instance is a runbook step (**[HOST]**, not yet run).

### P1 — before gated deploy — set up a free subdomain (DuckDNS-style) — `docs/ARCHITECTURE.md`

Resolved (Phase 8): free subdomain sufficient for the gated phase. `docs/RUNBOOK-gated-deploy.md` now documents the exact procedure (create the subdomain, point the A record, verify off-host resolution before touching Caddy), but nothing in this repository performs it — it is a host action with no code artifact. **Not closed here**; closes only when the owner executes that runbook step.

### P0 — before public launch — register a real domain — `gain.json`, `docs/ARCHITECTURE.md`

**Blocking item.** Required before anonymous public access opens: the published abuse contact address must be genuine and stable, which a free subdomain does not satisfy.

## Blocking anonymous public access

### P1 — when the moderation migration lands — wire the `bans.ip` retention statement in for real — `src/db/retention.ts`

**New, 2026-09-08.** The retention task's second statement (`bans.ip → NULL`) is guarded on `to_regclass('bans')` because `bans` has no migration yet (`src/db/migrations/1757800001_users_rooms_messages.sql` says so in its own comment) — landing it unguarded would abort the whole retention transaction on the missing relation and erase nothing, forever, while reporting success. The guard is deliberate and correct for now, but it becomes a permanent silent gap if nobody removes it once `bans` exists. When the moderation floor's migration ships: drop the guard (or verify it now always resolves true) and confirm `AC-RET-3`'s "table exists" branch actually runs against a real `bans` row, not just the guarded branch.

### P1 — before public launch — no hard-delete path for message bodies — `src/server/moderation`

Known limitation, accepted at the 2026-09-04 data model review. Moderation removal is a soft delete (`messages.deleted_at`), so a removed message keeps its body. A legal takedown or an erasure request would need a genuine delete. Not a blocker behind the Caddy gate.

### P1 — before public launch — cap `pg_dump` retention at 30 days — `docs/ARCHITECTURE.md`

Privacy control, not storage housekeeping. A dump that outlives the retention window keeps erased IPs in plaintext and makes the 30-day promise false.

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

### P1 — before the write-up — fold two recorded chunks into the synthesis — `docs/EVALUATION-FINDINGS.md`

`docs/EVALUATION-SESSIONS/2026-09-08-ci-and-ai-review.md` and `2026-09-08-gated-deploy.md` are captured in full but **not yet synthesized** into the thematic findings. The session records report; `EVALUATION-FINDINGS.md` argues. Two themes look ready to state and are not yet written up: (1) execution and inspection find **disjoint** defect sets in this codebase, now observed three times; (2) a recurring defect shape — a claim true as written and false in fact, because the check and the claim look at different things — with four instances in one chunk. Protocol: `docs/EVALUATION-METHOD.md`.

### P1 — after accounts ship — run the no-Rosetta baseline feature — `agents/IMPLEMENTATION.md`

1:1 DM, built with plain Claude Code. **Do not pre-design it** — no specs, schema, endpoints, or plans before the baseline run. See `docs/CONTEXT.md`.

### P2 — after code exists — re-run pattern extraction — `docs/PATTERNS/INDEX.md`

Current patterns are prescribed, not extracted. Re-derive from actual usage (2+ occurrences). **Checked 2026-09-08 (gated-deploy chunk): no new pattern qualifies.** The client-IP extractor, the retention sweep and the deploy/systemd artifacts are each a single occurrence in this codebase — extracting a pattern from one instance would be prescription again, not extraction.

### P2 — after deploy — verify real monthly cost against estimate — `agents/IMPLEMENTATION.md`

$6 droplet + domain. Neither provisioned nor priced in full.
