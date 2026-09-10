# RUNBOOK — gated deploy

You are about to spend real money and put a real internet-facing service behind one basic-auth
gate, with **no backups in existence** (`plans/gated-deploy/architecture-notes.md` §11 — this
design can restore code and cannot restore data). Read this whole file once before you start.
Do not run step 12 (the first deploy) until you have read step 12's "first-deploy branch" note.

Design and rationale live in `plans/gated-deploy/architecture-notes.md` (arch-notes) and
`plans/gated-deploy/GATED-DEPLOY-SPECS.md` (SPECS) — referenced by section here, never restated.
This file is the sequence and the expected output of each check, nothing else.

Every numbered step below is something you do. Every lettered sub-item under step 13 is a
pass/fail check with a stated expected value — if what you see does not match, stop and read the
cited section before continuing.

**Ordering constraints — the load-bearing part of this document:**
- Swap file **before** installing Postgres (step 1, before step 4) — Postgres and the first deploy
  both benefit, and you do not want to add swap under memory pressure later.
- Firewall **before** anything listens on 80/443 (step 3, before step 9) — Caddy's automatic TLS
  fails silently if the ACME challenge port is blocked.
- DNS **before** Caddy starts (step 8, before step 9) — same reason, the other prerequisite.
- systemd units are installed but **not started** until after the first release exists (step 10,
  before step 12) — starting `chat.service` with no release is a guaranteed, meaningless failure.
- The `:3000` off-host reachability check is at **step 13**, not step 3. At step 3 nothing is
  listening on `:3000` yet, so the check would pass whether or not the bind and firewall actually
  work (SPECS §5.6 — this supersedes arch-notes §10, which placed it at step 3).

---

## Step 0 — Preconditions and inputs

Do not start step 1 until every row here is filled in and true.

### 0.1 The droplet — create it with these exact options

G4 authorises provisioning; this table is what to provision. These are compatibility-critical: the
release is built on a GitHub runner pinned to `ubuntu-24.04` and shipped as compiled output plus a
prebuilt native module, so an image or architecture mismatch fails at first service start, after
everything else has succeeded (arch-notes §3.4).

| Creation option | Required value | Why it is not free choice |
|---|---|---|
| Image | **Ubuntu 24.04 LTS x64** | The deploy runner is pinned to `ubuntu-24.04`. A newer image moves the droplet's glibc ahead of the runner's; an older one moves it behind. `bcrypt` ships a prebuilt `linux-x64` binary resolved against glibc. |
| Architecture | **x86-64 (Intel/AMD "Regular" or "Premium")** — **not** ARM | `bcrypt`'s prebuild set is chosen per architecture; the runner builds x64. |
| Plan | **Basic, $6/mo — 1 GB RAM / 1 vCPU / 25 GB SSD** | `docs/ARCHITECTURE.md` "Deployment topology". The $12/2 GB upgrade path is pre-decided if memory pressure appears, so it is not re-argued under load. |
| Region / data location | **Your choice, recorded here → ______** | Not technically constrained, but it determines where user messages and IP addresses physically reside. Record it: `docs/CONTEXT.md` commits to a published abuse contact and a retention promise, and both are jurisdictional questions later. |
| Authentication | **SSH key at creation. Not a password.** | Step 2 disables password auth outright; creating with a password means a window where it is enabled, and a credential that then lingers. |
| Swap | **2 GB, added in step 1** | Not a creation option on DigitalOcean — you add it yourself. `docs/ARCHITECTURE.md` treats it as part of the 1 GB plan's viability, not an optional extra. |
| Backups / monitoring add-ons | **Neither** | Out of scope by decision (arch-notes §11). Do not enable them expecting them to satisfy the backup obligation — that obligation is a tested `pg_dump` restore, which does not exist yet. |

### 0.2 Everything else, before step 1

| Item | Value / confirmation |
|---|---|
| Droplet created per 0.1, root SSH reachable from your machine right now | |
| **Deploy keypair generated on your own machine** (see 0.3 — step 2 installs the public half, step 11 uploads the private half) | |
| Chosen `SITE_DOMAIN` (a DuckDNS subdomain for the gated phase) | |
| DuckDNS account created, token in hand, subdomain pointed at the droplet's IP | |
| GitHub repository admin access (to set secrets/variables and merge to `develop`) | |
| Batches B1–B7 merged to `develop` — **`deploy.yml` must be on the default branch or the dispatch button will not exist** (SPECS §5.3) | |
| A second terminal window available (step 2 needs one open while the first stays connected) | |

### 0.3 Generate the deploy keypair now — step 2 cannot be completed without it

On **your own machine**, never on the droplet:
```
ssh-keygen -t ed25519 -C "rosetta-chat-deploy" -f ./deploy_key -N ""
```
Produces `./deploy_key` (private — becomes the `DEPLOY_SSH_KEY` GitHub secret in step 11) and
`./deploy_key.pub` (public — pasted into the droplet in step 2.2).

Keep `./deploy_key` until step 11 is done, then delete your local copy. It is a credential with
deploy rights to production.

---

## Step 1 — Base OS

```
apt update && apt full-upgrade -y
timedatectl set-timezone UTC
```
Expected: both commands exit 0. `timedatectl` with no arguments afterward shows `Time zone: UTC`.

**Swap, before anything else installs** (`docs/ARCHITECTURE.md` "Deployment topology": 1 GB RAM
droplet needs 2 GB swap):
```
fallocate -l 2G /swapfile
chmod 600 /swapfile
mkswap /swapfile
swapon /swapfile
echo '/swapfile none swap sw 0 0' >> /etc/fstab
```
Expected: `swapon --show` lists `/swapfile` at size `2G`.

---

## Step 2 — Identities

Design: arch-notes §7. Two users, not one — the service identity must never be the identity that
can touch secrets or restart itself.

