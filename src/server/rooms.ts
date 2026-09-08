// Room membership and fan-out. docs/PATTERNS/websocket-room-fanout.md,
// with the declared deviation from the design ("Message flow"): broadcast
// calls `deliver(socket, message)` instead of `socket.send(message)`
// directly, so buffering and the backpressure ceiling apply uniformly.
//
// Imports delivery.ts (a leaf module) for the actual send, never the
// reverse — the design's fix for the `rooms → ws → rooms` cycle that a
// different placement of `deliver` would create.
//
// `leaveRoom` does NOT call broadcastPresence: presence is target state 2
// and not built in this feature. Implemented without that call rather than
// stubbing a presence broadcast with no protocol frame (design, "On send").
import type { WebSocket } from 'ws';
import { deliver } from './delivery.js';

const rooms = new Map<string, Set<WebSocket>>();

export function joinRoom(roomId: string, socket: WebSocket): void {
  let members = rooms.get(roomId);
  if (!members) {
    members = new Set<WebSocket>();
    rooms.set(roomId, members);
  }
  members.add(socket);

  // MUST: registered before any other 'close'/'error' handling for this
  // socket. roomId is captured by the closure - no property is set on the
  // socket (docs/PATTERNS/websocket-room-fanout.md).
  socket.on('close', () => leaveRoom(roomId, socket));
  socket.on('error', () => leaveRoom(roomId, socket));
}

/**
 * Idempotent: `Set.delete` on an absent member and the `if (!members)
 * return` guard both no-op, so `close` and `error` both firing (or a
 * heartbeat `terminate()` racing either) never throws and never needs an
 * "already left" flag (design, edge cases table).
 */
export function leaveRoom(roomId: string, socket: WebSocket): void {
  const members = rooms.get(roomId);
  if (!members) return;
  members.delete(socket);
  if (members.size === 0) rooms.delete(roomId); // MUST: prevent unbounded Map growth
  // No broadcastPresence() call - presence is out of scope (target state 2).
}

export function broadcast(
  roomId: string,
  message: string,
  options: { readonly exclude?: WebSocket } = {},
): void {
  const members = rooms.get(roomId);
  if (!members) return;
  for (const socket of members) {
    if (socket === options.exclude) continue;
    deliver(socket, message); // deliver() owns the readyState guard and backpressure check
  }
}

/** Test-only escape hatch: current membership count for a room, or 0. */
export function roomSize(roomId: string): number {
  return rooms.get(roomId)?.size ?? 0;
}
