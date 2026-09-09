// Data-retention task. Erases IP addresses once they are no longer
// operationally needed while keeping the records they belong to —
// docs/ARCHITECTURE.md "Retention rule". Invoked daily by a systemd timer
// (`deploy/systemd/rosetta-chat-retention.{service,timer}`, owned by
// another batch) via the CLI entry point at the bottom of this file.
// GATED-DEPLOY-SPECS.md §2.2 is the contract this file implements.
//
// Three statements, ONE transaction, fixed order (messages -> bans ->
// users). One transaction because a partially-applied run would report
// success while only half-keeping the retention promise —
// docs/TODO.md:63.
//
// Statement 2 (`bans.ip -> NULL`) is GUARDED on the `bans` relation's
// existence, and this guard is the load-bearing part of this file.
// `bans` is approved-but-unmigrated
// (src/db/migrations/1757800001_users_rooms_messages.sql:4-6 says so in
// its own comment). Unguarded, Postgres aborts the *whole* transaction the
// moment it hits a missing relation, which would roll statement 1 back
// with it — so `messages.ip`, the entire reason this task exists, would
// never be erased, forever, while the job still reported success. [S]
// user decision 2026-09-08: guard it so it no-ops cleanly today; do not
// land the moderation migration just to satisfy this task. Wiring
// statement 2 in for real is a docs/TODO.md follow-up once `bans` exists.
import type { Pool } from 'pg';
import { GUEST_TTL_MS } from '../server/session.js';

// Retention cutoffs are decisions, not configuration, so they stay as
// constants in code — docs/PATTERNS/env-config-secrets.md: "Values that
// are decisions ... stay as constants in code. Making a decided value
// env-tunable creates a second copy that drifts from the decision."
const DAY_MS = 24 * 60 * 60 * 1000;

/** docs/ARCHITECTURE.md "Retention rule": messages.ip kept 30 days. */
const MESSAGE_IP_RETENTION_MS = 30 * DAY_MS;

/** docs/ARCHITECTURE.md "Retention rule": bans.ip kept until 30 days after
 * the ban expires. */
const BAN_IP_RETENTION_MS = 30 * DAY_MS;

/**
 * Guest reap bound. This MUST be the same value the guest JWT is issued
 * with (`src/server/session.ts`), not a second literal — otherwise the
 * two silently drift apart (AC-RET-7). Exported so the test suite can
 * assert equality against `GUEST_TTL_MS` directly rather than trusting
 * this file's own arithmetic.
 */
export const GUEST_REAP_MS: number = GUEST_TTL_MS;

export interface RetentionResult {
  /** Rows where `messages.ip` was set to NULL. The message row itself is
   * always retained — this task erases the address, never the record. */
  readonly messagesIpNulled: number;
  /**
   * Rows where `bans.ip` was set to NULL, or `null` if statement 2 was
   * SKIPPED because the `bans` relation does not exist yet. `null` (skip)
   * and `0` (ran, matched nothing) are deliberately distinct values — a
   * caller that logs or monitors this field can tell a guarded no-op from
   * a working eraser that simply found nothing to do.
   */
  readonly bansIpNulled: number | null;
  /** Guest `users` rows deleted because `last_seen_at` is older than
   * `GUEST_REAP_MS`. Their `messages` rows survive: `author_id` -> NULL
   * (ON DELETE SET NULL), `author_nickname` snapshot intact. */
  readonly guestsDeleted: number;
}

/**
 * Runs the retention task. `now` is injectable so tests can assert exact
 * boundary behaviour without depending on wall-clock time
 * (GATED-DEPLOY-PLAN.md B3 notes: "Backdate fixtures with explicit
 * timestamps; never `now()`-relative fixtures").
 */