1. Service user, no shell, no login, nothing writable:
   ```
   adduser --system --group --no-create-home --shell /usr/sbin/nologin rosetta-chat
   ```
2. Deploy user, real login shell, key-only auth:
   ```
   adduser --disabled-password --gecos "" deploy
   mkdir -p /home/deploy/.ssh && chmod 700 /home/deploy/.ssh
   # paste the contents of ./deploy_key.pub from step 0.3 into:
   nano /home/deploy/.ssh/authorized_keys
   chmod 600 /home/deploy/.ssh/authorized_keys
   chown -R deploy:deploy /home/deploy/.ssh
   ```
3. Sudoers allowlist — **exactly these four commands, no wildcard** (AC-SEC-3):
   ```
   visudo -f /etc/sudoers.d/deploy
   ```
   contents:
   ```
   deploy ALL=(root) NOPASSWD: /usr/bin/systemctl stop chat, /usr/bin/systemctl start chat, /usr/bin/systemctl start chat-migrate, /usr/bin/systemctl is-active chat
   ```
   Expected: `visudo -c` reports `/etc/sudoers.d/deploy: parsed OK`.
   **[HOST] AC-SEC-3** — proof: `sudo -l -U deploy` lists exactly those four commands and nothing
   else.
   **[HOST] AC-SEC-4** — proof: `getent passwd rosetta-chat` shows shell `/usr/sbin/nologin`;
   `ls /home/rosetta-chat/.ssh` does not exist (no home dir at all); `sudo -l -U rosetta-chat`
   reports it is not in sudoers.

4. **Confirm `deploy` can log in — but do not disable root SSH yet.**

   Open a **second terminal** and confirm, using the key generated in step 0.3 explicitly --
   plain `ssh deploy@<droplet-ip>` will very likely fail here, because `./deploy_key` is not one of
   the filenames (`id_rsa`, `id_ed25519`, ...) the SSH client searches for automatically, and
   nothing has added it to an agent:
   ```
   ssh -i ./deploy_key -o IdentitiesOnly=yes deploy@<droplet-ip>
   ```
   Expected: you land in a `deploy` shell with no password prompt.

   > **Keep your root session open. Do not harden SSH here.**
   > Steps 3–10 require unrestricted root — installing packages, editing PostgreSQL config,
   > writing files under `/etc`. The `deploy` user **cannot** do any of it: its sudoers allowlist
   > is exactly the four `systemctl` commands above, by design (AC-SEC-3). Disabling root SSH at
   > this point would strand you between step 3 and step 10 with no path to root except the
   > DigitalOcean web console.
   >
   > SSH hardening is therefore **step 10.4**, after the last root-only work. This is a correction:
   > an earlier version of this runbook hardened here and told you to close the root session, which
   > made the document impossible to follow in order (found in review, 2026-09-10).

---

## Step 3 — Firewall, before anything that listens

Design: arch-notes §2. Ordering constraint: 80 and 443 must be open before Caddy first starts
(step 9), or ACME fails.

```
ufw default deny incoming
ufw default allow outgoing
ufw allow 22/tcp
ufw allow 80/tcp
ufw allow 443/tcp
ufw enable
ufw status verbose
```
**[HOST] AC-BIND-3** — expected `ufw status verbose` output: `Status: active`, default `deny
(incoming)`, and **ALLOW entries covering exactly the three ports 22, 80, 443, and no others.**
Do not count lines: Ubuntu 24.04 ships with IPv6 firewalling enabled by default (`/etc/default/ufw`,
`IPV6=yes`), and `ufw allow <port>/tcp` applies to both stacks -- so the normal, correct result is
commonly **six** lines (three ports × IPv4 and `(v6)`), not three. A stock configuration showing
three lines instead of six is not necessarily wrong (a droplet with no IPv6 configured at the
network level may show only the v4 half), but a build that shows exactly three assuming that is
the only correct count would reject a working firewall (found in review, 2026-09-10). Record the
full output either way.

Do **not** yet check whether `:3000` is reachable from off-host — nothing is listening there yet,
so the check would pass vacuously either way (SPECS §5.6). That check is step 13i.

---

## Step 4 — PostgreSQL 17

Design: arch-notes §10 step 4, discovery §8. Ubuntu's default repo ships an older major; use the
PGDG repo.

