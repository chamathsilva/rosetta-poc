// WebSocket connection lifecycle for the chat room.
//
// Connects to a relative `/ws` path so the same code works through the Vite
// dev proxy (vite.config.ts `server.proxy['/ws']`, `ws: true`) and through
// the production same-origin serve (design SS5, one port for HTTP + WS).
//
// Reconnect is explicitly OUT of scope (design, "Automatic reconnect is
// explicitly OUT of scope for this feature"): on close this hook surfaces a
// terminal "disconnected" status and does not retry.
import { useEffect, useRef, useState } from 'react';
import type { ClientFrame, ErrorFrame, OutgoingMessage, ServerFrame } from '../shared/protocol';

export type ChatSocketStatus = 'connecting' | 'open' | 'disconnected';

export interface ChatSocketState {
  readonly status: ChatSocketStatus;
  /** Rendered exactly as received: the server sends one ordered `history`
   * frame, already merged and sorted (design, "BATCH"), and this hook never
   * re-sorts or reverses it - it only appends live `message` frames after. */
  readonly messages: readonly OutgoingMessage[];
  /** Every `error` frame received, oldest first, surfaced rather than
   * silently dropped (design SS4: rejections are an `error` frame, the
   * socket stays open). */
  readonly errors: readonly string[];
  readonly send: (body: string) => void;
}

function buildSocketUrl(): string {
  const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
  return `${protocol}//${window.location.host}/ws`;
}

export function useChatSocket(): ChatSocketState {
  const [status, setStatus] = useState<ChatSocketStatus>('connecting');
  const [messages, setMessages] = useState<readonly OutgoingMessage[]>([]);
  const [errors, setErrors] = useState<readonly string[]>([]);
  const socketRef = useRef<WebSocket | null>(null);
  // history frame: place in the array where subsequent `message` frames
  // append. Guards against a `message` frame that somehow arrives before
  // `history` on a given connection - it is queued rather than dropped or
  // used to seed an ordering the server never asserted.
  const historyReceivedRef = useRef(false);
  const pendingLiveRef = useRef<OutgoingMessage[]>([]);

  useEffect(() => {
    const socket = new WebSocket(buildSocketUrl());
    socketRef.current = socket;
    historyReceivedRef.current = false;
    pendingLiveRef.current = [];

    socket.addEventListener('open', () => {
      setStatus('open');
    });

    socket.addEventListener('message', (event) => {
      let frame: ServerFrame;
      try {
        frame = JSON.parse(event.data as string) as ServerFrame;
      } catch {
        // Unparseable server frame: nothing sane to render, drop silently
        // (symmetric with the server's own "unparseable JSON is ignored").
        return;
      }

      if (frame.type === 'history') {
        historyReceivedRef.current = true;
        // Render in the order given - the server has already merged and
        // sorted it (design "BATCH"; SPECS AC-6). Any `message` frame that
        // arrived before this frame is appended after, in arrival order.
        setMessages([...frame.messages, ...pendingLiveRef.current]);
        pendingLiveRef.current = [];
        return;
      }

      if (frame.type === 'message') {
        if (!historyReceivedRef.current) {
          pendingLiveRef.current = [...pendingLiveRef.current, frame];
          return;
        }
        setMessages((prev) => [...prev, frame]);
        return;
      }

      if (frame.type === 'error') {
        const errorFrame: ErrorFrame = frame;
        setErrors((prev) => [...prev, errorFrame.code]);
      }
    });

    const handleTerminal = () => {
      setStatus('disconnected');
    };
    socket.addEventListener('close', handleTerminal);
    socket.addEventListener('error', handleTerminal);

    return () => {
      socket.close();
      socketRef.current = null;
    };
  }, []);

  const send = (body: string) => {
    const socket = socketRef.current;
    if (socket === null || socket.readyState !== WebSocket.OPEN) {
      return;
    }
    const frame: ClientFrame = { type: 'send', body };
    socket.send(JSON.stringify(frame));
  };

  return { status, messages, errors, send };
}
