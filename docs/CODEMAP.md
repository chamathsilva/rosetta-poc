# Code Map

**REAL** — the walking skeleton is built (`agents/IMPLEMENTATION.md`, 2026-09-08). Re-derived from the actual `src/` tree, per this file's own prior instruction, not from the pre-code sketch it replaces.

## Repository structure

```
rosetta-poc/
  src/
    server/
      index.ts          Entry point: wires config, pool, lobby resolution, Express app, WS upgrade/heartbeat
      config.ts          loadConfig() - fail-fast env reading, docs/PATTERNS/env-config-secrets.md
      session.ts          JWT issue/verify, cookie, expiry timer - docs/PATTERNS/jwt-session-cookies.md
      rooms.ts            Map<roomId, Set<WebSocket>> membership + fan-out, docs/PATTERNS/websocket-room-fanout.md
      delivery.ts          Leaf module: per-socket outbound buffer, backpressure ceiling, readyState guard
      validation.ts        Nickname/message-body bounds
      http/
        app.ts             Express app: CSP header, cookie-parser, express.json(), route mounting
        join.ts            POST /api/join - guest create-or-resume
        session.ts          GET /api/session - lets the client learn if it already has one
      ws/
        upgrade.ts          Raw 'upgrade' handling: path/Origin/cookie checks before handshake
        connection.ts        Named-step connection lifecycle (ADMIT..RELEASE), send serialization, heartbeat
      *.test.ts            node:test files, one per module above
    db/
      pool.ts             pg Pool, five config keys - docs/ARCHITECTURE.md "Database connection pool"
      reset-test-db.ts     Destructive reset for the disposable _test database only
      queries/
        users.ts            Guest user insert, unique-violation detection
        rooms.ts             Lobby room resolution by name
        messages.ts          History read, message insert, DB-row -> wire-shape normalization
      migrations/
        *_users_rooms_messages.sql  Schema: users, rooms, messages (approved data model, restricted to what this feature uses)
        *_seed_lobby.sql            Seeds the well-known 'lobby' room
    client/
      main.tsx            Mounts <App />
      App.tsx              Bootstrap: GET /api/session decides join-form vs chat-view
      JoinForm.tsx          Nickname entry, POST /api/join
      ChatRoom.tsx          Message list + input; renders via JSX text children only (XSS boundary)
      useChatSocket.ts      WebSocket lifecycle: history/message/error frames, no reconnect (out of scope)
    shared/
      protocol.ts          Wire protocol types, imported by both server and client - the parallel-build contract
  docs/              Project documentation
  agents/            Rosetta workflow state, plans, memory
  plans/walking-skeleton/  SPECS + PLAN for this feature
  package.json, package-lock.json, tsconfig.json, tsconfig.client.json, vite.config.ts, .nvmrc, .npmrc, .env.example, eslint.config.js, compose.yml
  dist/              Build output, not committed - server/ (tsc, test files stripped) + client/ (Vite)
```

## Notes for navigating this codebase

- **Module boundary**: `server/rooms.ts` imports `server/delivery.ts`, never the reverse — this is deliberate (avoids a `rooms → ws → rooms` cycle; see `docs/PATTERNS/websocket-room-fanout.md`'s declared deviation).
- **The named connection sequence** (ADMIT, REGISTER, ACQUIRE, GUARD-OPEN, JOIN, QUERY, GUARD-SEND, BATCH, RELEASE) lives entirely in `src/server/ws/connection.ts`. It is cited by these names in code comments throughout that file and in `agents/TEMP/walking-skeleton/architecture-notes.md`, the design document it implements.
- **Every DB row becomes wire shape in exactly one place**: `src/db/queries/messages.ts`'s `toWireMessage()`. Do not reimplement that mapping elsewhere.
- **Not yet built**: `server/moderation` (report/ban/audit), presence, multi-room, registration/login, rate limiting. `docs/ARCHITECTURE.md`'s module table and `docs/TODO.md` track these.
- Tests are `node:test` + `tsx`, one file per module, colocated (`foo.ts` next to `foo.test.ts`). `npm test` runs them all; `npm run build:server` compiles then strips `*.test.js` from the output, so nothing test-only ships.
