# Walking Skeleton — SPECS (WHAT)

**Design authority: `agents/TEMP/walking-skeleton/architecture-notes.md` (APPROVED, frozen).** This file adds only what the design does not state: checkable acceptance criteria, the external contract, and done-ness. Anything describing *how* is in the design or the PLAN — cited, never restated.

## TLDR

Guest joins with a nickname, sends and receives messages in one room (`lobby`), persisted to Postgres. Single Node process, Express 5 + `ws`, React 19 client. Three tables (`users`, `rooms`, `messages`). Stateless JWT cookie session, 24h guest. No registration, no multi-room, no presence, no reconnect, no rate limiting, no moderation, no DM.

## Scope

In: guest join, one seeded room, send/receive over WS, history on join, persistence, CSP header, dev proxy.
Out: registration/login/upgrade, multi-room, presence roster, reconnect, rate limiting, moderation floor, 1:1 DM (reserved baseline — `docs/CONTEXT.md` evaluation guardrails).

## API contract

| Method | Path | Auth | Request | Success | Errors |
|---|---|---|---|---|---|
| POST | `/api/join` | no cookie, **or invalid/expired** | `{ nickname }` | `200 { nickname }` (server-normalized) + `Set-Cookie: session` | `400` invalid nickname · `409` `nickname_taken` |
| POST | `/api/join` | **valid cookie** | ignored | `200 { nickname }` from existing claims, **no INSERT, no new cookie** | — |

An invalid or expired cookie is treated as **no cookie** — a fresh join that overwrites it. Any other rule strands a user holding an expired `httpOnly` cookie they cannot read or clear.
| GET | `/api/session` | cookie | — | `200 { nickname }` | `401` no/invalid session |
| GET | `/ws` | cookie + `Origin` | upgrade | `101` | `401` session · `403` origin · close `1013` admission |
| GET | `/*` | none | — | static `dist/client` + CSP header | `404` |

Validation bounds: design §4. Cookie flags and TTL: design §3 + `docs/PATTERNS/jwt-session-cookies.md`.

## Wire protocol (`src/shared/protocol.ts`)

| Dir | Type | Payload | When |
|---|---|---|---|
| C→S | `send` | `{ body }` | user sends |
| S→C | `history` | `{ messages: OutgoingMessage[] }` | once, at BATCH |
| S→C | `message` | `{ id, nickname, body, createdAt }` | live fan-out |
| S→C | `error` | `{ code }` | rejected send; after `history` if buffered |

`OutgoingMessage` is the single wire shape. DB rows reach it only via `toWireMessage` (design, "Message flow" — normalization).

## Acceptance criteria

Each is observable without reading source.

AC-1…AC-3 apply to requests **without a valid session**; AC-15 governs requests with one. The two sets are disjoint, so no request satisfies criteria with conflicting expectations.

- **AC-1** POST `/api/join` with a fresh nickname returns `200` with the **server-normalized** nickname in the body (the server trims; echoing it back stops the client displaying a value that was never stored), sets an `httpOnly` `Secure` `SameSite` cookie, and creates exactly one `users` row with `is_guest = true`.
- **AC-2** Re-posting the same nickname (any case) while the first still exists returns `409`; no second row is created. Enforced by `users_nickname_key`, not an application pre-check.
- **AC-3** Nickname failing the §4 bounds returns `400` and creates no row.
- **AC-4** WS upgrade without a valid session cookie is refused before the handshake completes; the client never observes an open socket.
- **AC-5** WS upgrade with a disallowed `Origin` is refused `403`, even with a valid cookie.
- **AC-6** On connect the client receives exactly one `history` frame, ordered oldest→newest, before any live `message` frame.
- **AC-7** A sent message is persisted (`messages` row with `author_id`, `author_nickname` snapshot, `room_id` = lobby) *before* it is broadcast, and the sender receives it back as the persisted row — not a local echo.
- **AC-8** Two concurrent clients each see the other's messages, once each, in the same order.
- **AC-9** A message sent during another client's initialization appears exactly once in that client's view — never twice, never out of order (design, three-properties table).
- **AC-10** Bodies violating §4 bounds are rejected with an `error` frame and no row is written; the socket stays open.
- **AC-11** After a server restart, a reloaded client sees prior messages from Postgres. No in-memory state is the only copy.
- **AC-12** A socket whose peer stops reading is closed once `bufferedAmount` exceeds the ceiling; a half-open peer is terminated by heartbeat and leaves the room `Set` (design, steady-state bounds).
- **AC-13** Server responses carry a CSP with `script-src 'self'` and no `'unsafe-inline'` (`docs/PATTERNS/untrusted-content-rendering.md`).
- **AC-14** A nickname or body containing `<script>alert(1)</script>` or `<img onerror=...>` renders as inert literal text in another client's DOM and never executes. (Code-level constraints — no `dangerouslySetInnerHTML`, no user string in a URL attribute — are a review item, not an end-to-end check; see Definition of done 8.)
- **AC-15** POST `/api/join` carrying a valid session cookie returns `200 { nickname }` from the existing claims, writes no `users` row, and issues no new cookie. Verified by row count before and after.

