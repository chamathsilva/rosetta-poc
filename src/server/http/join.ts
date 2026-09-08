// POST /api/join — design §3 ("Extending JWT claims to carry the guest's
// users.id") and SPECS AC-1, AC-2, AC-3, AC-15.
import type { Request, Response } from 'express';
import type { Pool } from 'pg';
import { insertGuestUser, isUniqueViolation } from '../../db/queries/users.js';
import { issueGuestSession, verifySessionToken, SESSION_COOKIE } from '../session.js';
import { validateNickname } from '../validation.js';

export function createJoinHandler(pool: Pool) {
  return async function join(req: Request, res: Response): Promise<void> {
    // Idempotent path (AC-15, SPECS API contract): a valid cookie returns
    // the existing claims — no INSERT, no new cookie. An invalid or
    // expired cookie is treated as no cookie at all (SPECS: "Any other
    // rule strands a user holding an expired httpOnly cookie they cannot
    // read or clear") — falls through to a fresh join.
    const token: unknown = req.cookies?.[SESSION_COOKIE];
    if (typeof token === 'string') {
      const claims = verifySessionToken(token);
      if (claims !== null) {
        res.status(200).json({ nickname: claims.nickname });
        return;
      }
    }

    const body: unknown = req.body;
    const rawNickname =
      typeof body === 'object' && body !== null
        ? (body as Record<string, unknown>)['nickname']
        : undefined;
    const validated = validateNickname(rawNickname);
    if (!validated.ok) {
      res.status(400).json({ error: 'invalid_nickname' });
      return;
    }

    try {
      // No pre-check SELECT: `users_nickname_key` is the arbiter
      // (design §3, "nickname race" — a check-then-insert is a TOCTOU bug).
      const { id } = await insertGuestUser(pool, validated.value);
      issueGuestSession(res, id, validated.value);
      // Server-normalized (trimmed) nickname in the body, per AC-1 — the
      // client must not display a value that was never stored.
      res.status(200).json({ nickname: validated.value });
    } catch (err) {
      if (isUniqueViolation(err)) {
        res.status(409).json({ error: 'nickname_taken' });
        return;
      }
      throw err; // Express 5 forwards a rejected async handler to next(err).
    }
  };
}
