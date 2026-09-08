// Express app: static client, REST endpoints, CSP header. CSP is part of
// server/http, not a later pass (docs/TODO.md P0 "with server/http";
// docs/PATTERNS/untrusted-content-rendering.md § Rule).
import express, { type Express } from 'express';
import cookieParser from 'cookie-parser';
import type { Pool } from 'pg';
import { createJoinHandler } from './join.js';
import { sessionHandler } from './session.js';
import { requireSession } from '../session.js';

// No `'unsafe-inline'` — Vite's hashed output does not need it (design,
// "CSP is part of server/http").
const CONTENT_SECURITY_POLICY =
  "default-src 'self'; script-src 'self'; style-src 'self'; connect-src 'self'; " +
  "img-src 'self' data:; object-src 'none'; base-uri 'none'; frame-ancestors 'none'";

export function createApp(pool: Pool, clientDistDir: string): Express {
  const app = express();

  app.use((_req, res, next) => {
    res.setHeader('Content-Security-Policy', CONTENT_SECURITY_POLICY);
    next();
  });

  app.use(cookieParser());
  // 1 KiB: comfortably above the 24-char nickname bound (validation.ts),
  // well under body-parser's own 100 KB default. This endpoint accepts one
  // short field; an explicit limit says so rather than inheriting a default
  // sized for a different kind of API.
  app.use(express.json({ limit: '1kb' }));

  app.post('/api/join', createJoinHandler(pool));
  app.get('/api/session', requireSession, sessionHandler);

  // Static assets last: /api/* is matched first, then anything else falls
  // through to dist/client (SPECS API contract: "GET /* ... static
  // dist/client + CSP header ... 404").
  app.use(express.static(clientDistDir));

  return app;
}
