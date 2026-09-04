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

```js
const jwt = require('jsonwebtoken');

function issueGuestSession(res, { nickname }) {
  const token = jwt.sign(
    { type: 'guest', nickname },
    process.env.JWT_SECRET,
    { expiresIn: '24h' }
  );
  res.cookie('session', token, {
    httpOnly: true,
    secure: true,
    sameSite: 'lax',
  });
}

function requireSession(req, res, next) {
  const token = req.cookies?.session;
  if (!token) return res.status(401).end();
  try {
    req.session = jwt.verify(token, process.env.JWT_SECRET); // MUST verify, never decode-only
    next();
  } catch {
    res.status(401).end();
  }
}

function upgradeGuestToRegistered(existingClaims, { userId }) {
  // Re-issue with the same nickname/room context, new type + identity claim.
  return jwt.sign(
    { type: 'registered', userId, nickname: existingClaims.nickname },
    process.env.JWT_SECRET,
    { expiresIn: '7d' }
  );
}
```

## Extension points

- Token lifetime differs by type (guest short-lived, registered longer) — adjust `expiresIn`, not the verification path.
- No refresh-token flow is planned; re-authentication on expiry is the accepted behavior unless a future decision changes this.
