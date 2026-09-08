// docs/ARCHITECTURE.md "Database connection pool" [USER-DECIDED]: the five
// pool config keys, verbatim - PLAN "H-7": a disagreement here is a
// stop-and-report with that document authoritative, not something this
// test should silently accept a drift on.
//
// PLAN "Test scope": src/db/pool.test.ts - "statement_timeout path and
// release(err) not returning a busy connection (AC-19)".
//
// A real Postgres is now reachable at TEST_DATABASE_URL (B3, 2026-09-08),
// so the case deferred at B1 as a `{ skip }` - AC-19's actual
// statement_timeout / query_timeout behaviour against a live server - is
// exercised for real below, against TEST_DATABASE_URL only. Never
// DATABASE_URL: this file must not be able to touch anything but the
// disposable test database.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { Pool } from 'pg';
import { createPool } from './pool.js';

const TEST_DATABASE_URL = process.env['TEST_DATABASE_URL'];
if (TEST_DATABASE_URL && !/_test$/.test(new URL(TEST_DATABASE_URL).pathname)) {
  // Same guardrail PLAN "Test database and reset safety" mandates for the
  // destructive reset: refuse to run AC-19's live-server test against
  // anything whose database name does not end `_test`.
  throw new Error(
    `TEST_DATABASE_URL must point at a database whose name ends "_test" - refusing to run AC-19 against ${TEST_DATABASE_URL}`,
  );
}

test('createPool: sets the five pool config keys verbatim from docs/ARCHITECTURE.md', () => {
  const pool = createPool('postgres://user:pass@localhost:5432/db');
  try {
    assert.equal(pool.options.max, 10);
    assert.equal(pool.options.idleTimeoutMillis, 30_000);
    assert.equal(pool.options.connectionTimeoutMillis, 5_000);
    // statement_timeout/query_timeout are passed through to the
    // underlying `pg.Client` options, not renamed by pg-pool.
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    assert.equal((pool.options as any).statement_timeout, 5_000);
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    assert.equal((pool.options as any).query_timeout, 7_000);
  } finally {
    // No connection was ever opened (no query issued), so end() resolves
    // immediately without touching the network.
    void pool.end();
  }
});

test('createPool: does not mutate its connectionString argument', () => {
  const connectionString = 'postgres://user:pass@localhost:5432/db';
  const pool = createPool(connectionString);
  try {
    assert.equal(connectionString, 'postgres://user:pass@localhost:5432/db');
  } finally {
    void pool.end();
  }
});

test(
  'AC-19a: statement_timeout cancels server-side and the client releases back to the pool clean (reusable)',
  { skip: TEST_DATABASE_URL ? false : 'TEST_DATABASE_URL not set - no live Postgres reachable' },
  async () => {
    // createPool's real 5_000ms statement_timeout, verbatim, against a
    // real server - not a mock, not a shorter override, so this is the
    // exact configured behaviour rather than a proxy for it.
    const pool = createPool(TEST_DATABASE_URL as string);
    try {
      const client = await pool.connect();
      let caught: unknown;
      try {
        // Exceeds the 5_000ms statement_timeout; must be cancelled
        // server-side before the 7_000ms query_timeout backstop would
        // ever fire, so this exercises the statement_timeout path only.
        await client.query('SELECT pg_sleep(6)');
      } catch (err) {
        caught = err;
      } finally {
        // No error passed to release(): a statement_timeout cancellation
        // is a clean server-side abort, and the connection is fit for
        // reuse - the whole point of statement_timeout over query_timeout.
        client.release();
      }

      assert.ok(caught, 'expected the query to reject');
      // Postgres SQLSTATE 57014 = query_canceled, the statement_timeout
      // signature.
      assert.equal((caught as { code?: string }).code, '57014');

      // Prove the released connection is actually reusable, not merely
      // "not thrown on release": borrow again and run a trivial query.
      const client2 = await pool.connect();
      try {
        const res = await client2.query('SELECT 1 AS one');
        assert.equal(res.rows[0].one, 1);
      } finally {
        client2.release();
      }
    } finally {
      await pool.end();
    }
  },
);

test(
  'AC-19b: query_timeout backstop rejects client-side without cancelling, and release(err) destroys the connection instead of returning it to the idle set',
  { skip: TEST_DATABASE_URL ? false : 'TEST_DATABASE_URL not set - no live Postgres reachable' },
  async () => {
    // A dedicated pool, not createPool's real config: statement_timeout
    // disabled so the server never cancels, and a short query_timeout so
    // the client-side readTimeout (pg 8.23.0, lib/client.js:702) is the
    // only thing that can reject this query - isolating the backstop path
    // from the statement_timeout path covered above.
    const pool = new Pool({
      connectionString: TEST_DATABASE_URL,
      max: 1,
      statement_timeout: 0,
      query_timeout: 300,
    });
    try {
      const client = await pool.connect();
      const pidRes = await client.query('SELECT pg_backend_pid() AS pid');
      const backendPid: number = pidRes.rows[0].pid;

      let caught: unknown;
      try {
        // 2s server-side sleep vs. a 300ms client-side query_timeout:
        // the client rejects long before the server would ever finish or
        // cancel it - the readTimeout path, not a server-side cancel.
        await client.query('SELECT pg_sleep(2)');
      } catch (err) {
        caught = err;
      } finally {
        // The backstop contract (design, "Query timeout"): release WITH
        // the error, which pg-pool routes to _remove() rather than the
        // idle set, since the physical connection is still busy running
        // the abandoned query server-side.
        client.release(caught instanceof Error ? caught : new Error('expected a timeout error'));
      }

      assert.ok(caught, 'expected the query to reject client-side');
      assert.match((caught as Error).message.toLowerCase(), /timeout/);

      // Prove it was destroyed, not recycled: a fresh connect() from the
      // same max:1 pool must be a genuinely different backend process,
      // not the one still running pg_sleep(2). If release(err) had
      // returned it to the idle set instead, this would either hang
      // (pool waiting on the still-busy connection) or hand back the
      // same backend pid.
      const client2 = await pool.connect();
      try {
        const pidRes2 = await client2.query('SELECT pg_backend_pid() AS pid');
        assert.notEqual(pidRes2.rows[0].pid, backendPid);
      } finally {
        client2.release();
      }
    } finally {
      await pool.end();
    }
  },
);
