# Walking Skeleton — PLAN (HOW)

Sequencing and mechanics only. **WHAT** is `WALKING-SKELETON-SPECS.md`; **design** is `agents/TEMP/walking-skeleton/architecture-notes.md` (frozen; one authorised amendment 2026-09-07, noted in its header). Neither is restated here.

Read first: the design (whole), `docs/PATTERNS/` (all five), `docs/ARCHITECTURE.md` "Data model — APPROVED" + "Database connection pool", `docs/CONTEXT.md`.

Deviation: `planning` normally emits a session index, per-session files and `HANDOFF.md`; scoped to two files at MEDIUM. Outcomes → `agents/IMPLEMENTATION.md`, blockers → `docs/ASSUMPTIONS.md`.

## Build order

**B0 — contract, tooling & config (solo, blocks everything).**

1. **Runtime check first.** `.nvmrc` says 24; this shell runs v22.14.0. Add `.npmrc` with `engine-strict=true` so `npm` refuses to install on the wrong major (`engines` is `>=24 <25`), and begin every batch with `nvm use`. Enforcement, not intent — an engineer can otherwise build and test green on 22.
2. **Install and pin** `tsx`, `eslint`, `typescript-eslint` — all currently `PLANNED`/absent, so B1's `npm test` and any lint gate cannot run without this. **B0 owns `package-lock.json`**; no other batch may alter dependencies.
3. `eslint.config.js` — flat config, `typescript-eslint` recommended. None exists today.
4. `src/shared/protocol.ts` — wire types; the contract that makes B1/B2 parallel.
5. `tsconfig.client.json` — `rootDir` → `src`, add `src/shared/**/*.ts` to `include`. Both halves, or the client cannot import shared types (TS6059).
6. `vite.config.ts` — `server.proxy` for `/api` and `/ws` (`ws: true`) → `http://localhost:3000`.
7. `package.json` — `"migrate": "node-pg-migrate -m src/db/migrations"`; real `test` and `lint` scripts.
8. `.env.example` — stage `ALLOWED_ORIGIN` and `TEST_DATABASE_URL`. `REQUIRED` does not exist yet: `src/server/config.ts` (B1) must carry **`ALLOWED_ORIGIN`** from its first commit — see H-8. `TEST_DATABASE_URL` is documented in `.env.example` but deliberately **not** in `REQUIRED` (corrected 2026-09-07): it is consumed only by test/reset tooling, never by the running server, so it must not force production or force every unrelated test to fake one.
9. The 10 pattern-file edits (checklist below), **before** implementation, so both engineers read corrected templates.

**B1 — db + server** and **B2 — client** run in parallel after B0. **B3 — integration** is solo, after both.

## Batching

Parallel is right: the wire protocol fixes the contract and, after B0, the file sets are disjoint. B1 ∩ B2 = ∅.

| Batch | Owns |
|---|---|
| **B0** | `src/shared/protocol.ts`, `tsconfig.client.json`, `vite.config.ts`, `package.json`, `package-lock.json`, `.npmrc`, `eslint.config.js`, `.env.example`, `docs/PATTERNS/parameterized-pg-queries.md`, `docs/PATTERNS/jwt-session-cookies.md` |
| **B1** | `src/db/**`, `src/server/**`, server tests |
| **B2** | `src/client/**` |
| **B3** | `docs/EVALUATION-LOG.md`, `agents/IMPLEMENTATION.md` — verification plus the two completion records |

Neither B1 nor B2 may edit a B0 file; a needed change there is a stop-and-report, or the batches diverge on the contract.

Intra-B1 (leaf-first): `server/config.ts` → migrations → `db/pool.ts` → `db/queries/*` → `server/delivery.ts` → `server/rooms.ts` → `server/session.ts` → `server/ws/*` → `server/http/*` → `server/index.ts`.

- `config.ts` first: `pool`, `session`, `ws/upgrade` and `index` all call `loadConfig()`, and `REQUIRED` lives there.
- `rooms` imports `delivery`, never the reverse (design, declared deviation).
- `http/join.ts` verifies the cookie before inserting (SPECS API table, AC-15), so it needs `session.ts` — already satisfied: `session.ts` precedes `http/*` and always did.

## Migration mechanics

- Plain SQL, run **by extension**. `-j sql` applies only to `node-pg-migrate create`, never to running existing files.
- `-m src/db/migrations` is required to run them at all; the default resolves `migrations/` at the repo root. Without it migrations silently never run and startup fails at the lobby lookup with a misleading error.
- `001_users_rooms_messages.sql` — three tables only; intra-file order `users`, `rooms`, `messages` (it FKs both). Indexes per `docs/ARCHITECTURE.md` "Data model — APPROVED", verbatim.
- `002_seed_lobby.sql` — the `lobby` row, separate so schema stays pure DDL.
- `bans`, `reports`, `moderation_actions` are **not** migrated.

## Test database and reset safety

**Provisioning: Docker Compose. [USER-DECIDED — 2026-09-07]** `compose.yml` at the repo root, owned by **B0**, pinning **PostgreSQL 17** — the same major the droplet must install, so local and production cannot drift silently. Chosen over Homebrew and Postgres.app because the container is disposable and isolated, and the same file documents the version for the deploy. Bring-up is `docker compose up -d`; the B0 gate must confirm the container accepts a connection before B1 starts.

