// Initialization bounds (AC-18): the 1 MiB outbound buffer cap
// (src/server/delivery.ts) and the 32-frame inbound queue
// (src/server/ws/connection.ts, pre-JOIN). PLAN "Test scope":
// src/server/ws/init-bounds.test.ts.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import { openBuffer, closeBuffer, deliver, getBufferedFrames, BYTE_CEILING } from '../delivery.js';
import { attachConnectionHandler } from './connection.js';
import type { ConnectionContext } from './upgrade.js';

class FakeSocket extends EventEmitter {
  static readonly OPEN = 1;
  static readonly CLOSED = 3;
  readonly OPEN = FakeSocket.OPEN;
  readyState: number = FakeSocket.OPEN;
  bufferedAmount = 0;
  closes: number[] = [];
  sent: string[] = [];
  send(data: string): void {
    this.sent.push(data);
  }
  close(code: number): void {
    this.closes.push(code);
    this.readyState = FakeSocket.CLOSED;
  }
}

// --- Outbound 1 MiB init-buffer cap (delivery.ts) ---

test('BYTE_CEILING is 1 MiB', () => {
  assert.equal(BYTE_CEILING, 1 * 1024 * 1024);
});

test('deliver: frames buffer (not send) while a socket is initializing', () => {
  const ws = new FakeSocket();
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  openBuffer(ws as any);
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  deliver(ws as any, 'frame-1');
  assert.deepEqual(ws.sent, []); // not sent directly
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  assert.deepEqual(getBufferedFrames(ws as any), ['frame-1']);
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  closeBuffer(ws as any);
});

test('deliver: crossing the 1 MiB cumulative cap while initializing closes 1011 and drops the overflowing frame', () => {
  const ws = new FakeSocket();
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  openBuffer(ws as any);

  const frame = 'x'.repeat(100_000); // 100,000 bytes (ASCII, 1 byte/char)
  const framesToFit = Math.floor(BYTE_CEILING / frame.length); // 10, at 1,000,000 bytes total

  for (let i = 0; i < framesToFit; i++) {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    deliver(ws as any, frame);
  }
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  assert.equal(getBufferedFrames(ws as any).length, framesToFit);
  assert.deepEqual(ws.closes, []);

  // One more frame pushes cumulative bytes over 1 MiB (1,100,000 > 1,048,576).
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  deliver(ws as any, frame);

  assert.deepEqual(ws.closes, [1011]);
  assert.equal(ws.readyState, FakeSocket.CLOSED);
  // The overflowing frame is dropped, not queued - the buffer was cleared
  // by deliver() itself on overflow.
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  assert.deepEqual(getBufferedFrames(ws as any), []);
});

test('deliver: the projection is exact at the boundary - exactly 1 MiB does not overflow, 1 byte more does', () => {
  const ws = new FakeSocket();
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  openBuffer(ws as any);

  const exact = 'x'.repeat(BYTE_CEILING);
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  deliver(ws as any, exact);
  assert.deepEqual(ws.closes, []); // exactly at the ceiling, not over it

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  deliver(ws as any, 'y');
  assert.deepEqual(ws.closes, [1011]);
});

// --- Steady-state backpressure (deliver(), no init buffer open) ---
// Companion to the init-buffer cap above: deliver()'s OTHER branch (no
// openBuffer() called - i.e. a socket that has already passed BATCH) checks
// the PROJECTED ws.bufferedAmount rather than an internal running total,
// and closes 1013 (not 1011 - a stalled peer is load-shedding, not an
// internal error) per design "Backpressure: a bufferedAmount ceiling,
// checked in deliver()". Added because no test in this suite previously
// exercised this branch: the two init-buffer tests above only ever call
// deliver() after openBuffer(), which takes the other branch entirely.

test('deliver: steady state (no init buffer) - projected bufferedAmount over the ceiling closes 1013, frame dropped not sent', () => {
  const ws = new FakeSocket();
  // Simulates a stalled peer: the kernel/ws send buffer already holds
  // just under the ceiling from prior sends that were never read.
  ws.bufferedAmount = BYTE_CEILING - 10;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  deliver(ws as any, 'x'.repeat(20)); // projected: ceiling - 10 + 20 > ceiling
  assert.deepEqual(ws.closes, [1013]); // load-shedding code, not 1011
  assert.deepEqual(ws.sent, []); // in-flight frame is dropped, not queued or sent
});

test('deliver: steady state - a frame that fits within the projected ceiling is sent normally', () => {
  const ws = new FakeSocket();
  ws.bufferedAmount = 100;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  deliver(ws as any, 'hello');
  assert.deepEqual(ws.sent, ['hello']);
  assert.deepEqual(ws.closes, []);
});

test('deliver: steady state - the projection is exact at the boundary, matching the init-buffer boundary test above', () => {
  const ws = new FakeSocket();
  const frame = 'x'.repeat(100);
  ws.bufferedAmount = BYTE_CEILING - frame.length; // exactly at the ceiling after this send
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  deliver(ws as any, frame);
  assert.deepEqual(ws.closes, []); // exactly at the ceiling, not over it
  assert.deepEqual(ws.sent, [frame]);

  ws.bufferedAmount += frame.length; // now genuinely at the ceiling
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  deliver(ws as any, 'y'); // one byte over
  assert.deepEqual(ws.closes, [1013]);
});

// --- Inbound 32-frame pre-JOIN queue (connection.ts) ---

function fakeContext(): ConnectionContext {
  return {
    claims: { type: 'guest', userId: 'u1', nickname: 'alice' },
    exp: Date.now() / 1000 + 3600,
    ip: '127.0.0.1',
  };
}

class NeverConnectingPool {
  connect(): Promise<never> {
    return new Promise(() => {
      /* never settles - keeps the socket permanently pre-JOIN at ACQUIRE */
    });
  }
}

test('inbound queue: the 33rd frame enqueued before JOIN closes 1011 (32-frame cap, AC-18)', () => {
  const wss = new EventEmitter();
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  attachConnectionHandler(wss as any, new NeverConnectingPool() as any, 'lobby-room-id');

  const ws = new FakeSocket();
  wss.emit('connection', ws, {}, fakeContext());

  // The socket is now parked at ACQUIRE (connect() never resolves), so
  // every 'message' event lands in the pre-JOIN parked chain.
  for (let i = 0; i < 32; i++) {
    ws.emit('message', Buffer.from(JSON.stringify({ type: 'send', body: `msg-${i}` })), false);
  }
  assert.deepEqual(ws.closes, [], 'first 32 queued frames must not trip the cap');

  ws.emit('message', Buffer.from(JSON.stringify({ type: 'send', body: 'msg-32' })), false);
  assert.deepEqual(ws.closes, [1011]);
});
