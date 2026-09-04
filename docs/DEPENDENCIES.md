# Dependencies

All entries: **PLANNED** (no versions pinned; versions to be pinned at install).

## Runtime

| Package | Purpose | Status |
|---|---|---|
| Node.js | Runtime | PLANNED |

## Production dependencies

| Package | Purpose | Version | Status |
|---|---|---|---|
| `express` | HTTP framework **[USER-DECIDED]** | to be pinned at install | PLANNED |
| `ws` | WebSocket support | to be pinned at install | PLANNED |
| `pg` | PostgreSQL client | to be pinned at install | PLANNED |
| `jsonwebtoken` | JWT signing/verification for session cookies | to be pinned at install | PLANNED |
| `bcrypt` | Password hashing, cost factor 12 **[USER-DECIDED]** | to be pinned at install | PLANNED |
| `cookie-parser` | Cookie parsing middleware for Express — closes the gap where `docs/PATTERNS/jwt-session-cookies.md` assumed `req.cookies` with no middleware listed **[USER-DECIDED]** | to be pinned at install | PLANNED |

## Development dependencies

| Package | Purpose | Version | Status |
|---|---|---|---|
| `typescript` | Source language and compiler **[USER-DECIDED — 2026-09-04]** | **`^5.9.3` — pin 5.x, not `latest`** (see `docs/TECHSTACK.md` constraints) | PLANNED |
| `@types/node` | Node type definitions | to be pinned at install | PLANNED |
| `@types/express`, `@types/ws`, `@types/pg`, `@types/jsonwebtoken`, `@types/bcrypt`, `@types/cookie-parser` | Type definitions for the production dependencies above | to be pinned at install | PLANNED |
| test framework | (TBD — likely jest or mocha; must run against TypeScript) | to be pinned at install | PLANNED |
| linter | (TBD — likely eslint) | to be pinned at install | PLANNED |

## Infrastructure

| Component | Purpose | Status |
|---|---|---|
| Caddy | Reverse proxy & TLS | PLANNED (installed on droplet, not npm) |
| PostgreSQL | Database server | PLANNED (installed on droplet, not npm) |
| systemd | Process supervision | PLANNED (OS-provided, not npm) |

## Notes

- No database ORM planned; raw `pg` queries initially.
- Session state: signed JWT cookies (no server-side session table).
- WebSocket rooms: in-process `Map` only (single instance).
