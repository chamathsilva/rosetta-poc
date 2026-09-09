# Gated deploy — architecture notes

Architecture for the first deployment of the walking skeleton to a real droplet, behind the Caddy basic-auth gate.
No code. No provisioning. Style follows `docs/ARCHITECTURE.md`: terse, decision-first, every decision carries its reason so it is not silently reverted.

Primary input: `agents/TEMP/gated-deploy/discovery-notes.md` — referenced by section, never restated.

Marking per claim: **[V]** = verified directly (file read, command run, or quoted from linked documentation). **[I]** = my inference from verified facts. **[D]** = decision made here, with reason. **[S]** = settled by the user this session, not open for redesign.

Memory frame for every decision below: **1 GB total, shared by Postgres, Node and Caddy** (`docs/ARCHITECTURE.md:216`). Every process this design adds is measured against that gigabyte, and the design adds **zero** long-lived processes beyond the three already planned.

---

## 0. Chosen design in one paragraph

**[D]** A `workflow_dispatch`-only GitHub Actions workflow checks out the chosen ref, builds server and client **on the runner**, installs production dependencies **on the runner**, rsyncs a self-contained release directory to `/srv/chat/releases/<id>` over SSH, then over the same SSH session: stops the service, atomically flips the `/srv/chat/current` symlink, runs migrations via a `oneshot` systemd unit, starts the service, and polls a loopback health check. Any failure after the flip re-flips the symlink to the previous release and restarts it, and the workflow still reports red. Caddy terminates TLS on a DuckDNS subdomain, enforces `basic_auth` above the application, and **replaces** `X-Forwarded-For` with the real peer address; Node binds loopback only, `ufw` denies everything else, and a single shared extractor trusts that header only when the TCP peer is loopback.

---

## 1. Trusted-proxy client IP

Closes `docs/TODO.md:43-46` (P0, REQ-MOD-003). Mechanism and failure mode already established — discovery §§1–4. Not restated.

### 1.1 Where the extraction lives

**[D]** One pure function, one file, no framework coupling:

`src/server/net/client-ip.ts` → `extractClientIp(remoteAddress: string | undefined, forwardedFor: string | undefined): string | undefined`

Reason: discovery §2 **[V]** proves the WebSocket upgrade path and the Express request path are structurally different objects with different lifecycles. A single *pure* function is the only shape that can be called from both without either path importing the other's framework. Two implementations would mean `messages.ip` and any future `reports`/`bans` IP could disagree depending on which path recorded them — and the moderation floor bans on that value (`docs/ARCHITECTURE.md:129-138`).

- **WS path** — called at `src/server/ws/upgrade.ts:95`, replacing `req.socket.remoteAddress` in the `ConnectionContext`. This is the only site that currently captures an IP (discovery §1 **[V]**).
- **HTTP path** — **no site calls it today.** `src/server/http/join.ts` and `src/server/http/session.ts` read no IP at all (discovery §1 **[V]**). The extractor is called from an Express handler only when one first needs an IP (report intake, rate limiting).

### 1.2 `app.set('trust proxy', ...)` is NOT added — [D], departs from `docs/TODO.md:45`

`docs/TODO.md:45` says Express `trust proxy` "still covers `POST /api/join` and `GET /api/session`". That sentence is technically true and operationally misleading: it describes what `req.ip` *would* return, and **neither handler reads `req.ip`** (discovery §1 **[V]**). Setting it now installs a second, differently-behaving trust mechanism (Express hop-counting, left-to-right) that nothing consumes, and that a future handler would reach for by reflex instead of the extractor.

Decision: do not set it. When an HTTP handler needs an IP, it calls `extractClientIp(req.socket.remoteAddress, req.headers['x-forwarded-for'])`. One trust rule, one place to audit, one place to get wrong.

This narrows `docs/TODO.md:45` rather than contradicting it. Flagged in §12 as a doc edit the orchestrator should make.

### 1.3 What it trusts

**[D]** Trust the `X-Forwarded-For` header **only** when the immediate TCP peer is loopback:

`127.0.0.1`, `::1`, `::ffff:127.0.0.1`

The IPv4-mapped form is mandatory, not defensive padding: a dual-stack Node listener reports loopback IPv4 peers as `::ffff:127.0.0.1`. **[I]** — follows from Node's dual-stack listen behaviour quoted in discovery §4 **[V]**. Omitting it silently disables the whole extractor and every row records `::ffff:127.0.0.1`.

The trusted set is a **constant in code, not an environment variable.** Reason: `docs/PATTERNS/env-config-secrets.md:16` — "values that are **decisions**, not configuration … stay as constants in code". Caddy and Node are co-located on one droplet by decision (`docs/ARCHITECTURE.md:212-213`), so "the proxy is loopback" is a decision. This answers discovery open question #2.

### 1.4 What it must never trust

- The header's presence alone.
- Any value at all when the peer is not loopback.
- The **leftmost** entry — that is the attacker-controlled one (discovery §3 **[V]**).
- An unvalidated string. `messages.ip` is `inet` (`docs/ARCHITECTURE.md:122`, `src/db/migrations/1757800001_users_rooms_messages.sql:38` **[V]**). A malformed value reaches `insertMessage()` (`src/db/queries/messages.ts:71-97`, discovery §1 **[V]**) and Postgres rejects it with `22P02` — which throws inside the send path. **[I]** Consequence: header validation is a *liveness* requirement, not hygiene — an unvalidated extractor converts a spoofed header into a broken send. Validate with `net.isIP(value) !== 0`; on failure, fall back.

### 1.5 What it falls back to

`remoteAddress`, always — never to an untrusted header value. The column is nullable, so `undefined` is representable and is the correct answer when Node genuinely does not know.

### 1.6 What Caddy must send — [D] replace, do not append

```
reverse_proxy 127.0.0.1:3000 {
    header_up X-Forwarded-For {http.request.remote.host}
}
```

`header_up` with a single value **overwrites** any existing header; `+` prefix is what appends. **[V]** — Caddy v2, https://caddyserver.com/docs/caddyfile/directives/reverse_proxy ("`header_up Some-Header "value"` overwrites any existing values"; `+` = append, `-` = delete).

Reason: Caddy's *default* behaviour is "sets or augments" — it appends the real peer to a client-supplied header, producing `1.2.3.4, <real ip>` (discovery §3 **[V]**). Correct last-value parsing handles that, but it makes the correctness of the whole chain depend on a parsing rule that reads as an implementation detail. Replacing makes the header contain exactly one value: the real peer. The chain becomes verifiable by eye.

**The extractor still takes the last comma-separated value anyway.** Reason: defence against exactly one future event — someone removes the `header_up` line and Caddy's append default returns. Under append, last-value is correct; under replace, last-value is also correct. The two rules must not depend on each other.

Caddy must **not** strip `Origin`: `src/server/ws/upgrade.ts:67-71` **[V]** rejects the upgrade with 403 on any mismatch, using strict `!==`. Caddy passes unlisted headers through unmodified **[V]** (same doc: "by default, Caddy passes through incoming headers … with three exceptions"). Consequence: `ALLOWED_ORIGIN` must be `https://<SITE_DOMAIN>` with **no trailing slash** — a trailing slash is a 403 on every WebSocket upgrade with an otherwise-working page, the exact failure `.env.example:26-32` already warns about.

### 1.7 How a wrong answer is detectable rather than silent

