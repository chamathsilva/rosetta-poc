# Rosetta POC — Session Handoff Brief

> Written during the setup session, before Rosetta was activated.
> Read this first if you are a fresh Claude Code session in this repo.

## Goal

Evaluate **[griddynamics/rosetta](https://github.com/griddynamics/rosetta)** — an "instruction layer for AI coding agents" — by building a real application through its workflows.

This is a **personal-laptop POC**. No company approval needed (Rosetta's docs ask for manager approval; not applicable here).

**The evaluation is the deliverable, not the app.** The chat app is the vehicle.

## Current state

| Item | Status |
|---|---|
| Repo cloned | Yes — was empty |
| Rosetta plugin | Installed, v3.1.13, **project scope** |
| Rosetta activated | **No** — never run yet |
| Repo init workflow | **Not run** — this is the next step |
| Application code | None |
| Infrastructure | None provisioned |

Only `.claude/settings.json` and this file exist. Nothing is committed yet.

## Environment / git

Two SSH keys on this laptop. **This repo must use Chamath's**, not Nimesha's (the global git default).

- `~/.ssh/id_ed25519` → Chamath (`chamath.silva@velaris.com`)
- `~/.ssh/id_ed25519_github_nimesha` → Nimesha (global git default)

A `chamath` SSH host alias was added to `~/.ssh/config`. The remote uses it:

```
origin  git@chamath:chamathsilva/rosetta-poc.git
```

Repo-local git identity is overridden to Chamath. **Don't "fix" the remote to `git@github.com:...`** — that would auth as the wrong user.

## Rosetta setup notes

Installed at **project scope** deliberately, so it does not apply to other projects in `~/Desktop/Projects/POC/` and does not contaminate the Phase 3 baseline comparison.

`.claude/settings.json` declares both the marketplace and the plugin, so the setup reproduces from a fresh clone.

Gotchas:
- Plugins load **at session start** — installing mid-session does nothing.
- Project scope resolves from the **project root**, so the session must be rooted in this directory (`cd rosetta-poc && claude`), not the parent.
- Rosetta's docs specify a **medium-reasoning model** — Sonnet, not Auto or Opus.
- Conflicts with similar plugins (JUXT, Superpowers, GSD, AI-DevKit) — don't stack them.

## What Rosetta actually is

Not a library. A versioned set of markdown instructions that load at session start:

- A **bootstrap** file (always-on core policies)
- A **classifier** routing each request into one of ~17 workflow types (`coding-flow`, `security-flow`, …)
- **Skills** loaded on demand (progressive disclosure)
- **Subagents** with fresh context for review
- **HITL** approval gates

Three layers merge: **Core** (OSS) → **Organization** (skipped here) → **Project** (this repo's generated docs).

Value proposition is **governance and consistency at team scale**, not raw capability. README is blunt: *"If you are effectively using your current setup, writing your own skills, and managing AI using your own processes, you probably don't need Rosetta."*

## The application

A [chatib.us](https://www.chatib.us/)-style chat app: guest access **and** registered accounts.

Chosen because it exercises several Rosetta workflow types — `planning-flow`, `coding-flow`, `security-flow` (guest sessions, auth, XSS in user content, rate limiting, moderation), `testing-flow` (WebSocket/presence logic is awkward to test).

**Caveat for the write-up:** this is greenfield. Griddynamics' headline "2×" claim is specifically about *brownfield* work. So this POC tests workflow discipline, not that claim.

## Architecture — DECIDED

**Node on a DigitalOcean droplet + Neon Postgres.**

| Layer | Choice |
|---|---|
| Host | DigitalOcean droplet, $4/mo (512 MB) or $6/mo (1 GB) |
| Runtime | Node.js |
| HTTP | Express or Fastify |
| WebSockets | `ws` (or Socket.IO), rooms as in-process `Map<roomId, Set<socket>>` |
| Database | Neon Postgres, free tier |
| Sessions | Signed JWT cookies |
| TLS / proxy | Caddy (automatic certs) — or Nginx + certbot |
| Process supervision | systemd (or pm2) |

**Cost: ~$4-6/month** (~$50-70/yr). Not $0, but the DB is genuinely free.

### Verified limits

DigitalOcean droplets (checked during setup):
- $4/mo → 512 MB RAM, 1 vCPU, 10 GB SSD, 500 GB transfer
- $6/mo → 1 GB RAM, 1 vCPU, 25 GB SSD, 1 TB transfer

Neon free plan (checked during setup):
- **0.5 GB storage per project** (hard cap)
- **100 CU-hours/project/month**
- **5 GB egress/month**
- Scale-to-zero after **5 min** inactivity
- Hitting any monthly limit suspends compute until the next billing month
- Up to 100 projects/org, 10 branches/project; permanent free, no credit card

⚠️ **100 CU-hours is the one to watch.** At the smallest compute size that's roughly 400 active hours/month against ~730 hours in a month — fine for intermittent POC testing, but a genuinely 24/7 app would suspend mid-month. Verify the actual compute size when provisioning. If it becomes annoying, `better-sqlite3` on the droplet is a zero-limit fallback (at the cost of owning your own backups).

⚠️ **DigitalOcean has no free managed database.** Their managed Postgres starts at **$15.15/mo**, 3-4× the droplet. Do not reach for it — that's why the DB is external.

### Known limitation, accepted

In-process room state means **one instance only**. Scaling to two droplets breaks WebSocket fanout and would require a Redis pub/sub adapter. Fine for a POC; note it if the write-up discusses production readiness.

## Rejected alternatives — do not silently revert

**Cloudflare Workers + Durable Objects + D1** was the original design and was deliberately abandoned. Two reasons:

1. **Durable Objects free tier is a knife-edge.** 13,000 GB-s/day ÷ 128 MB per DO = ~104,000 DO-seconds/day ≈ **1.2 continuously-active Durable Objects**. With WebSocket Hibernation working, idle rooms cost nothing and you can have thousands. But hibernation is fragile — a `setInterval` presence heartbeat, an alarm, or an outbound connection all defeat it. That's a natural thing to write for a chat app. Get it subtly wrong and the app tests fine, then dies hours into real use.
2. **Stack conventionality is an evaluation confound.** Workers + DO is niche. If Rosetta produced mediocre code there, you could not distinguish *Rosetta failing* from *the model knowing Workers less well than Express*. That contaminates the exact variable being measured. Node + Postgres is also far more representative of the enterprise SDLC Rosetta targets, so findings transfer better.

The request/socket math was **not** the reason — Workers' 100k DO requests/day with the 20:1 WebSocket ratio is ~2M messages/day, never a POC concern.

**D1 as the database for a Node server** was also rejected: outside Workers, D1 is only reachable via Cloudflare's HTTP REST API — every query is an HTTPS round-trip, with no connection pooling or session transactions. It's a Workers binding, not a remote database.

**Fly.io / Railway** remain reasonable if the droplet's ops burden (TLS, systemd, patching, firewall, backups) proves to be a distraction from the actual evaluation. Slightly less infra surface for Rosetta to govern, but the POC finishes sooner.

## Plan

**Phase 1 — Rosetta setup**
1. ~~Install plugin~~ ✅
2. Run the repo-init workflow → generates `CONTEXT.md`, `ARCHITECTURE.md`, `TECHSTACK.md`, `CODEMAP.md`, `plans/`
3. Hand-write real content into those files — Rosetta's FAQ is explicit that init alone is insufficient and the agent won't invent domain facts

**Phase 2 — build through Rosetta's workflows** (each step is a POC data point, not just a feature)
4. Guest entry: nickname + join, WebSocket chat in one room — *walking skeleton, deploy it*
5. Multi-room + presence list
6. Accounts: registration, login, guest→registered upgrade — *run through `security-flow`*
7. 1:1 private messaging
8. Rate limiting + moderation — *second `security-flow` pass*

**Phase 3 — evaluate**
9. Deploy to the droplet, confirm real cost matches expectation
10. Rebuild **one** feature with plain Claude Code, no Rosetta, as baseline
11. Write up: consistency, token/time overhead, whether the plan→HITL→review gate caught anything real, whether generated docs stayed accurate as code changed

## Evaluation guardrails

These are what make this an evaluation rather than a demo. Protect them.

- **Step 10 is the one people skip.** Without a baseline there is no finding, only a demo.
- **Hold back 1:1 private messaging (step 7) as the baseline feature.** Guest entry and the architecture were designed in the setup session, outside Rosetta — using them as the baseline would bias the comparison. 1:1 DM has not been pre-designed. Keep it that way.
- **Record token and wall-clock cost per feature** as you go. Reconstructing it later is not possible.
- Paste the architecture above into `ARCHITECTURE.md`/`TECHSTACK.md` rather than re-deriving it — the POC should test Rosetta's workflow discipline, not its ability to redo finished research.
- **Ops work counts as evaluation surface.** Deployment and infra are legitimate SDLC territory that Rosetta claims to govern. Note how it handles them rather than treating them as setup noise.

## Immediate next steps

```bash
cd ~/Desktop/Projects/POC/rosetta-poc && claude
```

1. Accept the project-scope plugin trust prompt
2. Confirm Rosetta booted (`/help` should show its workflow commands)
3. Then: *"Initialize this repository using the respective Rosetta workflow."*
4. Hand-write real content into the generated docs (architecture above)
5. Commit — nothing is committed yet

Infrastructure (droplet + Neon project) is **not yet provisioned**. It isn't needed until the Phase 2 walking skeleton is ready to deploy — don't provision early and burn Neon CU-hours on an idle project.
