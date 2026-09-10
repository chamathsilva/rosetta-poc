// Integration tests for the data-retention task (GATED-DEPLOY-SPECS.md
// §2.2, §3.8). Runs against a real PostgreSQL via TEST_DATABASE_URL — the
// same convention as src/db/pool.test.ts's AC-19 tests: `{ skip }` when no
// live database is reachable, never a mock standing in for one.
//
// Every fixture timestamp is backdated with an explicit Date, never
// `now()`-relative (GATED-DEPLOY-PLAN.md B3 notes: "never `now()`-relative
// fixtures, or boundary tests become time-of-day dependent").
//
// Each test creates its own rows (unique room/nickname per test) and
// deletes them in a `finally`, so the suite is isolated and idempotent
// without a full schema reset per test.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { execFile } from 'node:child_process';
import path from 'node:path';
import { Pool } from 'pg';
import { runRetention, GUEST_REAP_MS } from './retention.js';
import { GUEST_TTL_MS } from '../server/session.js';

const TEST_DATABASE_URL = process.env['TEST_DATABASE_URL'];

// Same guardrail src/db/pool.test.ts and src/db/reset-test-db.ts enforce:
// refuse to run against anything whose database name does not end
// `_test`, since a misconfigured TEST_DATABASE_URL could otherwise point
// this suite's DELETE/UPDATE statements at real data.
if (TEST_DATABASE_URL && !/_test$/.test(new URL(TEST_DATABASE_URL).pathname)) {
  throw new Error(
    `TEST_DATABASE_URL must point at a database whose name ends "_test" - refusing to run retention tests against ${TEST_DATABASE_URL}`,
  );
}

const skip = TEST_DATABASE_URL ? false : 'TEST_DATABASE_URL not set - no live Postgres reachable';

// A single setup/teardown pool, separate from the pool `runRetention`
// itself is handed — this one is never passed into the code under test.
const setupPool = TEST_DATABASE_URL ? new Pool({ connectionString: TEST_DATABASE_URL }) : undefined;

const DAY_MS = 24 * 60 * 60 * 1000;
const HOUR_MS = 60 * 60 * 1000;

// A fixed "now" for every test in this file, so 30-day/24-hour boundaries
// are computed the same way the assertions compute them — no dependence
// on when the suite happens to run.
const NOW = new Date('2026-09-08T12:00:00.000Z');

async function insertRoom(): Promise<string> {
  const { rows } = await setupPool!.query<{ id: string }>(
    `INSERT INTO rooms (name) VALUES ($1) RETURNING id`,
    [`retention-test-${randomUUID()}`],
  );
  return rows[0]!.id;
}

async function insertGuestUser(lastSeenAt: Date): Promise<string> {
  const { rows } = await setupPool!.query<{ id: string }>(
    `INSERT INTO users (nickname, is_guest, last_seen_at) VALUES ($1, true, $2) RETURNING id`,
    [`guest-${randomUUID()}`, lastSeenAt],
  );
  return rows[0]!.id;
}

async function insertRegisteredUser(lastSeenAt: Date): Promise<string> {
  const { rows } = await setupPool!.query<{ id: string }>(
    `INSERT INTO users (nickname, is_guest, password_hash, last_seen_at)
     VALUES ($1, false, 'not-a-real-hash', $2) RETURNING id`,
    [`registered-${randomUUID()}`, lastSeenAt],
  );
  return rows[0]!.id;
}

async function insertMessage(
  roomId: string,
  authorId: string | null,
  ip: string | null,
  createdAt: Date,
): Promise<string> {
  const { rows } = await setupPool!.query<{ id: string }>(
    `INSERT INTO messages (room_id, author_id, author_nickname, body, ip, created_at)
     VALUES ($1, $2, 'snapshot-nickname', 'hello', $3, $4) RETURNING id`,
    [roomId, authorId, ip, createdAt],
  );
  return rows[0]!.id;
}

async function getMessage(
  id: string,
): Promise<{ ip: string | null; author_id: string | null; author_nickname: string; created_at: Date } | undefined> {
  const { rows } = await setupPool!.query(
    `SELECT ip, author_id, author_nickname, created_at FROM messages WHERE id = $1`,
    [id],
  );
  return rows[0];
}

async function userExists(id: string): Promise<boolean> {
  const { rows } = await setupPool!.query(`SELECT 1 FROM users WHERE id = $1`, [id]);
  return rows.length > 0;
}

async function dropBansTable(): Promise<void> {
  // CASCADE: nothing else references `bans` in this schema, but this
  // keeps the drop safe even if a crashed prior run left a dependent
  // object behind.
  await setupPool!.query(`DROP TABLE IF EXISTS bans CASCADE`);
}

