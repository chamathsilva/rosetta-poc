# ASSUMPTIONS

Open unknowns, unverified inferences, and decisions not yet made.
Each entry: what is assumed or missing, **confidence**, and the **target file** it moves into once resolved.
An entry leaves this file only when a human decides it — not when an agent guesses it.
Style: one h3 per entry, grep-friendly. Status `[OPEN]` or `[RESOLVED — <date>, → <file>]`.

Disagreement with a decided architecture is logged here as an open question. It is never applied as a silent change.

## Undecided technology

### Database migration tool: none chosen [OPEN]

Confidence: n/a — undecided.
`docs/CODEMAP.md` proposes `src/db/` for migrations with nothing to run them. Raw `pg` is decided; the migration runner is not.
Target on resolution: `docs/TECHSTACK.md`, `docs/DEPENDENCIES.md`, `docs/PATTERNS/`.

### Rate-limiting library: none chosen [OPEN]

Confidence: n/a — undecided.
Rate limiting is a **public-launch gate** (`docs/CONTEXT.md`), so this cannot stay open past the pre-launch phase.
Target on resolution: `docs/TECHSTACK.md`, `docs/DEPENDENCIES.md`.

### Monitoring and logging stack: none chosen [OPEN]

Confidence: n/a — undecided. `gain.json` carries placeholders for both.
Retention period (30 days) is now decided (`docs/CONTEXT.md`, `docs/ARCHITECTURE.md`); the logging tool choice still determines *where* that retention is technically enforced.
Target on resolution: `gain.json`, `docs/TECHSTACK.md`.

### Test framework and linter: not chosen [OPEN]

Confidence: n/a — `docs/DEPENDENCIES.md` records "likely jest or mocha" and "likely eslint" as guesses, not decisions.
Target on resolution: `docs/DEPENDENCIES.md`.

### Connection pooling configuration: unspecified [OPEN]

Confidence: n/a. `pg` is chosen; pool sizing against a 1 GB co-hosted droplet is not. Pool size interacts with the memory ceiling.
Target on resolution: `docs/ARCHITECTURE.md`.

## Unproven operations

### Backup and restore procedure: unproven [OPEN]

Confidence: low. Self-hosting Postgres made backups an owned deliverable (`docs/ARCHITECTURE.md`). Neither `pg_dump` scheduling nor a restore has been performed.
**An untested restore is not a backup.** This must not be marked done on the strength of a dump script alone.
Target on resolution: `docs/ARCHITECTURE.md`, `agents/IMPLEMENTATION.md`.

### Droplet not provisioned; real cost unverified [OPEN]

Confidence: medium on the $6/mo figure (DigitalOcean pricing checked during the setup session, 2026-09-04). Zero confidence in the total: domain and any overage are unpriced.
Deliberate — do not provision before the walking skeleton is ready to deploy.
Target on resolution: `agents/IMPLEMENTATION.md`.

### Single-instance capacity ceiling: never measured [OPEN]

Confidence: n/a. `docs/ARCHITECTURE.md` documents the ceiling and its Redis pub/sub migration path, but the actual concurrent-connection limit of one 1 GB droplet running Node + Postgres has not been measured. Any capacity claim before measurement is a guess.
Target on resolution: `docs/ARCHITECTURE.md`.

### Node.js LTS version: unpinned [OPEN]

Confidence: n/a. "LTS current, to be pinned at install."
Target on resolution: `docs/TECHSTACK.md`, `package.json`, `.nvmrc`.

## Unverified inferences (agent-derived, no human source)

### Module decomposition [OPEN]

Confidence: low. The module table in `docs/ARCHITECTURE.md` is an agent proposal consistent with `docs/CODEMAP.md`. No code exists to validate it.
Target on resolution: `docs/CODEMAP.md`, `docs/ARCHITECTURE.md`.

### User population description [OPEN]

Confidence: low. `docs/CONTEXT.md` "Users" is inferred. No source document describes who the users are beyond "real strangers".
Target on resolution: `docs/CONTEXT.md`.

## Process assumptions about the evaluation itself

### Baseline-feature isolation is enforced by discipline only [OPEN]

Confidence: low that it holds. 1:1 DM must not be pre-designed, but `gain.json` already carries a `DM` vocabulary entry and this file names the constraint. Nothing mechanically prevents a future session from designing it.
Target on resolution: `docs/CONTEXT.md`, and the baseline run's own record.