The named failure mode (`docs/TODO.md:45`) is "every row carries the same useless value and nothing fails visibly". Three mechanisms, each catching a different wrongness:

**[D] a. Two warn-level log lines, one per condition, rate-limited to once per process per condition.**

| Condition | What it proves is broken |
|---|---|
| peer **is** loopback **and** `X-Forwarded-For` absent | Caddy is proxying but not setting the header — the `header_up` line or the whole `reverse_proxy` block is wrong |
| peer is **not** loopback | Something reached `:3000` without going through Caddy — the loopback bind or the firewall (§2) is not in effect |

Both are impossible in a correct deployment, so neither is noise. Once per process keeps a flood of connections from filling journald on a 1 GB box.

**[D] b. One info line at first resolution per process**, naming the source (`xff` or `peer`). The operator sees on the very first connection, in `journalctl -u chat`, which path won. This is the cheap version of a readiness assertion — there is nothing to assert at boot, because no client exists yet.

**[D] c. A runbook query, run once after the first real message** (§10 step 13):
`SELECT ip, count(*) FROM messages GROUP BY 1 ORDER BY 2 DESC LIMIT 5;`
If the top row is `127.0.0.1`, the extractor or Caddy is wrong. This is the only check that tests the *whole* chain end to end including the database column, and it is the direct test of REQ-MOD-003's actual requirement.

**[D] Not done: reject a non-loopback peer.** A request arriving directly at `:3000` still carries a *true* socket address; recording it is correct data from an unexpected path. Rejecting would fail closed in local development and in any future topology change, for no integrity gain. Warn and record; do not refuse.

### 1.8 Tests

Discovery §5 **[V]**: zero existing tests assert on IP, so nothing regresses and everything is new. Required cases: peer trusted + single value; peer trusted + chained value (last wins); peer trusted + header absent; peer **untrusted** + header present (header ignored — the security case); peer `::ffff:127.0.0.1`; malformed header value; header present but empty.

---

## 2. The bind/firewall gap

Gap established by discovery §4 **[V]**: `src/server/index.ts:41` binds all interfaces, and no firewall configuration exists anywhere in the repository.

**[D] Both. They defend against different things, and neither is redundant.**

| Control | Defends against | Does not defend against |
|---|---|---|
| `server.listen(config.port, '127.0.0.1', cb)` | The entire internet reaching `:3000`, **even if the firewall is off, mis-ordered, flushed by a package upgrade, or never enabled**. It is the only control that survives a firewall mistake, and it is a one-argument change with zero cost — Caddy is same-host (`docs/ARCHITECTURE.md:212-213`). | Every other port. A local process. |
| `ufw` default-deny inbound; allow 22, 80, 443 | Every port nobody thought about: Postgres 5432, anything a future `apt install` starts listening on, anything started by hand during debugging and forgotten. The bind protects the one port you remembered. | `:3000` specifically, if `ufw` is ever disabled or reset. |
| *(neither)* | — | A **compromised local process** connecting to `127.0.0.1:3000` with a forged `X-Forwarded-For`. This is precisely why §1.3's peer check is a code-level condition and not an appeal to network topology — discovery §4 **[V]** makes the same point. |

**[D]** DigitalOcean Cloud Firewall is **not** used as a third layer. Reason: it is off-host configuration with no representation in this repository or the runbook, so it drifts invisibly and adds a place to look during an outage. `ufw` is a runbook step with a verifiable `ufw status` output.

**[D]** Runbook additionally verifies Postgres is not listening publicly (`listen_addresses`), rather than assuming the Debian packaging default holds. Reason: a default is a configuration, not a guarantee, and this is a one-line check.

---

## 3. Cross-run artifact consumption

Four options enumerated in discovery §7 **[V]**.

### 3.1 Decision: **option 4 — the deploy workflow builds**

The runner builds; **the droplet never builds** **[S]**. Option 4 does not violate that constraint — discovery §7 says so explicitly, and it is worth restating because the option's name invites the misreading.

### 3.2 Why, against the settled `workflow_dispatch` decision — [S]

This is the decisive argument, and it is a direct consequence of the settled trigger:

**`workflow_dispatch` is ref-centric. Options 1–3 are run-centric or SHA-centric.** A human pressing the button picks a **ref** — that is the only thing the dispatch UI offers alongside inputs **[V]**, https://docs.github.com/en/actions/reference/workflows-and-actions/events-that-trigger-workflows ("`GITHUB_REF` reflects the branch or tag you selected"). Every other option inserts a mapping step between *what the human chose* and *what gets shipped*:

- Option 1 (`workflow_run` trigger) is **structurally incompatible** — it is an automatic trigger. Adopting it means something reaches the host without a human pressing a button. Dead on the settled constraint, not on merit.
- Option 2 (`run-id` as a dispatch input) makes the human transcribe a run id from the Actions UI. The failure mode is silent and severe: a mistyped or stale id ships a build of a *different commit* than the ref selected, and nothing about the deploy looks wrong.
- Option 3 (third-party resolver action) removes the transcription but adds a third-party action holding a repository token, on a repo whose SonarCloud gate already flags unpinned actions and where the user's acceptance of that finding rested specifically on `claude-code-action@v1` being *the vendor's* supported entry point (`docs/TECHSTACK.md:39` **[V]**). That reasoning does not transfer to an unrelated third party.
- Option 4 has **no mapping step**. Dispatch ref → checkout that ref → build it → ship it. What you pressed is what runs.

Secondary benefits, all real: no `actions: read` permission; no 14-day artifact-retention window between build and deploy (`.github/workflows/ci.yml:126` **[V]**); no cross-run token plumbing; no dependency on `download-artifact`'s cross-run API at all.

Accepted cost: a second build, ~1–2 minutes of runner time. CI's build job stays as a **merge gate**, not as a deploy input. The two builds run the same `npm run build` (`package.json:11` **[V]**), so there is one build definition, not two.

**[D] Additional guard, because `workflow_dispatch` alone does not know whether CI passed.** A precondition step queries the check runs for the dispatched SHA and fails the deploy if CI is not successful. Permission: `checks: read`. Reason: with the `workflow_run` trigger rejected, nothing else links "green" to "deployed", and the single most likely operator error is deploying a red commit to an internet-facing host. Six lines, one failure mode removed.

### 3.3 Is the artifact-naming fix still correctness-critical? — plainly: **no**

`docs/TODO.md:23-25` (P1, `github.event.pull_request.head.sha || github.sha`).

Under option 4, **nothing looks that artifact up**, so the defect cannot cause a lookup failure. Discovery §7 anticipated exactly this ("worth flagging as a possible way the fix's urgency changes"). **[D]** The item stays open but is **downgraded from P1-correctness to P2-hygiene**, with a new and different reason: CI's artifact remains the human-facing record of "what did this PR build", and naming it after a commit that exists in no branch makes that record misleading to a person, not to a machine. Recommend the orchestrator rewrite `docs/TODO.md:23-25`'s justification rather than just re-prioritising it — the current wording ("becomes a silent lookup failure the moment a deploy job resolves it by head SHA") is falsified by this design and would otherwise re-argue itself later.

### 3.4 Production dependencies are installed on the runner, not the droplet — [D]

Sequence on the runner: `npm ci` (full) → `npm run build` → `rm -rf node_modules` → `npm ci --omit=dev --ignore-scripts` → assemble release → rsync.