export async function runRetention(pool: Pool, now: Date = new Date()): Promise<RetentionResult> {
  const messageCutoff = new Date(now.getTime() - MESSAGE_IP_RETENTION_MS);
  const banCutoff = new Date(now.getTime() - BAN_IP_RETENTION_MS);
  const guestCutoff = new Date(now.getTime() - GUEST_REAP_MS);

  const client = await pool.connect();
  try {
    await client.query('BEGIN');

    // 1. messages.ip -> NULL. Row retained (docs/ARCHITECTURE.md
    // "Retention rule"); `deleted_at`/body are untouched — nulling is a
    // hard erase of the address only.
    const messagesResult = await client.query(
      `UPDATE messages
          SET ip = NULL
        WHERE ip IS NOT NULL
          AND created_at < $1`,
      [messageCutoff],
    );

    // 2. bans.ip -> NULL, GUARDED on relation existence — see file header.
    // to_regclass returns NULL when the relation does not exist and never
    // throws, so this check itself cannot abort the transaction.
    const relationCheck = await client.query<{ regclass: string | null }>(
      `SELECT to_regclass('public.bans') AS regclass`,
    );
    const bansTableExists = relationCheck.rows[0]?.regclass != null;

    let bansIpNulled: number | null;
    if (bansTableExists) {
      const bansResult = await client.query(
        `UPDATE bans
            SET ip = NULL
          WHERE ip IS NOT NULL
            AND expires_at < $1`,
        [banCutoff],
      );
      bansIpNulled = bansResult.rowCount ?? 0;
    } else {
      // Distinguishable from "ran, matched zero rows" (RetentionResult
      // doc comment) — this is the guarded no-op, logged so a skip is
      // visible in journald rather than silent.
      bansIpNulled = null;
      console.warn(
        'retention: "bans" relation does not exist yet - statement 2 (bans.ip erasure) skipped; see docs/TODO.md',
      );
    }

    // 3. Reap guest users. `bans.created_by` and
    // `moderation_actions.actor_id` are NOT NULL REFERENCES users(id) with
    // no ON DELETE action (docs/ARCHITECTURE.md), so deleting a
    // referenced user would abort this same transaction rather than
    // silently corrupting data — filtering to `is_guest` keeps this
    // statement from ever reaching such a row in practice.
    const usersResult = await client.query(
      `DELETE FROM users
        WHERE is_guest
          AND last_seen_at < $1`,
      [guestCutoff],
    );

    await client.query('COMMIT');

    return {
      messagesIpNulled: messagesResult.rowCount ?? 0,
      bansIpNulled,
      guestsDeleted: usersResult.rowCount ?? 0,
    };
  } catch (err) {
    await client.query('ROLLBACK');
    throw err;
  } finally {
    client.release();
  }
}

// --- CLI entry point --------------------------------------------------
//
// Invoked by `rosetta-chat-retention.service` (a systemd oneshot unit
// owned by a different batch) as:
//   node dist/db/retention.js
// with no arguments — the unit is a stable host contract
// (GATED-DEPLOY-SPECS.md §2.2). `pool.end()` is mandatory: without it the
// oneshot process hangs for `idleTimeoutMillis` (30s,
// docs/ARCHITECTURE.md "Database connection pool") before systemd sees it
// exit (AC-RET-8).
//
// Reads DATABASE_URL directly rather than via `loadConfig()`: this
// process needs only a database connection, and `loadConfig()`'s REQUIRED
// list (JWT_SECRET, PORT, ALLOWED_ORIGIN) has nothing to do with
// retention — forcing this unit's EnvironmentFile to carry variables it
// never uses would be the same anti-pattern config.ts's own comment
// warns against for TEST_DATABASE_URL.
async function main(): Promise<void> {
  const { createPool } = await import('./pool.js');
  const connectionString = process.env['DATABASE_URL'];
  if (!connectionString) {
    throw new Error('DATABASE_URL is not set - refusing to run retention with no target.');
  }

  const pool = createPool(connectionString);
  try {
    const result = await runRetention(pool);
    // One structured line, all three counts, so a single journalctl grep
    // shows the whole outcome (GATED-DEPLOY-SPECS.md §2.2, "log one
    // structured line with all three counts").
    console.log(
      JSON.stringify({
        task: 'retention',
        messagesIpNulled: result.messagesIpNulled,
        bansIpNulled: result.bansIpNulled,
        guestsDeleted: result.guestsDeleted,
      }),
    );
  } finally {
    await pool.end();
  }
}

// Only run the CLI when this module is the process entry point, not when
// `runRetention`/`GUEST_REAP_MS` are imported by the test suite.
if (import.meta.url === `file://${process.argv[1]}`) {
  main().catch((err: unknown) => {
    console.error(err);
    process.exitCode = 1;
  });
}