No Postgres client or server is installed on this machine, so the real-database gates are **currently unexecutable in this environment** until `docker compose up -d` is run somewhere Docker is available. The plan depends only on the contract below, so any Postgres reachable at `TEST_DATABASE_URL` satisfies it — the compose file is the decided mechanism, not the only one that could.

- **`TEST_DATABASE_URL`**, distinct from `DATABASE_URL`, documented in `.env.example`. **Not** in `src/server/config.ts`'s `REQUIRED`** (corrected 2026-09-07) — test/reset code reads `process.env['TEST_DATABASE_URL']` directly with its own local check. Tests and resets **never fall back** to `DATABASE_URL`.
- It must point at a **disposable database dedicated to tests** — its own database, or its own schema in one.
- **The reset refuses to run unless the target database name ends `_test`.** Mandatory, not advisory: a reset is destructive and `DATABASE_URL` may point at data someone cares about. The check is on the resolved connection target, not on which variable was read.
- B1 and B3 gates are blocked until provisioning lands. Record the chosen mechanism in `docs/ASSUMPTIONS.md`.

## Pattern-file edits

`docs/PATTERNS/parameterized-pg-queries.md` — [ ] § Template `ORDER BY created_at DESC, id DESC` · [ ] § Template widen first param to `Pool | PoolClient`

`docs/PATTERNS/jwt-session-cookies.md` — [ ] § Rule every session carries a real `users.id` · [ ] § Template `SessionClaims` guest gains `userId` · [ ] § Template `issueGuestSession(res, userId, nickname)` · [ ] § Template extract `verifySessionToken` + export `SESSION_COOKIE` · [ ] § Template runtime shape narrowing · [ ] § Template per-type cookie `maxAge` · [ ] § Template fourth load-bearing note (`author_id` nullable) · [ ] § Extension points `upgradeGuestToRegistered` reuses `existing.userId`

**Count: 10 (2 + 8).** Stated because it drifted twice — the design's §3 carries eight bullets (verified by grep), while earlier summaries said six.

## Verification gates

| Gate | Must pass |
|---|---|
| **B0** | `node -v` on 24; `npm ci` succeeds under `engine-strict`; `npm run lint` and `npm run typecheck` clean both configs; a client file importing `src/shared/protocol.ts` compiles (proves the TS6059 fix). |
| **B1** | Lint + `tsc -p tsconfig.json` clean; migrations apply empty→current against `TEST_DATABASE_URL`; server boots; `/api/join` sets a cookie; WS upgrade authenticates and refuses a bad `Origin`; B1 tests pass. |
| **B2** | Lint + `tsc -p tsconfig.client.json` clean; `npm run build:client` emits `dist/client`; join form and chat view render. |
| **B3** | SPECS AC-1…AC-19 (AC-16…AC-19 via tests), two concurrent clients, plus a server restart for AC-11; both completion records updated. |

## Test scope

`node:test` + `tsx`, all B1. First four are the design's minimum set; the last three cover mechanisms that would otherwise be undetectable if absent.

`src/server/session.test.ts` — claim verification, shape narrowing, rejection paths, **and expiry: close-timer arming plus the per-frame `exp` check (AC-16)** · `src/server/validation.test.ts` — §4 bounds at edges · `src/server/ws/batch.test.ts` — normalization, dedup, `(createdAt, id)` order, the 31-80/1-30 case · `src/server/rooms.test.ts` — membership; `leaveRoom` on close, error, terminate · `src/server/ws/admission.test.ts` — admission limit and `1013` vs `1011` (AC-17) · `src/server/ws/init-bounds.test.ts` — 1 MiB buffer cap and 32-frame inbound queue (AC-18) · `src/db/pool.test.ts` — `statement_timeout` path and `release(err)` not returning a busy connection (AC-19).

Client tests deliberately unspecified — the design's minimum set names server-side areas only. A decision, not an oversight; revisit if B3 proves thin.

## Ordering hazards

- **H-1** Migrations before any query path. Startup throws on a missing lobby row — correct, but the error names the room, not the missing `-m` flag.
- **H-2** `src/shared/protocol.ts` before both batches; it is the only thing making them parallel.
- **H-3** `tsconfig.client.json` before the client typechecks at all.
- **H-4** Pattern edits before implementation, or the narrow `Pool` signature is copied and re-creates the resource inversion.
- **H-5** `ALLOWED_ORIGIN` must be **Vite's dev origin** locally, not `:3000`. Wrong value presents as `403` on upgrade with a fully working page.
- **H-6** `delivery.ts` before `rooms.ts`; reversing the import reintroduces the module cycle.
- **H-7 — resolved.** Pool timeouts are ratified and `docs/ARCHITECTURE.md` "Database connection pool" already carries all five keys (edited 2026-09-07). `pool.ts` uses them verbatim; B1 must not edit that block, and a disagreement at the B1 gate is a stop-and-report with the block authoritative.
- **H-8** `.env.example` (B0) and `REQUIRED` in `config.ts` (B1) are two halves of one rule for **`ALLOWED_ORIGIN`** specifically, in **different batches** — the only cross-batch coupling here. If B1 omits it, the failure surfaces as H-5, one layer from the cause. `TEST_DATABASE_URL` is NOT part of this coupling (corrected 2026-09-07): it is documented in `.env.example` but intentionally excluded from `REQUIRED`, since only test/reset tooling consumes it.
- **H-9** Tooling before tests: `tsx` and `eslint` are absent today, so a B1 that starts before B0 step 2 cannot run its own gate.
