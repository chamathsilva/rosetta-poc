# Evaluation Log

**Synthesized findings** (workflow, benefits, efficiency, failure modes — organized by theme, not chronology): `docs/EVALUATION-FINDINGS.md`. This file is the raw cost ledger and per-run notes; that one is the analysis.

Append-only cost record for the Rosetta evaluation. **One row per unit of work, written as the work happens.**

`POC-BRIEF.md` and `docs/CONTEXT.md` both state this cannot be reconstructed afterwards. A session that finishes a feature without adding a row has destroyed that data point permanently. This is the highest-risk failure in the project because it fails silently — nothing breaks, nothing errors, and the loss is only discovered at write-up time.

## How to record

- **Main-thread tokens** — read the session's remaining-token counter at the start and end of the unit of work, and subtract. Not exact (it includes unrelated conversation), so mark it approximate.
  **Known defect in this method (found 2026-09-04, session 2):** the counter resets to its full budget at the start of every user turn, so start-minus-end across a multi-turn session measures nothing. The only usable figure is the sum of within-turn deltas, which double-counts context re-read on each tool call and therefore overstates. Any main-thread number in this table is an upper bound, not a measurement. Subagent figures are unaffected — those are reported exactly.
- **Subagent tokens** — each subagent completion reports `subagent_tokens` exactly. Sum them.
- **Wall clock** — `date -u` at start and end. Include time spent waiting on human answers; that is a real cost of the HITL model and must not be quietly excluded.
- **Mode** — `rosetta` or `baseline`. The baseline rows are the entire point of the comparison.
- Record what actually happened, including work that failed or was thrown away. A log that only contains successes cannot support a finding.

## Rows

