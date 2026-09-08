// Room lookup. Parameterized `pg` queries only —
// docs/PATTERNS/parameterized-pg-queries.md.
//
// design §2, option B: the room name is the contract, the id stays
// database-generated. LOBBY_ROOM_NAME is a code constant, not an env var —
// docs/PATTERNS/env-config-secrets.md ("Values that are decisions, not
// configuration ... stay as constants in code").
import type { Pool } from 'pg';

export const LOBBY_ROOM_NAME = 'lobby';

/**
 * Resolves the lobby room's id once at startup. Throws if the seed
 * migration has not been run — fail fast before `server.listen`, per
 * docs/PATTERNS/env-config-secrets.md's fail-fast rule.
 */
export async function resolveLobbyRoomId(pool: Pool): Promise<string> {
  const { rows } = await pool.query<{ id: string }>(
    `SELECT id FROM rooms WHERE lower(name) = lower($1)`,
    [LOBBY_ROOM_NAME],
  );
  const row = rows[0];
  if (!row) {
    throw new Error('lobby room not found — run migrations');
  }
  return row.id;
}
