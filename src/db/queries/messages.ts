// Message row access and the one normalization point from DB shape to wire
// shape. Parameterized `pg` queries only —
// docs/PATTERNS/parameterized-pg-queries.md.
import type { Pool, PoolClient } from 'pg';
import type { OutgoingMessage } from '../../shared/protocol.js';

export interface MessageRow {
  readonly id: string;
  readonly author_nickname: string;
  readonly body: string;
  readonly created_at: Date;
}

/**
 * The single place a raw `messages` DB row becomes the wire shape
 * (design, "Message flow and remaining implementation decisions" —
 * normalization). Both BATCH (mapping history rows) and the send path
 * (mapping the row assembled from `INSERT ... RETURNING`) go through this;
 * doing the `author_nickname → nickname` / `created_at → createdAt` mapping
 * anywhere else is how the two drift apart again.
 *
 * `created_at` is `timestamptz` with microsecond precision; going through
 * `Date#toISOString()` truncates to milliseconds (design, "Accepted
 * precision loss") — the `id` tie-breaker at BATCH is what keeps ordering
 * deterministic despite that.
 */
export function toWireMessage(row: MessageRow): OutgoingMessage {
  return {
    id: row.id,
    nickname: row.author_nickname,
    body: row.body,
    createdAt: row.created_at.toISOString(),
  };
}

/**
 * First parameter is `Pool | PoolClient` (both expose the same `query`) —
 * design "QUERY" step: a caller already holding a client (BATCH holds one
 * across ACQUIRE) must pass it rather than implicitly acquiring a second
 * connection, or a bounded pool can deadlock under concurrent
 * initializations.
 *
 * `ORDER BY created_at DESC, id DESC` needs both keys: `LIMIT` must apply
 * to a total order, or a timestamp tie straddling the boundary lets two
 * callers see different histories for the same query
 * (docs/PATTERNS/parameterized-pg-queries.md).
 */
export async function getMessagesForRoom(
  pool: Pool | PoolClient,
  roomId: string,
  limit: number,
): Promise<readonly MessageRow[]> {
  const { rows } = await pool.query<MessageRow>(
    `SELECT id, author_nickname, body, created_at
       FROM messages
      WHERE room_id = $1 AND deleted_at IS NULL
      ORDER BY created_at DESC, id DESC
      LIMIT $2`,
    [roomId, limit],
  );
  return rows;
}

/**
 * Persists a sent message. `author_nickname` is written as a snapshot,
 * never re-read from `users` (docs/ARCHITECTURE.md "`author_nickname` is a
 * snapshot"). Callers pass `undefined` for `authorId` only if the claims
 * genuinely lack a `userId` — `verifySessionToken`'s runtime narrowing
 * should prevent that in practice; the FK accepts NULL, not a dangling id.
 */
export async function insertMessage(
  pool: Pool | PoolClient,
  params: {
    readonly roomId: string;
    readonly authorId: string | undefined;
    readonly authorNickname: string;
    readonly body: string;
    readonly ip: string | undefined;
  },
): Promise<MessageRow> {
  const { rows } = await pool.query<{ id: string; created_at: Date }>(
    `INSERT INTO messages (room_id, author_id, author_nickname, body, ip)
     VALUES ($1, $2, $3, $4, $5)
     RETURNING id, created_at`,
    [params.roomId, params.authorId, params.authorNickname, params.body, params.ip],
  );
  const row = rows[0];
  if (!row) {
    throw new Error('insertMessage: INSERT ... RETURNING produced no row');
  }
  return {
    id: row.id,
    author_nickname: params.authorNickname,
    body: params.body,
    created_at: row.created_at,
  };
}
