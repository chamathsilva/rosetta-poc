# Parameterized `pg` Queries Only

## Description

No ORM is planned (`docs/DEPENDENCIES.md`: "No database ORM planned; raw `pg` queries initially"). All database access goes through the `pg` client's parameterized query form. This is the only planned line of defense against SQL injection since there is no query-builder layer to enforce it structurally.

Use when: writing any code in `src/db/` or any server code issuing a SQL statement.

## Rule

- Every value that varies per call MUST be passed as a `$1, $2, ...` placeholder in `values`, never interpolated into the query string (template literal, string concatenation, or `util.format`).
- This applies to values from user input AND values computed internally (session IDs, timestamps) — consistency prevents a future edit from reintroducing string-built SQL "just this once."

## Template

```js
// Correct
async function getMessagesForRoom(pool, roomId, limit) {
  const { rows } = await pool.query(
    'SELECT id, nickname, body, created_at FROM messages WHERE room_id = $1 ORDER BY created_at DESC LIMIT $2',
    [roomId, limit]
  );
  return rows;
}

// MUST NOT: string-built SQL, even for values that "look safe"
// `SELECT * FROM messages WHERE room_id = '${roomId}'`  <-- forbidden
```

## Extension points

- Migrations (`src/db/`) are plain SQL files, not query-builder DSL — the parameterization rule applies to application queries, not schema DDL run at migration time.
- If an ORM or query builder is adopted later, this file must be revisited — it currently assumes raw `pg` only.
