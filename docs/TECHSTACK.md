# Tech Stack

All entries: **PLANNED** (no code or infrastructure exists yet).

## Runtime & HTTP

| Component | Choice | Status |
|---|---|---|
| Node.js runtime | LTS current (to be pinned at install) | PLANNED |
| HTTP framework | Express **[USER-DECIDED]** | PLANNED |
| WebSocket library | `ws` | PLANNED |

## Database

| Component | Choice | Status |
|---|---|---|
| Database | Self-hosted PostgreSQL on DigitalOcean droplet | PLANNED |
| Connection pooling | (TBD at install) | PLANNED |
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

- **One instance only:** in-process room state cannot scale to multiple droplets without Redis pub/sub adapter.
- **Neon rejected:** 100 CU-hours/month free tier suspends compute mid-month for always-on apps.
- **Domain:** free subdomain (DuckDNS-style) during the gated phase; real registered domain required before public launch (abuse contact must be genuine and stable). **[USER-DECIDED]**