Reasons:
1. The droplet never contacts the npm registry at deploy time. No network dependency, no registry outage, no install-script surface on the host, and none of the CPU or transient memory of an `npm ci` on a 1 GB box.
2. `--ignore-scripts` matches `.github/workflows/ci.yml:39,88,114` **[V]** and is safe here: discovery §6 **[V]** establishes `bcrypt@6.0.0` ships `prebuildify` binaries inside the tarball, including `linux-x64/bcrypt.glibc.node`, and needs no install script on any platform.
3. Because `bcrypt`'s prebuilds directory contains *every* platform, the installed package directory is portable between two machines of the same architecture and libc.

**[D] The runner is pinned to `runs-on: ubuntu-24.04`, not `ubuntu-latest`.** **[I]**, and this is the non-obvious part: `ubuntu-latest` is a moving label. When it advances to the next LTS, the runner's glibc moves ahead of an Ubuntu 24.04 droplet's, and a native module built or resolved against the newer glibc can fail to load on the host — a failure that appears *after* a green build, at service start, with no change to this repository. Pinning the runner to the droplet's OS removes an entire class of "it worked yesterday". This applies to the deploy workflow; `.github/workflows/ci.yml` may stay on `ubuntu-latest` since it ships nothing.

**[D]** The release is smoke-tested for the native module **on the droplet, before the symlink flips**: `node -e "require('bcrypt').hashSync('x',12)"` inside the new release directory. This closes discovery open question #5 mechanically instead of by assertion, and it closes `docs/TODO.md:39-41` — whose *stated reasoning* discovery §6 and Contradiction 1 **[V]** showed to be factually stale on two counts.

### 3.5 Release tree — fixed by the code, not by preference

```
/srv/chat/releases/<utc-timestamp>-<short-sha>/
  package.json          <-- REQUIRED, see below
  node_modules/         (production only)
  dist/server/index.js
  dist/client/
  src/db/migrations/*.sql
  deploy.env
```

- `dist/client` must sit **next to** `dist/server` — `src/server/index.ts:27` **[V]** resolves it as `path.join(import.meta.dirname, '../client')`. Confirmed by `tsconfig.json:9-10` (`rootDir: src`, `outDir: dist`) and `vite.config.ts:11` (`outDir: '../../dist/client'`) **[V]**.
- `src/db/migrations/*.sql` must be present as **source-tree-relative plain SQL** — `package.json:18` **[V]** (`-m src/db/migrations`), and both migration files are plain `.sql` **[V]**.
- **`package.json` at the release root is load-bearing and easy to omit.** `tsconfig.json:7` sets `module: nodenext` **[V]**, so `dist/server/*.js` is emitted as ESM with `import` statements, and Node resolves module type from the nearest `package.json` — which is the release root's `"type": "module"` (`package.json:6` **[V]**). Ship the release without it and the service dies at first line with `Cannot use import statement outside a module`. **[I]** from the two verified facts.

---

## 4. Caddy

### 4.1 Shape

```
{
    email {$ACME_EMAIL}
}

{$SITE_DOMAIN} {
    encode zstd gzip

    # === GATE — delete this block at public launch. Nothing else changes. ===
    basic_auth {
        {$GATE_USER} "{$GATE_HASH}"
    }
    # === END GATE ===

    reverse_proxy 127.0.0.1:3000 {
        header_up X-Forwarded-For {http.request.remote.host}
    }
}
```

`{$VAR}` is environment substitution performed **before Caddyfile parsing**, with a `{$VAR:default}` form **[V]** — Caddy v2, https://caddyserver.com/docs/caddyfile/concepts. Variables are supplied by an `EnvironmentFile` drop-in on `caddy.service` (`/etc/caddy/caddy.env`, `root:caddy`, `0640`).

`basic_auth` (v2.8+ spelling) takes a **hash, never a plaintext password**; generate with `caddy hash-password` — discovery §8 **[V]**.

`{$GATE_HASH}` is quoted because a bcrypt hash contains `$` characters. The runbook runs `caddy validate --config /etc/caddy/Caddyfile` before every reload, which turns any substitution or quoting surprise into a loud pre-reload failure rather than a dead site.

### 4.2 TLS

Automatic HTTPS. Prerequisites, both of which are runbook *ordering* constraints, not configuration: the DuckDNS A record must already resolve to the droplet, and 80 + 443 must be reachable — discovery §8 **[V]**. Consequence for §2: `ufw` must allow 80 and 443 **before** Caddy first starts, or ACME HTTP-01 fails and the site serves nothing. 80 is required even though the site is HTTPS-only; it carries the challenge and the redirect.

### 4.3 WebSocket upgrade proxying

Nothing to configure. Caddy performs the HTTP upgrade and transitions to a bidirectional tunnel automatically **[V]** (reverse_proxy docs, and discovery §8 reached the same conclusion independently). The nginx-style `proxy_set_header Upgrade`/`Connection` dance has no Caddy equivalent and must not be invented.

Client-side is already correct: `src/client/useChatSocket.ts:28-31` **[V]** derives `wss:` from `window.location.protocol`, so TLS needs no client change.

### 4.4 RISK — basic auth may break the WebSocket handshake. Read this before provisioning.

**[I], and the highest-severity finding in this design.** The gate sits above the application and therefore also above `/ws`. A browser cannot set headers on a WebSocket handshake, and **Chrome never presents an authentication dialogue for a WebSocket connection**; whether it replays *cached* basic-auth credentials from the already-authenticated page onto the same-origin handshake is browser-dependent and not guaranteed. There are well-documented cases of basic auth on a reverse proxy blocking WebSocket connections with a 401 the application never sees, and of Firefox caching handshake credentials too aggressively.
Sources **[V]**: https://groups.google.com/a/chromium.org/g/chromium-bugs/c/0nz0r-7mh6I (Chromium: WebSocket upgrade handshake does not handle HTTP 401), https://github.com/coder/code-server/issues/1348 (basic auth on nginx/haproxy blocks WS), https://websockets.readthedocs.io/en/stable/topics/authentication.html (Firefox credential caching).

Why it matters here specifically: the gate is the *entire* pre-public security model (`docs/CONTEXT.md:42`), and the walking skeleton's whole purpose is proving the WebSocket path works on real infrastructure. The plausible bad outcome is a deploy that looks successful — site loads, gate prompts, login works — and chat is dead.

**[D] Primary: keep `basic_auth` on the whole site.** Do not weaken a security control against a risk that may not materialise.

**[D] Pre-authorised fallback, if the runbook's browser test fails** — exempt only the upgrade endpoint:

```
    @notws not path /ws
    basic_auth @notws {
        {$GATE_USER} "{$GATE_HASH}"
    }
```

This is safe, and the reason is specific rather than general: `/ws` independently requires a **signed session cookie** (`src/server/ws/upgrade.ts:73-82` **[V]**) whose only issuer is `POST /api/join` (`src/server/http/app.ts:32` **[V]**) — which remains behind the gate. It also enforces the `Origin` allowlist before touching the cookie (`upgrade.ts:67-71` **[V]**). So an unauthenticated stranger reaching `/ws` gets 401 from the application, having gained nothing.

**[D]** The runbook makes this an explicit pass/fail step with a named fallback (§10 step 13), so the decision is made with a measurement instead of a guess. The measurement cannot be taken from this repository — it needs a browser against a live gated host.

### 4.5 Removable by config change alone — [S] satisfied

Delete the marked block, `caddy validate`, `systemctl reload caddy`. No application change, no redeploy, no restart of the Node process. Satisfies `docs/ARCHITECTURE.md:219` and `docs/CONTEXT.md:42`.

