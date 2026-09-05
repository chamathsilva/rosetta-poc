# ASSUMPTIONS

Open unknowns, unverified inferences, and decisions not yet made.
Each entry: what is assumed or missing, **confidence**, and the **target file** it moves into once resolved.
An entry leaves this file only when a human decides it — not when an agent guesses it.
Style: one h3 per entry, grep-friendly. Status `[OPEN]` or `[RESOLVED — <date>, → <file>]`.

Disagreement with a decided architecture is logged here as an open question. It is never applied as a silent change.

## Undecided technology

### Database migration tool: `node-pg-migrate` [RESOLVED — 2026-09-04, → `docs/TECHSTACK.md`]

Chosen for plain SQL migrations on the same `pg` driver, with no query builder to erode the no-ORM pattern. Recorded as a production dependency because the droplet runs migrations at deploy time.

### Rate-limiting library: none chosen [OPEN]

Confidence: n/a — undecided.
Rate limiting is a **public-launch gate** (`docs/CONTEXT.md`), so this cannot stay open past the pre-launch phase.
Target on resolution: `docs/TECHSTACK.md`, `docs/DEPENDENCIES.md`.

### Monitoring and logging stack: none chosen [OPEN]

Confidence: n/a — undecided. `gain.json` carries placeholders for both.
Retention period (30 days) is now decided (`docs/CONTEXT.md`, `docs/ARCHITECTURE.md`); the logging tool choice still determines *where* that retention is technically enforced.
Target on resolution: `gain.json`, `docs/TECHSTACK.md`.

### Source language: TypeScript [RESOLVED — 2026-09-04, → `docs/TECHSTACK.md`]

Was never recorded as an open question, yet `docs/CONTEXT.md` mandated `typescript-lsp` while `docs/TECHSTACK.md` and `docs/DEPENDENCIES.md` described a plain-JavaScript stack. Resolved by the user: **TypeScript**, compiled by `tsc` to `dist/`. No phase of `init-workspace-flow` caught the contradiction.

### Test framework and linter: not chosen [OPEN]

Confidence: n/a — `docs/DEPENDENCIES.md` records "likely jest or mocha" and "likely eslint" as guesses, not decisions.
Target on resolution: `docs/DEPENDENCIES.md`.

### JWT lifetime: 24h guest, 30d registered [RESOLVED — 2026-09-04, → `docs/ARCHITECTURE.md`]

Was never specified by any source and only surfaced because guest reaping depends on it. The guest value also sets when a nickname returns to the pool.

### Connection pooling configuration: unspecified [OPEN]

Confidence: n/a. `pg` is chosen; pool sizing against a 1 GB co-hosted droplet is not. Pool size interacts with the memory ceiling.
Target on resolution: `docs/ARCHITECTURE.md`.

### Client framework departs from the pre-Rosetta design [RESOLVED — 2026-09-04, → `docs/ARCHITECTURE.md`]

`POC-BRIEF.md` and the original architecture specified a plain static HTML/CSS/JS client. The user decided React 19 with Vite instead.

Recorded here because `docs/CONTEXT.md` requires departures from the pre-decided architecture to be written down rather than applied silently. This one is a deliberate user decision, not agent drift.

Open consequences, not yet resolved:
- The React payload (~60 KB gzipped, no CDN) has not been weighed against the single-instance capacity ceiling, which is itself unmeasured.
- `docs/PATTERNS/untrusted-content-rendering.md` had to be rewritten: the XSS surface moved from `innerHTML` to `dangerouslySetInnerHTML`.

## Unproven operations

### Backup and restore procedure: unproven [OPEN]

Confidence: low. Self-hosting Postgres made backups an owned deliverable (`docs/ARCHITECTURE.md`). Neither `pg_dump` scheduling nor a restore has been performed.
**An untested restore is not a backup.** This must not be marked done on the strength of a dump script alone.
Retention is now capped at 30 days as a privacy control (`docs/ARCHITECTURE.md`); the cap is decided but unimplemented, so the retention promise is currently unenforced.
Target on resolution: `docs/ARCHITECTURE.md`, `agents/IMPLEMENTATION.md`.

### Droplet not provisioned; real cost unverified [OPEN]

Confidence: medium on the $6/mo figure (DigitalOcean pricing checked during the setup session, 2026-09-04). Zero confidence in the total: domain and any overage are unpriced.
Deliberate — do not provision before the walking skeleton is ready to deploy.
Target on resolution: `agents/IMPLEMENTATION.md`.

### Single-instance capacity ceiling: never measured [OPEN]

Confidence: n/a. `docs/ARCHITECTURE.md` documents the ceiling and its Redis pub/sub migration path, but the actual concurrent-connection limit of one 1 GB droplet running Node + Postgres has not been measured. Any capacity claim before measurement is a guess.
Target on resolution: `docs/ARCHITECTURE.md`.

### Node.js version: 24 [RESOLVED — 2026-09-04, → `.nvmrc`, `package.json`]

Pinned to the Node 24 line in `.nvmrc` and `engines`. Note the global `typescript` and `typescript-language-server` are per-Node-version under nvm and were reinstalled for 24; the Claude Code process itself runs on v22.14.0, which also has them.

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
