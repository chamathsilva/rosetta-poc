# WebSocket Room Fan-Out

## Description

Rooms are held in process memory, not the database (`docs/TECHSTACK.md`, `gain.json` vocabulary: "room"). Membership and message fan-out use a `Map<roomId, Set<WebSocket>>`. This is the only planned mechanism for presence and broadcast — there is no message queue or pub/sub layer (single-instance constraint, `docs/TECHSTACK.md` Constraints).

Use when: any code that joins a socket to a room, broadcasts a message to room members, or computes the presence roster.

## Known failure mode (why this pattern is prescribed, not optional)

The room `Set` is the only reference to which sockets belong to a room. If a socket disconnects (network drop, tab close, crash) without being removed from every `Set` it belongs to, the room leaks a dead entry: presence lists show ghost users, and broadcast attempts to a closed socket throw or silently no-op depending on the library. This is the known presence bug class for this architecture — cleanup on disconnect is not optional, it is the core correctness requirement of the pattern.

## Template

```ts
import type { WebSocket } from 'ws';

const rooms = new Map<string, Set<WebSocket>>();

export function joinRoom(roomId: string, socket: WebSocket): void {
  let members = rooms.get(roomId);
  if (!members) {
    members = new Set<WebSocket>();
    rooms.set(roomId, members);
  }
  members.add(socket);

  // MUST: registered before any other 'close'/'error' handling for this socket.
  // roomId is captured by the closure - no property is set on the socket.
  socket.on('close', () => leaveRoom(roomId, socket));
  socket.on('error', () => leaveRoom(roomId, socket));
}

export function leaveRoom(roomId: string, socket: WebSocket): void {
  const members = rooms.get(roomId);
  if (!members) return;
  members.delete(socket);
  if (members.size === 0) rooms.delete(roomId); // MUST: prevent unbounded Map growth
  broadcastPresence(roomId);
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
    if (socket.readyState !== socket.OPEN) continue; // MUST: guard dead sockets, never assume open
    socket.send(message);
  }
}
```

Note on the closure: the earlier version of this template set `socket.roomId = roomId` so cleanup could find the room. That is unnecessary — the `close` and `error` handlers already capture `roomId` — and it does not typecheck, because `roomId` is not a property of `ws.WebSocket`. Do not reintroduce an ad-hoc property on the socket.

## Extension points

- Presence roster: derive from `rooms.get(roomId)` size/members at read time — do not maintain a separate counter that can drift from the `Set`.
- Multi-instance scaling is explicitly out of scope (`docs/TECHSTACK.md`: "in-process room state cannot scale to multiple droplets without Redis pub/sub adapter"). Do not add cross-instance coordination speculatively.
