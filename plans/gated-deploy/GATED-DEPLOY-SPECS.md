# GATED-DEPLOY — tech specs

Target state (WHAT). Steps and sequencing (HOW) → `plans/gated-deploy/GATED-DEPLOY-PLAN.md`.
Architecture, decisions, rejected alternatives → `plans/gated-deploy/architecture-notes.md` (approved 2026-09-08). **Referenced by §, never restated.**
Marking per claim: **[V]** verified · **[I]** inferred · **[D]** decided here · **[S]** settled by user.

## TLDR

- Ships the first real deployment: trusted-proxy IP extractor, loopback bind, `workflow_dispatch` CD, Caddy gate, systemd units, runbook.
- Adds retention task (`docs/TODO.md:61-63`) — in scope by user decision, because this deploy is what first writes real IPs.
- 11 deliverables; 4 existing source files modified (`upgrade.ts`, `index.ts`, `session.ts`, `ci.yml`); 0 schema changes; 0 new dependencies.
- 84 numbered ACs. **53 provable locally · 20 require the droplet · 11 partly local, confirmed on the host** — 31 carry a runbook step.
- Extractor arrives with **zero** existing regression coverage (discovery §5 **[V]**) — its own tests are the net.
- Not covered: backups, monitoring, rate limiting, moderation, real domain, `/healthz`.

## 1. Scope

### 1.1 In

| # | Deliverable | Path |
|---|---|---|
| D1 | Client-IP extractor (pure fn) + tests | `src/server/net/client-ip.ts` (+`.test.ts`) |
| D2 | Upgrade-path wiring + tests | `src/server/ws/upgrade.ts`, `upgrade.test.ts` |
| D3 | Loopback bind | `src/server/index.ts` |
| D4 | Retention task + CLI + tests | `src/db/retention.ts` (+`.test.ts`) |
| D5 | `GUEST_TTL_MS` export (drift guard only) | `src/server/session.ts` |
| D6 | Deploy workflow | `.github/workflows/deploy.yml` |
| D7 | Caddyfile template | `deploy/Caddyfile` |
| D8 | systemd units ×4 | `deploy/systemd/*.service`, `*.timer` |
| D9 | Provisioning runbook | `docs/RUNBOOK-gated-deploy.md` |
| D10 | Doc updates | `docs/{ARCHITECTURE,TECHSTACK,TODO}.md`, `agents/IMPLEMENTATION.md` |
| D11 | Artifact-name fix (P2, one line) | `.github/workflows/ci.yml:123` |

### 1.2 Out

Backups · monitoring/alerting · rate limiting · moderation floor · admin bootstrap · real domain · `/healthz` · patching policy · capacity measurement · 1:1 DM (reserved, `docs/CONTEXT.md:61` **[V]**). Full list + rationale → architecture-notes §11.

### 1.3 Non-functional constraints

| NFR | Bound | Source |
|---|---|---|
| Memory | 1 GB shared Node+PG+Caddy; design adds **0** long-lived processes | `docs/ARCHITECTURE.md:216` **[V]** |
| Instances | exactly 1 (in-process room state) | `docs/ARCHITECTURE.md:247` **[V]** |
| Deploy trigger | `workflow_dispatch` only **[S]** | arch-notes §3.2 |
| Downtime/deploy | seconds, accepted **[S]** | arch-notes §8.1 |
| Schema changes | none | — |
| New runtime deps | none | — |

## 2. Contracts

### 2.1 Client-IP extractor — D1

```ts
export function extractClientIp(remoteAddress: string|undefined, forwardedFor: string|string[]|undefined): string|undefined
```

- Trusted peers (constant, not env — `docs/PATTERNS/env-config-secrets.md:16` **[V]**): `127.0.0.1`, `::1`, `::ffff:127.0.0.1`.
- Trust XFF ⟺ peer ∈ trusted. Take **last** comma-separated value, trimmed. Validate `net.isIP(v) !== 0`. Else → `remoteAddress`.
- Rationale, threat model, why not `trust proxy` → arch-notes §1.1–1.6.

Observability (arch-notes §1.7), one line per condition per process:
| Level | Condition | Meaning |
|---|---|---|
| warn | peer trusted ∧ XFF absent | Caddy misconfigured |
| warn | peer untrusted | something bypassed Caddy — §2.3 broken |
| info | first resolution | names source `xff`\|`peer` |

