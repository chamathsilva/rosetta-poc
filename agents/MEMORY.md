# AGENT MEMORY

Generalized reusable lessons from agent sessions.
Root causes converted into preventive rules, not incident-specific notes.
Entries are h3 headers with [ACTIVE|RETIRED] status.
Content: brief, grep-friendly, MECE across sections.
Style: one-liner per entry, optional sub-bullets for context.
Operational notes for agents — not a duplicate of `docs/CONTEXT.md` or `docs/ARCHITECTURE.md`.
Keep template entries so that AI knows how to fill them in later on.

## Preventive Rules

### A subagent's self-reported "no gaps" is not evidence of no gaps [ACTIVE]

- Phase 3 (discovery) self-reported "no conflicts" while shipping a `.gitignore` containing no `.env` entry — a direct secret-leak path for the planned DB password and JWT signing key.
- Caught by orchestrator review, **not by the workflow**. The workflow's own checklist passed.
- Rule: verify a phase's security-relevant output directly. Treat a clean self-report as unverified.
- Also missed by the same self-report: no password-hashing dependency, no rate-limiting dependency, no migration tool, no `.env.example`.

### Free-tier provider limits must be checked against the app's actual duty cycle, not its peak [ACTIVE]

- A cap expressed in compute-hours behaves completely differently for an always-on app than for intermittent testing. The headline number looks generous either way.
- Rule: convert every quota into "hours the app can be alive per month" before accepting the tier.

### A decision reversed by a later conversation must be written down, not remembered [ACTIVE]

- `POC-BRIEF.md` still specifies Neon and a $4/512 MB droplet; both were superseded in conversation. A session reading only the brief would silently revert both.
- Rule: corrections live in `docs/ARCHITECTURE.md` and `docs/CONTEXT.md` with an explicit "supersedes" note. Do not edit the stale source — its staleness is evidence.

### Do not re-derive researched decisions [ACTIVE]

- The architecture was decided and researched before Rosetta was activated. Re-deriving it burns tokens and changes the variable under measurement.
- Rule: transcribe. Disagreement goes to `docs/ASSUMPTIONS.md` as an open question, never into a silent change.

### \<Generalized Preventive Rule\> [ACTIVE|RETIRED]

\[Root cause, Reasons, Problems\]

## What Worked

### Orchestrator review of subagent output caught what the phase checklist did not [ACTIVE]

- The `.gitignore` secret-leak gap was found by a human-directed orchestrator pass over a phase that reported itself clean.
- Reason it worked: the reviewer checked the artifact, not the report.

### \<Generalized What Worked\> [ACTIVE|RETIRED]

\[Root cause, Reasons, Problems\]

## What Failed

### Phase 3 discovery reported "no conflicts" while shipping an unsafe `.gitignore` [ACTIVE]

- Hypothesis: the phase validated that files were produced, not that their content was correct.
- Root cause: no adversarial check on security-relevant output; the completion criterion was existence, not correctness.
- Problem: this failure mode is silent and generalizes — any phase whose checklist asks "did you produce X" will pass on a wrong X.

### \<Generalized What Failed\> [ACTIVE|RETIRED]

\[Hypothesis, Root cause, Reasons, Problems\]

## Discoveries

### Neon free tier was dropped on CU-hour math, not storage or egress [ACTIVE]

- 100 CU-hours/project/month ≈ ~400 active hours at the smallest compute size, against ~730 hours in a month. Hitting the cap **suspends compute until the next billing month**.
- Fine for intermittent POC testing; fatal for an always-on publicly-launched app.
- Consequence: Postgres self-hosted on the droplet, which makes `pg_dump` **and a tested restore** an owned deliverable, and pushes the droplet from 512 MB to 1 GB + 2 GB swap.

### Cloudflare Workers + Durable Objects was dropped for hibernation fragility AND evaluation contamination [ACTIVE]

- Free tier ≈ 1.2 continuously-active Durable Objects. WebSocket Hibernation makes idle rooms free, but a presence heartbeat, an alarm, or an outbound connection each silently defeat it — all natural things to write for a chat app. Fails hours into real use, not in testing.
- Second and equally binding reason: Workers + DO is a niche stack. Mediocre generated code there is indistinguishable from *the model knowing Workers less well than Express* — which contaminates the exact variable this POC measures.
- Usage note: the second reason is specific to this repo being an evaluation. Do not generalize it to ordinary projects.

### This repo has two subjects and the evaluation is the fragile one [ACTIVE]

- The chat app produces visible artifacts; the evaluation produces none unless deliberately recorded.
- Per-feature token/wall-clock cost and the without-Rosetta baseline feature (1:1 DM) cannot be reconstructed after the fact. Losing them turns the POC into a demo.
- Usage: check `docs/CONTEXT.md` "Evaluation guardrails" before starting any feature work.

### \<Generalized Discovery\> [ACTIVE|RETIRED]

\[Usage, Reasons, Problems\]
