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

### A GitHub Action's `permissions` block is part of its contract, not boilerplate [ACTIVE]

- `anthropics/claude-code-action@v1` exchanges the workflow's OIDC token, so without `id-token: write` it fails before it ever reads the credentials secret. The error names OIDC, not the missing permission's consequence.
- Both Claude workflows were authored from the action's own `action.yml` inputs, which say nothing about required permissions — the inputs are documented, the permissions are not.
- Rule: after adding a third-party action, run it once and read the failure, rather than assuming the permissions copied from an example are complete. Permission defects surface only at execution, like the migration verb defect below.

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

### A subagent told to push back with evidence did so, twice, and was right both times [ACTIVE]

- The walking-skeleton architect was instructed every round to dispute findings with evidence rather than comply silently. It disputed exactly twice, both times against the orchestrator, and was correct both times.
- First: the orchestrator asserted a 200-frame buffer was 4.63 MB of heap. The architect measured 2.32 MB and explained why — V8 stores Latin-1 strings one byte per character, and a JSON-escaped NUL body is pure ASCII. The orchestrator reproduced 2.33 MB independently.
- Second: the orchestrator reported a lost-message window as live. The architect showed it was structurally real but unreachable, citing `pg-pool`'s FIFO `_pendingQueue` (`push` at 207/231, `shift` at 156) — verified in source by the orchestrator. It then **made the fix anyway**, on the grounds that an invariant resting on a library's internal scheduling is not something a design should rest on.
- The second is the more valuable behaviour: it neither complied silently nor used being right as grounds to refuse the change.
- Generalizes: "push back with evidence" produces useful dissent only when the subagent is also told the standard of evidence. Both pushbacks cited a file and line or a measurement, because that was demanded. A bare instruction to "disagree if you disagree" would not have produced either.

### Breaking CI on a throwaway PR settled in two runs what a green run could not settle at all [ACTIVE]

- The CI added 2026-09-08 was green on its own PR. That is equally consistent with the checks working and with them checking nothing — CodeQL in particular reported `results=0` across 201 rules.
- Six deliberate defects on a scratch branch (unused variable, type error, failing assertion, invalid migration SQL, a SQL-injection sink, a dependency with a known high advisory) made each check fail at the exact step intended, and removing them returned CodeQL and dependency review to green — proving the checks track the diff rather than emitting constant noise.
- Cost: one scratch branch, two CI runs, deleted afterwards. The PR under review kept a clean history.
- Rule: validate a new gate by making it fail, on a branch you throw away. Applies to CI, lint configs, alerting and health checks alike.

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

### Verifying a document's citations is not verifying its reasoning [ACTIVE]

- The walking-skeleton design was produced by an opus architect, then spot-checked by the orchestrator before being presented for approval. The orchestrator verified two claims — that a pattern file contained a quoted line, and that a CLI flag existed — and both were true. That produced false confidence.
- The user's review then found eight real defects, two of them factual errors the orchestrator had read past: an assertion that a null `author_id` "cannot author a message" (the column is nullable, so `pg` writes NULL and the insert succeeds), and a TOAST threshold rationale that is simply wrong for 2000 Unicode characters.
- Root cause: the orchestrator verified the *citations* — claims of the form "document X says Y" — because those are cheap and mechanical to check. It did not verify the *reasoning* — claims of the form "therefore Z is safe" — which is where both errors lived.
- Rule: when checking a design, separate its citations from its load-bearing assertions, and test the assertions against the schema or runtime behaviour they depend on. A correctly-cited document can still be unsound.

### A decision lands in the file being edited, not the full set it belongs in [ACTIVE]

- Three consecutive review rounds caught the same shape. Test framework: closed in `ASSUMPTIONS.md`, never moved to `DEPENDENCIES.md` — which the assumption entry itself named as its target. Pool sizing: recorded in `ASSUMPTIONS.md` and `ARCHITECTURE.md`, missed in `TECHSTACK.md`. IP-proxy follow-up: relayed to the user as "logged as a TODO", never written to `docs/TODO.md` at all.
- Each time the orchestrator stated the update as done and it was partially or entirely not done. The user found all three.
- Root cause: updates are made to whichever file is open in the moment, and the propagation set is reconstructed from memory instead of from the roster. `bootstrap_rosetta_files` already lists that roster.
- Rule: before claiming a decision is recorded, enumerate its homes explicitly — a tech choice touches `TECHSTACK.md`, `DEPENDENCIES.md`, `ARCHITECTURE.md` and `ASSUMPTIONS.md`; a deferred action touches `TODO.md` — then grep for the old value to prove none survive. Saying "recorded" without that grep is an unverified claim.
- **This rule was written, then violated in the same session.** A fourth instance followed immediately: the orchestrator told the user in prose that `docs/TODO.md`'s admin-bootstrap item was misfiled as blocking the walking skeleton, and never edited the file — leaving a P0 that formally blocked the feature for three review rounds. The rule as first written covered *decisions*, and this was a *correction noticed in conversation*, so it did not fire.
- Stronger rule: **saying a file is wrong is not fixing it.** Any sentence of the form "that TODO is misfiled", "that doc is stale", "I should update X" is an action, not an observation — perform the edit in the same turn it is noticed, or it will not happen. Prose to the user is not a work queue.

### Fixes introduce their own defects, and nobody checks the fix itself [ACTIVE]