### 2.2 Retention task — D4 (new scope, user-approved)

```ts
export interface RetentionResult { messagesIpNulled: number; bansIpNulled: number|null; guestsDeleted: number } // null = statement 2 skipped
export function runRetention(pool: Pool, now?: Date): Promise<RetentionResult>
```

**[D] Mechanism: systemd timer → oneshot unit → release-scoped Node script.** Justification against the alternatives the coordinator named:

| Option | Verdict |
|---|---|
| **systemd timer** | **Chosen.** systemd is already PID 1 → no resident process, no memory. Inherits `User=`, both `EnvironmentFile=` lines, journald. `systemctl list-timers` + a `failed` unit = the "one thing to monitor" `docs/TODO.md:63` **[V]** demands. |
| in-process `setInterval` | Rejected. 0 extra memory, but retention stops silently whenever the app is down or crash-looping — and a long `DELETE` competes with request handling on 1 vCPU. Couples a privacy promise to app uptime. |
| cron | Rejected. Cannot read a systemd `EnvironmentFile`; failure goes to mail/nowhere. Fails the monitorability requirement. |

**[D] Host↔release interaction** (the coordinator's question): units are **host-scoped** (`/etc/systemd/system`, installed once by runbook step 10); the script is **release-scoped** (`ExecStart=/usr/bin/node /srv/chat/current/dist/db/retention.js`), so it resolves through the symlink and rolls back with the release — consistent with arch-notes §4.7. Consequences, both accepted:
- Rolling back below the release that introduced the script leaves the timer pointing at a missing file → the unit **fails loudly** each run. Detectable, not silent. **[I]**
- The unit is a **stable contract**: one fixed path, no arguments. All behaviour lives in the script, so a release may change retention logic without a host edit. Changing the path or arguments requires a runbook step and `daemon-reload`.

Semantics — three statements, **one transaction**, fixed order (`messages` → `bans` → `users`). One transaction because a partially-applied run would report success while half-keeping the promise. Cutoffs are constants in code (decisions, not config — `docs/PATTERNS/env-config-secrets.md:16` **[V]**).

| # | Statement | Cutoff | Source |
|---|---|---|---|
| 1 | `messages.ip → NULL` | `created_at < now-30d` | `docs/ARCHITECTURE.md:186-193` **[V]** |
| 2 | `bans.ip → NULL` — **guarded, see below** | `expires_at < now-30d` | same |
| 3 | `DELETE users WHERE is_guest` | `last_seen_at < now-24h` | `docs/ARCHITECTURE.md:70` **[V]** |

**[D] Statement 2 is guarded on relation existence. [S] user decision 2026-09-08: guard it, do not land the moderation migration.**
`bans` does not exist in the database. `src/db/migrations/1757800001_users_rooms_messages.sql:4-6` **[V]** creates only `users`, `rooms`, `messages` and states "`bans`, `reports`, `moderation_actions` are approved-but-unmigrated - do not add them here, they have no consumer yet". Unguarded, Postgres aborts the **whole** transaction on the missing relation, so statements 1 and 3 roll back with it and `messages.ip` is **never erased** — a silent, permanent failure of the exact promise this task exists to keep. **[V]**
Guard: skip statement 2 when the relation is absent (`to_regclass('bans') IS NULL`), report `bansIpNulled: null` to distinguish "skipped" from "zero rows", and log that it was skipped. Wiring it in when the moderation migration lands is a `docs/TODO.md` item (PLAN B7).

CLI entry: create pool → `runRetention` → log one structured line with all three counts → **`pool.end()`** → exit 0/1.

### 2.3 Bind, firewall, gate, units, workflow

No new interfaces. Shapes and reasons: bind+firewall → arch-notes §2 · Caddyfile → §4.1 · units → §5.1/§5.2 · workflow + release tree → §3 · secrets/identity → §6/§7 · rollback → §8.

Deploy workflow inputs (`workflow_dispatch`): none required beyond the ref. Repo **variables** `SITE_DOMAIN`, `DEPLOY_HOST`, `SSH_KNOWN_HOSTS`; repo **secret** `DEPLOY_SSH_KEY`. Permissions: `contents: read`, `checks: read`.

## 3. Acceptance criteria

Proof marking: **[LOCAL]** = provable in repo/CI with no infrastructure · **[HOST]** = requires the provisioned droplet, with the runbook step that proves it. Runbook steps = arch-notes §10.

### 3.1 Client IP — REQ-MOD-003, `docs/TODO.md:43-46`

| # | Criterion | Proof |
|---|---|---|
| AC-IP-1 | Peer `127.0.0.1` + `XFF: 203.0.113.9` → returns `203.0.113.9` | [LOCAL] unit |
| AC-IP-2 | Peer `127.0.0.1` + `XFF: 1.2.3.4, 203.0.113.9` → returns `203.0.113.9` (**last**, not first) | [LOCAL] unit |
| AC-IP-3 | Peer `203.0.113.50` (untrusted) + `XFF: 1.2.3.4` → returns `203.0.113.50`; header ignored | [LOCAL] unit — the security case |
| AC-IP-4 | Peer `::ffff:127.0.0.1` is trusted (dual-stack form) | [LOCAL] unit |
| AC-IP-5 | Peer trusted + header absent → returns peer | [LOCAL] unit |
| AC-IP-6 | Peer trusted + `XFF: not-an-ip` → returns peer, never the malformed string | [LOCAL] unit — prevents `22P02` on the `inet` column |
| AC-IP-7 | `remoteAddress` undefined + no header → returns `undefined` (column nullable) | [LOCAL] unit |
| AC-IP-8 | `upgrade.ts` builds `ConnectionContext.ip` from the extractor, not `req.socket.remoteAddress` | [LOCAL] `upgrade.test.ts` asserts `context.ip` via the `connection` event |
| AC-IP-9 | Repo contains no `app.set('trust proxy'…)` (arch-notes §1.2) | [LOCAL] `grep` |
| AC-IP-10 | Each of the 3 log conditions fires at most once per process | [LOCAL] unit |
| AC-IP-11 | A message sent through Caddy records a **public** IP; `SELECT ip,count(*) FROM messages GROUP BY 1` top row ≠ `127.0.0.1` | **[HOST]** runbook 13f — the only end-to-end proof of REQ-MOD-003 |
| AC-IP-12 | `journalctl -u chat` shows no AC-IP-10 warn lines after a clean deploy | **[HOST]** runbook 13g |

### 3.2 Bind & firewall — arch-notes §2

| # | Criterion | Proof |
|---|---|---|
| AC-BIND-1 | `index.ts` passes `'127.0.0.1'` as the host argument to `listen()` | [LOCAL] `grep`/inspection |
| AC-BIND-2 | From off-host, `:3000` refuses/times out **while the service is running and listening** | **[HOST]** runbook **13**, after the first deploy. Checking this at step 3 is vacuous — nothing is bound to 3000 yet, so it passes whether or not the bind and firewall work |
| AC-BIND-3 | `ufw status` = deny incoming; only 22/80/443 allowed | **[HOST]** runbook 3 |
| AC-BIND-4 | Postgres `listen_addresses` is local-only | **[HOST]** runbook 4 |

### 3.3 CD workflow — `docs/TODO.md:17-21`, arch-notes §3

| # | Criterion | Proof |
|---|---|---|
| AC-CD-1 | Only trigger is `workflow_dispatch` **[S]** | [LOCAL] inspection |
| AC-CD-2 | `runs-on: ubuntu-24.04` (pinned, not `latest`) — arch-notes §3.4 | [LOCAL] inspection |
| AC-CD-3 | No `download-artifact`, no `workflow_run`, no third-party action | [LOCAL] `grep` |
| AC-CD-4 | Fails before touching the host if CI is not green for the dispatched SHA | [LOCAL] inspection; **[HOST]** first red-commit dispatch |
| AC-CD-5 | Release contains `package.json`, `node_modules/`, `dist/server/`, `dist/client/`, `src/db/migrations/*.sql`, `deploy.env` | [LOCAL] inspectable step list; **[HOST]** runbook 12 `ls` |
| AC-CD-6 | `deploy.env` is generated with `ALLOWED_ORIGIN=https://<SITE_DOMAIN>`, no trailing slash | [LOCAL] inspection; **[HOST]** 13e (a slash = 403 on every upgrade) |
| AC-CD-7 | Prod install uses `--omit=dev --ignore-scripts` | [LOCAL] inspection |
| AC-CD-8 | `concurrency` group with `cancel-in-progress: false` — arch-notes §8.5 | [LOCAL] inspection |
| AC-CD-9 | bcrypt smoke runs on the droplet **before** the symlink flips | [LOCAL] step order; **[HOST]** runbook 13h |
| AC-CD-10 | Deploy order is stop → flip → migrate → start **[S]** | [LOCAL] step order; **[HOST]** runbook 12 |
| AC-CD-11 | Health poll ≥ 60 s and gates success — arch-notes §5.4 | [LOCAL] inspection; **[HOST]** 13b |
| AC-CD-12 | Workflow never receives `JWT_SECRET`, `DATABASE_URL`, or the gate credential | [LOCAL] `grep` of workflow + secret list |

### 3.4 Caddy — `docs/TODO.md:47-53`, arch-notes §4

| # | Criterion | Proof |
|---|---|---|
| AC-CAD-1 | `header_up X-Forwarded-For {http.request.remote.host}` present (replace, not append) | [LOCAL] inspection |
| AC-CAD-2 | Hostname appears only as `{$SITE_DOMAIN}`; no literal domain in the repo | [LOCAL] `grep` |
| AC-CAD-3 | No plaintext password anywhere; hash supplied via `{$GATE_HASH}` | [LOCAL] `grep` |
| AC-CAD-4 | `caddy validate` passes | **[HOST]** runbook 9 (no Caddy binary on the darwin dev box) |
| AC-CAD-5 | Certificate issued for `SITE_DOMAIN` | **[HOST]** runbook 9 |
| AC-CAD-6 | Unauthenticated `GET /` → 401; authenticated → 200 | **[HOST]** runbook 13c/13d |
| AC-CAD-7 | **WebSocket connects through the gate in a real browser** | **[HOST]** runbook 13e — pass/fail; on fail apply the §4.4 `/ws` fallback and re-test. Record which occurred. |
| AC-CAD-8 | Gate block is contiguous and delimited so removal is delete+reload, no code change | [LOCAL] inspection |

### 3.5 systemd — arch-notes §5

| # | Criterion | Proof |
|---|---|---|
| AC-SYS-1 | `chat.service`: `Type=exec`, `Restart=on-failure`, `RestartSec=5`, `StartLimitIntervalSec`/`Burst` in `[Unit]` | [LOCAL] inspection |
| AC-SYS-2 | Two `EnvironmentFile=` lines, **neither** `-`-prefixed | [LOCAL] inspection |
| AC-SYS-3 | `ExecStart` invokes `node` directly (no `npm start`) | [LOCAL] inspection |
| AC-SYS-4 | No `MemoryDenyWriteExecute`, no `SystemCallFilter` (arch-notes §5.3) | [LOCAL] `grep` — a present `MemoryDenyWriteExecute` breaks V8 |
| AC-SYS-5 | `MemoryMax=512M` + `NODE_OPTIONS=--max-old-space-size=384` | [LOCAL] inspection |
| AC-SYS-6 | No migrations in `ExecStartPre` | [LOCAL] `grep` |
| AC-SYS-7 | `chat-migrate.service` is `Type=oneshot`, same `User=`/env files | [LOCAL] inspection |
| AC-SYS-8 | `systemd-analyze verify` clean | **[HOST]** runbook 10 (Linux-only tool) |
| AC-SYS-9 | Killing the process → systemd restarts it; 5 rapid failures → `failed`, not endless `activating` | **[HOST]** runbook 13 |

### 3.6 Secrets & identity — arch-notes §6, §7

| # | Criterion | Proof |
|---|---|---|
| AC-SEC-1 | `secrets.env` is `0640 root:rosetta-chat` | **[HOST]** runbook 7 |
| AC-SEC-2 | `sudo -u deploy cat /etc/rosetta-chat/secrets.env` is **denied** | **[HOST]** runbook 7 — explicit negative test; §6 rests on it |
| AC-SEC-3 | `deploy` sudoers lists exactly 4 commands, no wildcard | **[HOST]** runbook 2 |
| AC-SEC-4 | `rosetta-chat` has nologin shell, no authorized_keys, no sudo | **[HOST]** runbook 2 |
| AC-SEC-5 | Root SSH and password auth disabled | **[HOST]** runbook 2 |
| AC-SEC-6 | No secret in repo: `.env` untracked, no key material committed | [LOCAL] `git ls-files` + `grep` |

### 3.7 Rollback & migration failure — arch-notes §8, §9

| # | Criterion | Proof |
|---|---|---|
| AC-ROL-1 | Symlink flip uses `mv -T` (atomic), not bare `ln -sfn` onto an existing link | [LOCAL] inspection |
| AC-ROL-2 | Failure at migrate/start/health auto-flips to the previous release and restarts | [LOCAL] inspection; **[HOST]** runbook 14 |
| AC-ROL-3 | An auto-rolled-back deploy still exits **non-zero** | [LOCAL] inspection; **[HOST]** runbook 14 |
| AC-ROL-4 | Rollback never runs `down` migrations | [LOCAL] `grep` |
| AC-ROL-5 | ≥3 releases retained | **[HOST]** runbook 14 |
| AC-ROL-6 | Manual one-liner rollback documented and **executed once** | **[HOST]** runbook 14 — a drill, per `docs/ARCHITECTURE.md:238` **[V]** |
| AC-ROL-7 | **First-deploy branch:** with no prior release, any failure stops, leaves the site down, and does **not** attempt a flip. The workflow exits non-zero and says explicitly that no rollback target existed | [LOCAL] inspection; **[HOST]** runbook 12 — this is B8, so the first real deploy is exactly the case with no rollback target |
| AC-ROL-8 | **Flip failure:** if `mv -T` fails at step 4, before migration starts, the previous release is restarted rather than left stopped | [LOCAL] inspection; **[HOST]** runbook 14 |
| AC-MIG-1 | `npm run migrate` passes no `--no-single-transaction` (default `true` **[V]** — `node_modules/node-pg-migrate/bin/node-pg-migrate.js:179-183`, v8.0.4) | [LOCAL] inspection |
| AC-MIG-2 | No migration declares `disable_transaction` | [LOCAL] `grep src/db/migrations/` |
| AC-MIG-3 | A deliberately failing migration leaves schema **and** `pgmigrations` unchanged | [LOCAL] against local PG 17 |

### 3.8 Retention — `docs/TODO.md:61-63`

| # | Criterion | Proof |
|---|---|---|
| AC-RET-1 | `messages` with `created_at` = now−31d and non-null `ip` → `ip` NULL, **row retained** | [LOCAL] integration, `TEST_DATABASE_URL` |
| AC-RET-2 | `messages` at now−29d keep their `ip` | [LOCAL] boundary |
| AC-RET-3 | **`bans` absent (current state): statement 2 is skipped, `bansIpNulled` is `null`, the run still succeeds, and statements 1 and 3 still commit.** An unguarded run would abort the transaction and erase nothing — regression-test that explicitly. When `bans` exists: `expires_at` = now−31d → `ip` NULL, row retained for audit | [LOCAL] integration, both branches |
| AC-RET-4 | Guest `users` with `last_seen_at` = now−25h deleted; their `messages` survive with `author_id` NULL and `author_nickname` intact | [LOCAL] integration — `docs/ARCHITECTURE.md:176` **[V]** |
| AC-RET-5 | Non-guest users are never deleted regardless of `last_seen_at` | [LOCAL] integration |
| AC-RET-6 | Every statement that **does** run runs in **one** transaction; an induced failure in statement 3 leaves statement 1 un-applied. A skipped statement 2 (AC-RET-3) does not weaken this | [LOCAL] integration |
| AC-RET-7 | The 24 h bound equals `GUEST_TTL_MS` (`src/server/session.ts:24` **[V]**); a test asserts equality so drift fails CI | [LOCAL] unit — no second literal |
| AC-RET-8 | CLI calls `pool.end()`; the process exits without waiting out `idleTimeoutMillis` (30 s, `docs/ARCHITECTURE.md:47` **[V]**) | [LOCAL] timed test |
| AC-RET-9 | CLI exits non-zero on failure and logs all three counts on success | [LOCAL] unit |
| AC-RET-10 | Timer is `OnCalendar=daily` + `Persistent=true`; a missed run fires after boot rather than being skipped | [LOCAL] inspection; **[HOST]** `systemctl list-timers` |
| AC-RET-11 | Daily granularity on a 30-day rule ⇒ worst-case retention 30 d + <24 h, i.e. **≤31 days**. **[S] accepted by the user 2026-09-08** as satisfying `docs/ARCHITECTURE.md:186-193`; tightening is a one-line `OnCalendar` change if that ever changes | [LOCAL] arithmetic |
| AC-RET-12 | `ExecStart` targets `/srv/chat/current/...` with no arguments (stable host contract) | [LOCAL] inspection |
| AC-RET-13 | Timer fires and the unit succeeds on the real host | **[HOST]** runbook 13 |

### 3.9 Runbook & docs

| # | Criterion | Proof |
|---|---|---|
| AC-RUN-1 | Runbook covers arch-notes §10 steps 0–15 in that order, each with an expected value | [LOCAL] inspection |
| AC-RUN-2 | Ordering constraints called out as such: swap before Postgres; firewall before Caddy; DNS before Caddy | [LOCAL] inspection |
| AC-RUN-3 | Step 9 states that a **502 is the correct result** before the first deploy | [LOCAL] inspection — prevents a false alarm |
| AC-RUN-4 | Step 13 is a pass/fail checklist with expected values, not prose | [LOCAL] inspection |
| AC-DOC-1 | `docs/ARCHITECTURE.md` deployment topology reflects loopback bind, release/symlink model, retention timer | [LOCAL] |
| AC-DOC-2 | `docs/TECHSTACK.md:40` CD row rewritten: nothing will ever consume the `dist/client` artifact, by decision | [LOCAL] |
| AC-DOC-3 | `docs/TODO.md` — 4 corrections applied (arch-notes §12), closed items moved to `agents/IMPLEMENTATION.md` | [LOCAL] |
| AC-DOC-4 | `docs/TODO.md:23-25` rationale rewritten (not merely re-prioritised) | [LOCAL] |
| AC-DOC-5 | `agents/IMPLEMENTATION.md` records installed versions, droplet IP, real cost; `docs/ASSUMPTIONS.md:56-60,71-75` closed | **[HOST]** runbook 15 |

## 4. Testing strategy

**Starting position: no net.** Discovery §5 **[V]** — zero tests anywhere assert on IP or `X-Forwarded-For`; `remoteAddress` in `upgrade.test.ts:59-70` and `connection.test.ts:41` is scaffolding, not an assertion target. Every guarantee in §3.1 is created by this chunk.

| Layer | Scope | Notes |
|---|---|---|
| Unit, pure | AC-IP-1…7, 10; AC-RET-7, 9 | Table-driven. No DB, no sockets — the extractor is pure precisely so this is possible (arch-notes §1.1). **AC-IP-10 asserts once-per-process behaviour, which is module-level state: its tests must reset that state per test (fresh module instance or an exported reset), or the suite becomes order-dependent and passes for the wrong reason.** |
| Unit, harness | AC-IP-8 | Extend `emitUpgrade()` (`upgrade.test.ts:59-70` **[V]**) with an `xForwardedFor` option; assert `context.ip` from the `connection` event. Harness exists; only assertions are missing. |
| Integration, PG 17 | AC-RET-1…6, 8; AC-MIG-3 | `TEST_DATABASE_URL` + `npm run db:reset:test` (`package.json:19` **[V]**). Backdate `created_at`/`last_seen_at` explicitly — never `now()`-relative fixtures. |
| Static | AC-CD-*, AC-CAD-1/2/3/8, AC-SYS-1…7, AC-ROL-1/4/7/8, AC-MIG-1/2, AC-SEC-6 | `grep`/inspection at review. **`[LOCAL]` is not uniformly strong.** For AC-CD-4, AC-CD-6 and the `[LOCAL]` halves of AC-ROL-2/3/7/8 it means *the step exists and reads correctly*, not *the step behaves* — behaviour is proven only by the paired `[HOST]` check. Do not close these on inspection alone. |
| **Untestable locally** | AC-CAD-4, AC-SYS-8 | Dev box is darwin-arm64 (discovery §6 **[V]**): no `systemd-analyze`, no Caddy binary assumed. `caddy validate` and `systemd-analyze verify` are **runbook** steps 9 and 10. Do not fake them in CI. |
| **[HOST]** | 31 criteria carry a host check; **20 of them cannot be advanced at all** without the droplet, 11 are inspected locally and confirmed there | This chunk ships "ready to provision", not "verified in production". |

## 5. Assumptions & open items

1. **AC-RET-11 boundary — CLOSED [S] 2026-09-08.** ≤31 days accepted by the user as satisfying the 30-day rule. No longer an open item; recorded here because AC-RET-11 cites it.
2. **`last_seen_at` is never updated by application code** — **[V]**, `grep -rn last_seen_at src/` returns only the migration. It is set at INSERT and never refreshed, so AC-RET-4 reaps guests 24 h after **creation**, not after activity. Harmless now (the guest JWT expires at 24 h, `src/server/session.ts:17` **[V]**), but the column's name promises behaviour the code does not implement. **Will become a real defect when sessions outlive a single visit.** Not fixed here — out of scope, and fixing it silently would change reaping semantics.
3. **Default branch is `develop` — [V]**, resolved 2026-09-08 after my earlier reading of `refs/remotes/origin/HEAD` proved to be a stale clone-time cache. Evidence: coordinator ran `git remote set-head origin -a` → `refs/remotes/origin/develop` and confirmed against the GitHub API; independently reconfirmed by the plan reviewer. Consistent with `docs/TODO.md:29` and `.github/workflows/ci.yml:11-16` **[V]**. Sequencing consequence: the dispatch button does not exist until `deploy.yml` lands on `develop` (**[V]** — GitHub requires the file on the default branch, https://docs.github.com/en/actions/reference/workflows-and-actions/events-that-trigger-workflows).
4. Memory bounds in AC-SYS-5 are unmeasured, presented as such (accepted, arch-notes open item 6).
5. AC-CAD-7 outcome is unknown until measured (arch-notes §4.4); the fallback is pre-authorised.
6. **These specs supersede `architecture-notes.md` in three places**, found by plan review 2026-09-08. Arch-notes must be reconciled (PLAN B7) so it does not stand as a competing authority: §8.2's failure table has **no row for a failed stop or a failed flip** (→ AC-ROL-8) and **no first-deploy branch** where no rollback target exists (→ AC-ROL-7); §10's runbook shape places the `:3000` reachability check at step 3, where it is vacuous (→ AC-BIND-2).

## 6. On adding retention to this chunk — the argument, as requested

**It does not damage coherence. Ship it here.** File intersection with the deploy work is **empty** (`src/db/retention.ts` + `deploy/systemd/` vs `src/server/net|ws`, `.github/`), and the dependency runs one way: retention needs the release/unit model this chunk defines; nothing in the deploy needs retention. It is a clean parallel batch, not an entanglement.

**One real cost, named rather than absorbed:** it adds a second thing that can fail on first deploy, and its natural failure mode — a timer that never fires — is *silent*, which is the exact failure class this chunk otherwise spends §1.7 and §5.4 eliminating. **Condition on acceptance:** AC-RET-10, -12, -13 exist to make that failure loud (a `failed` unit and a visible `list-timers` row). Without them I would argue for splitting it back out.

## 7. Affected files

Modified: `src/server/ws/upgrade.ts` · `src/server/ws/upgrade.test.ts` · `src/server/index.ts` · `src/server/session.ts` (export only) · `.github/workflows/ci.yml` (1 line) · `docs/{ARCHITECTURE,TECHSTACK,TODO}.md` · `agents/IMPLEMENTATION.md` · `docs/ASSUMPTIONS.md`
New: `src/server/net/client-ip.ts` (+test) · `src/db/retention.ts` (+test) · `.github/workflows/deploy.yml` · `deploy/Caddyfile` · `deploy/systemd/{chat.service,chat-migrate.service,rosetta-chat-retention.service,rosetta-chat-retention.timer}` · `docs/RUNBOOK-gated-deploy.md`
Unchanged: schema · `package.json` · `.env.example` · `compose.yml`
