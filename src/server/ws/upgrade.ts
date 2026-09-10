// Raw `http.Server` 'upgrade' handling for /ws. `cookie-parser` runs only
// inside the Express request chain, which a raw upgrade event never enters
// (design §1) — so this module parses the `Cookie` header itself and calls
// the same `verifySessionToken` HTTP uses, keeping one verification path
// for both (design §1, option A, the chosen option).
//
// Origin allowlist is mandatory, not optional (RFC 6455 §4.2 — the server
// must check it; there is no CORS preflight for a WS upgrade). Checked
// before the cookie so a cross-origin probe never even reaches session
// verification.
import type { IncomingMessage } from 'node:http';
import type { Server } from 'node:http';
import type { Socket } from 'node:net';
import type { WebSocketServer } from 'ws';
import { SESSION_COOKIE, verifySessionToken, decodeExpiry, type SessionClaims } from '../session.js';
import { extractClientIp } from '../net/client-ip.js';

/** Per-connection context, captured at handshake and passed through the
 * 'connection' event — never written onto the socket as an ad-hoc property
 * (design §1; mirrors the closure note in websocket-room-fanout.md).
 * `exp` (seconds since epoch) is carried separately from `claims` because
 * `SessionClaims` itself does not include it — matching
 * docs/PATTERNS/jwt-session-cookies.md's `SessionClaims` shape exactly —
 * but §1's close-timer and per-frame checks both need it. */
export interface ConnectionContext {
  readonly claims: SessionClaims;
  readonly exp: number;
  readonly ip: string | undefined;
}

/** Minimal `Cookie` header parser — deliberately not the `cookie` package
 * (not a declared dependency of this project; B1 may not alter the
 * dependency list). Splits on `; ` and takes the first `=` as the
 * name/value boundary, matching RFC 6265's `cookie-pair` grammar closely
 * enough for reading a single named value we ourselves issued. */
function readCookie(header: string | undefined, name: string): string | undefined {
  if (!header) return undefined;
  for (const part of header.split(';')) {
    const eq = part.indexOf('=');
    if (eq === -1) continue;
    const key = part.slice(0, eq).trim();
    if (key === name) return decodeURIComponent(part.slice(eq + 1).trim());
  }
  return undefined;
}

/** Writes a bare HTTP status line and destroys the socket. Never completes
 * the handshake and closes after — design §1: "an authenticated-looking
 * socket is worse than a refused one." */
function reject(socket: Socket, status: number, statusText: string): void {
  socket.write(`HTTP/1.1 ${status} ${statusText}\r\n\r\n`);
  socket.destroy();
}

export function attachUpgradeHandler(
  server: Server,
  wss: WebSocketServer,
  allowedOrigin: string,
): void {
  server.on('upgrade', (req: IncomingMessage, socket: Socket, head: Buffer) => {
    const url = req.url ?? '';
    const path = url.split('?')[0];
    if (path !== '/ws') {
      reject(socket, 404, 'Not Found');
      return;
    }

    const origin = req.headers.origin;
    if (origin !== allowedOrigin) {
      reject(socket, 403, 'Forbidden');
      return;
    }

    const token = readCookie(req.headers.cookie, SESSION_COOKIE);
    if (typeof token !== 'string') {
      reject(socket, 401, 'Unauthorized');
      return;
    }
    const claims = verifySessionToken(token);
    if (claims === null) {
      reject(socket, 401, 'Unauthorized');
      return;
    }
    const exp = decodeExpiry(token);
    if (exp === null) {
      // Cannot happen given verifySessionToken already succeeded (its own
      // runtime narrowing requires `exp` to be a number) — checked
      // defensively since decodeExpiry re-parses independently.
      reject(socket, 401, 'Unauthorized');
      return;
    }

    const context: ConnectionContext = {
      claims,
      exp,
      ip: extractClientIp(req.socket.remoteAddress, req.headers['x-forwarded-for']),
    };

    wss.handleUpgrade(req, socket, head, (ws) => {
      wss.emit('connection', ws, req, context);
    });
  });
}
