# WebSocket Room Fan-Out

## Description

Rooms are held in process memory, not the database (`docs/TECHSTACK.md`, `gain.json` vocabulary: "room"). Membership and message fan-out use a `Map<roomId, Set<WebSocket>>`. This is the only planned mechanism for presence and broadcast — there is no message queue or pub/sub layer (single-instance constraint, `docs/TECHSTACK.md` Constraints).

Use when: any code that joins a socket to a room, broadcasts a message to room members, or computes the presence roster.

## Known failure mode (why this pattern is prescribed, not optional)

The room `Set` is the only reference to which sockets belong to a room. If a socket disconnects (network drop, tab close, crash) without being removed from every `Set` it belongs to, the room leaks a dead entry: presence lists show ghost users, and broadcast attempts to a closed socket throw or silently no-op depending on the library. This is the known presence bug class for this architecture — cleanup on disconnect is not optional, it is the core correctness requirement of the pattern.

## Template

```js
// rooms: Map<roomId, Set<WebSocket>>
const rooms = new Map();

function joinRoom(roomId, socket) {
  if (!rooms.has(roomId)) rooms.set(roomId, new Set());
  rooms.get(roomId).add(socket);
  socket.roomId = roomId; // needed for cleanup on close — do not omit

  // MUST: registered before any other 'close'/'error' handling for this socket
  socket.on('close', () => leaveRoom(roomId, socket));
  socket.on('error', () => leaveRoom(roomId, socket));
}

function leaveRoom(roomId, socket) {
  const members = rooms.get(roomId);
  if (!members) return;
  members.delete(socket);
  if (members.size === 0) rooms.delete(roomId); // MUST: prevent unbounded Map growth
  broadcastPresence(roomId);
}

function broadcast(roomId, message, { exclude } = {}) {
  const members = rooms.get(roomId);
  if (!members) return;
  for (const socket of members) {
    if (socket === exclude) continue;
    if (socket.readyState !== socket.OPEN) continue; // MUST: guard dead sockets, never assume open
    socket.send(message);
  }
}
```

## Extension points

- Presence roster: derive from `rooms.get(roomId)` size/members at read time — do not maintain a separate counter that can drift from the `Set`.
- Multi-instance scaling is explicitly out of scope (`docs/TECHSTACK.md`: "in-process room state cannot scale to multiple droplets without Redis pub/sub adapter"). Do not add cross-instance coordination speculatively.
