// Trusted-proxy client-IP extractor. Closes docs/TODO.md:43-46
// (REQ-MOD-003). One pure function, callable from both the raw
// `http.Server` 'upgrade' path (src/server/ws/upgrade.ts) and any future
// Express handler, without either importing the other's framework
// (plans/gated-deploy/architecture-notes.md §1.1) — that is why this
// module imports nothing from `express` or `ws`, and carries no framework
// types.
//
// Trust rule (architecture-notes §1.3-§1.5): `X-Forwarded-For` is trusted
// only when the immediate TCP peer is loopback — Caddy and Node are
// co-located on one droplet by decision, so "the proxy is loopback" is a
// decision, not configuration (docs/PATTERNS/env-config-secrets.md:16).
// The trusted set is therefore a constant here, never an env var.
//
// `::ffff:127.0.0.1` MUST stay in this set: a dual-stack Node listener
// reports loopback IPv4 peers in that form. Omitting it silently disables
// the whole extractor on such a listener and every row records the
// proxy's own address instead of a real one (architecture-notes §1.3).
import { isIP } from 'node:net';

/** The only TCP peers Node ever accepts an `X-Forwarded-For` value from.
 * Constant in code, not env — see module header. */
const TRUSTED_PEERS: ReadonlySet<string> = new Set(['127.0.0.1', '::1', '::ffff:127.0.0.1']);

/** Module-level, once-per-process log guards (AC-IP-10). Each of the three
 * conditions below must log at most once per process, not once per
 * connection, so a flood of connections cannot fill journald on a 1 GB
 * box (architecture-notes §1.7). Deliberately the only mutable state in
 * this otherwise-pure module. */
let warnedTrustedPeerNoHeader = false;
let warnedUntrustedPeer = false;
let loggedFirstResolution = false;

/** Test-only reset of the once-per-process log guards above. Exported so
 * tests can isolate the three log conditions from each other and from
 * test run order (reviewer note on AC-IP-10) without resorting to
 * `node:test` module-reset tricks. Never called from production code. */
export function resetClientIpLogStateForTests(): void {
  warnedTrustedPeerNoHeader = false;
  warnedUntrustedPeer = false;
  loggedFirstResolution = false;
}

function logFirstResolution(source: 'xff' | 'peer'): void {
  if (loggedFirstResolution) return;
  loggedFirstResolution = true;
  // info line at first resolution per process, naming the winning source.
  console.info(`[client-ip] first client IP resolved via ${source}`);
}

/** Picks the rightmost comma-separated value out of a raw `X-Forwarded-For`
 * value. The rightmost value is the one nearest the trusted proxy — the
 * leftmost is attacker-controlled (architecture-notes §1.4, §1.6).
 *
 * On the array branch: Node does **not** produce an array for this header.
 * Repeated `X-Forwarded-For` headers are joined by Node's own parser into a
 * single comma-separated string ("1.2.3.4, 9.9.9.9"); `set-cookie` is the
 * only header Node keeps as an array. Verified directly against a live
 * `http.Server` — code review 2026-09-09, after an earlier version of this
 * comment asserted the opposite from reading the TypeScript type rather
 * than testing the runtime. The branch is kept because
 * `IncomingHttpHeaders` is typed `string | string[] | undefined` for every
 * header, so the type must be handled even though this shape is
 * unreachable here. It is type satisfaction, not defence against a real
 * input. */
function lastForwardedValue(forwardedFor: string | readonly string[]): string {
  const combined: string = Array.isArray(forwardedFor)
    ? (forwardedFor as readonly string[]).join(',')
    : (forwardedFor as string);
  const parts = combined.split(',');
  return (parts[parts.length - 1] ?? '').trim();
}

/**
 * Returns the client IP that should be recorded for a connection.
 *
 * Trust rule: `forwardedFor` is consulted only when `remoteAddress` is one
 * of the trusted peers above; otherwise it is ignored outright, even if
 * present. When trusted, the rightmost value is taken and validated with
 * `net.isIP()` before being returned — `messages.ip` is `inet`
 * (docs/db/migrations/1757800001_users_rooms_messages.sql), and an
 * unvalidated string reaching that column throws `22P02` inside the send
 * path (architecture-notes §1.4), so validation here is a liveness
 * requirement, not hygiene. Any failure to produce a trusted, valid value
 * falls back to `remoteAddress` — never to an untrusted or malformed
 * header value. The column is nullable, so `undefined` is a legitimate,
 * representable answer (architecture-notes §1.5).
 */
export function extractClientIp(
  remoteAddress: string | undefined,
  forwardedFor: string | readonly string[] | undefined,
): string | undefined {
  const peerIsTrusted = remoteAddress !== undefined && TRUSTED_PEERS.has(remoteAddress);

  if (!peerIsTrusted) {
    // A request reaching this code with a defined, non-trusted peer
    // arrived without going through Caddy — the loopback bind or the
    // firewall is not in effect (architecture-notes §1.7.a, §2). A peer
    // that is `undefined` is not "untrusted", it is "unknown" — Node
    // genuinely has no socket address to report — and is not warned on.
    if (remoteAddress !== undefined && !warnedUntrustedPeer) {
      warnedUntrustedPeer = true;
      console.warn(
        '[client-ip] connection from a non-loopback peer carried an X-Forwarded-For header; ' +
          'ignoring it (something reached this port without going through Caddy)',
      );
    }
    logFirstResolution('peer');
    return remoteAddress;
  }

  const hasForwardedValue = forwardedFor !== undefined && !(Array.isArray(forwardedFor) && forwardedFor.length === 0);

  if (!hasForwardedValue) {
    // Peer is trusted but Caddy did not set the header — the `header_up`
    // line or the whole `reverse_proxy` block is misconfigured
    // (architecture-notes §1.7.a).
    if (!warnedTrustedPeerNoHeader) {
      warnedTrustedPeerNoHeader = true;
      console.warn(
        '[client-ip] trusted peer connected without an X-Forwarded-For header ' +
          '(Caddy is proxying but not setting the header)',
      );
    }
    logFirstResolution('peer');
    return remoteAddress;
  }

  const candidate = lastForwardedValue(forwardedFor);
  if (isIP(candidate) !== 0) {
    logFirstResolution('xff');
    return candidate;
  }

  // Malformed X-Forwarded-For value from a trusted peer. Never pass this
  // through to `messages.ip` (an `inet` column) — fall back to the real
  // peer address instead (architecture-notes §1.4, AC-IP-6).
  logFirstResolution('peer');
  return remoteAddress;
}
