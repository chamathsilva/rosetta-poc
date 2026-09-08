// Raw 'upgrade' handling for /ws - Origin allowlist and session checks,
// all of which happen before ACQUIRE and are therefore testable without a
// database. AC-4 (no/invalid session refused before handshake), AC-5
// (disallowed Origin refused 403 even with a valid cookie).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import jwt from 'jsonwebtoken';

process.env['DATABASE_URL'] ??= 'postgres://test/test';
process.env['JWT_SECRET'] ??= 'test-secret-not-for-production-use-only';
process.env['PORT'] ??= '3000';
process.env['ALLOWED_ORIGIN'] ??= 'http://localhost:5173';

const { attachUpgradeHandler } = await import('./upgrade.js');
const { SESSION_COOKIE } = await import('../session.js');
const { loadConfig } = await import('../config.js');

const SECRET = loadConfig().jwtSecret;
const ALLOWED_ORIGIN = loadConfig().allowedOrigin;

class FakeSocket extends EventEmitter {
  written: string[] = [];
  destroyed = false;
  write(data: string): boolean {
    this.written.push(data);
    return true;
  }
  destroy(): void {
    this.destroyed = true;
  }
}

class FakeServer extends EventEmitter {}

class FakeWss extends EventEmitter {
  handleUpgradeCalls = 0;
  handleUpgrade(
    _req: unknown,
    _socket: unknown,
    _head: unknown,
    cb: (ws: unknown) => void,
  ): void {
    this.handleUpgradeCalls++;
    cb({ fake: 'websocket' });
  }
}

function validToken(): string {
  return jwt.sign({ type: 'guest', userId: 'u1', nickname: 'alice' }, SECRET, {
    expiresIn: '1h',
  });
}

function emitUpgrade(
  server: FakeServer,
  opts: { path?: string; origin?: string; cookie?: string },
): FakeSocket {
  const socket = new FakeSocket();
  const req = {
    url: opts.path ?? '/ws',
    headers: {
      origin: opts.origin,
      cookie: opts.cookie,
    },
    socket: { remoteAddress: '127.0.0.1' },
  };
  server.emit('upgrade', req, socket, Buffer.alloc(0));
  return socket;
}

test('upgrade: rejects a path other than /ws with 404, destroys the socket, never completes the handshake', () => {
  const server = new FakeServer();
  const wss = new FakeWss();
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  attachUpgradeHandler(server as any, wss as any, ALLOWED_ORIGIN);

  const socket = emitUpgrade(server, { path: '/not-ws', origin: ALLOWED_ORIGIN, cookie: `${SESSION_COOKIE}=${validToken()}` });

  assert.equal(socket.destroyed, true);
  assert.match(socket.written[0] ?? '', /^HTTP\/1\.1 404/);
  assert.equal(wss.handleUpgradeCalls, 0);
});

test('upgrade: rejects a disallowed Origin with 403, even with a valid session cookie (AC-5)', () => {
  const server = new FakeServer();
  const wss = new FakeWss();
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  attachUpgradeHandler(server as any, wss as any, ALLOWED_ORIGIN);

  const socket = emitUpgrade(server, {
    origin: 'https://evil.example.com',
    cookie: `${SESSION_COOKIE}=${validToken()}`,
  });

  assert.equal(socket.destroyed, true);
  assert.match(socket.written[0] ?? '', /^HTTP\/1\.1 403/);
  assert.equal(wss.handleUpgradeCalls, 0);
});

test('upgrade: rejects a missing Origin header (no CORS preflight exists for a WS upgrade)', () => {
  const server = new FakeServer();
  const wss = new FakeWss();
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  attachUpgradeHandler(server as any, wss as any, ALLOWED_ORIGIN);

  const socket = emitUpgrade(server, { cookie: `${SESSION_COOKIE}=${validToken()}` });

  assert.equal(socket.destroyed, true);
  assert.match(socket.written[0] ?? '', /^HTTP\/1\.1 403/);
});

test('upgrade: rejects a missing session cookie with 401 (AC-4)', () => {
  const server = new FakeServer();
  const wss = new FakeWss();
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  attachUpgradeHandler(server as any, wss as any, ALLOWED_ORIGIN);

  const socket = emitUpgrade(server, { origin: ALLOWED_ORIGIN });

  assert.equal(socket.destroyed, true);
  assert.match(socket.written[0] ?? '', /^HTTP\/1\.1 401/);
  assert.equal(wss.handleUpgradeCalls, 0);
});

test('upgrade: rejects an invalid/expired session cookie with 401', () => {
  const server = new FakeServer();
  const wss = new FakeWss();
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  attachUpgradeHandler(server as any, wss as any, ALLOWED_ORIGIN);

  const expired = jwt.sign({ type: 'guest', userId: 'u1', nickname: 'alice' }, SECRET, {
    expiresIn: -10,
  });
  const socket = emitUpgrade(server, { origin: ALLOWED_ORIGIN, cookie: `${SESSION_COOKIE}=${expired}` });

  assert.equal(socket.destroyed, true);
  assert.match(socket.written[0] ?? '', /^HTTP\/1\.1 401/);
});

test('upgrade: correct path, allowed Origin, valid cookie -> handshake completes via wss.handleUpgrade', () => {
  const server = new FakeServer();
  const wss = new FakeWss();
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  attachUpgradeHandler(server as any, wss as any, ALLOWED_ORIGIN);

  const socket = emitUpgrade(server, { origin: ALLOWED_ORIGIN, cookie: `${SESSION_COOKIE}=${validToken()}` });

  assert.equal(socket.destroyed, false);
  assert.equal(wss.handleUpgradeCalls, 1);
});

test('upgrade: reads the session cookie correctly when other cookies are present alongside it', () => {
  const server = new FakeServer();
  const wss = new FakeWss();
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  attachUpgradeHandler(server as any, wss as any, ALLOWED_ORIGIN);

  const socket = emitUpgrade(server, {
    origin: ALLOWED_ORIGIN,
    cookie: `other=ignored; ${SESSION_COOKIE}=${validToken()}; another=also-ignored`,
  });

  assert.equal(socket.destroyed, false);
  assert.equal(wss.handleUpgradeCalls, 1);
});