/** The approved-but-unmigrated `bans` shape, verbatim from
 * docs/ARCHITECTURE.md "Data model — APPROVED", created only inside the
 * tests that need to exercise the "bans exists" branch, then dropped —
 * production has no migration for this table (SPECS §2.2), and this file
 * must leave the schema exactly as it found it. */
async function createBansTable(): Promise<void> {
  await dropBansTable();
  await setupPool!.query(`
    CREATE TABLE bans (
      id         uuid PRIMARY KEY DEFAULT gen_random_uuid(),
      ip         inet,
      reason     text NOT NULL,
      created_by uuid NOT NULL REFERENCES users(id),
      created_at timestamptz NOT NULL DEFAULT now(),
      expires_at timestamptz NOT NULL
    )
  `);
}

async function insertBan(ip: string | null, createdBy: string, expiresAt: Date): Promise<string> {
  const { rows } = await setupPool!.query<{ id: string }>(
    `INSERT INTO bans (ip, reason, created_by, expires_at) VALUES ($1, 'test', $2, $3) RETURNING id`,
    [ip, createdBy, expiresAt],
  );
  return rows[0]!.id;
}

async function deleteRows(opts: {
  messageIds?: readonly string[];
  userIds?: readonly string[];
  roomIds?: readonly string[];
}): Promise<void> {
  if (opts.messageIds?.length) {
    await setupPool!.query(`DELETE FROM messages WHERE id = ANY($1::uuid[])`, [opts.messageIds]);
  }
  if (opts.userIds?.length) {
    await setupPool!.query(`DELETE FROM users WHERE id = ANY($1::uuid[])`, [opts.userIds]);
  }
  if (opts.roomIds?.length) {
    await setupPool!.query(`DELETE FROM rooms WHERE id = ANY($1::uuid[])`, [opts.roomIds]);
  }
}

// --- AC-RET-7: drift guard ---------------------------------------------

test('AC-RET-7: the guest reap bound is GUEST_TTL_MS itself, not a second literal', () => {
  assert.equal(GUEST_REAP_MS, GUEST_TTL_MS);
});

// --- AC-RET-1/2: messages.ip erasure and its boundary ------------------

test(
  'AC-RET-1: messages.ip older than 30 days is nulled; the message row is retained',
  { skip },
  async () => {
    const roomId = await insertRoom();
    const oldCreatedAt = new Date(NOW.getTime() - 31 * DAY_MS);
    const messageId = await insertMessage(roomId, null, '203.0.113.9', oldCreatedAt);
    try {
      const result = await runRetention(setupPool!, NOW);
      assert.equal(result.messagesIpNulled, 1);
      const row = await getMessage(messageId);
      assert.ok(row, 'message row must still exist');
      assert.equal(row!.ip, null);
      assert.equal(row!.author_nickname, 'snapshot-nickname');
    } finally {
      await deleteRows({ messageIds: [messageId], roomIds: [roomId] });
    }
  },
);

test('AC-RET-2: messages.ip at 29 days old is kept (below the 30-day cutoff)', { skip }, async () => {
  const roomId = await insertRoom();
  const recentCreatedAt = new Date(NOW.getTime() - 29 * DAY_MS);
  const messageId = await insertMessage(roomId, null, '203.0.113.9', recentCreatedAt);
  try {
    const result = await runRetention(setupPool!, NOW);
    assert.equal(result.messagesIpNulled, 0);
    const row = await getMessage(messageId);
    assert.equal(row!.ip, '203.0.113.9');
  } finally {
    await deleteRows({ messageIds: [messageId], roomIds: [roomId] });
  }
});

// --- AC-RET-3: the bans guard, both directions --------------------------

test(
  'AC-RET-3a: bans absent (today\'s reality) — statement 2 is skipped, bansIpNulled is null, and statements 1 and 3 still commit',
  { skip },
  async () => {
    await dropBansTable();
    const roomId = await insertRoom();
    const oldCreatedAt = new Date(NOW.getTime() - 31 * DAY_MS);
    const messageId = await insertMessage(roomId, null, '203.0.113.9', oldCreatedAt);
    const guestId = await insertGuestUser(new Date(NOW.getTime() - 25 * HOUR_MS));
    try {
      const result = await runRetention(setupPool!, NOW);
      // null (skipped), not 0 (ran, matched nothing) — the field the spec
      // requires to distinguish a guard from a working eraser.
      assert.equal(result.bansIpNulled, null);
      assert.equal(result.messagesIpNulled, 1, 'statement 1 must still commit');
      assert.equal(result.guestsDeleted, 1, 'statement 3 must still commit');
      assert.equal((await getMessage(messageId))!.ip, null);
      assert.equal(await userExists(guestId), false);
    } finally {
      await deleteRows({ messageIds: [messageId], roomIds: [roomId] });
      // guestId already deleted by the retention run itself.
    }
  },
);

