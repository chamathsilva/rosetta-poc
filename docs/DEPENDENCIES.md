# Dependencies

Versions below are **INSTALLED** as of 2026-09-04 and resolved from `package-lock.json`. Infrastructure entries remain PLANNED.

## Runtime

| Package | Purpose | Status |
|---|---|---|
| Node.js | Runtime — pinned to the 24 line (`.nvmrc`, `engines`). Verified on v24.20.0 | INSTALLED |

## Production dependencies

| Package | Purpose | Version | Status |
|---|---|---|---|
| `express` | HTTP framework **[USER-DECIDED]** | 5.2.1 | INSTALLED |
| `ws` | WebSocket support | 8.21.3 | INSTALLED |
| `pg` | PostgreSQL client | 8.23.0 | INSTALLED |
| `jsonwebtoken` | JWT signing/verification for session cookies | 9.0.3 | INSTALLED |
| `bcrypt` | Password hashing, cost factor 12 **[USER-DECIDED]**. Native module; ships a prebuilt binary, so it loads even though npm 11 blocks install scripts by default. Verified working at cost 12 on darwin-arm64 — **not yet verified on the droplet's architecture** | 6.0.0 | INSTALLED |
| `node-pg-migrate` | Database migrations **[USER-DECIDED — 2026-09-04]**. Production, not dev: the droplet runs migrations at deploy, so `npm ci --omit=dev` must still contain it | 8.0.4 | INSTALLED |
| `cookie-parser` | Cookie parsing middleware for Express | 1.4.7 | INSTALLED |

## Development dependencies

| Package | Purpose | Version | Status |
|---|---|---|---|
| `typescript` | Source language and compiler **[USER-DECIDED — 2026-09-04]**. **Pin the 5.x line** — `latest` is now the 7.x Go port, which ships no `tsserver.js` (see `docs/TECHSTACK.md` constraints) | 5.9.3 | INSTALLED |
| `@types/node` | Node type definitions | 24.13.3 | INSTALLED |
| `@types/express` | | 5.0.6 | INSTALLED |
| `@types/ws` | | 8.18.1 | INSTALLED |
| `@types/pg` | | 8.23.1 | INSTALLED |
| `@types/jsonwebtoken` | | 9.0.10 | INSTALLED |
| `@types/bcrypt` | | 6.0.0 | INSTALLED |
| `@types/cookie-parser` | | 1.4.10 | INSTALLED |
| `react` | Client UI **[USER-DECIDED — 2026-09-04]** | 19.2.8 | INSTALLED |
| `react-dom` | React DOM renderer | 19.2.8 | INSTALLED |
| `@types/react`, `@types/react-dom` | Type definitions | 19.2.18 / 19.2.7 | INSTALLED |
| `vite` | Client bundler → `dist/client` | 8.2.2 | INSTALLED |
| `@vitejs/plugin-react` | React support for Vite | 6.1.1 | INSTALLED |
| test framework | (TBD — open in `docs/ASSUMPTIONS.md`; `npm test` currently exits 1 by design) | — | NOT CHOSEN |
| linter | (TBD — open in `docs/ASSUMPTIONS.md`) | — | NOT CHOSEN |

## Infrastructure

| Component | Purpose | Status |
|---|---|---|
| Caddy | Reverse proxy & TLS | PLANNED (installed on droplet, not npm) |
| PostgreSQL | Database server | PLANNED (installed on droplet, not npm) |
| systemd | Process supervision | PLANNED (OS-provided, not npm) |

## Notes

- React, `react-dom` and Vite are **devDependencies on purpose**. They are build-time only — nothing React-related runs on the droplet, which serves the built output. The consequence is that the droplet's `npm ci --omit=dev` cannot build the client, so CI must build it and ship `dist/client`. Contrast `node-pg-migrate`, which is a production dependency because migrations *must* run on the droplet.
- 0 vulnerabilities reported at install (2026-09-04).
- No database ORM planned; raw `pg` queries initially.
- Session state: signed JWT cookies (no server-side session table).
- WebSocket rooms: in-process `Map` only (single instance).
