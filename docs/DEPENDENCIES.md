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
| test framework | (TBD — likely jest or mocha) | to be pinned at install | PLANNED |
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
