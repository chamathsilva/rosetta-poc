# GATED-DEPLOY — execution plan

Steps and sequencing (HOW). Target state and acceptance criteria (WHAT) → `plans/gated-deploy/GATED-DEPLOY-SPECS.md`. Architecture and rationale → `plans/gated-deploy/architecture-notes.md`. **Neither is restated here.**

Deviation from skill `planning`: per-session files and `HANDOFF.md` are **merged into this one file** at the coordinator's explicit instruction (MEDIUM request, two files). Batch sections below are the session units.

## Read first

`plans/gated-deploy/architecture-notes.md` · `GATED-DEPLOY-SPECS.md` · `agents/TEMP/gated-deploy/discovery-notes.md` · `docs/ARCHITECTURE.md` §Deployment topology · `docs/PATTERNS/env-config-secrets.md`

## Governing rules

| Rule | Authority |
|---|---|
| Design is approved; disagreement → open question, never a silent change | `docs/CONTEXT.md:65` |
| `workflow_dispatch` only; droplet never builds; migrations before restart; owner provisions | user-settled, arch-notes §0 |
| Constants that encode decisions stay in code, not env | `docs/PATTERNS/env-config-secrets.md:16` |
| No DM design, mention, or preparation | `docs/CONTEXT.md:61` |
| Token/wall-clock cost recorded per feature | `docs/CONTEXT.md:62` → `docs/EVALUATION-LOG.md` |
| Every AC traces to a design § or a `docs/TODO.md` item | SPECS §3 |

Outcomes recorded in: `agents/IMPLEMENTATION.md` (changelog) · `docs/ASSUMPTIONS.md` (open items) · this file's Status table.

## File ownership — prevents parallel collision

| Batch | Owns exclusively |
|---|---|
| B1 | `src/server/net/**` |
| B2 | `src/server/ws/upgrade.ts`, `upgrade.test.ts`, `src/server/index.ts` |
| B3 | `src/db/retention.ts`, `retention.test.ts`, `src/server/session.ts` |
| B4 | `deploy/**` |
| B5 | `.github/workflows/deploy.yml` |
| B6 | `docs/RUNBOOK-gated-deploy.md` |
| B7 | `docs/*.md`, `agents/IMPLEMENTATION.md`, `.github/workflows/ci.yml` |

No path appears twice. Unlisted pairs are sequential. Parallelism below is valid **only** because of this table.

## Phases

| # | Batch | Depends on | Parallel with | Role |
|---|---|---|---|---|
| B1 | Client-IP extractor + tests | — | B3, B4 | `rosetta:engineer` |
| B2 | Wire extractor; loopback bind | B1 | B3, B4 | `rosetta:engineer` |
| B3 | Retention task + timer script | — | B1, B2, B4 | `rosetta:engineer` |
| B4 | Caddyfile + systemd units | — | B1, B2, B3 | `rosetta:engineer` |
| B5 | Deploy workflow | B2, B3, B4 | — | `rosetta:engineer` |
| B6 | Provisioning runbook | B4, B5 | B7 | `rosetta:engineer` |
| B7 | Documentation updates | B1–B5 | B6 | `rosetta:engineer` |
| B8 | **Owner provisions + executes runbook** | B6, B7 merged to `develop` | — | **human (owner)** |
| B9 | Record results | B8 | — | `rosetta:engineer` |

**B8 runs alone.** It is the only batch that touches infrastructure, and it is not an AI session.

---

## B1 — Client-IP extractor

### Do
1. Create `src/server/net/client-ip.ts` per SPECS §2.1 — pure, no framework imports.
2. Create `src/server/net/client-ip.test.ts` covering AC-IP-1…7, 10.

### Notes (traps)
- Take the **last** XFF value. The leftmost is attacker-controlled (discovery §3).
- `::ffff:127.0.0.1` must be in the trusted set or the extractor silently never fires (arch-notes §1.3).
- Validate with `net.isIP()`. `messages.ip` is `inet`; an invalid string throws `22P02` inside the send path (SPECS AC-IP-6).
- Trusted peers are a **constant**, not config.
- Log conditions fire once per process per condition — not once per connection.

