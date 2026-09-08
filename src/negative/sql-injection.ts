// DELIBERATE DEFECT - validation of the CI gate. Not for merge.
// Untrusted request input concatenated into SQL: CodeQL js/sql-injection.
// This is exactly what docs/PATTERNS/parameterized-pg-queries.md forbids.
import express from 'express';
import { Pool } from 'pg';

const pool = new Pool();
export const router = express.Router();

router.get('/negative', (req, res) => {
  const nickname = String(req.query['nickname']);
  pool.query(`SELECT * FROM users WHERE nickname = '${nickname}'`).then((result) => {
    res.json(result.rows);
  });
});
