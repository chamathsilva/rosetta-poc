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

### Prove a config is doing work by making it fail on purpose [ACTIVE]

- A `tsconfig.client.json` that `extends` a base inherits the base's `exclude`. The base excluded `src/client`, so the client config excluded its own sources and checked nothing.
- It surfaced only because zero files matched and `tsc` raised TS18003. Had one file matched, it would have passed silently while checking almost nothing.
- Rule: after adding a strictness setting or a new config, introduce a deliberate error and confirm it is caught. A clean run proves nothing on its own — it is equally consistent with the check not running.
- Applied twice this session: `noUncheckedIndexedAccess` proved active via a rejected `rows[0].length`, and the client config proved active by compiling a JSX template through it.

### A stub that documents a failure must actually produce it [ACTIVE]

- `src/server/index.ts` exported a `main()` that threw "not implemented" — and never called it. `node dist/server/index.js`, the exact command `npm start` runs, exited 0 with no output.
- The comment said it would fail loudly. The code did the opposite, and the build, the typecheck and the file all looked correct.
- Under systemd a clean immediate exit reads as a healthy unit, so this would have been much harder to diagnose than a crash.
- Rule: when writing a placeholder whose purpose is to fail, run it and confirm a non-zero exit. Intent expressed in a comment is not behaviour.

### \<Generalized Preventive Rule\> [ACTIVE|RETIRED]

\[Root cause, Reasons, Problems\]

## What Worked

### Orchestrator review of subagent output caught what the phase checklist did not [ACTIVE]

- The `.gitignore` secret-leak gap was found by a human-directed orchestrator pass over a phase that reported itself clean.
- Reason it worked: the reviewer checked the artifact, not the report.

### Offering paired options in one HITL batch exposed a contradiction the user could not have seen [ACTIVE]

- The data model review asked four questions in one batch. Two answers were mutually impossible: ban-by-IP without accounts, plus a single `author_id` requiring accounts.
- The contradiction was visible only because both options carried their dependency in the option text. Restating it and asking one follow-up resolved it in a single round.
- Generalizes: when batched questions have hidden dependencies, name the dependency inside the option, then verify the answers against each other before acting. Do not silently pick the reading that suits the implementation.

### A reviewer that compiles beats a reviewer that reads [ACTIVE]

- The scaffold review was told it could run commands. It built a scratch project against the repo's real `tsconfig.json` and compiled the pattern templates, rather than reasoning about them.
- That is how it found that `jwt-session-cookies.md` did not compile — a defect invisible to reading, in a file the orchestrator had edited minutes earlier and believed correct.
- It also reported the exact error codes, which made the fix verifiable in both directions rather than plausible.
- Generalizes: when reviewing anything executable, give the reviewer the means to execute it and demand error output as evidence. Reading finds contradictions; running finds defects.

### \<Generalized What Worked\> [ACTIVE|RETIRED]

\[Root cause, Reasons, Problems\]

## What Failed

### Phase 3 discovery reported "no conflicts" while shipping an unsafe `.gitignore` [ACTIVE]

- Hypothesis: the phase validated that files were produced, not that their content was correct.
- Root cause: no adversarial check on security-relevant output; the completion criterion was existence, not correctness.
- Problem: this failure mode is silent and generalizes — any phase whose checklist asks "did you produce X" will pass on a wrong X.

### Nine phases missed a contradiction between a tooling mandate and the stack docs [ACTIVE]

- Hypothesis: every phase read the documents it owned and none read two documents against each other.
- Root cause: `docs/CONTEXT.md` mandated `typescript-lsp` for navigation while `docs/TECHSTACK.md` and `docs/DEPENDENCIES.md` described a plain-JavaScript stack with no compiler, no `tsconfig` and no `@types`. The source language was never an entry in `docs/ASSUMPTIONS.md`, so no phase owned the question.
- Problem: cross-document consistency has no owner. Phase 9 verification found staleness *within* documents, not disagreement *between* them. An unasked question cannot be flagged as unresolved, so it fails silently — the same shape as the `.gitignore` failure above.

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

### `typescript@latest` is now the Go port and breaks the language server [ACTIVE]

- `npm install -g typescript` resolves to 7.x (verified 7.0.2, 2026-09-04), the native Go rewrite. Its package contains `lib/tsc.js` and nothing else — no `tsserver.js`, no `typescript.js`, no `tsserverlibrary.js`.
- `typescript-language-server` 5.3.0 exits at initialize with "Could not find a valid TypeScript installation", which reads like a PATH or config fault and is not one.
- Fix: pin `typescript@5`. Recorded as a hard constraint in `docs/TECHSTACK.md` and a version pin in `docs/DEPENDENCIES.md`.
- Generalizes: an unpinned major of a toolchain package can silently swap the artifact set, not just the behavior. The error message names the wrong cause.

### A data-retention promise is only as strong as backup retention [ACTIVE]

- `docs/ARCHITECTURE.md` mandated 30-day IP retention in one section and scheduled `pg_dump` in another. Neither referenced the other. A dump taken while an IP was live keeps it in plaintext forever, so the retention promise was false as written.
- Found only because the user asked whether "erased" meant soft delete. No phase, review or gate surfaced it.
- Fix: backup retention capped at 30 days, with each section naming the other so they cannot be changed independently.
- Generalizes: any retention, deletion or erasure claim must be checked against every copy of the data — backups, WAL, replicas, logs — not only the live table.

### \<Generalized Discovery\> [ACTIVE|RETIRED]

\[Usage, Reasons, Problems\]
