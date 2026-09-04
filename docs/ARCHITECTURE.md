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
- **Lifetimes: 24 hours for a guest, 30 days for a registered user. [USER-DECIDED — 2026-09-04]** There is no refresh-token flow, so expiry logs the user out mid-conversation — a day covers any realistic guest visit, and 30 days matches what a chat product normally does.
- The guest lifetime is **load-bearing beyond sessions**: the maintenance task reaps guest `users` rows whose `last_seen_at` is older than it, so it also decides when a guest nickname returns to the pool.
- No refresh-token flow. Re-auth on expiry is accepted.
- Full rule and template: `docs/PATTERNS/jwt-session-cookies.md`.

## WebSocket and presence design

**[USER-DECIDED]**

- Rooms live in process memory as `Map<roomId, Set<WebSocket>>`. Fan-out iterates the `Set`.
- Presence roster is **derived at read time** from the live `Set`. No separate counter — a counter drifts.
- **Disconnect cleanup is the core correctness requirement**, not an optimization: a socket removed from the room `Set` on `close` and `error`, and the `Set` deleted when empty. Skipping it produces ghost users in presence and throws on broadcast to closed sockets. This is the known bug class for this design.
- Broadcast guards `readyState` on every send.
- Full rule and template: `docs/PATTERNS/websocket-room-fanout.md`.

## Data model — APPROVED

**[USER-DECIDED — reviewed and approved 2026-09-04. Supersedes the AI-invented DRAFT sketch.]**

Reviewed table by table against the requirements in `docs/CONTEXT.md`. Four defects in the draft were found and fixed; each fix carries its reason below so it is not silently reverted.

Access is via parameterized `pg` queries only. No ORM. See `docs/PATTERNS/parameterized-pg-queries.md`.

**No direct-message tables exist here, deliberately.** 1:1 DM is the reserved no-Rosetta baseline feature and must not be pre-designed. See `docs/CONTEXT.md` evaluation guardrails.

```sql
CREATE TABLE users (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  nickname      text NOT NULL,
  password_hash text,                                  -- NULL for guests
  is_guest      boolean NOT NULL DEFAULT true,
  is_admin      boolean NOT NULL DEFAULT false,
  created_at    timestamptz NOT NULL DEFAULT now(),
  last_seen_at  timestamptz NOT NULL DEFAULT now(),
  banned_at     timestamptz,                           -- account ban; IP ban lives in bans
  CONSTRAINT registered_users_have_a_password CHECK (is_guest OR password_hash IS NOT NULL)
);
CREATE UNIQUE INDEX users_nickname_key   ON users (lower(nickname));
CREATE        INDEX users_guest_reap_idx ON users (last_seen_at) WHERE is_guest;

CREATE TABLE rooms (
  id         uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name       text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX rooms_name_key ON rooms (lower(name));

CREATE TABLE messages (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  room_id         uuid NOT NULL REFERENCES rooms(id),
  author_id       uuid REFERENCES users(id) ON DELETE SET NULL,
  author_nickname text NOT NULL,                       -- snapshot; survives guest reaping
  body            text NOT NULL,
  ip              inet,                                -- nulled at 30 days, row kept
  created_at      timestamptz NOT NULL DEFAULT now(),
  deleted_at      timestamptz                          -- soft delete, auditable
);
CREATE INDEX messages_room_history_idx ON messages (room_id, created_at DESC);
CREATE INDEX messages_ip_purge_idx     ON messages (created_at) WHERE ip IS NOT NULL;

CREATE TABLE bans (
  id         uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  ip         inet,                                     -- nulled 30 days after expires_at
  reason     text NOT NULL,
  created_by uuid NOT NULL REFERENCES users(id),
  created_at timestamptz NOT NULL DEFAULT now(),
  expires_at timestamptz NOT NULL,
  CONSTRAINT ban_expires_after_creation CHECK (expires_at > created_at)
);
CREATE INDEX bans_active_idx ON bans (ip, expires_at);

CREATE TABLE reports (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  message_id  uuid NOT NULL REFERENCES messages(id),
  reporter_id uuid REFERENCES users(id) ON DELETE SET NULL,
  reason      text NOT NULL,
  created_at  timestamptz NOT NULL DEFAULT now(),
  resolved_at timestamptz
);
CREATE INDEX reports_open_idx ON reports (created_at) WHERE resolved_at IS NULL;

CREATE TABLE moderation_actions (
  id                uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  actor_id          uuid NOT NULL REFERENCES users(id),
  action            text NOT NULL
                    CHECK (action IN ('remove_message','ban_ip','ban_account','unban')),
  target_message_id uuid REFERENCES messages(id),
  target_user_id    uuid REFERENCES users(id) ON DELETE SET NULL,
  target_ban_id     uuid REFERENCES bans(id),
  target_nickname   text,                              -- snapshot, same reason as messages
  note              text,
  created_at        timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT exactly_one_target CHECK (
    (target_message_id IS NOT NULL)::int
  + (target_user_id    IS NOT NULL)::int
  + (target_ban_id     IS NOT NULL)::int = 1)
);
```

