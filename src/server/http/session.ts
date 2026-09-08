// GET /api/session — lets the client, which cannot read its own httpOnly
// cookie, learn whether it is already joined (design, "Client bootstrap").
// Touches no table: the JWT is the whole answer.
import type { Request, Response } from 'express';

/** Mount behind `requireSession` — that middleware verifies the cookie and
 * responds 401 itself on failure; this handler only runs when
 * `req.session` is already populated. */
export function sessionHandler(req: Request, res: Response): void {
  const claims = req.session;
  if (!claims) {
    // Unreachable when mounted behind requireSession; defensive only.
    res.status(401).end();
    return;
  }
  res.status(200).json({ nickname: claims.nickname });
}