### Done when
`npm test` green; AC-IP-1…7, 10 each have a named test; no import of `express` or `ws` in the module.

### Checklist
`[ ]` Implemented `[ ]` 8 ACs (AC-IP-1…7, 10) covered by named tests `[ ]` Edge cases: chained, malformed, absent, undefined peer, IPv6-mapped `[ ]` Lint + typecheck clean `[ ]` No framework coupling `[ ]` Cost recorded

---

## B2 — Wire the extractor; bind loopback

### Do
1. `src/server/ws/upgrade.ts:95` — build `ConnectionContext.ip` from `extractClientIp(...)`.
2. `src/server/index.ts:41` — pass `'127.0.0.1'` as the host argument to `listen()`.
3. Extend `emitUpgrade()` (`upgrade.test.ts:59-70`) with an `xForwardedFor` option; assert `context.ip` off the `connection` event (AC-IP-8).

### Notes (traps)
- Do **not** add `app.set('trust proxy', …)` — arch-notes §1.2, AC-IP-9. This narrows `docs/TODO.md:45` deliberately.
- The `connection` event carries the context as the **third** argument (`upgrade.ts:99`).
- Binding loopback breaks any workflow that reached `:3000` from another machine — including local Docker-to-host access. Vite's dev proxy targets `localhost:3000` (`vite.config.ts:25`) and is unaffected.

### Done when
`npm test` green; AC-IP-8, AC-IP-9, AC-BIND-1 provable; the existing **seven** upgrade tests still pass unchanged (**[V]** counted 2026-09-08: `upgrade.test.ts:72,85,101,113,126,141,153`; "six" was wrong in discovery §5 and in arch-notes §1.8 — see B7).

### Checklist
`[ ]` Implemented `[ ]` AC-IP-8/9, AC-BIND-1 `[ ]` No regression in existing upgrade tests `[ ]` `grep 'trust proxy'` empty `[ ]` Manually run locally `[ ]` Docs deferred to B7

---

## B3 — Retention task

### Do
1. Create `src/db/retention.ts` per SPECS §2.2 — `runRetention()` plus a CLI entry.
2. Export `GUEST_TTL_MS` from `src/server/session.ts:24` (export only — no behaviour change).
3. Create `src/db/retention.test.ts` covering AC-RET-1…9 against `TEST_DATABASE_URL`.

### Notes (traps)
- **One transaction, three statements, fixed order.** `docs/TODO.md:63` forbids splitting into three schedules.
- **`pool.end()` is mandatory.** Without it the oneshot unit hangs ~30 s on `idleTimeoutMillis` (`docs/ARCHITECTURE.md:47`) — AC-RET-8.
- Guest delete must filter `WHERE is_guest`. `bans.created_by` and `moderation_actions.actor_id` are `NOT NULL REFERENCES users(id)` with no `ON DELETE` action (`docs/ARCHITECTURE.md:133,152`) — deleting a referenced user aborts the whole transaction.
- Messages must survive their author: `author_id` → NULL, `author_nickname` snapshot intact (`docs/ARCHITECTURE.md:176`).
- Backdate fixtures with explicit timestamps; never `now()`-relative, or boundary tests become time-of-day dependent.
- **RESOLVED [S] 2026-09-08 — guard statement 2, do not land the moderation migration.** `bans` does not exist (`1757800001_users_rooms_messages.sql:4-6`). Unguarded, the missing relation aborts the whole transaction, so statements 1 and 3 roll back and `messages.ip` is **never erased** — the task would fail silently on every run, forever. Implement per SPECS §2.2 and AC-RET-3; test **both** branches, including a regression test that an unguarded form would fail.
- **Process note, not a technical one:** this file already flagged the `bans` gap as "stop-and-report if this changes scope" and no report was made — the flag was written and then walked past. A flag in a plan is only worth the escalation it triggers. Any batch that hits a `Notes (traps)` item it cannot satisfy stops and reports **before** implementing around it.

### Done when
AC-RET-1…9 green against local PG 17; the drift-guard test fails if `GUEST_TTL_MS` changes; the run succeeds with `bans` absent.

