// Admission limit and 1013 vs 1011 (AC-17). PLAN "Test scope":
// src/server/ws/admission.test.ts.
//
// ADMIT is the very first synchronous work `handleConnection` does,
// before any `await` - so driving 65 synchronous 'connection' events
// through a fake WebSocketServer, with a Pool whose `connect()` never
// resolves, exercises the real admission counter without needing a live
// database or completing initialization for any of them.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import { attachConnectionHandler } from './connection.js';
import type { ConnectionContext } from './upgrade.js';

class FakeSocket extends EventEmitter {
  static readonly OPEN = 1;
  static readonly CLOSED = 3;
  readonly OPEN = FakeSocket.OPEN;
  readyState: number = FakeSocket.OPEN;
  bufferedAmount = 0;
  closes: number[] = [];
  send(): void {
    /* not exercised in this test */
  }
  close(code: number): void {
    this.closes.push(code);
    this.readyState = FakeSocket.CLOSED;
  }
}

function fakeContext(): ConnectionContext {
  return {
    claims: { type: 'guest', userId: 'u1', nickname: 'alice' },
    exp: Date.now() / 1000 + 3600, // 1h out - armExpiryTimer must not fire
    ip: '127.0.0.1',
  };
}

// A Pool stand-in whose connect() never resolves, so every admitted
// connection parks at ACQUIRE forever - exactly what this test needs: it
// isolates the ADMIT check from everything after it. Not a mock of a
// "regular class" - `pg.Pool` is an external database client, squarely
// within the testing skill's "mock external calls only" policy.
class NeverConnectingPool {
  connect(): Promise<never> {
    return new Promise(() => {
      /* never settles */
    });
  }
}

test('admission: the 65th concurrent connection is refused 1013; the first 64 are unaffected', () => {
  const wss = new EventEmitter();
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  attachConnectionHandler(wss as any, new NeverConnectingPool() as any, 'lobby-room-id');

  const sockets: FakeSocket[] = [];
  for (let i = 0; i < 65; i++) {
    const ws = new FakeSocket();
    sockets.push(ws);
    wss.emit('connection', ws, {}, fakeContext());
  }

  const admitted = sockets.slice(0, 64);
  const refused = sockets[64];
  assert.ok(refused);

  for (const ws of admitted) {
    assert.deepEqual(ws.closes, [], 'admitted sockets must not be closed by ADMIT');
    assert.equal(ws.readyState, FakeSocket.OPEN);
  }
  assert.deepEqual(refused.closes, [1013]);
  assert.equal(refused.readyState, FakeSocket.CLOSED);
});

test('admission: 1013 (admission refusal) is a distinct code from 1011 (internal error)', () => {
  // Documents the two close codes are not the same value - AC-17
  // "distinguishable from 1011". The 1011 path itself (an init-time
  // failure) is covered by ws/init-bounds.test.ts.
  assert.notEqual(1013, 1011);
});

// A prior version of this file had a third test here claiming to cover
// "freeing a slot allows a new admission." Removed (phase-12 test review):
// with `NeverConnectingPool`, RELEASE's `admittedCount--` never runs, so
// nothing in that test could free a slot - its assertion
// (`closes.length === 0 || closes[0] === 1013`) was true for every
// possible outcome of this code, tautologically, regardless of whether
// admission logic was correct. The real "a slot frees on RELEASE" property
// is covered by `ws/connection.test.ts`'s happy-path test, which uses a
// pool that actually resolves and asserts the client was released.