**[D] Not used: an `import` of a separate gate file.** It reads cleaner but adds a failure mode — an import whose target is missing or whose glob matches nothing — for no gain at three lines. A commented marker is greppable and cannot fail to parse.

### 4.6 The single hostname variable — and the honest limit on it

**[S]** One DuckDNS hostname, one value, three consumers: the Caddyfile, `ALLOWED_ORIGIN`, and the runbook.

**[D] It cannot be a single *runtime* reference, and pretending otherwise would be the bug.** systemd `EnvironmentFile` is **not a shell** and performs no variable expansion between entries **[V]** (systemd.exec(5), https://man7.org/linux/man-pages/man5/systemd.exec.5.html; format is literal `KEY=VALUE`), so the app's env file cannot say `ALLOWED_ORIGIN=https://${SITE_DOMAIN}`. Caddy's `{$SITE_DOMAIN}` and systemd's `ALLOWED_ORIGIN` are two files read by two processes with no shared interpolation.

Single-source is therefore achieved by **generation plus assertion**, not by reference:

1. `SITE_DOMAIN` is a GitHub Actions **repository variable** (not a secret — it is public the moment DNS resolves).
2. The deploy workflow **generates** `deploy.env` containing `ALLOWED_ORIGIN=https://<SITE_DOMAIN>` (no trailing slash — §1.6). The app's origin value is never hand-typed.
3. `/etc/caddy/caddy.env` carries `SITE_DOMAIN` and is owner-managed via the runbook — the one hand-typed copy.
4. **The deploy asserts they agree**: after restart, `curl -sS -o /dev/null -w '%{http_code}' https://<SITE_DOMAIN>/` must return `401`. A 401 proves DNS, TLS, the gate, and Caddy's site block all name the same host. A connection failure or a 200 means the two copies have drifted, and the deploy fails.

Drift is prevented by a check that runs on every deploy, not by a mechanism that does not exist.

### 4.7 Split config, not one env file — [D]

`ALLOWED_ORIGIN`/`PORT`/`NODE_ENV` live in the **release-scoped** `deploy.env`; `DATABASE_URL`/`JWT_SECRET` live in the **host-scoped** `/etc/rosetta-chat/secrets.env`. systemd accepts multiple `EnvironmentFile=` lines.

Two reasons, both load-bearing:
1. **Security** (§6): the deploy identity never needs write access to the secrets file, and CI never sees its contents.
2. **Rollback correctness** (§8): non-secret configuration flips with the symlink. If a future release adds a required variable, rolling back automatically restores the *previous* variable set. A host-global config file would leave the old code facing new config, which is a rollback that does not actually roll back.

---

## 5. systemd

Two units. Neither is a long-lived extra process.

### 5.1 `chat.service`

```
[Unit]
Description=Rosetta POC chat
After=network-online.target postgresql.service
Wants=network-online.target
StartLimitIntervalSec=300
StartLimitBurst=5

[Service]
Type=exec
User=rosetta-chat
Group=rosetta-chat
WorkingDirectory=/srv/chat/current
EnvironmentFile=/etc/rosetta-chat/secrets.env
EnvironmentFile=/srv/chat/current/deploy.env
Environment=NODE_OPTIONS=--max-old-space-size=384
ExecStart=/usr/bin/node dist/server/index.js
Restart=on-failure
RestartSec=5
NoNewPrivileges=yes
ProtectSystem=strict
ProtectHome=yes
PrivateTmp=yes
PrivateDevices=yes
ProtectKernelTunables=yes
ProtectControlGroups=yes
RestrictAddressFamilies=AF_INET AF_INET6 AF_UNIX
MemoryMax=512M
LimitNOFILE=8192

[Install]
WantedBy=multi-user.target
```

**`Type=exec`, not `simple`** — with `exec`, `systemctl start` reports failure if the binary cannot be invoked; with `simple` it reports success even when invocation fails **[V]** (systemd.service(5), https://man7.org/linux/man-pages/man5/systemd.service.5.html). The deploy script's exit code is only as honest as this setting.

**`Restart=on-failure`, `RestartSec=5`.** `on-failure` covers non-zero exit **[V]** (same source; default `RestartSec` is 100ms, far too tight here). `src/server/index.ts:49-51` **[V]** sets `process.exitCode = 1` on any startup failure, so a missing environment variable, an unreachable database, or an unmigrated schema all exit non-zero and restart.

**`StartLimitIntervalSec=300` / `StartLimitBurst=5`** — these belong in `[Unit]` in modern systemd. The reason they matter is specific: a fail-fast configuration error (`src/server/config.ts:30-33` **[V]**) will *never* fix itself by restarting. Without a start limit the unit crash-loops forever and `systemctl status` shows `activating`, which reads like progress. With it, the unit lands in `failed` after five attempts — a state a human and a script can both detect.

**`EnvironmentFile=` with no `-` prefix** on both lines, deliberately. Without the dash, systemd refuses to start when the file is missing **[V]** (systemd.exec(5)) — a missing secrets file must be a loud unit failure, not a start that proceeds to a slightly-later `loadConfig()` throw.

**No `ExecStartPre=` running migrations.** Reason: `ExecStartPre` runs on *every* start, including every crash-restart, coupling restart availability to database availability and re-running the migration runner in a loop. Migrations belong to a deploy, not to a process lifecycle.

**`npm start` is not used.** `ExecStart` invokes `node` directly rather than `package.json:15`'s `npm start` **[V]**. Reason: `npm start` leaves a supervising npm process alive for the life of the service — tens of MB of the shared gigabyte, plus a signal-forwarding layer between systemd and the process it thinks it is supervising, for zero benefit.

### 5.2 `chat-migrate.service` — [D] a separate oneshot unit, not an inline SSH command

```
[Unit]
Description=Rosetta POC chat — database migrations
After=postgresql.service

[Service]
Type=oneshot
User=rosetta-chat
Group=rosetta-chat
WorkingDirectory=/srv/chat/current
EnvironmentFile=/etc/rosetta-chat/secrets.env
EnvironmentFile=/srv/chat/current/deploy.env
ExecStart=/usr/bin/node node_modules/node-pg-migrate/bin/node-pg-migrate.js up -m src/db/migrations
```

Reason it is a unit rather than a raw SSH command: the migration then runs under **exactly** the service's identity, environment files, and journald stream — one definition of "the application's environment" instead of two that drift. `systemctl start` on a `Type=oneshot` unit blocks until completion and returns non-zero on failure **[V]** (systemd.service(5)), so the deploy script gets a real exit code, and the failure is in `journalctl -u chat-migrate` next to everything else.

Also: the `deploy` user needs no `DATABASE_URL` and never reads the secrets file (§6). It only needs permission to *start* this unit.

### 5.3 Hardening worth it on a 1 GB box

**[I] The cost filter is the wrong filter.** Namespace and prctl hardening (`ProtectSystem`, `ProtectHome`, `PrivateTmp`, `PrivateDevices`, `NoNewPrivileges`) costs a handful of mount operations once at start and **zero steady-state memory**. Nothing in that list competes with Postgres for the gigabyte. The real filter is **breakage risk**, and the two decisions that matter are the ones *not* taken:

- **`MemoryDenyWriteExecute=yes` must NOT be set.** It breaks V8's JIT. This is the single most common way a hardened Node unit fails to start, and it fails in a way that reads like a Node bug.
- **`SystemCallFilter=` is deliberately omitted.** The marginal gain over `NoNewPrivileges` + `ProtectSystem=strict` is small, and a wrong filter surfaces at runtime as behaviour that looks like an application bug. It cannot be validated from this repository — only against the real droplet. Revisit after the host exists, not before.

**No `ReadWritePaths=`** — the application writes no files; logs go to stdout and thence journald. `ProtectSystem=strict` mounts the whole hierarchy read-only except `/dev`, `/proc`, `/sys` **[V]** (systemd.exec(5)), and `PrivateTmp=yes` supplies a writable `/tmp`. **If the application ever writes a file, this unit must change in the same commit** — otherwise it fails at runtime with a confusing `EROFS`.

**`MemoryMax=512M` paired with `NODE_OPTIONS=--max-old-space-size=384`.** **[I]** and the pairing is the point: a cgroup limit alone means the kernel OOM-kills Node with no warning and no heap error. Telling V8 a lower ceiling makes it collect garbage and, if genuinely out of memory, throw a diagnosable heap error first. The cgroup cap remains as the backstop that protects Postgres from a Node leak. Neither number is measured — the capacity ceiling has never been measured (`docs/ARCHITECTURE.md:251`, `docs/ASSUMPTIONS.md:77-80` **[V]**) — they are bounds chosen to fail safely, and they are the first things to revisit when real numbers exist.

### 5.4 `systemctl restart` returning 0 does not mean the service works — [I], and it changes the deploy

Chain of verified facts: `src/server/index.ts:19-25` **[V]** creates the pg pool and runs `resolveLobbyRoomId()` **before** `listen()`; on failure `main().catch` sets `process.exitCode = 1` without calling `process.exit()` (`index.ts:49-51` **[V]**); the pool's `idleTimeoutMillis` is `30_000` (`docs/ARCHITECTURE.md:47` **[V]**). Therefore a startup failure that occurs *after* the pool has opened a connection keeps the event loop alive on the idle timer, and the process exits **roughly 30 seconds later** rather than immediately. With `Type=exec`, systemd reports the unit active as soon as the binary executes.

Consequence for the deploy script: **`systemctl start` exiting 0 proves the binary ran, not that the service is listening.** The deploy must poll an actual health check, and its timeout must exceed 30 seconds or it will pass on a service that is about to die.

**[D] Health check: `curl -fsS -o /dev/null http://127.0.0.1:3000/`, polled every 2s for up to 60s.** It uses what exists today: static `dist/client` served by `src/server/http/app.ts:38` **[V]**, which proves the process is listening, the Express chain is up, and the client artifact actually landed. It runs on loopback, **below Caddy**, so the gate never blocks the deploy.

**Discovery-adjacent finding:** `docs/ARCHITECTURE.md:35` **[V]** lists "health check" as a `server/http` responsibility. **No health endpoint exists** — `app.ts:32-38` **[V]** registers only `/api/join`, `/api/session`, and static. A real `/healthz` that checks the pool would be strictly better than the static-file probe. Not built here (that would be code, and out of scope); logged in §12.

---

## 6. Secrets

### 6.1 Placement

| Value | Lives in | Reason |
|---|---|---|
| `DEPLOY_SSH_KEY` (ed25519 private key, no passphrase) | GitHub **secret** | The only thing CI genuinely needs and the only true secret CI holds. |
| `SITE_DOMAIN`, `DEPLOY_HOST`, `SSH_KNOWN_HOSTS` | GitHub **variables** | All three are public information the moment DNS resolves and the host key is presented. Storing public data as a secret buys nothing and makes it unreadable in logs when debugging. |
| `JWT_SECRET`, `DATABASE_URL` | Host only, `/etc/rosetta-chat/secrets.env`, `root:rosetta-chat`, `0640` | Never enter GitHub, never enter the repository, never enter a workflow log. |
| Basic-auth **hash** | Host only, `/etc/caddy/caddy.env`, `root:caddy`, `0640` | Caddy needs it; nothing else does. |
| Basic-auth **plaintext**, Postgres superuser password | **Owner's password manager only** | Never on the host in plaintext, never in CI, never in the repository. |

**[D] CI never holds an application secret.** The deploy pipeline ships code; it does not carry the keys to sessions or the database. Concretely: a leaked `DEPLOY_SSH_KEY` does not hand over `JWT_SECRET` (which forges any session, including a future admin's) or `DATABASE_URL` (which reads every message and every retained IP).

**Stated honestly, because overselling this would be worse than not doing it:** the separation is not airtight. An attacker with the deploy key can push a release whose code reads `secrets.env` as `rosetta-chat` and restart the service. What the separation actually buys is (a) protection against *accidental* disclosure — a debugging `cat` in a workflow step, an over-broad rsync, a log that echoes the environment; and (b) making a deliberate theft **noisy**: it requires a release directory that persists on disk, a unit restart in journald, and a workflow run in the Actions log. It raises cost and leaves evidence. It does not make theft impossible.

### 6.2 The basic-auth credential

1. Plaintext generated by the owner with `openssl rand -base64 24`. High entropy matters, because a bcrypt hash sitting on a host is offline-crackable if the password is guessable.
2. Hashed **on the droplet** with `caddy hash-password` (bcrypt, interactive prompt) — discovery §8 **[V]**. Interactive so the plaintext never enters shell history.
3. Hash written to `/etc/caddy/caddy.env`. Plaintext goes to the password manager and nowhere else.
4. **CI never receives it, in either form.** The deploy reaches the host over SSH and health-checks on loopback beneath Caddy — the gate is never in the deploy's path. The external assertion (§4.6) expects `401`, which requires no credential.

`JWT_SECRET` is generated with `openssl rand -base64 48`, per `.env.example:19` **[V]**. Rotating it invalidates every live session — there is no refresh flow (`.env.example:20`, `docs/ARCHITECTURE.md:71` **[V]**).

### 6.3 `NODE_ENV=production` — resolving discovery open question #4

**[D] Yes, set it, in `deploy.env`.** It is not in `config.ts`'s `REQUIRED` list (`src/server/config.ts:20` **[V]**) and must not be added there — `.env.example:35-36` **[V]** marks it "conventional, not fail-fast checked", and `docs/PATTERNS/env-config-secrets.md:15` **[V]** explicitly permits exactly this class of variable. Express changes behaviour on it (view caching, verbose error pages that can leak stack traces). `npm start` is not used (§5.1), and nothing else on the droplet path sets it, so if this file does not, it is unset in production.

---

## 7. Deploy identity

**[D] Two users. They are not the same, and the reason is §6.1.**

| User | Shell | SSH | Owns | sudo |
|---|---|---|---|---|
| `rosetta-chat` | `/usr/sbin/nologin`, `--system` | none | nothing writable | none |
| `deploy` | login shell, key-only auth | authorized_keys ← CI public key | `/srv/chat/releases`, `/srv/chat/current` | exact command allowlist only |

- The **service** runs as `rosetta-chat`: no shell, no key, no sudo, no writable path. It is the identity an attacker gets by exploiting the application, and it can do nothing but run.
- The **deploy** runs as `deploy`: it can write release directories and flip the symlink **without sudo** (it owns them), and can do exactly four privileged things via a sudoers allowlist — `systemctl stop chat`, `systemctl start chat`, `systemctl start chat-migrate`, `systemctl is-active chat`. Not `systemctl` generally, not a wildcard.
- `deploy` is in **neither** the `root` nor the `rosetta-chat` group, so `/etc/rosetta-chat/secrets.env` at `0640 root:rosetta-chat` is unreadable to it.
- Neither is `root`. Root SSH is disabled after step 2 of the runbook.

**Why not one user?** A single user means the CI key is also the key to `secrets.env`, directly and passively — no release push, no restart, no trace. That collapses the accidental-disclosure protection in §6.1 entirely, for the sole benefit of skipping one `useradd` and four sudoers lines.

---

## 8. Failure and rollback

**[D] Release directories plus an atomic symlink flip. Rollback is a symlink and a restart, and it is exercised before it is trusted.**

`/srv/chat/releases/<id>/` … `/srv/chat/current -> releases/<id>`. Keep the last **3** releases (~100 MB each with `node_modules`, against 25 GB of disk — the constraint is not disk). Flip atomically: `ln -sfn <target> current.tmp && mv -T current.tmp current`. `mv -T` over a symlink is a single rename syscall; `ln -sfn` directly onto an existing symlink is not atomic and can leave no `current` at all for an instant.

### 8.1 Deploy order — and why the service stops first

1. rsync new release → `/srv/chat/releases/<id>` (`current` untouched, old service still serving)
2. bcrypt smoke test inside the new release (§3.4)
3. `sudo systemctl stop chat`
4. flip `current` → new release
5. `sudo systemctl start chat-migrate` (**migrations before restart** — **[S]**)
6. `sudo systemctl start chat`
7. poll health, 60s (§5.4)
8. external assertion: `https://<SITE_DOMAIN>/` returns `401` (§4.6)

**[D] Stop-before-migrate, accepting a short outage, rather than migrating under the running old release.** Migrating while the old process still serves creates a window of old code against new schema. Avoiding that window without stopping requires expand/contract migration discipline on every future migration — a rule that is easy to state and easy to violate silently. On one host, no replicas, and a gated audience that is currently the owner (`docs/CONTEXT.md:42`), a few seconds of downtime is far cheaper than a standing discipline nobody enforces. WebSocket clients disconnect and reconnect.

### 8.2 What a failed deploy leaves behind

| Fails at | On disk | Database | Service | Recovery |
|---|---|---|---|---|
| 1 rsync | partial new release dir | untouched | old, **still running** | delete the partial dir; nothing else changed |
| 2 bcrypt smoke | complete new release dir | untouched | old, **still running** | delete; investigate; nothing was risked |
| 5 migration | new release dir | **untouched** — §9 | stopped | auto-rollback: flip back, start |
| 6 start | new release dir | migrated | failed | auto-rollback: flip back, start |
| 7 health | new release dir | migrated | running but broken | auto-rollback: stop, flip back, start, re-verify |
| 8 external assertion | — | migrated | running, healthy on loopback | **do not roll back** — the app is fine and Caddy/DNS is not; the workflow fails red and a human reads §4.6 |

Steps 1 and 2 are before any mutation, deliberately: the two most likely mechanical failures cost nothing.

### 8.3 Automatic rollback, and the one thing it cannot undo

Rollback is triggered automatically at steps 5–7, **and the workflow still exits non-zero**. Auto-restore plus a red status: the service is back, and the human is told. A silent auto-rollback would hide a broken release; a manual-only rollback leaves the site down while someone reads a runbook.

**[D] Rollback is code-only. It does not run `down` migrations.** A `down` migration executed automatically can drop a column holding rows written seconds earlier. Leaving the schema forward is recoverable; automated data loss is not.

**Consequence, stated because it is a real constraint and not a footnote:** each migration must be backward-compatible with the **immediately previous** release, for the duration of one deploy. This is a much weaker ask than general expand/contract discipline — one release, not all of history — and it is the price of code-only rollback. A migration that cannot satisfy it (a destructive column drop) needs a two-deploy plan and a human decision, and the runbook says so.

### 8.4 Manual rollback

A documented one-liner in the runbook — flip `current` to the previous release, restart, verify health — usable long after the deploy run has finished, when auto-rollback is no longer in play.

**[D] The rollback is drilled once, deliberately, on the first day.** Same reasoning `docs/ARCHITECTURE.md:238` **[V]** applies to backups: an untested restore is not a restore. A rollback path that has never been executed is a belief.

### 8.5 Concurrency

The deploy workflow declares a `concurrency` group with `cancel-in-progress: false`, so two dispatches queue rather than interleave. Cancelling a deploy mid-symlink-flip is worse than waiting. `.github/workflows/ci.yml:19-21` **[V]** already uses `cancel-in-progress: true` — correct there, wrong here, and the difference is worth a comment in the workflow so it is not "fixed" for consistency.

---

## 9. Migration failure specifically

**[V] Verified from the installed package, not from the docs site** — the documentation's stated default varies by version, so it was read directly:

- `node_modules/node-pg-migrate/package.json` → version **8.0.4** (repo pins `^8.0.3`, `package.json:28`).
- `node_modules/node-pg-migrate/bin/node-pg-migrate.js:179-183` → `[singleTransactionArg]: { default: true, describe: "Combines all pending migrations into a single database transaction so that if any migration fails, all will be rolled back" }`.
- Same file, lines 184-185 → `lock` also defaults `true` (advisory lock).

`npm run migrate` (`package.json:18` **[V]**) passes no `--no-single-transaction`, so the default holds.

**Therefore: a migration that fails halfway leaves the database exactly as it was.** Postgres has transactional DDL, so the whole run — the DDL **and** the `pgmigrations` bookkeeping rows — rolls back together. There is no half-applied schema, no "which migration got as far as where", no manual repair SQL.

The resulting state is: **database unchanged, service stopped, `current` pointing at the new release.** All three are recoverable by the §8 rollback: flip back, start. No database action is required or permitted.

Four caveats, each of which would break this guarantee:

1. **A migration declaring `disable_transaction` opts out.** Neither existing migration does — both files read in full **[V]** (`1757800001_users_rooms_messages.sql`, `1757800002_seed_lobby.sql`), and neither contains such a directive. **Rule: adding a migration that opts out of the transaction invalidates this section and must not be merged without updating it.**
2. Some statements **cannot** run inside a transaction (`CREATE INDEX CONCURRENTLY`, and `ALTER TYPE … ADD VALUE` on older majors). Needing one forces caveat 1 and therefore a deliberate rethink, not a quiet flag flip.
3. The advisory lock (default on) means a second concurrent migration run **blocks** rather than interleaving. It is the backstop; §8.5's concurrency group is the primary control.
4. An unreachable database fails the same way — nothing applied, same rollback.

**[D]** The deploy does not attempt any automatic database repair on migration failure, for the same reason §8.3 forbids automatic `down`.

---

## 10. Runbook shape

The owner executes it — **[S]**. Order matters more than prose; several steps are ordering constraints disguised as tasks.

**0. Preconditions and inputs.** A table filled in before starting: droplet created and root SSH reachable, chosen `SITE_DOMAIN`, DuckDNS account and token, GitHub repository admin access. Nothing below starts until this table is complete.

**1. Base OS.** `apt update && apt full-upgrade`; UTC; **2 GB swapfile** (`docs/ARCHITECTURE.md:216` **[V]**). Swap first — the Postgres install and the first deploy both benefit, and adding it later means doing it under pressure.

**2. Identities.** Create `rosetta-chat` (system, nologin) and `deploy`; install the CI public key into `deploy`'s `authorized_keys`; write the sudoers allowlist (§7); **disable root SSH and password auth**, then verify a `deploy` login works *in a second terminal* before closing the first.

**3. Firewall — before anything that listens.** `ufw default deny incoming`, `allow 22/80/443`, enable, `ufw status` recorded. Ordering constraint: 80 and 443 must be open before Caddy first starts, or ACME fails (§4.2).

**4. PostgreSQL 17** via the PGDG apt repository — exact procedure in discovery §8 **[V]**. Then: record the installed major and **confirm it is 17** (this closes `docs/ASSUMPTIONS.md:56-60`'s open drift risk **[V]**); verify `listen_addresses` is local-only (§2); create the role and database; compose `DATABASE_URL`.

**5. Node 24** system-wide at a stable absolute path (`ExecStart` needs `/usr/bin/node`; nvm's per-user shims are not that). Verify `node -v` against `.nvmrc`.

**6. Layout and ownership.** `/srv/chat/{releases}`, `/etc/rosetta-chat/`, with the ownership and modes from §6.1 and §7 stated as a checkable table, not prose.

**7. Secrets.** Generate `JWT_SECRET` and the database password; write `secrets.env`; `chmod 0640`, `chown root:rosetta-chat`; **verify `sudo -u deploy cat` is denied** — an explicit negative test, because the whole of §6 rests on it.

**8. DuckDNS.** Create the subdomain, point the A record at the droplet, and **verify resolution from off-host before touching Caddy.** Ordering constraint (§4.2).

**9. Caddy.** Install; generate the gate credential (§6.2); write `/etc/caddy/caddy.env` and the Caddyfile; `caddy validate`; start; then verify **three** things separately: a certificate was issued, an unauthenticated request returns `401`, and an authenticated one reaches Caddy's 502 (no app yet — a 502 here is the *correct* result and should be stated as such, or the operator will think it is broken).

**10. systemd units.** Install both; `daemon-reload`; **do not start** — there is no release yet. `systemctl start` before a first deploy fails in a way that looks alarming and means nothing.

**11. GitHub side.** Generate the deploy keypair (private key → repository secret `DEPLOY_SSH_KEY`); set variables `SITE_DOMAIN`, `DEPLOY_HOST`, `SSH_KNOWN_HOSTS` — the last taken from `ssh-keyscan` run **on the droplet console**, not from the first connection, so the host key is never trusted on first sight.

**12. First deploy.** Dispatch the workflow against the chosen ref. Watch it, do not walk away.

**13. Verification — the step that must not be abbreviated.** In this order, each with an expected value:
   a. `systemctl is-active chat` → `active`
   b. loopback health → `200`
   c. `https://<SITE_DOMAIN>/` without credentials → `401`
   d. with credentials → `200`, page renders
   e. **join a room and send a message in a real browser** → **the WebSocket connects.** This is §4.4's measurement. If it fails with a 401 on the handshake, apply the §4.4 fallback and re-test. Record which outcome occurred — it is the finding.
   f. `SELECT ip, count(*) FROM messages GROUP BY 1 ORDER BY 2 DESC LIMIT 5;` → **a real public IP, not `127.0.0.1`.** This is the REQ-MOD-003 proof and the reason §1 exists.
   g. `journalctl -u chat` → no warn lines from §1.7a
   h. bcrypt smoke on the droplet (already run by the deploy; re-run by hand once, closing discovery open question #5)

**14. Rollback drill.** Deploy an older ref, confirm the site returns, then deploy forward again (§8.4). Do this on day one, while nothing depends on it.

**15. Record.** Droplet IP, real monthly cost, and the **versions actually installed** (Postgres major especially) into `agents/IMPLEMENTATION.md`; open `docs/ASSUMPTIONS.md` entries closed or updated (`:56-60` Postgres drift, `:71-75` cost).

---

## 11. What this design does NOT do

- **No backups.** `docs/ARCHITECTURE.md:231-241` **[V]** makes them an owned deliverable; nothing here schedules a `pg_dump` or proves a restore. **This design can restore code and cannot restore data** — the asymmetry is worth naming out loud.
- **No monitoring or alerting.** Failure after a successful deploy is discovered by a human looking. `gain.json` carries placeholders for both **[V]**.
- **No log retention control.** journald's default rotation is a disk policy, not the 30-day privacy promise.
- **No maintenance task**, and this is the consequence that matters most: **this deploy is what first causes `messages.ip` to contain real personal data.** Until now the column has held `127.0.0.1` from local runs. Shipping this starts a 30-day retention clock (`docs/ARCHITECTURE.md:186-197` **[V]**) with no eraser built — `docs/TODO.md:61-63` **[V]** is unimplemented. Behind the gate the exposed population is small, but the promise becomes false on day 31 either way. **[I]** Recommend the maintenance task ships with or immediately after this, not "before public launch".
- **No rate limiting, no moderation, no admin bootstrap.** All public-launch gates; all still open.
- **No unattended-upgrades or patching policy** — named explicitly as evaluation surface by `docs/CONTEXT.md:64` **[V]**, and not decided here.
- **No `/healthz` endpoint**, though `docs/ARCHITECTURE.md:35` **[V]** promises one (§5.4).
- **No real domain** — `docs/TODO.md:55-57` **[V]**, a public-launch blocker.
- **No SSH hardening beyond key-only auth** — no fail2ban, no non-standard port.
- **Does not measure the capacity ceiling** (`docs/ASSUMPTIONS.md:77-80` **[V]**). §5.3's memory numbers are safe bounds, not measurements.
- **No 1:1 direct messaging is designed, mentioned, or prepared for** — reserved baseline feature, `docs/CONTEXT.md:61` **[V]**.

### `docs/TODO.md` items this design closes, when implemented

`:17-21` (ship the CI-built client — closed, though by building in the deploy workflow rather than consuming CI's artifact); `:39-41` (bcrypt — closed by discovery §6 plus the deploy-time smoke test); `:43-46` (trusted-proxy IP — design given, code not written); `:47-49` (launch gate); `:51-53` (subdomain).

### `docs/TODO.md` items that remain open after this ships

`:11-13` (evaluation-log habit); `:23-25` (artifact naming — **downgraded to P2, reason rewritten**, §3.3); `:27-29` (prove the AI reviewer reviews); `:31-33` (fork/draft guard); `:55-57` (real domain, P0); `:61-63` (maintenance task, P0 — see above); `:65-67` (no hard-delete path); `:69-71` (pg_dump retention); `:77-81` (first admin bootstrap); `:83-85` (moderation floor); `:87-89` (rate limiting); `:91-93` (backup and restore); `:95-97` (monitoring and logging); `:101-103` (no-Rosetta baseline); `:105-107` (pattern extraction); `:109-111` (verify real cost).

---

## Rejected alternatives — do not silently revert

**`workflow_run` trigger consuming CI's artifact by `run-id` (discovery §7 option 1) — REJECTED.** Structurally incompatible with the settled `workflow_dispatch`-only decision: it is an automatic trigger, so something reaches the host without a human pressing a button. Rejected on the constraint, not on merit — it is the option most people would reach for, which is exactly why it is written down here.

**`run-id` as a `workflow_dispatch` input (option 2) — REJECTED.** Makes a human transcribe a run id from the Actions UI. A stale or mistyped id deploys a build of a different commit than the ref selected, and nothing about the deploy looks wrong. Trades a machine problem for a human one.

**Third-party artifact-resolver action (option 3) — REJECTED.** Adds a third-party action holding a repository token. The repo's existing acceptance of an unpinned action (`docs/TECHSTACK.md:39` **[V]**) rested specifically on it being *the vendor's* supported entry point; that reasoning does not transfer.

**Solution B — single mutable deploy directory, tarball over `scp`, extract in place — REJECTED.** Simpler and genuinely tempting: one directory, no symlink, no release ids, less disk. Killed because rollback becomes "redeploy an older ref", which requires a working runner, a working network, and a green build at the moment you are already broken. It also has a window during extraction where the directory is neither the old release nor the new one — a failure there leaves nothing runnable. On a single host with no replicas, a rollback that depends on GitHub being up is not a rollback.

**Solution C — droplet pulls: `git fetch` plus `npm ci --omit=dev` on the host — REJECTED.** Genuinely different topology and not absurd: least data over the wire, no `node_modules` rsync, host always self-describing. Killed on three counts. (1) It puts a registry install on the 1 GB box, competing with Postgres for memory and CPU at exactly the moment the service is restarting. (2) A failed or partial `npm ci` leaves a half-updated tree that is neither version, with no clean rollback. (3) It requires the droplet to hold git credentials and reach the npm registry, adding two runtime dependencies and a supply-chain surface to the host. It also sits closest to the "droplet never builds" line **[S]** — `npm ci --omit=dev` is not a build, but it is the same class of thing for the same reason.

**`app.set('trust proxy', ...)` alongside the extractor — REJECTED** (§1.2). Two trust mechanisms with different semantics, one of them consumed by nothing, is how the two paths end up recording different IPs for the same client.

**Appending rather than replacing `X-Forwarded-For` at Caddy — REJECTED** (§1.6). Correct, but makes the chain's correctness rest on a parsing rule instead of on a header a human can read. The last-value parse is kept anyway as defence in depth.

**`ExecStartPre=` for migrations — REJECTED** (§5.1). Re-runs on every crash-restart and couples restart availability to database availability.

**`npm start` as `ExecStart` — REJECTED** (§5.1). A supervising npm process costing tens of MB of the shared gigabyte and a signal-forwarding layer, for nothing.

**`MemoryDenyWriteExecute=yes` — REJECTED** (§5.3). Breaks V8's JIT. Listed explicitly because it appears in every systemd hardening checklist and someone will add it.

**`SystemCallFilter=` — DEFERRED, not rejected** (§5.3). Unvalidatable without the real host; a wrong filter reads as an application bug. Revisit once the droplet exists.

**Automatic `down` migrations on rollback — REJECTED** (§8.3). Can drop a column holding rows written seconds earlier. Automated data loss is not recoverable; a forward schema is.

**DigitalOcean Cloud Firewall as an additional layer — REJECTED** (§2). Off-host configuration with no representation in this repository or the runbook; drifts invisibly.

**`import` of a separate Caddy gate file — REJECTED** (§4.5). Adds a parse-time failure mode for no gain at three lines.

**Exempting `/ws` from the gate up front — REJECTED as the default, pre-authorised as a fallback** (§4.4). Do not weaken a security control against a risk that may not materialise; do have the answer ready and the reasoning already checked.

---

## Open questions for the user

**1. `workflow_dispatch` requires the workflow file on the DEFAULT branch — and this repository's default branch is not what `docs/TODO.md` says it is.**
"This event will only trigger a workflow run if the workflow file exists on the default branch" **[V]** — https://docs.github.com/en/actions/reference/workflows-and-actions/events-that-trigger-workflows. Locally, `git symbolic-ref refs/remotes/origin/HEAD` → `refs/remotes/origin/docs/data-model-approval` **[V]**, and the current session's git status names the same branch as main. But `docs/TODO.md:29` **[V]** states "The default branch is now `develop`", and `.github/workflows/ci.yml:11-16` **[V]** triggers on pushes to `develop`/`main` only — neither of which is `docs/data-model-approval`. Caveat: `origin/HEAD` is a local cache set at clone time and can be stale. **Someone must confirm the actual default branch on GitHub, because the deploy workflow must be merged there or the dispatch button will not exist.** This also raises a second question: whether `ci.yml`'s trigger list is currently missing the real default branch, which would mean the default branch has no CI.

**2. Does basic auth break the WebSocket handshake in your browser? (§4.4)** Cannot be answered from this repository — it needs a browser against a live gated host. The design carries a pre-authorised fallback, but you should know before provisioning that this is the most likely way a "successful" gated deploy ships a broken product. **Requires a decision only if the test fails.**

**3. Should the maintenance task (`docs/TODO.md:61-63`) ship with this deploy rather than "before public launch"?** This deploy is what first puts real IP addresses in `messages.ip`, starting a 30-day retention clock with no eraser built (§11). Behind the gate the exposed population is small, but the promise in `docs/ARCHITECTURE.md:186-197` becomes false on day 31 regardless of who is watching. **Recommendation: yes. Decision: yours.**

**4. Confirm the departure in §1.2** — not adding `app.set('trust proxy')` narrows `docs/TODO.md:45`'s wording. `docs/CONTEXT.md:65` **[V]** requires disagreement with decided architecture to be surfaced rather than applied silently, so it is surfaced here. The reason is that a trust mechanism nothing consumes is a trap for the next handler, not that the TODO is wrong.

**5. Confirm §8.1's stop-before-migrate** — it accepts a few seconds of visible downtime on every deploy in exchange for eliminating the old-code/new-schema window and the standing expand/contract discipline it would otherwise require.

**6. `MemoryMax=512M` and `--max-old-space-size=384` are unmeasured bounds** (§5.3), chosen to fail safely against an unmeasured capacity ceiling (`docs/ASSUMPTIONS.md:77-80` **[V]**). Flagging rather than presenting as engineering.

---

## Corrections to existing documentation, found while designing

Not applied — this session writes exactly one file. Listed so they are not lost.

1. **`docs/TODO.md:73-75`** — "P0 — with `server/http` — send a Content-Security-Policy header" is **already done**. `src/server/http/app.ts:13-15,20-23` **[V]** sets a full CSP with no `'unsafe-inline'`. The item belongs in `agents/IMPLEMENTATION.md`. Minor related note: `connect-src 'self'` matches same-origin `wss:` under CSP Level 3 but did not under Level 2 — correct for current browsers, worth a comment rather than a change.
2. **`docs/TODO.md:35-37`** — "remove the scaffold stubs" describes `src/server/index.ts` as "a build-verification stub with no product behaviour" that "throws if called". It is now the real entry point **[V]** (`src/server/index.ts:1-52`). Stale.
3. **`docs/TODO.md:39-41` / `docs/DEPENDENCIES.md:20`** — the bcrypt reasoning is stale on two independent counts, already documented by discovery Contradictions 1 and 2 **[V]**. Cited here because §3.4 depends on the corrected version.
4. **`docs/TODO.md:23-25`** — the artifact-naming item's stated justification is falsified by §3.3's chosen design and should be rewritten, not merely re-prioritised.
5. **`docs/TECHSTACK.md:40`** — "CD (deploy to droplet) | GitHub Actions — not written; nothing consumes the `dist/client` artifact yet" will need rewording: under this design, **nothing ever will** consume it, by decision (§3.1).
6. **`docs/ARCHITECTURE.md:35`** — lists a health check as a `server/http` responsibility; none exists (§5.4).
