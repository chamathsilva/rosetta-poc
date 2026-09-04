# Evaluation Log

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

## Reminder — the baseline

1:1 direct messaging is reserved as the **no-Rosetta baseline feature** and must not be pre-designed. Its row in this table is the one that makes every other row mean something. Without it there is no finding, only a demo.
