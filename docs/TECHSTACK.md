# Tech Stack

All entries: **PLANNED** (no code or infrastructure exists yet).

## Runtime & HTTP

| Component | Choice | Status |
|---|---|---|
| Node.js runtime | LTS current (to be pinned at install) | PLANNED |
| Source language | **TypeScript** **[USER-DECIDED — 2026-09-04]** | PLANNED |
| Build | `tsc` to `dist/`; systemd runs the compiled output, not the sources | PLANNED |
| TypeScript version | **Pin the 5.x line (5.9.3 verified). Do NOT take `latest`.** | PLANNED |
| HTTP framework | Express **[USER-DECIDED]** | PLANNED |
| WebSocket library | `ws` | PLANNED |

## Database

| Component | Choice | Status |
|---|---|---|
| Database | Self-hosted PostgreSQL on DigitalOcean droplet | PLANNED |
| Connection pooling | (TBD at install) | PLANNED |
| Migrations | `node-pg-migrate` **[USER-DECIDED — 2026-09-04]** — plain SQL on the same `pg` driver, no query builder, no ORM | PLANNED |
| Session storage | Signed JWT cookies; no server-side session table | PLANNED |
| Password hashing | bcrypt, cost factor 12 **[USER-DECIDED]** | PLANNED |
| Cookie parsing | `cookie-parser` (Express) **[USER-DECIDED]** | PLANNED |

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
| Static client | Served from Node HTTP server | PLANNED |
| WebSocket rooms | In-process `Map<roomId, Set<socket>>` (single instance only) | PLANNED |
| Presence state | Derived from live WebSocket connections | PLANNED |

## Constraints

- **`npm install typescript` without a version range now resolves to 7.x, the native Go port.** Its package ships `lib/tsc.js` only — no `tsserver.js`, no `typescript.js`. `typescript-language-server` fails at initialize against it, and any tool expecting the classic JS compiler API does too. Verified 2026-09-04. Pin `typescript@5`.

- **One instance only:** in-process room state cannot scale to multiple droplets without Redis pub/sub adapter.
- **Neon rejected:** 100 CU-hours/month free tier suspends compute mid-month for always-on apps.
- **Domain:** free subdomain (DuckDNS-style) during the gated phase; real registered domain required before public launch (abuse contact must be genuine and stable). **[USER-DECIDED]**
