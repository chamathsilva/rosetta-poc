# Patterns Index

**No patterns were extracted from code — none exists.** This repo is greenfield (Phase 3 discovery confirmed 0 source files). The entries below are PRESCRIBED conventions for the first code to follow, derived from decisions already recorded in `POC-BRIEF.md`, `docs/TECHSTACK.md`, `docs/DEPENDENCIES.md`, and `gain.json`. They are not observations of existing structure. Each file states which decision it traces to.

When real code exists, this index must be re-derived from actual usage (2+ occurrences) per the standard pattern-extraction process, not just left as-is.

## WebSocket Room Fan-Out - `Map<roomId, Set<socket>>` membership, broadcast, and mandatory disconnect cleanup

See `websocket-room-fanout.md`.

## Untrusted Content Rendering - escape all user-originated content (nickname, message, room name) at render, never trust client input

See `untrusted-content-rendering.md`.

## Parameterized `pg` Queries Only - no string-built SQL, no ORM

See `parameterized-pg-queries.md`.

## Signed JWT Cookie Sessions - stateless guest and registered identity via verified JWT cookie, no server-side session table

See `jwt-session-cookies.md`.

## Configuration and Secrets via Environment Variables - `process.env` only, fail-fast on missing required vars, `.env.example` kept in sync

See `env-config-secrets.md`.