test(
  'AC-RET-3b: bans present — expired-ban ip is nulled, row retained for audit',
  { skip },
  async () => {
    await createBansTable();
    const adminId = await insertRegisteredUser(NOW);
    const oldExpiry = new Date(NOW.getTime() - 31 * DAY_MS);
    const banId = await insertBan('198.51.100.7', adminId, oldExpiry);
    try {
      const result = await runRetention(setupPool!, NOW);
      assert.equal(result.bansIpNulled, 1);
      const { rows } = await setupPool!.query(`SELECT ip FROM bans WHERE id = $1`, [banId]);
      assert.equal(rows.length, 1, 'ban row must be retained');
      assert.equal(rows[0].ip, null);
    } finally {
      // Order matters: `bans.created_by` FK-references `users(id)` with no
      // ON DELETE action, so the table holding the reference must go
      // first. dropBansTable() removes the ban row (and the table) before
      // the referenced user is deleted - the reverse order is exactly the
      // "23503 foreign_key_violation" this comment is here to prevent
      // reintroducing.
      await dropBansTable();
      await deleteRows({ userIds: [adminId] });
    }
  },
);

test(
  'AC-RET-3 regression: WITHOUT the guard, a missing "bans" relation aborts the whole transaction and erases nothing — the exact silent-failure the guard exists to prevent',
  { skip },
  async () => {
    await dropBansTable();
    const roomId = await insertRoom();
    const oldCreatedAt = new Date(NOW.getTime() - 31 * DAY_MS);
    const messageId = await insertMessage(roomId, null, '203.0.113.9', oldCreatedAt);
    try {
      const client = await setupPool!.connect();
      let caught: unknown;
      try {
        await client.query('BEGIN');
        await client.query(`UPDATE messages SET ip = NULL WHERE ip IS NOT NULL AND created_at < $1`, [
          new Date(NOW.getTime() - 30 * DAY_MS),
        ]);
        // Unguarded statement 2, exactly what runRetention would run if
        // the `to_regclass` check were removed.
        await client.query(`UPDATE bans SET ip = NULL WHERE expires_at < $1`, [
          new Date(NOW.getTime() - 30 * DAY_MS),
        ]);
        await client.query('COMMIT');
      } catch (err) {
        caught = err;
        await client.query('ROLLBACK');
      } finally {
        client.release();
      }

      assert.ok(caught, 'the unguarded transaction must throw on the missing relation');
      assert.equal((caught as { code?: string }).code, '42P01'); // undefined_table

      // Proof of the silent-failure mode: statement 1 ran inside the same
      // aborted transaction, so it must NOT have persisted.
      const row = await getMessage(messageId);
      assert.equal(row!.ip, '203.0.113.9', 'the unguarded path must roll back the ip erasure too');
    } finally {
      await deleteRows({ messageIds: [messageId], roomIds: [roomId] });
    }
  },
);

// --- AC-RET-4/5: guest reap ---------------------------------------------

test(
  'AC-RET-4: a guest user 25h old is reaped; their messages survive with author_id NULL and author_nickname intact',
  { skip },
  async () => {
    const roomId = await insertRoom();
    const guestId = await insertGuestUser(new Date(NOW.getTime() - 25 * HOUR_MS));
    const messageId = await insertMessage(roomId, guestId, null, NOW);
    try {
      const result = await runRetention(setupPool!, NOW);
      assert.equal(result.guestsDeleted, 1);
      assert.equal(await userExists(guestId), false);
      const row = await getMessage(messageId);
      assert.ok(row, 'message must survive its author being reaped');
      assert.equal(row!.author_id, null);
      assert.equal(row!.author_nickname, 'snapshot-nickname');
    } finally {
      await deleteRows({ messageIds: [messageId], roomIds: [roomId] });
    }
  },
);

test('AC-RET-4 boundary: a guest user 23h old is NOT reaped (below the 24h cutoff)', { skip }, async () => {
  const guestId = await insertGuestUser(new Date(NOW.getTime() - 23 * HOUR_MS));
  try {
    const result = await runRetention(setupPool!, NOW);
    assert.equal(result.guestsDeleted, 0);
    assert.equal(await userExists(guestId), true);
  } finally {
    await deleteRows({ userIds: [guestId] });
  }
});

test('AC-RET-5: a non-guest (registered) user is never deleted regardless of last_seen_at', { skip }, async () => {
  const registeredId = await insertRegisteredUser(new Date(NOW.getTime() - 365 * DAY_MS));
  try {
    const result = await runRetention(setupPool!, NOW);
    assert.equal(result.guestsDeleted, 0);
    assert.equal(await userExists(registeredId), true);
  } finally {
    await deleteRows({ userIds: [registeredId] });
  }
});

// --- AC-RET-6: transaction atomicity ------------------------------------

