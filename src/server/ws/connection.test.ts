// Drives the ADMIT..RELEASE happy path end to end with a Pool whose
// connect() actually resolves - every other test in this suite
// (admission.test.ts, init-bounds.test.ts) deliberately uses a Pool that
// never resolves, to isolate ADMIT from everything after it. That left
// JOIN, QUERY, GUARD-SEND, BATCH and RELEASE - the most-revised section of
// the design (renumbered three times during review; the site of the
// pool-vs-client resource-inversion defect found and fixed before
// approval) - with zero automated coverage. Found by phase-12 test review,
// closed here rather than only reported: no new fixture kind was needed
// beyond what admission.test.ts/init-bounds.test.ts already established,
// just one that resolves instead of hanging.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import { attachConnectionHandler } from './connection.js';
import { roomSize } from '../rooms.js';
import type { ConnectionContext } from './upgrade.js';
import type { MessageRow } from '../../db/queries/messages.js';

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

function fakeContext(): ConnectionContext {
  return {
    claims: { type: 'guest', userId: 'u1', nickname: 'alice' },
    exp: Date.now() / 1000 + 3600,
    ip: '127.0.0.1',
  };
}

// A client whose connect() and query() both resolve, so the sequence runs
// all the way to RELEASE instead of parking at ACQUIRE. Records exactly
// what it was released with - the specific thing the design's QUERY/RELEASE
// section (and the round-7/8 review findings on double-release and the
// pool-vs-client inversion) is about getting right.
class FakePoolClient {
  released: { called: boolean; error: unknown } = { called: false, error: undefined };
  constructor(private readonly rows: readonly MessageRow[]) {}
  query(): Promise<{ rows: readonly MessageRow[] }> {
    return Promise.resolve({ rows: this.rows });
  }
  release(error?: unknown): void {
    this.released = { called: true, error };
  }
}

class FakePool {
  public lastClient: FakePoolClient | undefined;
  constructor(private readonly rows: readonly MessageRow[] = []) {}
  connect(): Promise<FakePoolClient> {
    this.lastClient = new FakePoolClient(this.rows);
    return Promise.resolve(this.lastClient);
  }
}

// Yields enough microtask/macrotask turns for the ACQUIRE await, the QUERY
// await, and the synchronous JOIN/BATCH/RELEASE that follow each, to all
// settle. Two setImmediate hops (not just microtasks) because pool.connect()
// and client.query() are each their own Promise.resolve() hop.
function flush(): Promise<void> {
  return new Promise((resolve) => setImmediate(() => setImmediate(resolve)));
}

test('connection happy path: a resolving pool joins the room, sends exactly one history frame, and releases the client cleanly', async () => {
  const pool = new FakePool([]);
  const wss = new EventEmitter();
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  attachConnectionHandler(wss as any, pool as any, 'lobby-room-id');

  const ws = new FakeSocket();
  wss.emit('connection', ws, {}, fakeContext());
  await flush();

  assert.equal(roomSize('lobby-room-id'), 1, 'socket must be a room member after JOIN');
  assert.equal(ws.sent.length, 1, 'exactly one frame sent: the history frame (BATCH)');
  const frame: unknown = JSON.parse(ws.sent[0] as string);
  assert.equal((frame as { type: string }).type, 'history');
  assert.deepEqual((frame as { messages: unknown[] }).messages, []);

  assert.ok(pool.lastClient, 'ACQUIRE must have called pool.connect()');
  assert.deepEqual(
    pool.lastClient?.released,
    { called: true, error: undefined },
    'RELEASE must release the client exactly once, with no error, on the clean path',
  );
  assert.equal(ws.closes.length, 0, 'a socket that joined successfully must not be closed');

  ws.emit('close');
  assert.equal(roomSize('lobby-room-id'), 0, 'leaveRoom must run when the socket later closes');
});

test('connection happy path: history rows are normalized to wire shape and delivered in the batch', async () => {
  const row: MessageRow = {
    id: 'm1',
    author_nickname: 'bob',
    body: 'hi',
    created_at: new Date('2026-01-01T00:00:00.000Z'),
  };
  const pool = new FakePool([row]);
  const wss = new EventEmitter();
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  attachConnectionHandler(wss as any, pool as any, 'room-2');

  const ws = new FakeSocket();
  wss.emit('connection', ws, {}, fakeContext());
  await flush();

  const frame = JSON.parse(ws.sent[0] as string) as { messages: { id: string; nickname: string }[] };
  assert.deepEqual(frame.messages, [
    { id: 'm1', nickname: 'bob', body: 'hi', createdAt: '2026-01-01T00:00:00.000Z' },
  ]);

  ws.emit('close');
});
