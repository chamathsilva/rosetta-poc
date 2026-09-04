# ARCHITECTURE

Architecture and technical requirements: modules, structure, data model, runtime design, deployment topology, rejected alternatives.
No business context — see `docs/CONTEXT.md`. File layout — see `docs/CODEMAP.md`. Versions and packages — `docs/TECHSTACK.md`, `docs/DEPENDENCIES.md`. Coding conventions — `docs/PATTERNS/INDEX.md`.
Style: terse, decision-first, each decision carries its reason so it is not silently reverted.

**Nothing here is built.** All of it is decided-and-unbuilt. Provenance: **[USER-DECIDED]** = from `POC-BRIEF.md` or the user this session. **[AI-INFERRED]** = derived by an agent, unverified.

## Shape

**[USER-DECIDED]**

A **single Node.js process** on a **single DigitalOcean droplet**, serving the static client, the HTTP API, and the WebSocket endpoint. **PostgreSQL is self-hosted on the same droplet.** Caddy terminates TLS in front of it. systemd supervises.

One process. One host. One database. No queue, no cache tier, no pub/sub, no CDN.

## HTTP framework

**[USER-DECIDED]**

**Express.** No longer an open choice (supersedes the "Express or Fastify" framing in `docs/TECHSTACK.md`'s prior state). Rationale: stack conventionality keeps the evaluation variable clean — same reasoning `POC-BRIEF.md` gives for rejecting Cloudflare Workers, applied consistently to framework choice.

## Password hashing

**[USER-DECIDED]**

**bcrypt, cost factor 12.** Argon2id's default 64 MB per hash, multiplied by concurrent logins, is an OOM risk on a 1 GB droplet co-hosting Postgres, Node and Caddy. bcrypt is memory-light and OWASP-acceptable.

## Modules

**[AI-INFERRED — decomposition is an agent proposal; endorsed by `docs/CODEMAP.md` but unbuilt]**

| Module | Responsibility |
|---|---|
| `server/http` | Static client, REST endpoints (join, register, login, report), health check |
| `server/ws` | WebSocket upgrade, message routing, room fan-out, presence |
| `server/session` | JWT issue/verify, guest→registered upgrade |
| `server/rooms` | In-process `Map<roomId, Set<socket>>` — membership, broadcast, presence roster |
| `server/moderation` | Report intake, admin remove/ban, audit log |
| `db` | `pg` pool, schema, migrations |
| `client` | Static HTML/CSS/JS, WebSocket client |

Boundary rule: `rooms` is process-local and volatile; `db` is durable. Nothing in `rooms` may be the only copy of anything that matters after a restart.

## Session model

**[USER-DECIDED]**

- Stateless. Signed JWT in an `httpOnly`, `secure`, `sameSite` cookie. **No server-side session table.**
- Guest and registered identity use the **same cookie and claim mechanism**, distinguished by a `type` claim. This is what makes guest upgrade a claim rewrite rather than a session migration.
- Every read of identity verifies signature and expiry. Never decode-only.
- No refresh-token flow. Re-auth on expiry is accepted.
- Full rule and template: `docs/PATTERNS/jwt-session-cookies.md`.

## WebSocket and presence design

**[USER-DECIDED]**

- Rooms live in process memory as `Map<roomId, Set<WebSocket>>`. Fan-out iterates the `Set`.
- Presence roster is **derived at read time** from the live `Set`. No separate counter — a counter drifts.
- **Disconnect cleanup is the core correctness requirement**, not an optimization: a socket removed from the room `Set` on `close` and `error`, and the `Set` deleted when empty. Skipping it produces ghost users in presence and throws on broadcast to closed sockets. This is the known bug class for this design.
- Broadcast guards `readyState` on every send.
- Full rule and template: `docs/PATTERNS/websocket-room-fanout.md`.

## Data model sketch — DRAFT, UNAPPROVED

**[AI-INFERRED — no schema has been written or reviewed by a human]**

**DRAFT. This table is AI-invented, not human-approved.** It requires explicit human review before any migration is written in `src/db/`. Do not treat its presence here as authorization to implement it. Do not delete it, do not promote it out of draft status without that review.

| Table | Purpose | Notes |
|---|---|---|
| `users` | Registered accounts | nickname (unique), password hash, created_at, banned_at |
| `rooms` | Room catalog | name, created_at. Membership is NOT here — it is in-process |
| `messages` | Message history | room_id, author (user_id or guest nickname), body, created_at, ip, deleted_at |
| `reports` | Moderation intake | message_id, reporter, reason, created_at, resolved_at |
| `moderation_actions` | Admin audit log | actor, action (remove/ban), target, created_at |

- Guests have no `users` row. Guest identity exists only in the JWT claim.
- `messages.ip` + `created_at` satisfy the IP/timestamp logging requirement in `docs/CONTEXT.md`. **Retention: 30 days.** **[USER-DECIDED]**
- Soft-delete (`deleted_at`) rather than hard delete, so moderation is auditable.
- Access is via parameterized `pg` queries only. No ORM. See `docs/PATTERNS/parameterized-pg-queries.md`.

## Deployment topology

**[USER-DECIDED — supersedes `POC-BRIEF.md` on droplet size and database]**

```
internet → Caddy (:443, auto TLS, basic auth gate) → Node process (:3000, HTTP + WS)
                                                          └→ PostgreSQL (localhost:5432, same droplet)
```

- Droplet: **$6/mo, 1 GB RAM, 1 vCPU, 25 GB SSD, 1 TB transfer**, plus **2 GB swap**. Not $4/512 MB — 512 MB is not viable once Postgres is co-hosted.
- Upgrade path if memory pressure appears: **$12/mo, 2 GB RAM**. Decided in advance so it is not re-argued under load.
- systemd units for Node and Postgres; Caddy under its own service.
- **Pre-moderation gate: Caddy basic auth**, enforced in the reverse proxy, above the application — no application code implements it. Removing it at public launch is a Caddy config change, not a code change. **[USER-DECIDED]**
- Secrets via systemd `EnvironmentFile`, read as `process.env`, fail-fast on missing required vars. See `docs/PATTERNS/env-config-secrets.md`.
- Not provisioned yet. Do not provision before the walking skeleton is ready to deploy.

### Domain

**[USER-DECIDED]**

- **Gated phase**: a free subdomain (DuckDNS-style) is sufficient — Caddy's automatic TLS just needs something to resolve to the droplet.
- **Before public launch**: a real registered domain is required, because the published abuse contact address (moderation floor) must be genuine and stable — a free subdomain does not satisfy that.
- This is a blocking item before anonymous public access opens; see `docs/TODO.md`.

## Backups — an owned deliverable

**[USER-DECIDED — new obligation created by dropping Neon]**

Self-hosting Postgres means backups are ours. This is not optional and not a later nicety:

- Scheduled `pg_dump`.
- A **tested restore**. An untested backup is not a backup. The restore drill is the deliverable, not the dump script.
- Currently unproven — logged in `docs/ASSUMPTIONS.md`.

## Capacity ceiling: single instance

**[USER-DECIDED — accepted limitation, with a known migration path]**

In-process room state means **exactly one application instance**. A second instance breaks WebSocket fan-out: users connected to different instances would not see each other's messages or presence.

This is a documented capacity ceiling, not an unknown:

- **Ceiling**: whatever concurrent WebSocket connections one 1 GB droplet sustains alongside Postgres. Not measured. Measuring it is a real task, not a guess.
- **Migration path when the ceiling is hit**: introduce a **Redis pub/sub adapter** so room fan-out crosses instances, then run multiple instances behind a load balancer with sticky or stateless WS routing. The `rooms` module is the only component that changes.
- **Do not build the adapter speculatively.** The path is documented so that hitting the ceiling is a scheduled migration rather than a surprise redesign.

## Rejected alternatives — do not silently revert

**[USER-DECIDED]**

### Cloudflare Workers + Durable Objects + D1 — REJECTED

The original design, deliberately abandoned. Two reasons:

1. **DO free tier is a knife-edge.** 13,000 GB-s/day ÷ 128 MB per DO ≈ 104,000 DO-seconds/day ≈ **1.2 continuously-active Durable Objects**. WebSocket Hibernation makes idle rooms free — but hibernation is fragile. A `setInterval` presence heartbeat, an alarm, or an outbound connection each defeat it, and all three are natural things to write for a chat app. Get it subtly wrong and the app tests fine, then dies hours into real use.
2. **Stack conventionality is an evaluation confound.** Workers + DO is niche. Mediocre generated code there could not be distinguished from *the model knowing Workers less well than Express* — which contaminates the exact variable this POC measures. Node + Postgres is also more representative of the enterprise SDLC Rosetta targets.

Note: request/socket volume was **not** the reason. ~2M messages/day was never a POC concern.

### D1 as the database for a Node server — REJECTED

Outside Workers, D1 is reachable only via Cloudflare's HTTP REST API: every query is an HTTPS round-trip, with no connection pooling and no session transactions. It is a Workers binding, not a remote database.

### Neon Postgres — REJECTED

**[Supersedes `POC-BRIEF.md`, which still specifies Neon.]** Free plan caps **100 CU-hours per project per month**. At the smallest compute size that is roughly 400 active hours against ~730 hours in a month. Hitting the cap **suspends compute until the next billing month**. Acceptable for intermittent testing; fatal for an always-on publicly-launched app. Other free-plan caps: 0.5 GB storage, 5 GB egress/month, scale-to-zero after 5 min idle.

### DigitalOcean managed PostgreSQL — REJECTED

Starts at **$15.15/mo**, 2.5× the droplet itself. Cost-disproportionate for this POC.

### Fly.io / Railway — NOT REJECTED, held in reserve

Still reasonable if the droplet's ops burden (TLS, systemd, patching, firewall, backups) becomes a distraction from the evaluation. Trade-off: less infra surface for Rosetta to govern — and ops is deliberately in scope as evaluation surface (`docs/CONTEXT.md`) — against finishing sooner.