### Checklist
`[ ]` Implemented `[ ]` AC-RET-1…9 `[ ]` Boundary cases both sides of 30d/24h `[ ]` Transaction atomicity proven by induced failure `[ ]` `pool.end()` verified by a timed test `[ ]` Statement-2 guard tested both branches `[ ]` Lint + typecheck clean

---

## B4 — Caddyfile and systemd units

### Do
1. `deploy/Caddyfile` per arch-notes §4.1, with the gate block delimited for deletion.
2. `deploy/systemd/chat.service`, `chat-migrate.service` per arch-notes §5.1/§5.2.
3. `deploy/systemd/rosetta-chat-retention.service` + `.timer` per SPECS §2.2.

### Notes (traps)
- `header_up` **replaces**; `+` would append. AC-CAD-1.
- **No `MemoryDenyWriteExecute`** — breaks V8. No `SystemCallFilter` — deferred, arch-notes §5.3.
- `EnvironmentFile=` without `-`, both lines, so a missing file is a loud failure.
- `StartLimitIntervalSec`/`StartLimitBurst` go in `[Unit]`, not `[Service]`.
- Retention `ExecStart` targets `/srv/chat/current/...` with **no arguments** — the unit is a stable host contract (SPECS §2.2).
- `Persistent=true` on the timer, or a powered-off droplet silently skips a day.
- Quote `{$GATE_HASH}` — bcrypt hashes contain `$`.
- These files cannot be validated on darwin (SPECS §4). Do not add a CI job that pretends otherwise.

### Done when
AC-CAD-1/2/3/8, AC-SYS-1…7, AC-RET-10/12 provable by inspection; no literal hostname, no credential.

### Checklist
`[ ]` 5 artifacts written `[ ]` Static ACs met `[ ]` `grep` for hostname/secret literals empty `[ ]` Gate block delimited `[ ]` Validation deferred to runbook steps 9/10, stated in-file

---

## B5 — Deploy workflow

### Do
1. `.github/workflows/deploy.yml` per arch-notes §3 and SPECS §2.3/§3.3.

### Notes (traps)
- `runs-on: ubuntu-24.04`, pinned — arch-notes §3.4. `ci.yml` may stay on `latest`; do not "fix" it for consistency.
- `concurrency` with `cancel-in-progress: **false**` — opposite of `ci.yml:19-21`, deliberately. Comment it.
- Order: rsync → bcrypt smoke → stop → flip → migrate → start → health → external 401.
- Health poll must exceed 60 s: a startup failure can take ~30 s to surface (arch-notes §5.4). `systemctl start` exiting 0 proves nothing.
- Flip with `mv -T`. `ln -sfn` onto an existing symlink is not atomic.
- Auto-rollback **and** exit non-zero (AC-ROL-3).
- **First deploy has no rollback target** (AC-ROL-7) — and B8 *is* the first deploy. With no prior release, fail, leave the site down, do not flip, and say so in the output. A blind flip here corrupts `current`.
- **A failed `mv -T` at step 4 leaves the service stopped** (AC-ROL-8). Restart the previous release; do not fall through to migrate.
- Never `down`-migrate on rollback.
- Workflow must not receive `JWT_SECRET`/`DATABASE_URL`/gate credential (AC-CD-12).
- `deploy.env` generated with no trailing slash on `ALLOWED_ORIGIN` — a slash is a 403 on every upgrade (`.env.example:26-32`).

### Done when
AC-CD-1…12, AC-ROL-1/3/4/7/8 provable by inspection. `actionlint` clean if available.

### Checklist
`[ ]` Implemented `[ ]` 17 static ACs met `[ ]` Step order matches arch-notes §8.1 `[ ]` Rollback path present and exits non-zero `[ ]` First-deploy branch (AC-ROL-7) `[ ]` Flip-failure branch (AC-ROL-8) `[ ]` Secrets surface reviewed `[ ]` Cannot be executed until B8 — stated

---

## B6 — Provisioning runbook

### Do
1. `docs/RUNBOOK-gated-deploy.md` — steps 0–15 of arch-notes §10, each with an expected value.

