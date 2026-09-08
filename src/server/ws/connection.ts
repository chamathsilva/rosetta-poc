// Connection lifecycle: the ADMIT / REGISTER / ACQUIRE / GUARD-OPEN / JOIN
// / QUERY / GUARD-SEND / BATCH / RELEASE sequence from
// agents/TEMP/walking-skeleton/architecture-notes.md, "Message flow and
// remaining implementation decisions". Steps are named, not numbered, per
// that document, and are cited by name in comments below.
import type { IncomingMessage } from 'node:http';
import type { Pool, PoolClient } from 'pg';
import type { WebSocket, WebSocketServer, RawData } from 'ws';
import type {
  ErrorFrame,
  HistoryFrame,
  MessageFrame,
  OutgoingMessage,
} from '../../shared/protocol.js';
import {
  getMessagesForRoom,
  insertMessage,
  toWireMessage,
  type MessageRow,
} from '../../db/queries/messages.js';
import { deliver, openBuffer, closeBuffer, getBufferedFrames } from '../delivery.js';
import { joinRoom, broadcast } from '../rooms.js';
import { validateBody } from '../validation.js';
import { armExpiryTimer, isExpired } from '../session.js';
import type { ConnectionContext } from './upgrade.js';

/** 64 concurrently-initializing sockets (design, "Admission limit").
 * Beyond `max: 10` extra concurrency only buys queueing tolerance. */
const ADMISSION_LIMIT = 64;

/** 32 queued-but-unprocessed send tasks per socket — one mechanism serving
 * two purposes across this connection's lifetime: it is what "the per-
 * socket queue" bounds while REGISTER's parked chain awaits JOIN
 * (AC-18), and what "steady state" bounds afterwards for a client
 * outrunning its own INSERT latency (design, "Steady state needs its own
 * bounds"). See the module-level note below on why one counter serves
 * both without contradicting the design's separate descriptions of them. */
const QUEUE_DEPTH_LIMIT = 32;

/** `LIMIT 50` against `messages_room_history_idx` (design, QUERY step). */
const HISTORY_LIMIT = 50;

/** 30s ping interval; a socket is terminated after one missed pong
 * (design, "Liveness: server-side ping/pong heartbeat"). */
const HEARTBEAT_INTERVAL_MS = 30_000;

/** Concurrently-initializing socket count, checked at ADMIT and
 * decremented in RELEASE's `finally`. Module-level and process-wide: the
 * whole design assumes a single Node process (docs/ARCHITECTURE.md
 * "Shape"). */
let admittedCount = 0;

/** Per-socket liveness flag for the heartbeat. A WeakMap rather than a
 * `ws.isAlive` property — same reasoning `websocket-room-fanout.md` gives
 * for not reintroducing an ad-hoc socket property (roomId): it keeps the
 * `WebSocket` type unmodified and needs no unsound cast under this repo's
 * strict `tsconfig.json`. Functionally identical to the design's
 * `ws.isAlive` description — the state genuinely lives "in the
 * per-connection context, not the room `Set`" either way. */
const aliveMap = new WeakMap<WebSocket, boolean>();

function markAlive(ws: WebSocket): void {
  aliveMap.set(ws, true);
}

/**
 * One `setInterval` at the `WebSocketServer` level, iterating
 * `wss.clients`. Returns a stop function — callers must clear the interval
 * on server shutdown, or it keeps the process alive (design, "Liveness").
 */
export function startHeartbeat(wss: WebSocketServer): () => void {
  const interval = setInterval(() => {
    for (const ws of wss.clients) {
      if (aliveMap.get(ws) === false) {
        // terminate() emits 'close', so joinRoom's handlers run and
        // leaveRoom cleans the room Set through the normal path (design,
        // "Interactions checked").
        ws.terminate();
        continue;
      }
      aliveMap.set(ws, false);
      ws.ping();
    }
  }, HEARTBEAT_INTERVAL_MS);
  return () => clearInterval(interval);
}

export function attachConnectionHandler(wss: WebSocketServer, pool: Pool, lobbyRoomId: string): void {
  wss.on(
    'connection',
    (ws: WebSocket, _req: IncomingMessage, context: ConnectionContext) => {
      handleConnection(ws, context, pool, lobbyRoomId).catch((err: unknown) => {
        // Defensive net only: handleConnection owns a try/catch/finally
        // covering ACQUIRE..RELEASE, so nothing should reach here. If it
        // ever does, fail closed rather than leave an unhandled rejection.
        console.error('unhandled error in connection handler', err);
        if (ws.readyState === ws.OPEN) ws.close(1011);
      });
    },
  );
}