| Date (UTC) | Item | Mode | Main tokens | Subagent tokens | Total | Wall clock | Notes |
|---|---|---|---|---|---|---|---|
| 2026-09-04 | `init-workspace-flow` — full 9-phase run | rosetta | ~82,000 | 345,434 | ~428,000 | 36 min | Greenfield repo. 2 files in, 24 files out, **zero lines of application code**. 12 HITL questions across 2 rounds. See breakdown below. |
| 2026-09-04 | Session 2 — context load, language decision, LSP install, data model review | rosetta | ~140,000 (unreliable — see note) | 0 | ~140,000 | ~65 min | No workflow invoked; `load-project-context` + `hitl` prep steps only. **13 HITL questions across 4 rounds**, 12 doc files updated, zero subagents. Closed the P0 data model gate. Found two contradictions no init phase caught: JS vs TypeScript, and 30-day IP retention vs unbounded `pg_dump`. Still zero lines of application code. |
| 2026-09-04 | `adhoc-flow` — scaffold TypeScript project, `.env.example`, React+Vite client | rosetta | ~70,000 (unreliable — see note) | 160,054 | ~230,000 | ~70 min | First workflow-driven run. Sized SMALL, orchestrator-executed, 2 review subagents. 5 config files, 5 pattern files rewritten, 8 docs synced. Scope grew twice mid-run, both user-approved: 2 pattern files → 5, and static client → React. Two review passes, 160,054 subagent tokens. Review 1 found 2 HIGH defects in a file the orchestrator had edited minutes earlier; review 2 found the server stub exited 0 silently and that no CSP was specified anywhere. 9 findings total, all real, none rejected. |
| 2026-09-08 | Walking skeleton — full `coding-flow` run (design through B3 integration) | rosetta | not separately tracked with the same rigor as subagent figures | ~810,000+ (see breakdown; plan-phase architect rounds not individually totalled) | ~830,000+ | 9-round design gate + 2-round plan gate across 2026-09-05 through 2026-09-08 | First application code in the project. 9 design-review rounds (~40 findings), plan rejected once. Zero genuine code defects found by execution or full-file review; the one real defect (migrate script missing `up`) was only reachable by running it against a real database, which did not exist until this session. See breakdown below. |
| 2026-09-08 | CI + automated code review on GitHub Actions | rosetta | ~107,000 (upper bound — see note) | 0 | ~107,000 | ~20 min | Ops work, counted as evaluation surface per `docs/CONTEXT.md`. No workflow invoked: `load-project-context` + `hitl` prep only, zero subagents. **7 HITL questions across 2 rounds** before any file was written; the first round changed the deliverable (the request could have meant CI checks, an AI reviewer, or static analysis — the user wanted all three). 5 workflow files, 3 docs synced. Action versions and `claude-code-action` inputs were read from the GitHub API rather than recalled. |
| 2026-09-08 | AI reviewer diagnosis — why `claude-review` was green and inert | rosetta | ~30,000 (upper bound — see note) | 0 | ~30,000 | ~20 min | Three throwaway PRs (#6, #7, #8, all closed) to answer one question a green check could not answer: had the AI reviewer ever run? It had not. Two causes, both silent: the action validates its workflow against the **default branch**, which was a stale branch with no Claude workflows; and the generated plugin config hits an open upstream bug (`claude-code-action#1290`). Default branch moved to `develop`, plugin config replaced with a grounded prompt. Still unproven end-to-end — it cannot be proven until it is merged, because the validation compares against the default branch. |
| 2026-09-08 | CI gate validation — negative testing of the checks from PR #3 | rosetta | ~40,000 (upper bound — see note) | 0 | ~40,000 | ~25 min | Validation, not review: six deliberate defects on a throwaway PR proved each check fails at the intended step, then the branch was deleted. Found one real gap no reading had caught — the client artifact is named after the ephemeral `pull_request` merge commit. Cost of the proof: 1 scratch branch, 2 CI runs. |

### Breakdown — init-workspace-flow, 2026-09-04

Started 21:13:00 UTC. Greenfield repo: 2 files in, 20+ files out, zero application code produced.

| Phase | Subagent | Model | Tokens | Duration |
|---|---|---|---|---|
| 1 · context | orchestrator | opus | — | — |
| 2 · shells | *skipped* — plugin mode | — | 0 | 0 |
| 3 · discovery | `discoverer` | haiku | 42,470 | 79 s |
| 4 · rules | *disabled in 3.1.13* | — | 0 | 0 |
| 5 · patterns | `engineer` | sonnet | 61,999 | 96 s |
| 6 · code-graph | orchestrator (HITL) | opus | — | — |
| 7 · documentation | `architect` | opus | 76,169 | 267 s |
| 8 · questions | orchestrator (HITL) + `engineer` | opus / sonnet | 95,106 | 226 s |
| 9 · verification | `reviewer` | sonnet | 69,690 | 86 s |

**Subagent total: 345,434 tokens across 5 subagents, 754 s of subagent execution.** Main thread ~82,000. Combined ~428,000 tokens for 36 minutes of wall clock.

Main-thread figure is derived from the session token counter and includes the pre-workflow briefing conversation, so it overstates the workflow's own cost by roughly 10k.

### Qualitative observations — worth more than the token count

- **Two HITL rounds, 12 questions total**, before a single line of application code. That is the governance cost, paid up front.
- **The Phase 3 subagent self-reported "no conflicts, no gaps"** while shipping a `.gitignore` with no `.env` entry, in a project whose auth rests on a JWT signing secret. Six real gaps existed. Caught by orchestrator review, not by the workflow's own instructions — which did explicitly ask for gaps.
- **Phase 5 and Phase 7 reported honestly**, including rejected work and self-identified weaknesses. Phase 7 found a contradiction between two source documents unprompted. Reporting quality was not uniform across subagents, and appeared to track model capability more than instruction.
- **Phase 7 (Opus architect) produced the highest-value artifact** and found the cost-record gap that this file now closes. Rosetta's structure surfaced it; the structure did not solve it.
- **The workflow assumes brownfield.** Discovery and pattern extraction have nothing to work with in a greenfield repo. Phase 5 correctly refused to fabricate patterns rather than following the phase literally, which required judgement the instructions did not supply.
- **`TodoWrite` was unavailable in this session**, though the bootstrap mandates a task ledger. Fell back to the state file.
- **The independent review gate earned its cost.** Phase 9 (reviewer ≠ implementer) found two real staleness defects that every prior phase had walked past, and justified its no-HIGH verdict by naming the three checks most likely to hide one rather than asserting cleanliness. It still missed a stale `gain.json` placeholder that the orchestrator caught. Layered review reduced defects; it did not eliminate them.
- **Net defect tally for the run:** 6 gaps missed by Phase 3 and caught by orchestrator review; 2 staleness defects caught by Phase 9; 1 missed by Phase 9 and caught by the orchestrator. Every defect was caught by a *different* reviewer than the one who introduced it — which is the actual mechanism, and it is a process property rather than anything specific to Rosetta's content.

### Breakdown — walking skeleton, 2026-09-05 through 2026-09-08

Sized MEDIUM. Design and plan phases ran across multiple sessions with the same architect subagent resumed by name each round (not respawned), so context accumulated rather than being rebuilt — this is why round-9 tokens (~230,000 cumulative for the whole design phase) is much larger than any single round's own work.

| Phase | Subagent | Model | Tokens | Rounds |
|---|---|---|---|---|
| Design | `architect` | opus | ~230,000 cumulative | 9 (1 initial + 8 revisions) |
| Plan (specs+plan authoring) | `architect` | opus | not individually totalled | 3 (initial + 2 revisions across the phase-6 rejection) |
| Plan review (phase 5) | `reviewer` | sonnet | 118,218 | 1 |
| B0 — scaffold, config, patterns | `engineer` | sonnet | 119,842 | 1 |
| B1 — db + server | `engineer` | sonnet | 232,070 | 1 |
| B2 — client | `engineer` | sonnet | 93,417 | 1 |
| B3 — integration, real database | `validator` | sonnet | 134,114 | 1 |

**Subagent total: ~830,000+ tokens**, the "+" because the plan-authoring rounds' individual figures were not captured with the same discipline as every other row — a gap in this session's own record-keeping, not a missing cost. Wall clock spans three calendar days because of two separate HITL gates (design, plan) each requiring the user's own review time between rounds — a cost `docs/EVALUATION-LOG.md`'s own "How to record" section says must not be excluded.

### Qualitative observations

- **The design gate did the opposite of what nine rounds of AI review are supposed to demonstrate.** The orchestrator's own verification pass declared the design sound after rounds 1 through 4. Every substantive defect from round 2 onward was found by the human, not by any AI reviewer — including two factual errors (a nullable-FK safety claim, a TOAST-threshold justification) that survived a full opus authoring pass plus an opus verification pass. The one class of defect the AI side *did* catch twice was the orchestrator's own arithmetic and a wrong claim about library internals, both caught by the same architect subagent pushing back with a measurement rather than complying — which only worked because it was explicitly instructed on the *standard* of evidence to push back with, not merely told to disagree if it disagreed.
- **A process control introduced specifically to catch a known failure pattern produced a false negative on its first real use.** After four consecutive rounds where a fix introduced its own new defect, the orchestrator required a "failure modes introduced by this fix — checked" section. The architect wrote one. Its central claim ("checked for deadlock: none") was false, and the line that falsified it sat 120 lines above the claim in the same document. The control was followed exactly as specified and made things look safer than they were.
- **The migration defect is the cleanest single data point this project has produced on brownfield-vs-greenfield review limits.** Nine rounds of design review, a full server implementation, and a code-quality-focused execution validator all checked the migration *path*, the file *extension*, and the CLI *flag* — genuinely thorough, all correct. None of them ran the command, because no reachable database existed until the final session. The first execution found the defect in the time it took to read the CLI's own help text. This is not a case for "review harder" — it is a category of defect literally unreachable by any amount of reading.
- **Once a real database existed, defect-finding stopped being the bottleneck.** B1 and B2's actual code held up against a full independent file-by-file read, and B3's real end-to-end run (two concurrent clients, a hard kill and restart, direct DB queries at every step) found zero further code defects. The nine-round design gate produced a design that, once built, worked. The expensive part of this feature was converging on a correct design in prose; building and proving it was comparatively cheap and clean.
- **This design-phase cost is a property of this run's rigor, not a fixed tax on "using Rosetta."** A different session, or a less thorough human reviewer, would have produced a cheaper and worse design. When this row is eventually set against the no-Rosetta DM baseline, the honest comparison is total-cost-to-a-working-feature, not per-phase token counts — and even then, the baseline will not have had a human running 9 review rounds against it, so the comparison is already uneven by construction. Flag this explicitly in any write-up rather than letting the raw numbers imply Rosetta itself costs 830,000 tokens per feature.

### Qualitative observations — CI setup, 2026-09-08

- **The whole request was one word of ambiguity: "code review".** It reads unambiguous and is not — it maps to at least three different deliverables (a checks pipeline, an AI reviewer, static analysis). Two HITL rounds settled it in about two minutes and produced all three. An agent that guessed would have had a 1-in-3 chance of building the intended thing.
- **The repository's own history dictated a CI design choice.** The 2026-09-08 migration defect — nine review rounds that read the migration path and never ran it — is the reason the test job stands up a real `postgres:17` and runs `node-pg-migrate` on every PR instead of running only the tests that need no database. The memory file earned its keep here without being consulted as a checklist.
- **Version facts were fetched, not recalled.** Every action major (`checkout@v7`, `setup-node@v7`, `upload-artifact@v7`, `codeql-action@v4`, `dependency-review-action@v5`) and every `claude-code-action` input name came from the GitHub API during the run. Recalled versions would have been plausible and stale — the same failure class as `typescript@latest` in `agents/MEMORY.md`.

## Reminder — the baseline

1:1 direct messaging is reserved as the **no-Rosetta baseline feature** and must not be pre-designed. Its row in this table is the one that makes every other row mean something. Without it there is no finding, only a demo.
