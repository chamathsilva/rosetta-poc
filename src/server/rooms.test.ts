// Room membership and fan-out. docs/PATTERNS/websocket-room-fanout.md +
// design's declared deviation (broadcast calls deliver(), not
// socket.send() directly). PLAN "Test scope": src/server/rooms.test.ts -
// "membership; leaveRoom on close, error, terminate".
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import { joinRoom, leaveRoom, broadcast, roomSize } from './rooms.js';

// Fake WebSocket: a real `ws.WebSocket` extends EventEmitter and exposes
// on/emit, readyState/OPEN, send() and bufferedAmount - this fake
// implements exactly that surface so joinRoom's `socket.on('close', ...)`
// registration and delivery.ts's `deliver()` guard both work unmodified.
// Not a real network socket - per the testing skill's mocking policy, a
// live network connection has no place in a sub-second unit test.
class FakeSocket extends EventEmitter {
  static readonly OPEN = 1;
  static readonly CLOSED = 3;
  readonly OPEN = FakeSocket.OPEN;
  readyState: number = FakeSocket.OPEN;
  bufferedAmount = 0;
  sent: string[] = [];
  send(data: string): void {
    this.sent.push(data);
  }
  close(): void {
    this.readyState = FakeSocket.CLOSED;
  }
}

function freshRoomId(): string {
  // Each test uses its own room id so the module-level `rooms` Map in
  // rooms.ts never leaks state between tests (isolation, testing skill).
  return `room-${Math.random().toString(36).slice(2)}`;
}

test('joinRoom: a joined socket is counted in roomSize', () => {
  const roomId = freshRoomId();
  const ws = new FakeSocket();
  assert.equal(roomSize(roomId), 0);
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  joinRoom(roomId, ws as any);
  assert.equal(roomSize(roomId), 1);
});

test('broadcast: delivers to every OPEN member, guarding readyState', () => {
  const roomId = freshRoomId();
  const a = new FakeSocket();
  const b = new FakeSocket();
  const closed = new FakeSocket();
  closed.readyState = FakeSocket.CLOSED;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  joinRoom(roomId, a as any);
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  joinRoom(roomId, b as any);

  broadcast(roomId, 'hello');

  assert.deepEqual(a.sent, ['hello']);
  assert.deepEqual(b.sent, ['hello']);
  // `closed` was never joined in this test, so it is not a room member -
  // this just documents that a socket outside the Set never receives
  // anything, independent of readyState.
  assert.deepEqual(closed.sent, []);
});

test('broadcast: skips a member whose readyState is not OPEN (guard dead sockets)', () => {
  const roomId = freshRoomId();
  const alive = new FakeSocket();
  const dead = new FakeSocket();
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  joinRoom(roomId, alive as any);
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  joinRoom(roomId, dead as any);
  dead.readyState = FakeSocket.CLOSED; // died after joining, before broadcast

  broadcast(roomId, 'hi');

  assert.deepEqual(alive.sent, ['hi']);
  assert.deepEqual(dead.sent, []); // no throw, no send to the dead socket
});

test('broadcast: exclude option skips exactly the sender', () => {
  const roomId = freshRoomId();
  const sender = new FakeSocket();
  const other = new FakeSocket();
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  joinRoom(roomId, sender as any);
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  joinRoom(roomId, other as any);

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  broadcast(roomId, 'echo', { exclude: sender as any });

  assert.deepEqual(sender.sent, []);
  assert.deepEqual(other.sent, ['echo']);
});

test('broadcast: a room with no members is a silent no-op', () => {
  assert.doesNotThrow(() => broadcast(freshRoomId(), 'nobody home'));
});

test('leaveRoom: removing the last member deletes the room, and it is re-creatable', () => {
  const roomId = freshRoomId();
  const ws = new FakeSocket();
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  joinRoom(roomId, ws as any);
  assert.equal(roomSize(roomId), 1);

  leaveRoom(roomId, ws as unknown as never);
  assert.equal(roomSize(roomId), 0);

  // The next joiner re-creates the room Map entry from scratch.
  const ws2 = new FakeSocket();
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  joinRoom(roomId, ws2 as any);
  assert.equal(roomSize(roomId), 1);
});

test("leaveRoom: 'close' event triggers cleanup via joinRoom's own handler", () => {
  const roomId = freshRoomId();
  const ws = new FakeSocket();
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  joinRoom(roomId, ws as any);
  assert.equal(roomSize(roomId), 1);

  ws.emit('close');

  assert.equal(roomSize(roomId), 0);
});

test("leaveRoom: 'error' event also triggers cleanup", () => {
  const roomId = freshRoomId();
  const ws = new FakeSocket();
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  joinRoom(roomId, ws as any);

  ws.emit('error', new Error('boom'));

  assert.equal(roomSize(roomId), 0);
});

test('leaveRoom: idempotent - close then error both firing does not throw and does not double-count', () => {
  const roomId = freshRoomId();
  const ws = new FakeSocket();
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  joinRoom(roomId, ws as any);

  assert.doesNotThrow(() => {
    ws.emit('close');
    ws.emit('error', new Error('boom'));
  });
  assert.equal(roomSize(roomId), 0);
});

test('leaveRoom: called on a socket that was never joined (or an unknown room) is a no-op', () => {
  const roomId = freshRoomId();
  const ws = new FakeSocket();
  assert.doesNotThrow(() => leaveRoom(roomId, ws as unknown as never));
  assert.doesNotThrow(() => leaveRoom('never-existed', ws as unknown as never));
});

test('leaveRoom: a second tab (same identity, two sockets) - both are independent members, no dedup', () => {
  const roomId = freshRoomId();
  const tabA = new FakeSocket();
  const tabB = new FakeSocket();
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  joinRoom(roomId, tabA as any);
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  joinRoom(roomId, tabB as any);
  assert.equal(roomSize(roomId), 2);

  broadcast(roomId, 'msg');
  assert.deepEqual(tabA.sent, ['msg']);
  assert.deepEqual(tabB.sent, ['msg']);

  leaveRoom(roomId, tabA as unknown as never);
  assert.equal(roomSize(roomId), 1); // tabB remains, room itself survives
});
