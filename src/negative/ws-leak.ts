// DELIBERATE DEFECT - validation of the AI reviewer. Not for merge.
// Known bug class for the in-process room design (docs/ARCHITECTURE.md,
// docs/PATTERNS/websocket-room-fanout.md): the socket is added to the room
// Set and never removed on close or error, so presence keeps ghost users
// and broadcast throws on closed sockets.
import type { WebSocket } from 'ws';

const rooms = new Map<string, Set<WebSocket>>();

export function joinRoom(roomId: string, socket: WebSocket): void {
  let members = rooms.get(roomId);
  if (!members) {
    members = new Set<WebSocket>();
    rooms.set(roomId, members);
  }
  members.add(socket);
  // No socket.on('close', ...) and no socket.on('error', ...) cleanup.
}

export function broadcast(roomId: string, payload: string): void {
  for (const socket of rooms.get(roomId) ?? []) {
    socket.send(payload); // No readyState guard either.
  }
}
