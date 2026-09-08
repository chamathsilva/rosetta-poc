// Postgres connection pool. Five keys, verbatim from docs/ARCHITECTURE.md
// "Database connection pool" [USER-DECIDED — 2026-09-05, extended
// 2026-09-07]. Do not edit this block - PLAN "H-7": a disagreement at the
// B1 gate is a stop-and-report with that document authoritative.
import { Pool } from 'pg';

export function createPool(connectionString: string): Pool {
  return new Pool({
    connectionString,
    max: 10,
    idleTimeoutMillis: 30_000,
    connectionTimeoutMillis: 5_000,
    statement_timeout: 5_000,
    query_timeout: 7_000,
  });
}