### Notes (traps)
- Reference arch-notes and SPECS by §; do not re-derive rationale into the runbook.
- Ordering constraints are the content: swap before Postgres; firewall before Caddy; DNS before Caddy; units installed but **not started** before the first release.
- Step 9 must say a **502 is correct** at that point, or the owner will stop and debug a healthy system.
- Step 13e is pass/fail with a named fallback (arch-notes §4.4) — the WebSocket-through-the-gate test. Record the outcome either way; it is a finding.
- Step 13f is the REQ-MOD-003 proof and must not be abbreviated.
- Step 7 includes the **negative** test `sudo -u deploy cat secrets.env` → denied.
- Step 14 is a rollback drill, executed on day one.
- **Step 12 must state the first-deploy branch before the owner runs it** (AC-ROL-7): the first deploy has nothing to roll back to, so a failure leaves the site down and that is the expected, correct behaviour — not a bug to debug at 2 a.m.
- The `:3000` off-host reachability check belongs at **step 13**, after something is listening. At step 3 it passes vacuously (AC-BIND-2). SPECS §5.6 records this as superseding arch-notes §10.
- All 31 criteria carrying a `[HOST]` check in SPECS §3 must appear as numbered runbook checks.

### Done when
AC-RUN-1…4 met; all 31 `[HOST]` checks mapped to a step.

### Checklist
`[ ]` Steps 0–15 present in order `[ ]` Expected value per check `[ ]` 31 `[HOST]` checks mapped `[ ]` Ordering constraints flagged `[ ]` No duplicated rationale `[ ]` Owner-executable without asking the author

---

## B7 — Documentation

### Do
1. `docs/ARCHITECTURE.md` — deployment topology gains loopback bind, release/symlink model, retention timer, deploy identity.
2. `docs/TECHSTACK.md:40` — CD row rewritten (nothing will ever consume the `dist/client` artifact, by decision).
3. `docs/TODO.md` — apply arch-notes §12 corrections 1, 2, 4; move closed items (`:17-21`, `:39-41`, `:43-46`, `:47-49`, `:51-53`, `:61-63`) to `agents/IMPLEMENTATION.md`.
4. `agents/IMPLEMENTATION.md` — record what shipped.
5. `.github/workflows/ci.yml:123` — `client-${{ github.event.pull_request.head.sha || github.sha }}` (P2, one line).
6. `docs/TODO.md` — **add** a work item: wire retention statement 2 (`bans.ip`) in when the moderation migration lands; until then it is a guarded no-op (SPECS §2.2, AC-RET-3). Without this item the guard becomes permanent by forgetting.
7. Reconcile `plans/gated-deploy/architecture-notes.md` with SPECS §5.6 — §8.2 gains the failed-stop/failed-flip row and the first-deploy branch; §10 moves the `:3000` check to step 13. Leaving arch-notes uncorrected leaves a competing authority in the repo.
8. Correct "six tests" → **seven** in `agents/TEMP/gated-deploy/discovery-notes.md` §5 and arch-notes §1.8 (**[V]** `upgrade.test.ts:72,85,101,113,126,141,153`).
9. `docs/PATTERNS/` — extract a pattern **only if** two genuine occurrences exist. Fewer than two → do not create one; `docs/TODO.md:105-107` already says current patterns are prescribed rather than extracted.

### Notes (traps)
- Corrections 1 and 2 (stale CSP item, stale scaffold-stub item) were independently confirmed by the coordinator — apply, do not re-litigate.
- Correction 4 rewrites the *rationale* of `docs/TODO.md:23-25`, not just its priority.
- `docs/ARCHITECTURE.md` is transcribe-don't-improve territory (`docs/CONTEXT.md:65`). Additions only; no re-derivation of decided content.
- Do not mark `[HOST]` ACs done. Nothing is deployed at this point.
- The "six tests" error rode through three documents unchecked — the failure mode `docs/EVALUATION-FINDINGS.md` already names. Re-verify counts and quotes at the source before copying them forward.

### Done when
AC-DOC-1…4 met; no `docs/TODO.md` item claims something the repository contradicts.

