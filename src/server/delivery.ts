// Leaf module: owns the per-socket outbound buffer used during
// initialization, and the single send seam (`deliver`) that applies the
// `readyState` guard on every path — buffered and direct alike.
//
// Deliberately imports nothing of ours (design, "Message flow" —
// "`deliver` lives in src/server/delivery.ts, a leaf module that imports
// nothing of ours"). `server/rooms` imports this, never the reverse: the
// declared deviation from docs/PATTERNS/websocket-room-fanout.md that keeps
// the module graph acyclic (`rooms → delivery`, `ws/connection → {rooms,
// delivery}` instead of `rooms → ws → rooms`).
import type { WebSocket } from 'ws';

/** 1 MiB — the init-buffer cap and the steady-state bufferedAmount ceiling
 * share one number deliberately (design, "Backpressure"). */
export const BYTE_CEILING = 1 * 1024 * 1024;

interface Buffer_ {
  frames: string[];
  bytes: number;
}

/**
 * Absent (or removed) key = not initializing / no buffering. A present
 * entry means frames sent to this socket are queued rather than written
 * directly — set by the connection module at JOIN, cleared at BATCH or on
 * the initialization error path. (The design specifies the map's value
 * type as `{ frames, bytes } | null`; this implementation uses key absence
 * — via `delete` — as the equivalent of the `null` state, since a WeakMap
 * offers no way to observe the difference from outside and the entry is
 * never otherwise inspectable.)
 */
const buffers = new WeakMap<WebSocket, Buffer_>();

/** Opens the outbound buffer for a socket (design, JOIN step: "enable the
 * outbound buffer" as one synchronous step with joinRoom + drain start). */
export function openBuffer(socket: WebSocket): void {
  buffers.set(socket, { frames: [], bytes: 0 });
}

/** Clears the buffer flag for a socket. Called from BATCH (buffer consumed
 * as data, never replayed wholesale) and from the initialization error
 * path (design, "Initialization must be bounded and must fail closed"). */
export function closeBuffer(socket: WebSocket): void {
  buffers.delete(socket);
}

/** Returns the buffered frames without clearing the flag itself — the
 * caller (BATCH) reads them, then calls closeBuffer(). */
export function getBufferedFrames(socket: WebSocket): readonly string[] {
  return buffers.get(socket)?.frames ?? [];
}

/** Cumulative buffered bytes for a socket currently initializing, or
 * undefined if it is not (design, "1 MiB buffer cap ... accumulated with
 * Buffer.byteLength(frame) as each frame is buffered"). */
export function getBufferedBytes(socket: WebSocket): number | undefined {
  return buffers.get(socket)?.bytes;
}

/**
 * The single send seam. Every fan-out and every direct send goes through
 * this, so the `readyState` guard and the backpressure ceiling apply
 * uniformly (design, "steady-state bounds" + "deliver() is the right home
 * because it is already the single send seam that owns the readyState
 * guard").
 *
 * - If the socket is not OPEN, the frame is silently dropped (guard #3 in
 *   the three-guards table — the steady-state, every-send guard).
 * - If the socket is initializing (buffer entry present, non-null), the
 *   frame is queued instead of sent, and its byte cost is tracked in O(1).
 *   Crossing the 1 MiB cap here closes 1011 (design, "buffer cap").
 * - Otherwise, this is the steady-state backpressure check: the
 *   *projected* `bufferedAmount + byteLength(frame)` is tested, not the
 *   current value — the header amendment. Exceeding 1 MiB closes 1013 and
 *   the frame is dropped, not queued.
 */
export function deliver(socket: WebSocket, frame: string): void {
  if (socket.readyState !== socket.OPEN) return;

  const buf = buffers.get(socket);
  if (buf) {
    const size = Buffer.byteLength(frame);
    if (buf.bytes + size > BYTE_CEILING) {
      buffers.delete(socket);
      socket.close(1011);
      return;
    }
    buf.frames.push(frame);
    buf.bytes += size;
    return;
  }

  const size = Buffer.byteLength(frame);
  if (socket.bufferedAmount + size > BYTE_CEILING) {
    socket.close(1013);
    return;
  }
  socket.send(frame);
}