- Walking-skeleton design review, round 5: three of four findings were created by round 4's fixes. The ordered-batch merge introduced a frame-type assumption (error frames have no `id`/`created_at` and cannot be sorted into history). The cumulative byte cap introduced a false aggregate bound (pool size does not gate buffers, because a socket buffers *while waiting* for a client). The per-socket promise chain introduced a cancellation gap (queued INSERTs still run after the socket closes, and one rejection poisons the chain).
- Each fix was correct for the defect it targeted and was reviewed only against that defect. Neither the author nor the orchestrator asked what the fix newly made possible.
- The false-bound case is the sharpest: the design stated "bounded at 10 MiB across the `max: 10` pool" and, **two lines later**, described the pool-wait that disproves it. The contradiction was adjacent, in one file, and both an opus author and a verifying orchestrator read past it.
- Rule: after fixing a defect, review the fix as new code — what does it now assume about its inputs, what does it hold open, what happens when it fails partway. A fix is not a smaller change than a feature; it is a feature with less scrutiny. State explicitly what new failure modes were checked for.

### A self-check section produced false assurance instead of catching the defect [ACTIVE]

- After fixes kept introducing new defects, the orchestrator required the architect to add a "failure modes introduced by these fixes — checked" section. It did. The section's central claim was **"Checked for deadlock: none. The initialization path holds exactly one client and never awaits a second."**
- That was false. The step it described passed `pool` rather than the held client, so it *did* await a second — ten concurrent initializations would hold all ten clients and each block for an eleventh. The contradicting line sat 120 lines above the claim, and its own prose said "on the held client" while its argument said `pool`: one sentence disagreeing with itself.
- The self-check did not catch the break. It added a confident assertion that there was no break, which is worse than silence — a reader who trusts the section stops looking.
- Root cause: the section asked "did this introduce a problem?", which is answerable from memory of intent. It did not require pointing at the lines that would have to be true for the answer to hold.
- Rule: a self-check must cite the specific line or step re-read to justify each claim. A check that cannot be traced to something actually re-read is not a check, and "no problem found" without that trace should be written as "not verified" instead. Applies to the orchestrator's own verification passes, which failed the same way in rounds 1-4.
- **The rule was then broken by the orchestrator in the very next round, in a new way.** Asked to confirm a named-step conversion had removed all numeric step references, it ran `grep -on "step [0-9]"`, got no matches, and reported "NONE - fully converted". The pattern was case-sensitive and had no hyphen, so it missed `Steps 2-7` and `step-4 snapshot` in the same file. The user found both.
- The failure is distinct from the false self-check and needs its own guard: there, a claim was made without looking; here, a real command was run whose *pattern did not cover the space it appeared to cover*. An empty grep result is ambiguous between "nothing there" and "wrong pattern", and it reads as the first.
- Rule: when a search is the evidence, state the exact pattern alongside the result, and prefer a deliberately over-broad pattern that needs manual filtering over a narrow one that returns clean. Before trusting an empty result, run the pattern against a case you know should match — if it does not find that, it proves nothing about the rest.

### The migration command itself was never once executed before this defect shipped [ACTIVE]

- `package.json`'s `migrate` script read `node-pg-migrate -m src/db/migrations` from round 4 of the design review onward — nine design rounds, two plan rounds, a B0 scaffold, and a full B1 implementation all treated this as settled. It was wrong: `node-pg-migrate` requires a positional direction verb (`up`/`down`) as its first argument, and without one the CLI silently prints its help text and does nothing.
- Every prior check was structural: `-m` resolving the right directory, file extension `.sql` governing execution, `-j sql` being creation-only. All correct, and none of them actually invoked the command against a database — because until this session, no reachable database existed.
- The first time it ran for real (after obtaining credentials to a live Postgres), it printed help instead of migrating, immediately and unambiguously.
- Generalizes: a command's argument list can be verified against documentation, `--help` text, and even its own source, and still be wrong in the one respect that only running it reveals. This is the same lesson as "prove a config is doing work by making it fail on purpose" (an earlier entry), one level up: some things cannot be proven by static inspection at all, only by execution — no amount of additional review rounds would have found this before a real database existed to run it against.

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

### An ambient NODE_ENV from .env silently doubled the shipped client bundle [ACTIVE]

- `npm run build` intermittently produced a 393 KB client bundle instead of the expected 194 KB, with a different content hash each time. First dismissed as a non-reproducible anomaly after two clean retries came back at 194 KB.
- It was not an anomaly. The two sizes corresponded to exactly two conditions: `NODE_ENV=development` present in the shell → 393 KB (React's development bundle, extra runtime checks); absent or `production` → 194 KB. The variable was leaking from `.env` (`NODE_ENV=development`, set there for the server's own conventions) into whichever shell had sourced it before running `vite build`.
- `.env.example`'s own comment invites exactly the workflow that triggers this: "Copy to .env for local work." Any developer or CI step that sources `.env` before building ships the slower, larger bundle to production with no error, no warning, and a build that "succeeds."
- Fixed: `"build:client": "NODE_ENV=production vite build"` — forces the client build's mode regardless of the ambient environment. Verified under the worst case (`NODE_ENV=development` explicitly exported) that the fix holds.
- Generalizes: a build tool that appears to control its own mode (`vite build` is nominally always a production build) can still be silently overridden by an inherited environment variable if some part of its dependency chain (here, React itself) reads `process.env.NODE_ENV` directly rather than trusting the bundler's internal mode. An intermittent, hard-to-reproduce build artifact size is worth root-causing, not writing off after a couple of clean retries — retrying with the *same* ambient environment does not test the actual variable.

### \<Generalized Discovery\> [ACTIVE|RETIRED]

\[Usage, Reasons, Problems\]
