// User row access. Parameterized `pg` queries only —
// docs/PATTERNS/parameterized-pg-queries.md.
import type { Pool, PoolClient } from 'pg';

/** Postgres SQLSTATE for a unique_violation. */
export const UNIQUE_VIOLATION = '23505';

export interface PgError {
  readonly code?: string;
}

export function isUniqueViolation(err: unknown): boolean {
  return (
    typeof err === 'object' &&
    err !== null &&
    (err as PgError).code === UNIQUE_VIOLATION
  );
}

/**
 * Inserts a new guest user row. Throws with `.code === '23505'` on a
 * nickname collision (case-insensitive, `users_nickname_key`) — callers
 * must not pre-check with a SELECT (design §3, "nickname race": a
 * check-then-insert is a TOCTOU bug; the unique index is the arbiter).
 */
export async function insertGuestUser(
  pool: Pool | PoolClient,
  nickname: string,
): Promise<{ readonly id: string }> {
  const { rows } = await pool.query<{ id: string }>(
    `INSERT INTO users (nickname, is_guest) VALUES ($1, true) RETURNING id`,
    [nickname],
  );
  const row = rows[0];
  if (!row) {
    throw new Error('insertGuestUser: INSERT ... RETURNING produced no row');
  }
  return row;
}
