# Parameterized `pg` Queries Only

## Description

No ORM is planned (`docs/DEPENDENCIES.md`: "No database ORM planned; raw `pg` queries initially"). All database access goes through the `pg` client's parameterized query form. This is the only planned line of defense against SQL injection since there is no query-builder layer to enforce it structurally.

Use when: writing any code in `src/db/` or any server code issuing a SQL statement.

## Rule

- Every value that varies per call MUST be passed as a `$1, $2, ...` placeholder in `values`, never interpolated into the query string (template literal, string concatenation, or `util.format`).
- This applies to values from user input AND values computed internally (session IDs, timestamps) — consistency prevents a future edit from reintroducing string-built SQL "just this once."

## Template

```ts
import type { Pool, PoolClient } from 'pg';

export interface MessageRow {
  readonly id: string;
  readonly author_nickname: string;
  readonly body: string;
  readonly created_at: Date;
}

// Correct: every value goes through a placeholder, never string interpolation.
//
// First parameter is `Pool | PoolClient` (both expose the same `query`), not
// `Pool` alone - a caller that already holds a client (e.g. mid-transaction,
// or holding it across other statements) must be able to pass it instead of
// implicitly acquiring a second connection. Typing this narrower than that
// pushes every such caller into a resource inversion: with a bounded pool,
// enough concurrent callers acquiring a second connection while holding a
// first can exhaust the pool entirely.
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

// MUST NOT: string-built SQL, even for values that "look safe"
// `SELECT * FROM messages WHERE room_id = '${roomId}'`  <-- forbidden
```

Three details that are not stylistic:

- The column is `author_nickname`, not `nickname` — see the approved data model in `docs/ARCHITECTURE.md`. It is the snapshot taken at write time, which is what survives a guest row being reaped.
- `deleted_at IS NULL` belongs in every read of `messages` that a user will see. Removal is a soft delete, so omitting this filter shows moderated content back to users.
- **`ORDER BY created_at DESC, id DESC` needs both keys, not just the first.** Sorting after retrieval cannot repair which rows were selected: with `created_at DESC` alone, a timestamp tie straddling the `LIMIT` boundary lets Postgres return either tied row, so two callers can get different result sets for the same query. `LIMIT` must apply to a total order; `id` (a `uuid` primary key) is enough to make ties impossible.

## Extension points

- Migrations (`src/db/`) are plain SQL files, not query-builder DSL — the parameterization rule applies to application queries, not schema DDL run at migration time.
- If an ORM or query builder is adopted later, this file must be revisited — it currently assumes raw `pg` only.