```
apt install -y curl ca-certificates
install -d /usr/share/postgresql-common/pgdg
curl -o /usr/share/postgresql-common/pgdg/apt.postgresql.org.asc \
  https://www.postgresql.org/media/keys/ACCC4CF8.asc
echo "deb [signed-by=/usr/share/postgresql-common/pgdg/apt.postgresql.org.asc] https://apt.postgresql.org/pub/repos/apt $(lsb_release -cs)-pgdg main" \
  > /etc/apt/sources.list.d/pgdg.list
apt update
apt install -y postgresql-17 postgresql-client-17
```
**[HOST] closes `docs/ASSUMPTIONS.md:56-60` (Postgres major drift)** — proof:
```
psql --version
```
Expected: reports major version **17** (matches `compose.yml`'s `postgres:17` and
`ci.yml`'s `postgres:17` service image — no drift between local dev, CI, and production).
Record the exact installed version string for step 15.

**[HOST] AC-BIND-4** — verify Postgres is not listening publicly, rather than trusting the
packaging default:
```
sudo -u postgres psql -c "SHOW listen_addresses;"
```
Expected: `localhost` (Debian/Ubuntu packaging default). If it shows `*` or an interface address,
edit `/etc/postgresql/17/main/postgresql.conf` to `listen_addresses = 'localhost'` and
`systemctl restart postgresql` before proceeding.

Create the role and database:
```
openssl rand -hex 24   # save this value — it is the DB password, not shown again here
sudo -u postgres psql -c "CREATE ROLE rosetta_chat WITH LOGIN PASSWORD '<paste the value above>';"
sudo -u postgres psql -c "CREATE DATABASE rosetta_chat OWNER rosetta_chat;"
```

> **`-hex`, not `-base64`, and this is not a style preference.** Base64's alphabet includes `/`,
> which is a path delimiter inside a URL. This password goes into `DATABASE_URL` in step 7, and a
> `/` there makes the URL unparseable — Node throws `ERR_INVALID_URL` before the app can report
> anything useful about its own configuration. Measured on this project's own parser
> (`pg-connection-string`) during review on 2026-09-10: **`/` appears in roughly 42% of
> `openssl rand -base64 24` outputs**, so it is close to a coin flip, and it fails at first service
> start — after every other step has succeeded. `+` and `=` are harmless; only `/` breaks it.
> `-hex 24` is the same 24 bytes of entropy with a URL-safe alphabet.
Expected: both `psql -c` commands print `CREATE ROLE` / `CREATE DATABASE`.

Compose the connection string for step 7:
```
DATABASE_URL=postgres://rosetta_chat:<password>@localhost:5432/rosetta_chat
```
**This password and this connection string never leave the droplet except into
`/etc/rosetta-chat/secrets.env` (step 7) and your password manager. They are never pasted into
GitHub.**

---

## Step 5 — Node 24

`ExecStart=` in `chat.service` names `/usr/bin/node` directly (arch-notes §5.1) — nvm's per-user
shims are not that path. Install Node system-wide via NodeSource or the distro package that puts
the binary at `/usr/bin/node`:
```
curl -fsSL https://deb.nodesource.com/setup_24.x | bash -
apt install -y nodejs
which node
node -v
```
Expected: `which node` → `/usr/bin/node`. `node -v` matches `.nvmrc` (`24`) at the major version.

---

## Step 6 — Layout and ownership

| Path | Owner:Group | Mode | Purpose |
|---|---|---|---|
| `/srv/chat/releases/` | `deploy:deploy` | `0755` | release directories, one per deploy |
| `/srv/chat/current` | (symlink, created by first deploy) | — | the live release |
| `/etc/rosetta-chat/` | `root:rosetta-chat` | `0750` | host-scoped secrets directory |

```
mkdir -p /srv/chat/releases
chown -R deploy:deploy /srv/chat
mkdir -p /etc/rosetta-chat
groupadd -f rosetta-chat
chown root:rosetta-chat /etc/rosetta-chat
chmod 0750 /etc/rosetta-chat
```
Expected: `ls -ld /srv/chat/releases /etc/rosetta-chat` shows the owners/modes in the table above.

---

## Step 7 — Secrets

Design: arch-notes §6.1, §6.3. `secrets.env` holds `DATABASE_URL` and `JWT_SECRET` — the two
values that must never enter GitHub, never enter the repository, never enter a workflow log.

```
openssl rand -base64 48   # this is JWT_SECRET — save it nowhere but the file below and your password manager
```

Write `/etc/rosetta-chat/secrets.env`:
```
DATABASE_URL=postgres://rosetta_chat:<password from step 4>@localhost:5432/rosetta_chat
JWT_SECRET=<value from openssl rand -base64 48 above>
```

Lock it down:
```
chmod 0640 /etc/rosetta-chat/secrets.env
chown root:rosetta-chat /etc/rosetta-chat/secrets.env
```
**[HOST] AC-SEC-1** — proof:
```
ls -l /etc/rosetta-chat/secrets.env
```
Expected: `-rw-r-----  1 root rosetta-chat`.

**[HOST] AC-SEC-2 — the negative test. §6 rests on this passing.**
```
sudo -u deploy cat /etc/rosetta-chat/secrets.env
```
Expected: `cat: /etc/rosetta-chat/secrets.env: Permission denied`. If this instead prints the file,
**stop** — `deploy` is in the `rosetta-chat` group or the mode/owner above is wrong. Fix before
continuing; nothing downstream is safe until this denies.

**`DATABASE_URL` and `JWT_SECRET` never leave this file except into your password manager as a
backup record. They are never pasted into a GitHub secret or variable — the deploy workflow does
not receive them (AC-CD-12); the running service reads them from this file via
`EnvironmentFile=`.**

---

## Step 8 — DuckDNS

1. Create the subdomain in your DuckDNS account (the `SITE_DOMAIN` from step 0).
2. Point its A record at the droplet's public IP.
3. **Verify resolution from off-host before touching Caddy** — from your own machine, not the
   droplet:
   ```
   dig +short <SITE_DOMAIN>
   ```
   Expected: the droplet's public IP. If this is empty or wrong, wait for DNS propagation and
   re-check — do not proceed to step 9 on an unresolved name, or Caddy's ACME challenge fails.

---

## Step 9 — Caddy

Design: arch-notes §4. Install, generate the gate credential, write the config, validate, start.

```
apt install -y debian-keyring debian-archive-keyring apt-transport-https curl
curl -1sLf 'https://dl.cloudsmith.io/public/caddy/stable/gpg.key' \
  | gpg --dearmor -o /usr/share/keyrings/caddy-stable-archive-keyring.gpg
curl -1sLf 'https://dl.cloudsmith.io/public/caddy/stable/debian.deb.txt' \
  | tee /etc/apt/sources.list.d/caddy-stable.list
apt update
apt install -y caddy
```

Generate the gate credential — **plaintext first, on your own machine or the droplet, high
entropy**:
```
openssl rand -base64 24
```
Save this value to your password manager now. This is the credential real strangers would need to
get past the gate — it is not a secret from you, it is the wall itself.

Hash it **on the droplet**, interactively, so the plaintext never enters shell history:
```
caddy hash-password
```
(paste the plaintext when prompted). Expected: a bcrypt hash starting `$2a$14$...`.

Write `/etc/caddy/caddy.env` (`root:caddy`, `0640`):
```
ACME_EMAIL=<your email>
SITE_DOMAIN=<SITE_DOMAIN from step 0>
GATE_USER=<a username you choose>
GATE_HASH=<the bcrypt hash from caddy hash-password>
```
```
chmod 0640 /etc/caddy/caddy.env
chown root:caddy /etc/caddy/caddy.env
```

Add an `EnvironmentFile=` drop-in on `caddy.service` so it reads this file:
```
systemctl edit caddy.service
```
add:
```
[Service]
EnvironmentFile=/etc/caddy/caddy.env
```

Copy `deploy/Caddyfile` from the repository to `/etc/caddy/Caddyfile` on the droplet (this repo's
file is a template with placeholders only — arch-notes §4.1 — nothing to edit in it; the
placeholders are filled by `caddy.env` above).

**Validate before every reload, without exception** — and **with `--envfile`**, or every
`{$PLACEHOLDER}` in the Caddyfile resolves to empty and you validate a configuration that is not
the one Caddy will run:
```
caddy validate --config /etc/caddy/Caddyfile --envfile /etc/caddy/caddy.env
```
The `--envfile` flag was missing here until review on 2026-09-10. Without it, `{$SITE_DOMAIN}`,
`{$GATE_USER}`, `{$GATE_HASH}` and `{$ACME_EMAIL}` are all empty at validation time — the check
can pass while the real config is broken, or fail for reasons that have nothing to do with your
edits. `caddy.env` is the same file `systemd` hands the service, so validating with it is
validating what actually runs.
Expected: `Valid configuration`. **[HOST] AC-CAD-4** — this is the proof; there is no Caddy binary
on the darwin dev box, so this is the first time the file is checked at all.

```
systemctl daemon-reload
systemctl enable --now caddy
```

Now verify **three things separately** — do not skip any, and read the third one's expected
result before you run it:

1. **[HOST] AC-CAD-5** — certificate issued:
   ```
   curl -vI https://<SITE_DOMAIN>/ 2>&1 | grep -i "SSL certificate verify"
   ```
   Expected: no verification error (or check `journalctl -u caddy` for a line containing
   `"certificate obtained successfully"`).
2. **[HOST] AC-CAD-6 (first half)** — unauthenticated request:
   ```
   curl -s -o /dev/null -w '%{http_code}\n' https://<SITE_DOMAIN>/
   ```
   Expected: `401`.
3. **[HOST] — authenticated request reaches a 502.** This is the correct result. Read this before
   you run it: no application is deployed yet (systemd units aren't even installed until step 10,
   and there is no release until step 12). A `502 Bad Gateway` here means Caddy, TLS, DNS, and the
   gate are all working, and there is simply nothing behind them yet. **This is not a bug. Do not
   debug it. It is proof you are ready for step 10.** (AC-RUN-3.)
   ```
   curl -s -o /dev/null -w '%{http_code}\n' -u '<GATE_USER>:<plaintext password>' https://<SITE_DOMAIN>/
   ```
   Expected: `502`.

---

## Step 10 — systemd units

Copy `deploy/systemd/chat.service`, `deploy/systemd/chat-migrate.service`,
`deploy/systemd/rosetta-chat-retention.service`, and `deploy/systemd/rosetta-chat-retention.timer`
from the repository to `/etc/systemd/system/` on the droplet, unmodified — every value they need
is supplied by the environment files written in steps 6/7, not by editing these units.

```
systemctl daemon-reload
```
**[HOST] AC-SYS-8** — proof (Linux-only tool, cannot run on the darwin dev box):
```
systemd-analyze verify /etc/systemd/system/chat.service
systemd-analyze verify /etc/systemd/system/chat-migrate.service
systemd-analyze verify /etc/systemd/system/rosetta-chat-retention.service
systemd-analyze verify /etc/systemd/system/rosetta-chat-retention.timer
```
Expected: no output (silence = clean) for each.

### 10.3 Arm the units for boot — enable, do not start

```
systemctl enable chat
systemctl enable rosetta-chat-retention.timer
```

`enable` without `--now` is deliberate on both, and each for a different reason:

- **`chat`** — without this, the service never comes back after a reboot. The deploy workflow
  starts it, but `systemctl start` does not survive a restart; only `enable` does. This line was
  missing entirely until review on 2026-09-10.
- **`rosetta-chat-retention.timer`** — `--now` here would be actively wrong. The timer carries
  `Persistent=true` (`deploy/systemd/rosetta-chat-retention.timer`), so activating it before a
  release exists can trigger an immediate catch-up run against `/srv/chat/current`, which is not
  yet a symlink. It would fail loudly and prove nothing.

**The timer is therefore not running yet.** It is armed for boot but inactive, and
`systemctl list-timers` will not show it. **Step 13j starts it**, after the first deploy has put a
release in place. Do not skip that — an armed-but-never-started timer means the retention sweep
does not run until the droplet happens to reboot, and the 30-day erasure promise quietly depends on
that never being noticed.

**Do not `systemctl start chat` or `chat-migrate` here.** There is no release at
`/srv/chat/current` yet — starting either now fails in a way that looks alarming and proves
nothing. The first legitimate start happens inside step 12's deploy script.

### 10.4 SSH hardening — the last root-**SSH** action, not the last root action

Deferred from step 2 on purpose: everything above needed unrestricted root, and `deploy` cannot
provide it. This is the point where **root over SSH** is no longer required.

**It is not the point where root access of any kind stops being needed.** `deploy`'s sudoers
allowlist is deliberately four commands and nothing else (AC-SEC-3, step 2.3) -- that narrowness
is the point of the identity, not an oversight. Several checks in step 13 need broader privileges
than that: editing `/etc/caddy/Caddyfile` and reloading Caddy (13e's fallback), querying as the
`postgres` role (13f), starting the retention timer and its unit (13j), and reading full service
status or sending a signal to another user's process (13k). None of those commands are in
`deploy`'s allowlist, and adding them would defeat AC-SEC-3 for the sake of interactive
convenience -- **so they are performed via the DigitalOcean web console, logged in as root, not
over the SSH session you are about to close.** Each of those steps says so again at the point
you reach it, but the decision is made here: an earlier version of this runbook implied step 10.4
was the last time root was needed at all, which is not true (found in review, 2026-09-10).

Edit `/etc/ssh/sshd_config`, or a drop-in under `/etc/ssh/sshd_config.d/`:
```
PermitRootLogin no
PasswordAuthentication no
```
```
systemctl restart sshd
```

**Do not close your root session yet.** In a second terminal, confirm both of these:
```
ssh -i ./deploy_key -o IdentitiesOnly=yes deploy@<droplet-ip>   # expected: a deploy shell, no password prompt
ssh root@<droplet-ip>                                            # expected: Permission denied (publickey)
```
Only when the first succeeds *and* the second is refused, close the root session.

**[HOST] AC-SEC-5** — proof: that pair of results together.

> **The DigitalOcean web console is not just a recovery path from here on -- it is the sanctioned
> channel for every remaining root-level check in this runbook.** It authenticates independently
> of SSH (it is a local terminal session through DigitalOcean's own infrastructure, unaffected by
> `PermitRootLogin no`), so disabling root SSH here does not strand you: it removes one attack
> surface (root reachable from anywhere on the internet) while leaving the operator's own access
> intact through a channel that was never exposed to the internet in the first place.

---

## Step 11 — GitHub side

Design: arch-notes §6.1, §7, §10 step 11.

1. **Do not generate a new keypair here.** `./deploy_key` and `./deploy_key.pub` already exist
   from step 0.3, and the public half is already installed on the droplet (step 2.2). Running
   `ssh-keygen -f ./deploy_key` a second time is destructive, not idempotent: if you accept the
   overwrite prompt, `./deploy_key` becomes a *different* private key than the one whose public
   half is in `authorized_keys`, and the two now silently mismatch -- the deploy workflow's very
   first SSH connection would fail with "Permission denied" and nothing before that point would
   have told you why. If you decline the overwrite, nothing happens, which only works because you
   declined -- an earlier version of this runbook re-issued the `ssh-keygen` command here with no
   warning about either outcome (found in review, 2026-09-10).

   Confirm the public key is installed (it should already be, from step 2.2):
   ```
   ssh -i ./deploy_key -o IdentitiesOnly=yes deploy@<droplet-ip> "cat ~/.ssh/authorized_keys"
   ```
   Expected: the output matches the contents of `./deploy_key.pub` on your machine.
2. In the GitHub repository settings:
   - Secret `DEPLOY_SSH_KEY` = the **private** key contents.
   - Variable `SITE_DOMAIN` = the value from step 0/8.
   - Variable `DEPLOY_HOST` = the droplet's public IP.
   - Variable `SSH_KNOWN_HOSTS` = the output of the next command.
3. **Get the host key from the droplet's own console, not from your first SSH connection** — so
   the workflow never trust-on-first-use's the host key. Using the DigitalOcean web console (not
   an SSH session from your laptop), logged in as root or deploy:
   ```
   ssh-keyscan -t ed25519 <DEPLOY_HOST>
   ```
   Expected output form: `<DEPLOY_HOST> ssh-ed25519 AAAA...`. Paste this exact line as the
   `SSH_KNOWN_HOSTS` variable value.
4. Delete `./deploy_key` and `./deploy_key.pub` from your machine once the secret is saved — they
   have no further use locally.

**[HOST] proof this step succeeded**: no direct check yet — step 12's SSH connection from the
runner is the proof. If it fails with a host-key mismatch, the value pasted into
`SSH_KNOWN_HOSTS` does not match the droplet's actual key; re-run `ssh-keyscan` and update it.

---

## Step 12 — First deploy

**Read this before you dispatch anything.**

**First-deploy branch, stated in advance (AC-ROL-7):** `/srv/chat/current` does not exist yet.
The deploy script (`.github/workflows/deploy.yml`, "Write the remote deploy script" step) checks
for this and sets `FIRST_DEPLOY=true`. If **anything** fails from the migration step onward on
this run — a bad migration, a `chat.service` start failure, a health-check timeout — there is
**no previous release to fall back to**. The script will stop the service, print that no rollback
target existed, and exit non-zero. **The site will be down, and that is the designed, correct
outcome, not a bug to debug at 2 a.m.** If it happens: read the `journalctl` output the script
points you to, fix the underlying problem in the repository, and dispatch again — the second
dispatch is not a "first deploy" and does get the normal auto-rollback behavior described in step
14.

Only after reading the paragraph above:

1. In GitHub Actions, dispatch **"Deploy"** (`workflow_dispatch`) against the ref you want to
   ship (`develop`, unless you have a specific commit in mind).
2. **Watch it. Do not walk away** — this run either finishes healthy or leaves the site down with
   nothing to fall back to; you want to see which, immediately.

**[HOST] AC-CD-10 — deploy order** — while it runs, `journalctl -u chat -u chat-migrate -f` on the
droplet (second terminal) should show, in this order: `chat` stop, the migration unit run and
complete, `chat` start. Expected: this order, no interleaving.

**[HOST] AC-CD-5 and AC-ROL-7 — after the run finishes (success or the first-deploy failure
above)**, on the droplet:
```
ls -la /srv/chat/releases/
ls /srv/chat/releases/<the-new-release-id>/
```
Expected release contents: `package.json`, `node_modules/`, `dist/server/`, `dist/client/`,
**`dist/db/`**, `src/db/migrations/*.sql`, `deploy.env` (SPECS AC-CD-5). `dist/db/` is
load-bearing, not optional: `src/server/index.ts` imports from it and the retention unit's
`ExecStart` targets `dist/db/retention.js` directly -- its absence here was the exact defect
validation found by reconstructing this same tree (`docs/EVALUATION-SESSIONS/2026-09-08-gated-deploy.md`
§3, defect #8), and this list should have named it from the start (found in review, 2026-09-10). If the run failed per the first-deploy
branch above, confirm the release directory still exists on disk (nothing was deleted) and that
`/srv/chat/current` does **not** point at it — that is the expected state: the bad release
recorded, the symlink never flipped, the service stopped.

If the run failed, stop here, fix the problem, and re-dispatch before moving to step 13.

---

## Step 13 — Verification. Do not abbreviate this. Every item has an expected value.

Design: arch-notes §10 step 13, §4.4, §1.7c. Run all of these once the deploy in step 12 reports
success.

**a. Service is active.**
```
sudo systemctl is-active chat
```
Expected: `active`.

**b. Loopback health.**
```
curl -s -o /dev/null -w '%{http_code}\n' http://127.0.0.1:3000/
```
Expected: `200`.

**c. Unauthenticated external request.**
```
curl -s -o /dev/null -w '%{http_code}\n' https://<SITE_DOMAIN>/
```
Expected: `401`.

**d. Authenticated external request.**
```
curl -s -o /dev/null -w '%{http_code}\n' -u '<GATE_USER>:<plaintext password>' https://<SITE_DOMAIN>/
```
Expected: `200`, and opening the same URL with credentials in a real browser renders the chat
client page.

**e. WebSocket-through-the-gate — a pass/fail decision, not a smoke test. Read this in full before
you test it (arch-notes §4.4, the highest-severity finding in this design).**

Why this matters: a browser cannot set headers on a WebSocket handshake, and Chrome never
presents an auth dialogue for one. Whether cached basic-auth credentials get replayed onto a
same-origin WebSocket handshake is browser-dependent and **not guaranteed**. The plausible bad
outcome is a deploy that looks completely successful — page loads, gate prompts, login works —
and chat itself is dead.

**Test, in a real browser, not curl:**
1. Navigate to `https://<GATE_USER>:<password>@<SITE_DOMAIN>/` (or enter credentials at the
   browser's basic-auth prompt).
2. Join a room with a nickname.
3. Send a message.

**PASS:** the message appears in your own view (round-tripped through the server) and the
browser's network/WS inspector shows the `/ws` connection as `101 Switching Protocols`, not `401`.

**FAIL:** the WebSocket connection shows `401` on the upgrade, or never reaches
`101`, or the client visibly hangs on "connecting".

**Record the outcome in `agents/IMPLEMENTATION.md` either way — it is a finding, not a footnote.**

**If it fails, apply the pre-authorised fallback (arch-notes §4.4) — it replaces the gate block,
it does not sit alongside it:**

In `/etc/caddy/Caddyfile`, the gate block is delimited:
```
    # === GATE — delete this block at public launch. Nothing else changes. ===
    basic_auth {
        {$GATE_USER} "{$GATE_HASH}"
    }
    # === END GATE ===
```
Replace **that entire block** (not add alongside it — replace it) with:
```
    @notws not path /ws
    basic_auth @notws {
        {$GATE_USER} "{$GATE_HASH}"
    }
```
This is safe because `/ws` independently requires a signed session cookie whose only issuer is
`POST /api/join`, which stays behind the gate, and it separately enforces an `Origin` allowlist —
an unauthenticated stranger reaching `/ws` directly gets `401` from the application itself, having
gained nothing (arch-notes §4.4). Then, **(root, via the DigitalOcean console -- not the `deploy` SSH session; step 10.4.)**
```
caddy validate --config /etc/caddy/Caddyfile --envfile /etc/caddy/caddy.env
systemctl reload caddy
```
Expected: `Valid configuration`, then re-run the three-step browser test above. Record the final
outcome (fallback applied, retest passed) in `agents/IMPLEMENTATION.md`.

**f. The REQ-MOD-003 proof — do not abbreviate this one either.** After sending at least one
message in step 13e, on the droplet, **(root, via the DigitalOcean console -- not the `deploy` SSH session; step 10.4.)** `deploy`'s sudoers allowlist has no path to the
`postgres` role:
```
sudo -u postgres psql -d rosetta_chat -c "SELECT ip, count(*) FROM messages GROUP BY 1 ORDER BY 2 DESC LIMIT 5;"
```
Expected: the top row's `ip` is a **real public IP address** (yours, the one you connected from) —
**not** `127.0.0.1`, and not empty. If the top row is `127.0.0.1`, the extractor or the Caddy
`header_up` line is wrong — stop and re-check arch-notes §1 and §4.1 before proceeding; this is the
only end-to-end proof that the entire point of this deploy (trusted-proxy IP capture) actually
works.

**g. No extractor warnings.** **(root, via the DigitalOcean console -- not the `deploy` SSH session; step 10.4.)** `deploy` is not in the `systemd-journal` group, so an
unprivileged `journalctl` here can silently show less than the full log rather than failing loudly
-- root avoids that ambiguity.
```
journalctl -u chat --since "-15 min" | grep -i "trusted\|forwarded\|untrusted"
```
Expected: no output. Any warn-level line here means either Caddy is proxying without setting
`X-Forwarded-For` (misconfigured `header_up`) or something reached `:3000` without going through
Caddy (bind/firewall not in effect) — see arch-notes §1.7.

**h. Manual bcrypt smoke re-check.** The deploy already ran this automatically before flipping the
symlink (step 12); re-run it by hand once, in the live release:
```
cd /srv/chat/current && node -e "console.log(require('bcrypt').hashSync('x', 12))"
```
Expected: a string starting `$2b$12$...`. No error.

**i. Off-host `:3000` reachability — placed here, not at step 3, because step 3 would have passed
vacuously with nothing listening (SPECS §5.6).** From your own machine (not the droplet):
```
nc -zv -w 5 <droplet-public-ip> 3000
```
Expected: connection refused or timeout — **not** a successful connection. A successful connection
here means the loopback bind (`AC-BIND-1`) or the firewall (step 3) is not actually in effect,
despite the service being up and reachable through Caddy.

**j. Retention timer is scheduled and monitorable.** **(root, via the DigitalOcean console -- not the `deploy` SSH session; step 10.4.)** `deploy`'s sudoers allowlist covers
only `chat` and `chat-migrate`, never the retention unit or timer.
```
sudo systemctl start rosetta-chat-retention.timer
systemctl list-timers rosetta-chat-retention.timer
```
**The `start` is required, not optional.** Step 10.3 armed the timer for boot (`enable`) but
deliberately did not activate it, because `Persistent=true` would have fired a catch-up run before
any release existed. This is the point where a release exists, so this is where the timer actually
begins running. Skip it and the retention sweep does not run until the droplet next reboots —
silently, with the 30-day erasure promise depending on nobody noticing. Corrected in review,
2026-09-10.

Expected: a row showing a `NEXT` run within the next 24 hours and a `LAST` column (empty until
first fire). To prove the unit itself succeeds without waiting a day, trigger it once by hand:
```
sudo systemctl start rosetta-chat-retention.service
systemctl status rosetta-chat-retention.service
```
Expected: `status` shows `Active: inactive (dead)` with the last exit code `0` (a successful
oneshot), and `journalctl -u rosetta-chat-retention` shows one structured line with all three
counts (`messagesIpNulled`, `bansIpNulled: null` — `bans` does not exist yet, guarded per SPECS
§2.2 — and `guestsDeleted`).

**k. Restart and crash-loop behavior.** **(root, via the DigitalOcean console -- not the `deploy` SSH session; step 10.4.)** full `systemctl status` (as opposed to the
narrower `is-active chat` `deploy` is permitted) and sending a signal to a process owned by
`rosetta-chat` both fall outside `deploy`'s allowlist by design.
```
sudo systemctl status chat   # note the PID
sudo kill -9 <PID>
sleep 6
sudo systemctl status chat
```
Expected: after the `kill -9`, the second `status` shows the service `active (running)` again
with a **new** PID — `Restart=on-failure` fired. (Do not additionally force five rapid failures on
a service you depend on right now; the `StartLimitBurst=5` / `StartLimitIntervalSec=300` behavior
that lands a crash-looping unit in `failed` rather than endless `activating` is inspectable in the
unit file — arch-notes §5.1 — and does not need to be destructively proven against the only
running copy of this service.)

**l. Optional, recommended once — the CI-gate refusal.** Dispatch the "Deploy" workflow against a
ref whose CI checks are currently failing or incomplete (a scratch branch with a deliberately
broken test is sufficient). Expected: the workflow's "Verify CI is green for the dispatched
commit" step fails immediately, with **no SSH connection ever attempted** — confirm this by
checking that no new step after it ran. This proves a red commit cannot reach the droplet before
you ever need it to matter. *(SPECS marks this criterion `[HOST]` without naming a runbook step
number — see the mismatch note below.)*

---

## Step 14 — Rollback drill. Do this deliberately, on day one, while nothing is wrong.

Design: arch-notes §8.4, `docs/ARCHITECTURE.md` "Backups" (the same "an untested restore is not a
restore" reasoning applies here). Do not wait to discover the rollback path during a real
incident.

1. Note the current release id: `readlink -f /srv/chat/current`.
2. Dispatch the "Deploy" workflow against an **older** ref (e.g. the commit before the current
   one, or a trivial no-op commit if this is still the only release — in that case, skip to the
   manual one-liner below instead).
3. Confirm the site still serves correctly (repeat 13a–d).
4. Dispatch the "Deploy" workflow again against the original ref to return to the current state.

**Manual one-liner rollback** — the path you would actually use in an incident, executed once now
so it is proven rather than believed:
```
sudo systemctl stop chat
ln -sfn /srv/chat/releases/<older-release-id> /srv/chat/releases/current.tmp
mv -T /srv/chat/releases/current.tmp /srv/chat/current
sudo systemctl start chat
curl -s -o /dev/null -w '%{http_code}\n' http://127.0.0.1:3000/
```
Expected: final `curl` returns `200`. **[HOST] AC-ROL-6** — this manual drill, executed, is the
proof; a documented rollback that has never been run is a belief, not a rollback.

**[HOST] AC-ROL-5** — proof: `ls /srv/chat/releases/ | wc -l` shows **at least 3** releases
retained (the deploy script prunes to the last 3 — arch-notes §8, step 12's "[7] prune old
releases").

**[HOST] AC-ROL-2/3/8 — inducing a real failure, optional but recommended once.** Deliberately
dispatch a deploy against a ref containing a broken migration (a scratch commit with an invalid
SQL statement in `src/db/migrations/`). Expected: the deploy script's `rollback()` function fires,
`journalctl` on the droplet shows the flip-back and restart, the workflow run in GitHub Actions
shows **red** (non-zero exit) even though the service was restored, and `curl` against loopback
still returns `200` afterward (service back on the previous release). This is the only way to
observe AC-ROL-2/3/8 rather than merely reading the script and trusting it.

---

## Step 15 — Record

Design: SPECS AC-DOC-5. In `agents/IMPLEMENTATION.md`, record:
- Droplet IP (private note — not for the public repo if that matters to you).
- Real monthly cost (droplet plan actually chosen).
- **Versions actually installed**: `psql --version` output from step 4 (closes
  `docs/ASSUMPTIONS.md:56-60`), `node -v` from step 5, `caddy version`.
- The step 13e WebSocket-through-the-gate outcome (pass as-is, or fallback applied) — AC-CAD-7.
- The step 13f query result (confirms which real IP appeared) — AC-IP-11.
- Whether the step 14 induced-failure drill was run, and its outcome.

Then update `docs/ASSUMPTIONS.md:71-75` (cost — close it with the real number) and confirm
`:64-69` (backups) and `:77-80` (capacity ceiling) remain open, since nothing in this batch closes
them.

---

## Mapping — every `[HOST]` acceptance criterion to the step that proves it

| Criterion | Step | Observable proof |
|---|---|---|
| AC-IP-11 | 13f | `SELECT ip, count(*) ...` top row is a real public IP, not `127.0.0.1` |
| AC-IP-12 | 13g | `journalctl -u chat` — no warn lines from §1.7a |
| AC-BIND-2 | 13i | `nc -zv` from off-host to `:3000` refused/timed out |
| AC-BIND-3 | 3 | `ufw status verbose` — deny incoming; 22/80/443 only |
| AC-BIND-4 | 4 | `SHOW listen_addresses;` → `localhost` |
| AC-CD-4 | 13l (see mismatch note) | red-commit dispatch refused before any SSH connection |
| AC-CD-5 | 12 | `ls` of the new release dir shows the 6 required paths |
| AC-CD-6 | 13c/13d/13e | 401 unauth, 200 auth, no trailing-slash 403 on `/ws` |
| AC-CD-9 | 13h | manual bcrypt smoke re-run, `$2b$12$...` output |
| AC-CD-10 | 12 | `journalctl` order: stop → migrate → start |
| AC-CD-11 | 13b | loopback health `200` |
| AC-CAD-4 | 9 | `caddy validate` → `Valid configuration` |
| AC-CAD-5 | 9 | certificate issued, `journalctl -u caddy` |
| AC-CAD-6 | 13c/13d | 401 unauth / 200 auth |
| AC-CAD-7 | 13e | browser WS test pass/fail, recorded either way |
| AC-SYS-8 | 10 | `systemd-analyze verify` — silent = clean |
| AC-SYS-9 | 13k | `kill -9` + restart observed with new PID |
| AC-SEC-1 | 7 | `ls -l secrets.env` → `0640 root:rosetta-chat` |
| AC-SEC-2 | 7 | `sudo -u deploy cat secrets.env` → denied |
| AC-SEC-3 | 2 | `sudo -l -U deploy` → exactly 4 commands |
| AC-SEC-4 | 2 | `rosetta-chat` nologin, no home, not in sudoers |
| AC-SEC-5 | **10.4** | root SSH refuses; `deploy` key-only login works (moved from step 2 — hardening cannot precede the root-only steps 3–10) |
| AC-ROL-2 | 14 | induced migration failure → auto flip-back + restart |
| AC-ROL-3 | 14 | same run still exits non-zero in Actions |
| AC-ROL-5 | 14 | `ls releases | wc -l` ≥ 3 |
| AC-ROL-6 | 14 | manual one-liner rollback executed, `200` after |
| AC-ROL-7 | 12 | first-deploy failure branch: no flip attempted, site down, stated |
| AC-ROL-8 | 14 | induced flip failure → previous release restarted, not left stopped |
| AC-RET-10 | 13j | `systemctl list-timers` shows a scheduled `NEXT` run |
| AC-RET-13 | 13j | manual trigger of the oneshot unit succeeds, 3 counts logged |
| AC-DOC-5 | 15 | `agents/IMPLEMENTATION.md` entry with versions/IP/cost/outcomes |

That is 29 rows above; two criteria are worth calling out on their own —

---

## Mismatches between the specs' step references and this runbook's numbering

I checked every `[HOST]`-tagged criterion in SPECS §3 against the step it names. Two do not
resolve to one of the plan's numbered steps 0–15, and I am flagging both rather than silently
inventing a fit:

1. **AC-CD-4** (SPECS §3.3): proof is stated as `[HOST] first red-commit dispatch`, with no runbook
   step number given — unlike every sibling row in the same table (AC-CD-5→12, AC-CD-6→13e,
   AC-CD-9→13h, AC-CD-10→12, AC-CD-11→13b, all of which name a step). This criterion is a
   negative-path test of the workflow's CI-gate guard, which can only be exercised after the
   workflow exists on the default branch (i.e., after step 11) and is naturally a one-time
   verification rather than part of the linear provisioning sequence. I placed it at **13l**, and
   marked it optional-but-recommended rather than mandatory, since it is destructive of nothing
   but does require deliberately creating a red commit. **This is my placement, not the specs'** —
   there is no numbered step in SPECS or arch-notes §10 to check it against, so there is nothing
   to reconcile it with; I am recording the gap rather than presenting 13l as if the specs
   specified it.

2. **AC-RET-10** (SPECS §3.8): proof is stated as `[LOCAL] inspection; [HOST] systemctl
   list-timers`, again with no step number, while its sibling **AC-RET-13** in the same table row
   group explicitly says `runbook 13`. I placed both at **13j** together, since they are the same
   observation (the timer's scheduled state and the oneshot unit's success) taken at the same
   point in the sequence. Same caveat as above: this is a placement I made to satisfy the plan's
   "all 31 `[HOST]` checks mapped to a step" requirement, not a step number the specs themselves
   assert.

All other 29 `[HOST]`-tagged criteria named an explicit runbook step number in SPECS §3, and in
every case my step numbering matches the number the specs cite (verified individually in the
table above — e.g. AC-IP-11 → "runbook 13f" in SPECS matches step 13f here; AC-SEC-2 → "runbook 7"
matches step 7 here; AC-ROL-7 → "runbook 12" matches step 12 here). I found no case where the
specs named a step number and my ordering placed that criterion's proof at a **different** number
— the only gap is the two criteria above where the specs named no number at all.

---

## Corrections not made here

`plans/gated-deploy/architecture-notes.md` §10 itself places the `:3000` off-host reachability
check at its step 3, which SPECS §5.6 explicitly says is superseded (checking at step 3 is vacuous
— nothing listens on `:3000` until after the first deploy). This runbook follows SPECS §5.6 and
places that check at step 13i. Reconciling arch-notes §10's text to match is PLAN batch B7's job
(`docs/RUNBOOK-gated-deploy.md` is this batch's only owned file) — flagging here so it is not lost
between batches.
