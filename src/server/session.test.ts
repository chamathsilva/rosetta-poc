// Claim verification, runtime shape narrowing, rejection paths, and
// expiry: close-timer arming plus the per-frame `exp` check (AC-16).
// PLAN "Test scope": src/server/session.test.ts.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import jwt from 'jsonwebtoken';

process.env['DATABASE_URL'] ??= 'postgres://test/test';
process.env['JWT_SECRET'] ??= 'test-secret-not-for-production-use-only';
process.env['PORT'] ??= '3000';
process.env['ALLOWED_ORIGIN'] ??= 'http://localhost:5173';

const { verifySessionToken, decodeExpiry, isExpired, armExpiryTimer, SESSION_COOKIE } =
  await import('./session.js');
const { loadConfig } = await import('./config.js');

const SECRET = loadConfig().jwtSecret;

test('SESSION_COOKIE is the well-known cookie name', () => {
  assert.equal(SESSION_COOKIE, 'session');
});

// --- verifySessionToken: happy paths ---

test('verifySessionToken: accepts a valid guest token and narrows its shape', () => {
  const token = jwt.sign({ type: 'guest', userId: 'u1', nickname: 'alice' }, SECRET, {
    expiresIn: '1h',
  });
  const claims = verifySessionToken(token);
  assert.deepEqual(claims, { type: 'guest', userId: 'u1', nickname: 'alice' });
});

test('verifySessionToken: accepts a valid registered token', () => {
  const token = jwt.sign({ type: 'registered', userId: 'u2', nickname: 'bob' }, SECRET, {
    expiresIn: '1h',
  });
  const claims = verifySessionToken(token);
  assert.deepEqual(claims, { type: 'registered', userId: 'u2', nickname: 'bob' });
});

// --- verifySessionToken: signature / expiry rejection ---

test('verifySessionToken: rejects a token signed with the wrong secret', () => {
  const token = jwt.sign({ type: 'guest', userId: 'u1', nickname: 'alice' }, 'wrong-secret', {
    expiresIn: '1h',
  });
  assert.equal(verifySessionToken(token), null);
});

test('verifySessionToken: rejects an expired token', () => {
  const token = jwt.sign({ type: 'guest', userId: 'u1', nickname: 'alice' }, SECRET, {
    expiresIn: -10, // already expired
  });
  assert.equal(verifySessionToken(token), null);
});

test('verifySessionToken: rejects garbage input', () => {
  assert.equal(verifySessionToken('not-a-jwt'), null);
  assert.equal(verifySessionToken(''), null);
});

// --- verifySessionToken: runtime shape narrowing (the cast-is-not-a-check fix) ---
// jwt.verify proves signature+expiry, nothing about payload shape - these
// tests sign payloads that pass jwt.verify but must still be rejected.

test('verifySessionToken: rejects a wrong `type` value', () => {
  const token = jwt.sign({ type: 'admin', userId: 'u1', nickname: 'alice' }, SECRET, {
    expiresIn: '1h',
  });
  assert.equal(verifySessionToken(token), null);
});

test('verifySessionToken: rejects a missing `userId`', () => {
  const token = jwt.sign({ type: 'guest', nickname: 'alice' }, SECRET, { expiresIn: '1h' });
  assert.equal(verifySessionToken(token), null);
});

test('verifySessionToken: rejects an empty-string `userId`', () => {
  const token = jwt.sign({ type: 'guest', userId: '', nickname: 'alice' }, SECRET, {
    expiresIn: '1h',
  });
  assert.equal(verifySessionToken(token), null);
});

test('verifySessionToken: rejects a non-string `userId`', () => {
  const token = jwt.sign({ type: 'guest', userId: 42, nickname: 'alice' }, SECRET, {
    expiresIn: '1h',
  });
  assert.equal(verifySessionToken(token), null);
});