- **AC-16** A session whose `exp` passes while its socket is open is closed by the timer, and a frame arriving after `exp` on a socket the timer has not yet fired for is not processed (design §1, both mechanisms).
- **AC-17** Beyond the admission limit, further connections close `1013` and are distinguishable from `1011`; admitted sockets are unaffected.
- **AC-18** Initialization exceeding the 1 MiB buffer cap, or 32 queued inbound frames, closes `1011` and writes nothing.
- **AC-19** A history query exceeding `statement_timeout` fails that socket with `1011` and does not return a busy connection to the pool for reuse.

## Non-functional

Bounds, close codes, timeouts and memory accounting are specified in the design (steady-state bounds; initialization bounds) and are not restated. Two figures there are explicitly unmeasured floors, not ceilings — see the design's "Not checked" list. Pool config is `docs/ARCHITECTURE.md` "Database connection pool" **[USER-DECIDED]** — five keys as of the phase-5 gate: the original three plus `statement_timeout: 5_000` and `query_timeout: 7_000`, ratified there.

## Definition of done

1. AC-1…AC-19 demonstrated against a real Postgres, not a mock. AC-16…AC-19 may be demonstrated by the named tests rather than end-to-end (PLAN, "Test scope") — they are mechanism-level and hard to drive from a browser.
2. `npm run typecheck` clean for **both** tsconfigs; `npm run build` produces `dist/server` and `dist/client`.
3. Migrations apply from empty to current on a fresh database, and the lobby row resolves at startup.
4. Named tests pass (PLAN, "Test scope"); `npm test` no longer exits 1 by design.
5. The 10 pattern-file edits are applied (PLAN checklist) — the design names them; leaving them undone re-seeds the same defects in the next feature.
6. `.env.example` and `REQUIRED` agree, including `ALLOWED_ORIGIN` and `TEST_DATABASE_URL`; the destructive reset refuses any target whose database name does not end `_test` (PLAN, "Test database and reset safety").
7. Scaffold stubs `src/server/index.ts` and `src/client/main.tsx` are replaced, not extended (`docs/TODO.md` P1).
8. **Review item (not machine-checkable):** no `dangerouslySetInnerHTML` and no user-originated string in an `href`/`src`/`formAction`, per `docs/PATTERNS/untrusted-content-rendering.md`. Confirmed by reading the client diff, not by the B3 harness.
9. `docs/EVALUATION-LOG.md` row appended — token and wall-clock cost for this feature (`docs/CONTEXT.md` guardrail; unreconstructable afterwards).

## Assumptions

Inherited, not re-litigated: `docs/ASSUMPTIONS.md` resolved entries (pool sizing, test tooling, migration tool). Open and untouched: capacity ceiling unmeasured, backup/restore unproven, `messages.ip` records Caddy's address until the proxy extractor lands (`docs/TODO.md` P0).
