// Wire protocol for the /ws chat connection. Imported by both the server
// (src/server/ws) and the client (src/client) - this file is the contract
// that lets those two batches be built in parallel (B1/B2), and it defines
// no application logic of its own.
//
// See:
// - agents/TEMP/walking-skeleton/architecture-notes.md, "Message flow and
//   remaining implementation decisions" (frame shapes, BATCH normalization).
// - plans/walking-skeleton/WALKING-SKELETON-SPECS.md, "Wire protocol".

/**
 * A single message in the shape every client renders. The only place a raw
 * `messages` DB row becomes this shape is `toWireMessage`
 * (src/db/queries/messages.ts, owned by B1) - normalizing in exactly one
 * place is load-bearing for the BATCH merge (design, "Message flow").
 */
export interface OutgoingMessage {
  readonly id: string;
  readonly nickname: string;
  readonly body: string;
  /** ISO 8601 timestamp string. Millisecond precision - see the design's
   * "Accepted precision loss" note on truncating `timestamptz`. */
  readonly createdAt: string;
}

/** Client -> server: send a chat message. */
export interface SendFrame {
  readonly type: 'send';
  readonly body: string;
}

/** Every frame a client may send. Currently just `send`; an unrecognised
 * `type` or unparseable JSON is ignored per design SS4. */
export type ClientFrame = SendFrame;

/**
 * Server -> client: one ordered snapshot, sent exactly once per connection,
 * before any live `message` frame (design "BATCH" step; SPECS AC-6).
 */
export interface HistoryFrame {
  readonly type: 'history';
  readonly messages: readonly OutgoingMessage[];
}

/**
 * Server -> client: a single live message, fanned out to the room. Carries
 * the same fields as `OutgoingMessage` - the persisted, broadcast row is the
 * same shape a client would see replayed in a later `history` frame.
 */
export interface MessageFrame extends OutgoingMessage {
  readonly type: 'message';
}

/**
 * Server -> client: a rejected send, or another per-socket failure. No `id`
 * or `createdAt` - the design's BATCH step partitions this frame type out of
 * the history merge for exactly that reason (it cannot be sorted or deduped
 * like a message).
 */
export interface ErrorFrame {
  readonly type: 'error';
  readonly code: string;
}

/** Every frame the server may send. */
export type ServerFrame = HistoryFrame | MessageFrame | ErrorFrame;