function rawDataToString(data: RawData): string {
  if (Buffer.isBuffer(data)) return data.toString('utf8');
  if (Array.isArray(data)) return Buffer.concat(data).toString('utf8');
  return Buffer.from(data).toString('utf8');
}

function sendError(ws: WebSocket, code: string): void {
  const frame: ErrorFrame = { type: 'error', code };
  deliver(ws, JSON.stringify(frame));
}

interface PgError {
  readonly code?: string;
}

function isForeignKeyViolation(err: unknown): boolean {
  return typeof err === 'object' && err !== null && (err as PgError).code === '23503';
}

/** The read-timeout backstop's own error, distinguished from a normal
 * query rejection so RELEASE can route `client.release(err)` only on this
 * path (design, "Query timeout: server-side statement_timeout ... with
 * query_timeout as a backstop"). Message text matches `pg` 8.23.0's
 * `lib/client.js` read-timeout rejection verbatim. */
function isReadTimeout(err: unknown): err is Error {
  return err instanceof Error && err.message === 'Query read timeout';
}

/**
 * The BATCH merge: normalize, dedup by id, sort `(createdAt, id)` — the
 * `readonly` inputs are never mutated. Exported for
 * `src/server/ws/batch.test.ts` (PLAN "Test scope").
 *
 * `rows` are history rows in `created_at DESC` order (QUERY's own
 * ordering); `bufferedFrames` are raw JSON strings buffered between JOIN
 * and this call. Non-`message` frames (e.g. `error`) are partitioned out
 * into `extras`, in original buffer order, because they carry no `id` or
 * `createdAt` and cannot be sorted or deduped like a message (design,
 * "The buffer is not homogeneous").
 */
export function buildBatch(
  rows: readonly MessageRow[],
  bufferedFrames: readonly string[],
): { readonly history: readonly OutgoingMessage[]; readonly extras: readonly string[] } {
  const byId = new Map<string, OutgoingMessage>();
  for (const row of rows) {
    const wire = toWireMessage(row);
    byId.set(wire.id, wire);
  }

  const extras: string[] = [];
  for (const raw of bufferedFrames) {
    let parsed: unknown;
    try {
      parsed = JSON.parse(raw);
    } catch {
      continue;
    }
    if (typeof parsed !== 'object' || parsed === null) continue;
    const p = parsed as Record<string, unknown>;
    if (p['type'] === 'message') {
      const { id, nickname, body, createdAt } = p;
      if (
        typeof id === 'string' &&
        typeof nickname === 'string' &&
        typeof body === 'string' &&
        typeof createdAt === 'string'
      ) {
        byId.set(id, { id, nickname, body, createdAt });
      }
      // A malformed buffered `message` frame (missing/wrong-typed field)
      // is dropped rather than corrupting the sort — it cannot originate
      // from this server's own `deliver()` calls, only from a hypothetical
      // future bug, so failing closed here is the safe default.
    } else {
      extras.push(raw);
    }
  }

  const history = [...byId.values()].sort((a, b) => {
    if (a.createdAt !== b.createdAt) return a.createdAt < b.createdAt ? -1 : 1;
    if (a.id === b.id) return 0;
    return a.id < b.id ? -1 : 1;
  });

  return { history, extras };
}

async function handleSend(
  ws: WebSocket,
  context: ConnectionContext,
  pool: Pool,
  lobbyRoomId: string,
  frame: string,
): Promise<void> {
  // Execution-time checks, never enqueue-time (design, "Closing a socket
  // does not cancel its queued sends"): the whole point is that the state
  // may have changed while this task waited in the chain.
  if (ws.readyState !== ws.OPEN) return;
  if (isExpired(context.exp)) return; // AC-16: per-frame exp check

  let parsed: unknown;
  try {
    parsed = JSON.parse(frame);
  } catch {
    return; // unparseable JSON is ignored (design §4)
  }
  if (typeof parsed !== 'object' || parsed === null) return;
  const p = parsed as Record<string, unknown>;
  if (p['type'] !== 'send') return; // unrecognised type is ignored (design §4)

  const validated = validateBody(p['body']);
  if (!validated.ok) {
    sendError(ws, 'invalid_body');
    return;
  }

  let row: MessageRow;
  try {
    row = await insertMessage(pool, {
      roomId: lobbyRoomId,
      authorId: context.claims.userId,
      authorNickname: context.claims.nickname,
      body: validated.value,
      ip: context.ip,
    });
  } catch (err) {
    sendError(ws, 'send_failed');
    if (isForeignKeyViolation(err)) {
      // The author's `users` row was reaped mid-session - reachable only
      // if GUEST_TTL and the reaper drift apart (design, edge cases table).
      if (ws.readyState === ws.OPEN) ws.close(1011);
    }
    return;
  }

  // Persist before broadcast (design, "On send"): a broadcast-first order
  // could show a message that then fails to save.
  const wire = toWireMessage(row);
  const frameOut: MessageFrame = { type: 'message', ...wire };
  // No `exclude` - the sender receives its own message back as the
  // authoritative persisted row (design, "On send"; AC-7).
  broadcast(lobbyRoomId, JSON.stringify(frameOut));
}

