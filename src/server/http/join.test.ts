// POST /api/join handler logic, unit-tested without a live database - the
// specific evidence the B1 gate asks for: "POST /api/join sets a cookie,
// verifiable via a unit test of the handler logic even without a live DB."
// AC-1 (fresh join), AC-2/nickname race (409 on unique_violation, no
// pre-check SELECT), AC-3 (invalid nickname -> 400, no row), AC-15
// (idempotent join: valid cookie -> 200 from existing claims, no INSERT,
// no new cookie).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import jwt from 'jsonwebtoken';

process.env['DATABASE_URL'] ??= 'postgres://test/test';
process.env['JWT_SECRET'] ??= 'test-secret-not-for-production-use-only';
process.env['PORT'] ??= '3000';
process.env['ALLOWED_ORIGIN'] ??= 'http://localhost:5173';

const { createJoinHandler } = await import('./join.js');
const { SESSION_COOKIE } = await import('../session.js');
const { loadConfig } = await import('../config.js');

const SECRET = loadConfig().jwtSecret;

// Fake Express Request/Response - the "external call" this handler makes
// is the database query (via the fake Pool below); Express req/res are
// plain data objects, not external systems, so building lightweight fakes
// for them (rather than spinning up a real HTTP server) matches the
// testing skill's "mock external calls only" policy.
function fakeReq(body: unknown, cookieToken?: string): { body: unknown; cookies: Record<string, string> } {
  return { body, cookies: cookieToken !== undefined ? { [SESSION_COOKIE]: cookieToken } : {} };
}

class FakeRes {
  statusCode: number | undefined;
  body: unknown;
  cookies: Array<{ name: string; value: string; options: unknown }> = [];
  status(code: number): this {
    this.statusCode = code;
    return this;
  }
  json(payload: unknown): this {
    this.body = payload;
    return this;
  }
  cookie(name: string, value: string, options: unknown): this {
    this.cookies.push({ name, value, options });
    return this;
  }
  end(): this {
    return this;
  }
}

// Fake Pool: the one external call this handler makes. Records whether
// query() was ever invoked, so the idempotent path (AC-15) can assert
// "no INSERT" directly rather than inferring it from the response alone.
class FakePool {
  queries: Array<{ text: string; values: unknown[] }> = [];
  nextResult: { rows: Array<Record<string, unknown>> } | Error = { rows: [{ id: 'user-1' }] };
  query(text: string, values: unknown[]): Promise<{ rows: Array<Record<string, unknown>> }> {
    this.queries.push({ text, values });
    if (this.nextResult instanceof Error) return Promise.reject(this.nextResult);
    return Promise.resolve(this.nextResult);
  }
}

test('join: fresh nickname, no cookie -> 200, server-normalized nickname, issues a Set-Cookie, and INSERTs exactly once (AC-1)', async () => {
  const pool = new FakePool();
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const handler = createJoinHandler(pool as any);
  const req = fakeReq({ nickname: '  alice  ' });
  const res = new FakeRes();

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  await handler(req as any, res as any);

  assert.equal(res.statusCode, 200);
  assert.deepEqual(res.body, { nickname: 'alice' }); // server-normalized (trimmed)
  assert.equal(pool.queries.length, 1); // exactly one INSERT, no pre-check SELECT
  assert.equal(res.cookies.length, 1);
  assert.equal(res.cookies[0]?.name, SESSION_COOKIE);
});

test('join: invalid nickname (too short) -> 400, no query issued at all (AC-3)', async () => {
  const pool = new FakePool();
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const handler = createJoinHandler(pool as any);
  const req = fakeReq({ nickname: 'a' });
  const res = new FakeRes();

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  await handler(req as any, res as any);

  assert.equal(res.statusCode, 400);
  assert.equal(pool.queries.length, 0); // no row created
  assert.equal(res.cookies.length, 0);
});

test('join: nickname collision -> 409, unique_violation surfaced from the INSERT (AC-2, no pre-check SELECT)', async () => {
  const pool = new FakePool();
  const err = Object.assign(new Error('duplicate key'), { code: '23505' });
  pool.nextResult = err;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const handler = createJoinHandler(pool as any);
  const req = fakeReq({ nickname: 'alice' });
  const res = new FakeRes();

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  await handler(req as any, res as any);

  assert.equal(res.statusCode, 409);
  assert.deepEqual(res.body, { error: 'nickname_taken' });
  assert.equal(res.cookies.length, 0);
});

test('join: valid session cookie -> 200 from existing claims, no INSERT, no new cookie (AC-15)', async () => {
  const pool = new FakePool();
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const handler = createJoinHandler(pool as any);
  const token = jwt.sign({ type: 'guest', userId: 'u1', nickname: 'existing-nick' }, SECRET, {
    expiresIn: '1h',
  });
  const req = fakeReq({ nickname: 'ignored-should-not-matter' }, token);
  const res = new FakeRes();

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  await handler(req as any, res as any);

  assert.equal(res.statusCode, 200);
  assert.deepEqual(res.body, { nickname: 'existing-nick' });
  assert.equal(pool.queries.length, 0, 'idempotent join must not INSERT');
  assert.equal(res.cookies.length, 0, 'idempotent join must not issue a new cookie');
});

test('join: an invalid/expired cookie is treated as no cookie - falls through to a fresh join', async () => {
  const pool = new FakePool();
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const handler = createJoinHandler(pool as any);
  const expired = jwt.sign({ type: 'guest', userId: 'u1', nickname: 'old-nick' }, SECRET, {
    expiresIn: -10,
  });
  const req = fakeReq({ nickname: 'newnick' }, expired);
  const res = new FakeRes();

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  await handler(req as any, res as any);

  assert.equal(res.statusCode, 200);
  assert.deepEqual(res.body, { nickname: 'newnick' });
  assert.equal(pool.queries.length, 1); // a fresh join, INSERT did happen
  assert.equal(res.cookies.length, 1); // a new cookie was issued
});