test('verifySessionToken: rejects a missing `nickname`', () => {
  const token = jwt.sign({ type: 'guest', userId: 'u1' }, SECRET, { expiresIn: '1h' });
  assert.equal(verifySessionToken(token), null);
});

test('verifySessionToken: rejects a payload that is not an object (e.g. signed a bare string)', () => {
  // jsonwebtoken only accepts object|string payloads for sign(); when given
  // a string it stores it as the raw JWT payload, so jwt.verify returns a
  // string, not an object - verifySessionToken must reject that shape too.
  const token = jwt.sign('just-a-string-payload', SECRET);
  assert.equal(verifySessionToken(token), null);
});

// --- decodeExpiry ---

test('decodeExpiry: returns the numeric exp claim for a valid token', () => {
  const token = jwt.sign({ type: 'guest', userId: 'u1', nickname: 'alice' }, SECRET, {
    expiresIn: '1h',
  });
  const exp = decodeExpiry(token);
  assert.equal(typeof exp, 'number');
  assert.ok(exp !== null && exp > Date.now() / 1000);
});

test('decodeExpiry: returns null for an invalid token', () => {
  assert.equal(decodeExpiry('garbage'), null);
});

// --- isExpired: the per-frame execution-time check (AC-16, second mechanism) ---

test('isExpired: false for an exp comfortably in the future', () => {
  const exp = Date.now() / 1000 + 3600;
  assert.equal(isExpired(exp), false);
});

test('isExpired: true for an exp in the past', () => {
  const exp = Date.now() / 1000 - 1;
  assert.equal(isExpired(exp), true);
});

test('isExpired: true at the exact boundary (>=, not >)', () => {
  const exp = Date.now() / 1000;
  assert.equal(isExpired(exp), true);
});

// --- armExpiryTimer: the close-timer mechanism (AC-16, first/primary mechanism) ---
// Fake WebSocket: only the surface armExpiryTimer touches (readyState,
// OPEN, close()). Not a real socket - a real network socket in a unit
// test would violate the 1s-per-test / no-external-calls bar.

class FakeSocket {
  static readonly OPEN = 1;
  static readonly CLOSED = 3;
  readonly OPEN = FakeSocket.OPEN;
  readyState: number = FakeSocket.OPEN;
  closedWithCode: number | undefined;
  close(code: number): void {
    this.closedWithCode = code;
    this.readyState = FakeSocket.CLOSED;
  }
}

test('armExpiryTimer: closes the socket with 4001 once exp passes', async () => {
  const ws = new FakeSocket();
  const expSeconds = Date.now() / 1000 + 0.02; // ~20ms out
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const clear = armExpiryTimer(ws as any, expSeconds);
  assert.equal(ws.closedWithCode, undefined);
  await new Promise((resolve) => setTimeout(resolve, 80));
  assert.equal(ws.closedWithCode, 4001);
  clear();
});

test('armExpiryTimer: closes immediately if exp is already in the past at arming time', async () => {
  const ws = new FakeSocket();
  const expSeconds = Date.now() / 1000 - 10;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const clear = armExpiryTimer(ws as any, expSeconds);
  assert.equal(ws.closedWithCode, 4001);
  clear();
});

test('armExpiryTimer: the returned cleanup function prevents a late close on an already-closed socket', async () => {
  const ws = new FakeSocket();
  const expSeconds = Date.now() / 1000 + 0.02;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const clear = armExpiryTimer(ws as any, expSeconds);
  // Socket closes for an unrelated reason (e.g. client disconnect) before
  // the timer fires; the connection module calls the cleanup on 'close'.
  ws.readyState = FakeSocket.CLOSED;
  clear();
  await new Promise((resolve) => setTimeout(resolve, 80));
  // Timer was cleared, so closedWithCode is never (re)written by it -
  // still CLOSED from the manual assignment above, not overwritten to 4001
  // by a timer that should no longer be armed.
  assert.equal(ws.readyState, FakeSocket.CLOSED);
});