### Decisions and their reasons

**Guests get a `users` row**, flagged `is_guest`. This reverses the draft's "guests have no `users` row". Reasons: authorship gets a real foreign key instead of a polymorphic column; nickname uniqueness becomes one database constraint covering guests and accounts alike; guest upgrade becomes a flag flip on an existing row, which preserves nickname and room membership as `docs/CONTEXT.md` requires. Cost: one write per guest join. This does **not** contradict the stateless session model — an identity row is not a session table, and the JWT remains the only session mechanism.

**Bans are by IP, in their own table, and time-limited.** A `users.banned_at` alone cannot satisfy the moderation floor, because a banned guest simply rejoins. `banned_at` is retained for account bans; `bans` covers the rejoin. Known weakness, accepted: an IP ban is a speed bump against a mobile network or a VPN, and can catch a shared address — which is why bans expire.

**A guest cannot take a registered nickname.** Enforced by `users_nickname_key`, which is case-insensitive: `Alice` and `alice` collide. Without case folding the impersonation vector stays open.

**`author_nickname` is a snapshot.** Guest rows are reaped when the session expires, which sets `author_id` to null. Without the snapshot every message older than one session would show no author, and moderation would read anonymous history.

**`users.is_admin` was absent from the draft entirely.** Nothing could perform a removal or a ban without it.

**Message ids are `uuid`.** Ids are exposed to clients by the report button; a sequential id would leak message volume and allow enumeration.

**`rooms` exists from the first migration** although the walking skeleton uses one room, so `messages.room_id` is a correct foreign key from the start and needs no backfill.

**`moderation_actions` uses three nullable target columns** with an `exactly_one_target` check, rather than one polymorphic column, so every target keeps referential integrity.

### Retention rule

**An IP address is retained only while it is operationally needed, then erased. The record it belongs to survives.**

| Record | IP kept while | Then |
|---|---|---|
| `messages` | 30 days | `ip` set to NULL, message kept |
| `bans` | the ban is active, plus 30 days | `ip` set to NULL, ban row kept for audit |

Nulling is a hard erase of the value, not a soft delete. `deleted_at` on `messages` is the soft one — a removed message keeps its body so moderation stays auditable.

**This promise is bounded by backup retention**, which is capped at 30 days for exactly this reason — see "Backups" below. The two must be changed together or not at all.

Known limitation, accepted for now: because removal is a soft delete, there is no path that genuinely erases a message body. A legal takedown or an erasure request would need one. Logged in `docs/TODO.md`.

### Repeat-offender escalation — documented, not built

Erasing ban IPs means the system cannot see that an address has been banned before, so escalation on repeat offences is impossible.

The path, if it is ever wanted: store `hmac(ip, server_secret)` alongside the address. Exact-match ban lookups work on the hash, so correlation survives the address being erased. **Do not build it speculatively** — same reasoning as the Redis pub/sub adapter below.

## Deployment topology

**[USER-DECIDED — supersedes `POC-BRIEF.md` on droplet size and database]**

```
internet → Caddy (:443, auto TLS, basic auth gate) → Node process (:3000, HTTP + WS)
                                                          └→ PostgreSQL (localhost:5432, same droplet)
```

- Droplet: **$6/mo, 1 GB RAM, 1 vCPU, 25 GB SSD, 1 TB transfer**, plus **2 GB swap**. Not $4/512 MB — 512 MB is not viable once Postgres is co-hosted.
- Upgrade path if memory pressure appears: **$12/mo, 2 GB RAM**. Decided in advance so it is not re-argued under load.
- systemd units for Node and Postgres; Caddy under its own service. The Node unit runs **compiled JavaScript from `dist/`**, never TypeScript sources — the build is a deploy-time step, not a runtime one. **[USER-DECIDED — 2026-09-04]**
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
- **Retention capped at 30 days. [USER-DECIDED — 2026-09-04]** This is a privacy control, not a storage decision. A dump taken while an IP was still live keeps that IP in plaintext forever, so the 30-day retention rule in the data model above is only true if no dump outlives it. The cap and the retention rule must be changed together or not at all.
- Rejected alternative: keep older dumps and scrub IPs out of them. More code, runs offline, fails silently.
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