### Checklist
`[ ]` 4 corrections applied `[ ]` 6 closed items moved `[ ]` CD row rewritten `[ ]` Artifact-name fix landed `[ ]` `bans` statement-2 TODO added `[ ]` arch-notes §8.2/§10 reconciled `[ ]` "six"→"seven" fixed in discovery + arch-notes `[ ]` Pattern extracted or explicitly declined `[ ]` No `[HOST]` AC marked done

---

## B8 — Owner provisions and executes (human, runs alone)

### Do
1. Merge B1–B7 to `develop`. **`deploy.yml` must be on the default branch or the dispatch button does not exist** (SPECS §5.3).
2. Provision the droplet; execute `docs/RUNBOOK-gated-deploy.md` steps 0–11.
3. Dispatch the deploy workflow (step 12).
4. Execute verification step 13 (a–h) and the rollback drill (step 14).

### Done when
All 31 `[HOST]` checks recorded pass/fail with observed values, including AC-CAD-7's outcome and AC-IP-11's query result.

### Checklist
`[ ]` Merged to `develop` `[ ]` Droplet provisioned `[ ]` Runbook 0–11 `[ ]` First deploy green `[ ]` 13a–h recorded `[ ]` Rollback drilled `[ ]` AC-CAD-7 outcome recorded `[ ]` AC-IP-11 shows a public IP

---

## B9 — Record results

### Do
1. `agents/IMPLEMENTATION.md` — installed versions, droplet IP, real monthly cost, `[HOST]` AC results.
2. `docs/ASSUMPTIONS.md` — close `:56-60` (Postgres major drift) and `:71-75` (cost); update `:64-69` (backups still unproven) and `:77-80` (ceiling still unmeasured).
3. `docs/EVALUATION-LOG.md` — token and wall-clock cost for this feature.
4. Raise follow-ups: `/healthz`, `last_seen_at` never updated (SPECS §5.2), retention boundary (SPECS §5.1), whichever AC-CAD-7 branch was taken.

### Done when
AC-DOC-5 met; no `[HOST]` AC is left in an unknown state.

### Checklist
`[ ]` Versions + cost recorded `[ ]` 2 assumptions closed, 2 updated `[ ]` Evaluation log row added `[ ]` 4 follow-ups raised `[ ]` No unknown-state AC

---

## Gates

Explicit stop-and-approve between every batch. HITL is mandatory (`rosetta:hitl`); no batch starts on the assumption that the previous one passed.

| Gate | Blocks | Passes when |
|---|---|---|
| G1 | B2 | B1 extractor reviewed — trust rule and last-value parse confirmed against arch-notes §1 |
| G2 | B5 | B2, B3, B4 complete; `npm test` green; no file-ownership violation |
| G3 | B6, B7 | B5 workflow reviewed — step order and rollback path confirmed |
| G4 | **B8** | **User approval to provision.** `docs/ARCHITECTURE.md:221`: do not provision before ready. Blast radius: real host, real money, real data. `rosetta:risk-assessment` + `rosetta:dangerous-actions` apply. |
| G5 | B9 | Runbook executed; `[HOST]` results in hand |

## Test strategy

Owned by SPECS §4 — layers, harness reuse, and the locally-untestable set. **The starting position is no regression net**: discovery §5 **[V]** found zero tests asserting on IP anywhere. B1's tests are the net, written in the same batch as the behaviour they protect; B2 must not land without AC-IP-8.

## Status

| Batch | State |
|---|---|
| B1–B7 | not started |
| B8 | blocked — G4, droplet not provisioned (`docs/ASSUMPTIONS.md:71-75`) |
| B9 | blocked — B8 |

Active blockers: none for **B1, B3, B4** (startable in parallel now). B2 waits on G1/B1 per the Phases table.
Deferred decisions: `last_seen_at` semantics (SPECS §5.2) · `SystemCallFilter` (arch-notes §5.3).
Closed 2026-09-08 **[S]**: retention boundary ≤31 days accepted (SPECS §5.1) · `bans` guarded rather than migrated (B3 notes) · default branch is `develop` (SPECS §5.3).
Next: B1, B3, B4 in parallel.