async function handleConnection(
  ws: WebSocket,
  context: ConnectionContext,
  pool: Pool,
  lobbyRoomId: string,
): Promise<void> {
  // ADMIT - runs first because everything after it retains memory.
  if (admittedCount >= ADMISSION_LIMIT) {
    ws.close(1013);
    return;
  }
  admittedCount++;

  markAlive(ws);
  ws.on('pong', () => markAlive(ws));

  const clearExpiryTimer = armExpiryTimer(ws, context.exp);
  ws.on('close', clearExpiryTimer);

  // REGISTER - attached synchronously, before any `await`. Frames only
  // enqueue onto a promise chain; the chain itself is "parked" behind
  // `releaseGate` until JOIN resolves it, so nothing is processed before
  // this socket is a room member (design, REGISTER + "Why the inbound
  // queue is gated on membership").
  let releaseGate: () => void = () => {
    /* replaced immediately below; placeholder keeps TS happy about
       definite assignment before the executor runs. */
  };
  let chain: Promise<void> = new Promise<void>((resolve) => {
    releaseGate = resolve;
  });
  let queueDepth = 0;

  ws.on('message', (data: RawData) => {
    if (queueDepth >= QUEUE_DEPTH_LIMIT) {
      ws.close(1011);
      return;
    }
    queueDepth++;
    const frame = rawDataToString(data);
    chain = chain
      .then(() => handleSend(ws, context, pool, lobbyRoomId, frame))
      .catch((err: unknown) => {
        // The chain must recover from rejection, or every later send for
        // this socket is silently skipped (design, "the chain must
        // recover from rejection").
        console.error('send task failed', err);
        if (ws.readyState === ws.OPEN) {
          sendError(ws, 'internal_error');
        }
      })
      .finally(() => {
        queueDepth--;
      });
  });

  let client: PoolClient | undefined;
  let releaseError: Error | undefined;

  try {
    // ACQUIRE - precedes JOIN deliberately (aggregate bound: an outbound
    // buffer cannot open without a pooled connection in hand).
    client = await pool.connect();

    // GUARD-OPEN - a socket that closed during ACQUIRE has already fired
    // 'close' before joinRoom registered any cleanup handler. Return only;
    // the single `finally` below is the sole release site.
    if (ws.readyState !== ws.OPEN) {
      return;
    }

    // JOIN - joinRoom, enable the outbound buffer, and start draining the
    // inbound queue, all in one synchronous step; nothing may run between
    // them.
    openBuffer(ws);
    joinRoom(lobbyRoomId, ws);
    releaseGate();

    // QUERY - on the held client, never the pool (design, "held client vs
    // pool").
    let rows: readonly MessageRow[];
    try {
      rows = await getMessagesForRoom(client, lobbyRoomId, HISTORY_LIMIT);
    } catch (err) {
      if (isReadTimeout(err)) {
        releaseError = err;
      }
      throw err;
    }

    // GUARD-SEND - the socket can have closed during QUERY; leaveRoom has
    // already run via the 'close' handler joinRoom registered.
    if (ws.readyState !== ws.OPEN) {
      closeBuffer(ws);
      return;
    }

    // BATCH - the buffer is consumed as data (read, then cleared), never
    // replayed wholesale; deliver() applies its readyState/backpressure
    // guard on this flush exactly as it does on any direct send.
    const bufferedFrames = getBufferedFrames(ws);
    closeBuffer(ws);
    const { history, extras } = buildBatch(rows, bufferedFrames);
    const historyFrame: HistoryFrame = { type: 'history', messages: history };
    deliver(ws, JSON.stringify(historyFrame));
    for (const extra of extras) {
      deliver(ws, extra);
    }
  } catch {
    // Any failure from ACQUIRE through BATCH: never leave a socket joined
    // with a live buffer, and fail closed (design, "Initialization must be
    // bounded and must fail closed").
    closeBuffer(ws);
    if (ws.readyState === ws.OPEN) ws.close(1011);
  } finally {
    // RELEASE - single finally, covering both guards and the catch.
    releaseGate(); // idempotent; ensures no parked send task waits forever
    if (client) client.release(releaseError);
    admittedCount--;
  }
}