test(
  'AC-RET-6: an induced failure in statement 3 leaves statement 1 un-applied (one transaction, not three)',
  { skip },
  async () => {
    await createBansTable();
    const roomId = await insertRoom();
    // This guest is old enough to be reaped by statement 3, but is
    // referenced by bans.created_by (NOT NULL REFERENCES users(id), no ON
    // DELETE action) — deleting it must raise a foreign_key_violation and
    // abort the whole transaction.
    const guestId = await insertGuestUser(new Date(NOW.getTime() - 25 * HOUR_MS));
    const oldCreatedAt = new Date(NOW.getTime() - 31 * DAY_MS);
    const messageId = await insertMessage(roomId, guestId, '203.0.113.9', oldCreatedAt);
    const oldExpiry = new Date(NOW.getTime() - 31 * DAY_MS);
    const banId = await insertBan('198.51.100.7', guestId, oldExpiry);
    try {
      await assert.rejects(() => runRetention(setupPool!, NOW));

      // Statement 1 "ran" inside the same transaction as the failing
      // statement 3 — prove it did not survive the rollback.
      const row = await getMessage(messageId);
      assert.equal(row!.ip, '203.0.113.9', 'messages.ip erasure must roll back with the failed transaction');

      // Statement 2 must roll back too.
      const { rows: banRows } = await setupPool!.query(`SELECT ip FROM bans WHERE id = $1`, [banId]);
      assert.equal(banRows[0].ip, '198.51.100.7', 'bans.ip erasure must roll back with the failed transaction');

      // The guest that caused the failure must still exist.
      assert.equal(await userExists(guestId), true);
    } finally {
      await deleteRows({ messageIds: [messageId] });
      await setupPool!.query(`DELETE FROM bans WHERE id = $1`, [banId]);
      await deleteRows({ userIds: [guestId], roomIds: [roomId] });
      await dropBansTable();
    }
  },
);

// --- AC-RET-9: CLI exit codes and logging -------------------------------

const repoRoot = path.resolve(import.meta.dirname, '..', '..');
const retentionScript = path.join(repoRoot, 'src', 'db', 'retention.ts');

function runCli(env: Record<string, string | undefined>): Promise<{ code: number; stdout: string; stderr: string }> {
  return new Promise((resolve) => {
    execFile(
      process.execPath,
      ['--import', 'tsx', retentionScript],
      { cwd: repoRoot, env: { ...process.env, ...env } },
      (err, stdout, stderr) => {
        // execFile's callback reports failure via `err`, whose numeric
        // exit code is `err.code` when the process actually ran (as
        // opposed to failing to spawn at all, in which case `code` is a
        // string errno like 'ENOENT' and 1 is a reasonable stand-in).
        let code = 0;
        if (err) {
          code = typeof err.code === 'number' ? err.code : 1;
        }
        resolve({ code, stdout, stderr });
      },
    );
  });
}

test('AC-RET-9a: the CLI exits non-zero and logs an error when DATABASE_URL is missing', async () => {
  const { code, stderr } = await runCli({ DATABASE_URL: '' });
  assert.notEqual(code, 0);
  assert.match(stderr, /DATABASE_URL is not set/);
});

test(
  'AC-RET-9b: the CLI exits 0 and logs all three counts on success',
  { skip },
  async () => {
    const roomId = await insertRoom();
    const oldCreatedAt = new Date(0); // far enough in the past to be unambiguous
    const messageId = await insertMessage(roomId, null, '203.0.113.9', oldCreatedAt);
    try {
      const { code, stdout } = await runCli({ DATABASE_URL: TEST_DATABASE_URL });
      assert.equal(code, 0);
      const logged: unknown = JSON.parse(stdout.trim().split('\n').pop()!);
      assert.equal((logged as { task: string }).task, 'retention');
      assert.equal(typeof (logged as { messagesIpNulled: number }).messagesIpNulled, 'number');
      assert.ok('bansIpNulled' in (logged as object));
      assert.equal(typeof (logged as { guestsDeleted: number }).guestsDeleted, 'number');
    } finally {
      await deleteRows({ messageIds: [messageId], roomIds: [roomId] });
    }
  },
);

// --- AC-RET-8: pool.end() is called; the CLI does not wait out idleTimeoutMillis (30s) ---

test(
  'AC-RET-8: the CLI process exits promptly, without waiting out the 30s idleTimeoutMillis',
  { skip },
  async () => {
    const start = Date.now();
    const { code } = await runCli({ DATABASE_URL: TEST_DATABASE_URL });
    const elapsedMs = Date.now() - start;
    assert.equal(code, 0);
    // Generous margin above real work, but well under the 30_000ms
    // idleTimeoutMillis a missing pool.end() would leave the process
    // waiting on.
    assert.ok(elapsedMs < 10_000, `expected the CLI to exit promptly, took ${elapsedMs}ms`);
  },
);
