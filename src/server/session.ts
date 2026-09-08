// Signed JWT cookie sessions. This is the implementation of the corrected
// template in docs/PATTERNS/jwt-session-cookies.md — do not duplicate its
// logic elsewhere; both HTTP (`server/http`) and WS (`server/ws/upgrade`)
// import from here so there is exactly one verification path
// (design §1, §3).
import type { Request, Response, NextFunction } from 'express';
import type { WebSocket } from 'ws';
import jwt from 'jsonwebtoken';
import { loadConfig } from './config.js';

export type SessionClaims =
  | { readonly type: 'guest'; readonly userId: string; readonly nickname: string }
  | { readonly type: 'registered'; readonly userId: string; readonly nickname: string };

// docs/ARCHITECTURE.md "Session model" [USER-DECIDED]. Fixed values, not
// env-tunable — a decided fact, not configuration.
const GUEST_TTL = '24h';
const REGISTERED_TTL = '30d';

// Same value as GUEST_TTL, in milliseconds, for the cookie's own maxAge -
// one source, two units. A registered-session maxAge constant is not
// declared here: guest upgrade is out of scope for this feature and an
// unused constant would fail lint.
const GUEST_TTL_MS = 24 * 60 * 60 * 1000;

export const SESSION_COOKIE = 'session';

declare module 'express-serve-static-core' {
  interface Request {
    session?: SessionClaims;
  }
}

const COOKIE = {
  httpOnly: true,
  secure: true,
  sameSite: 'lax',
} as const;

export function issueGuestSession(res: Response, userId: string, nickname: string): void {
  const token = jwt.sign({ type: 'guest', userId, nickname }, loadConfig().jwtSecret, {
    expiresIn: GUEST_TTL,
  });
  res.cookie(SESSION_COOKIE, token, { ...COOKIE, maxAge: GUEST_TTL_MS });
}

/**
 * Verifies signature and expiry, THEN narrows the decoded payload's shape
 * at runtime. `jwt.verify` proves the token was signed with our secret and
 * is unexpired - it proves nothing about what shape was signed. Returns
 * null on any failure (bad signature, expired, or wrong shape); callers
 * must reject on null, not fall through.
 *
 * Shared by the HTTP `requireSession` middleware and the raw WS upgrade
 * handler (design §1, option A) - one verification path for both.
 */
export function verifySessionToken(token: string): SessionClaims | null {
  let payload: unknown;
  try {
    payload = jwt.verify(token, loadConfig().jwtSecret);
  } catch {
    return null;
  }
  if (typeof payload !== 'object' || payload === null) return null;
  const p = payload as Record<string, unknown>;
  if (p['type'] !== 'guest' && p['type'] !== 'registered') return null;
  if (typeof p['userId'] !== 'string' || p['userId'].length === 0) return null;
  if (typeof p['nickname'] !== 'string' || p['nickname'].length === 0) return null;
  if (typeof p['exp'] !== 'number') return null;
  return { type: p['type'], userId: p['userId'], nickname: p['nickname'] };
}

/** `exp` (seconds since epoch) for an already-verified token, for the WS
 * upgrade's close-timer arming (design §1) and per-frame expiry check. */
export function decodeExpiry(token: string): number | null {
  let payload: unknown;
  try {
    payload = jwt.verify(token, loadConfig().jwtSecret);
  } catch {
    return null;
  }
  if (typeof payload !== 'object' || payload === null) return null;
  const p = payload as Record<string, unknown>;
  return typeof p['exp'] === 'number' ? p['exp'] : null;
}

export function requireSession(req: Request, res: Response, next: NextFunction): void {
  const token: unknown = req.cookies?.[SESSION_COOKIE];
  if (typeof token !== 'string') {
    res.status(401).end();
    return;
  }
  const claims = verifySessionToken(token);
  if (claims === null) {
    res.status(401).end();
    return;
  }
  req.session = claims;
  next();
}

export function upgradeGuestToRegistered(existing: SessionClaims, userId: string): string {
  return jwt.sign(
    { type: 'registered', userId, nickname: existing.nickname },
    loadConfig().jwtSecret,
    { expiresIn: REGISTERED_TTL },
  );
}

/** `setTimeout` clamps above 2^31-1 ms and fires *immediately* instead
 * (design §1, "Trap"). The 24h guest TTL never reaches this branch, but a
 * wrong-by-construction primitive should not be left as a trap for the
 * (out-of-scope) 30d registered TTL. Exported for
 * `src/server/session.test.ts` (PLAN "Test scope": "expiry: close-timer
 * arming ... AC-16"). */
export const MAX_TIMEOUT_MS = 2 ** 31 - 1;

/**
 * Arms the close timer for `(exp * 1000) - Date.now()` (design §1, "A
 * close timer armed at handshake"). This is the primary expiry mechanism —
 * the only one of the two that logs out a *passive* client (one that never
 * sends a frame, so the per-frame check in the WS message handler would
 * never touch it). Clamps to `MAX_TIMEOUT_MS` and re-arms rather than
 * relying on `setTimeout`'s clamp-and-fire-immediately behavior.
 *
 * Returns a cleanup function; callers MUST call it on the socket's
 * 'close' event, or a timer for an already-closed socket leaks until it
 * fires.
 */
export function armExpiryTimer(ws: WebSocket, expSeconds: number): () => void {
  let timer: ReturnType<typeof setTimeout> | undefined;

  function schedule(): void {
    const delay = expSeconds * 1000 - Date.now();
    if (delay <= 0) {
      if (ws.readyState === ws.OPEN) ws.close(4001);
      return;
    }
    if (delay > MAX_TIMEOUT_MS) {
      timer = setTimeout(schedule, MAX_TIMEOUT_MS);
    } else {
      timer = setTimeout(() => {
        if (ws.readyState === ws.OPEN) ws.close(4001);
      }, delay);
    }
    // Guest sessions run up to 24h; this timer alone must never be the
    // reason the process stays alive (same reasoning `pg` applies to its
    // own connectionTimeoutHandle, node_modules/pg/lib/client.js:173-174).
    timer.unref();
  }

  schedule();
  return () => {
    if (timer) clearTimeout(timer);
  };
}

/** Per-frame expiry check (design §1, second mechanism): "costing one
 * number comparison", closing the close-timer's blind spot where
 * `setTimeout` does not advance while the host is suspended. `expSeconds`
 * is the JWT `exp` claim (seconds since epoch). */
export function isExpired(expSeconds: number): boolean {
  return Date.now() / 1000 >= expSeconds;
}
