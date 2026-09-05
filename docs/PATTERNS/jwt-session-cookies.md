# Signed JWT Cookie Sessions

## Description

Session identity — for both guest and registered users — is carried in a signed JWT cookie; there is no server-side session table (`docs/TECHSTACK.md`: "Session storage: Signed JWT cookies; no server-side session table"; `docs/DEPENDENCIES.md`: `jsonwebtoken`). The server is stateless with respect to sessions: any valid signature is trusted for the claims it carries, so verification and claim design carry the full weight of session security.

Use when: writing any code that establishes, reads, or upgrades a session — guest join, registration, login, or guest→registered upgrade (`gain.json` vocabulary: "guest upgrade").

## Rule

- Cookie MUST be `httpOnly`, `secure` (site is TLS-only via Caddy per `docs/TECHSTACK.md`), and `sameSite: 'lax'` or stricter.
- JWT MUST be verified (signature + expiry) on every request that reads identity from it — never decoded without verification.
- Guest and registered identities share the same cookie/claim mechanism, distinguished by a claim (e.g. `type: 'guest' | 'registered'`), not by separate cookies — this is what makes "guest upgrade" a claim rewrite rather than a session-migration problem.
- Signing secret comes from environment configuration (see `env-config-secrets.md`), never hardcoded.

**[USER-DECIDED, Phase 8]** Framework is now Express; `req.cookies` requires the `cookie-parser` middleware, which is the chosen dependency (`docs/DEPENDENCIES.md`).

## Template

```ts
import type { Request, Response, NextFunction } from 'express';
import jwt from 'jsonwebtoken';
import { loadConfig } from './config.js';   // ESM: the .js extension is required

export type SessionClaims =
  | { readonly type: 'guest'; readonly nickname: string }
  | { readonly type: 'registered'; readonly userId: string; readonly nickname: string };

// docs/ARCHITECTURE.md "Session model" [USER-DECIDED]. Fixed values, not env-tunable.
const GUEST_TTL = '24h';
const REGISTERED_TTL = '30d';

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

export function issueGuestSession(res: Response, nickname: string): void {
  const token = jwt.sign({ type: 'guest', nickname }, loadConfig().jwtSecret, {
    expiresIn: GUEST_TTL,
  });
  res.cookie('session', token, COOKIE);
}

export function requireSession(req: Request, res: Response, next: NextFunction): void {
  const token: unknown = req.cookies?.['session'];
  if (typeof token !== 'string') {
    res.status(401).end();
    return;
  }
  try {
    // MUST verify signature and expiry. Never jwt.decode().
    req.session = jwt.verify(token, loadConfig().jwtSecret) as SessionClaims;
    next();
  } catch {
    res.status(401).end();
  }
}

export function upgradeGuestToRegistered(existing: SessionClaims, userId: string): string {
  return jwt.sign(
    { type: 'registered', userId, nickname: existing.nickname },
    loadConfig().jwtSecret,
    { expiresIn: REGISTERED_TTL },
  );
}
```

This template compiles clean under the repo's `tsconfig.json` — verified, not assumed. Three details that are load-bearing:

- **The secret comes from `loadConfig()`, never a raw `process.env.JWT_SECRET` read.** Under `noUncheckedIndexedAccess` that read is `string | undefined`, which `jwt.sign` rejects. Routing it through the config module is both the fail-fast contract in `env-config-secrets.md` and the only form that typechecks.
- **Lifetimes are constants here, not environment variables.** `docs/ARCHITECTURE.md` records them as decided facts. Keeping one copy is what prevents the registered lifetime drifting away from the decision — which it previously had, to 7 days.
- **`GUEST_TTL` reaches past sessions.** The maintenance task reaps guest `users` rows on it, so changing it also changes when a nickname returns to the pool.

## Extension points

- Token lifetime differs by type: **24h guest, 30d registered** (`docs/ARCHITECTURE.md`, [USER-DECIDED]). Adjust the constants, never the verification path.
- No refresh-token flow is planned; re-authentication on expiry is the accepted behavior unless a future decision changes this.
