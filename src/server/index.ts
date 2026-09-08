// Server entry point. Replaces the scaffold stub (docs/TODO.md P1).
//
// http.createServer(app) + WebSocketServer({ noServer: true }) on
// 'upgrade' — not app.listen(), because Express 5 hides its own server
// there and this design needs the http.Server reference to attach the
// 'upgrade' listener itself (design §5). One listening socket on PORT
// carries static assets, /api/* and /ws together
// (docs/ARCHITECTURE.md "Deployment topology").
import http from 'node:http';
import path from 'node:path';
import { WebSocketServer } from 'ws';
import { loadConfig } from './config.js';
import { createPool } from '../db/pool.js';
import { resolveLobbyRoomId } from '../db/queries/rooms.js';
import { createApp } from './http/app.js';
import { attachUpgradeHandler } from './ws/upgrade.js';
import { attachConnectionHandler, startHeartbeat } from './ws/connection.js';

async function main(): Promise<void> {
  const config = loadConfig();
  const pool = createPool(config.databaseUrl);

  // Fail fast before listen() if migrations were never run (design §2,
  // option B).
  const lobbyRoomId = await resolveLobbyRoomId(pool);

  const clientDistDir = path.join(import.meta.dirname, '../client');
  const app = createApp(pool, clientDistDir);
  const server = http.createServer(app);

  // 16 KiB outer bound - the §4 2000-char body check runs only after `ws`
  // has buffered the whole frame, so this is what actually bounds memory
  // per inbound frame (design §4).
  const wss = new WebSocketServer({ noServer: true, maxPayload: 16 * 1024 });

  attachUpgradeHandler(server, wss, config.allowedOrigin);
  attachConnectionHandler(wss, pool, lobbyRoomId);
  const stopHeartbeat = startHeartbeat(wss);
  server.on('close', stopHeartbeat);

  server.listen(config.port, () => {
    console.log(`listening on :${config.port}`);
  });
}

// Invoked at module scope on purpose, matching the stub it replaces: this
// MUST fail loudly (non-zero exit) if startup fails, rather than looking
// like a healthy systemd unit.
main().catch((err: unknown) => {
  console.error(err);
  process.exitCode = 1;
});
