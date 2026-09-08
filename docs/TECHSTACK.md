# Tech Stack

Entries marked **PLANNED** are decided-and-unbuilt. Entries marked **IMPLEMENTED** are exercised by the walking skeleton (`agents/IMPLEMENTATION.md`, 2026-09-08). Infrastructure (droplet, TLS, CI) remains PLANNED regardless of code status.

## Runtime & HTTP

| Component | Choice | Status |
|---|---|---|
| Node.js runtime | **Node 24** — pinned in `.nvmrc` and `package.json` engines `>=24 <25` **[USER-DECIDED — 2026-09-04]** | SCAFFOLDED |
| Source language | **TypeScript 5.9.3, ESM** (`"type": "module"`, `module: nodenext`) **[USER-DECIDED — 2026-09-04]** | SCAFFOLDED |
| Build | `tsc` to `dist/`; systemd runs the compiled output, not the sources | PLANNED |
| TypeScript version | **Pin the 5.x line (5.9.3 verified). Do NOT take `latest`.** | PLANNED |
| HTTP framework | Express **[USER-DECIDED]** | IMPLEMENTED |
| WebSocket library | `ws` | IMPLEMENTED |

## Database

| Component | Choice | Status |
|---|---|---|
| Database | Self-hosted **PostgreSQL 17** on DigitalOcean droplet | PLANNED |
| Local dev/test database | **Docker Compose**, `compose.yml` pinning PostgreSQL 17 **[USER-DECIDED — 2026-09-07]**. Must match the droplet's major version | PLANNED |
| Connection pooling | `max: 10`, `idleTimeoutMillis: 30_000`, `connectionTimeoutMillis: 5_000` **[USER-DECIDED — 2026-09-05]** | PLANNED |
| Migrations | `node-pg-migrate` **[USER-DECIDED — 2026-09-04]** — plain SQL on the same `pg` driver, no query builder, no ORM | IMPLEMENTED |
| Session storage | Signed JWT cookies; no server-side session table | IMPLEMENTED |
| Password hashing | bcrypt, cost factor 12 **[USER-DECIDED]** | PLANNED |
| Cookie parsing | `cookie-parser` (Express) **[USER-DECIDED]** | IMPLEMENTED |

## Infrastructure & Deployment

| Component | Choice | Status |
|---|---|---|
| Host | DigitalOcean droplet: $6/mo, 1 GB RAM, 2 GB swap, 25 GB SSD | PLANNED |
| Reverse proxy & TLS | Caddy (automatic HTTPS certificates) | PLANNED |
| Process supervision | systemd | PLANNED |
| Secrets management | systemd EnvironmentFile (choice pending) | PLANNED |
| CI/CD | GitHub Actions | PLANNED |

## Client

| Component | Choice | Status |
|---|---|---|
| Client framework | **React 19.2.8** **[USER-DECIDED — 2026-09-04]** | SCAFFOLDED |
| Client build | **Vite 8.2.2** → `dist/client`, served statically by Express. Build-time only; must run in CI, not on the droplet | SCAFFOLDED |
| Static client | Built output served from the Node HTTP server | SCAFFOLDED |
| WebSocket rooms | In-process `Map<roomId, Set<socket>>` (single instance only) | PLANNED |
| Presence state | Derived from live WebSocket connections | PLANNED |

## Constraints

- **`npm install typescript` without a version range now resolves to 7.x, the native Go port.** Its package ships `lib/tsc.js` only — no `tsserver.js`, no `typescript.js`. `typescript-language-server` fails at initialize against it, and any tool expecting the classic JS compiler API does too. Verified 2026-09-04. Pin `typescript@5`.

- **One instance only:** in-process room state cannot scale to multiple droplets without Redis pub/sub adapter.
- **Neon rejected:** 100 CU-hours/month free tier suspends compute mid-month for always-on apps.
- **Domain:** free subdomain (DuckDNS-style) during the gated phase; real registered domain required before public launch (abuse contact must be genuine and stable). **[USER-DECIDED]**
