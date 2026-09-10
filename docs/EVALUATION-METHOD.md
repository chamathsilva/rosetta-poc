# Evaluation Method — how Rosetta evidence is captured and retrieved

**This file is the entry point for the evaluation.** It says where every kind of evidence lives, how it gets there, and how to find it later. `docs/CONTEXT.md` states the evaluation is the deliverable and the chat app is the vehicle — so losing evidence is losing the product, not losing notes.

Read this first; then go to whichever layer answers your question.

---

## The four layers, and which question each answers

| Layer | File | Answers | Written when | Style |
|---|---|---|---|---|
| **Method** | `docs/EVALUATION-METHOD.md` (this file) | "Where is anything, and how did it get there?" | When the process changes | Protocol |
| **Cost ledger** | `docs/EVALUATION-LOG.md` | "What did each unit of work cost?" | As the work happens, append-only | One row per unit + breakdowns |
| **Session records** | `docs/EVALUATION-SESSIONS/*.md` | "What actually happened in that chunk, in detail?" | At chunk close, before context is lost | Raw, dated, evidence-first |
| **Synthesis** | `docs/EVALUATION-FINDINGS.md` | "What does it all mean?" | Periodically, and before the write-up | Thematic, cross-run, argued |

Two supporting files carry evaluation-relevant material as a by-product, and must not be duplicated into the layers above:

- `agents/MEMORY.md` — generalized preventive rules. The transferable form of a finding. **The rule belongs here; the incident belongs in a session record.**
- `agents/IMPLEMENTATION.md` — the only changelog. What shipped, when. Cite it; do not restate it.

---

## The capture protocol — what to do, and when

### At the start of a work chunk
1. Note the UTC start time. Wall clock is not reconstructable afterwards.
2. Create the working ledger at `agents/TEMP/<FEATURE>/coding-flow-state.md` as the workflow requires.
3. **Know that `agents/TEMP/` is gitignored.** It is scratch. Nothing there survives.

### While the chunk runs — capture at the moment, not afterwards
Record these *when they occur*, because each is unreconstructable once the transcript is gone:

- **Every subagent's reported token count**, against its role and round. These arrive once, in a completion notification, and exist nowhere else.
- **Every HITL gate: the options offered, the one chosen, and the ones rejected.** The rejected options are the evidence that a decision was a decision. A file that records only the outcome cannot show that alternatives existed.
- **Every defect, and which pass caught it** — authoring, review, validation, execution, or the human. This is the single most important measurement in the project: it is what distinguishes a workflow that catches things from a workflow that merely has stages.
- **Every deviation from the workflow, and why.** Including model substitutions, skipped phases, and interruptions (rate limits, failures).
- **Anything a subagent reported that turned out to be wrong.** Self-reports that survive unverified are a recurring failure mode here.

### At chunk close — the promotion step
**This is the step that prevents context loss, and it is the one most likely to be skipped.**

1. Write `docs/EVALUATION-SESSIONS/YYYY-MM-DD-<slug>.md` from the working ledger, the transcript, and the subagent reports — using the template at the bottom of this file.
2. Add or complete the row in `docs/EVALUATION-LOG.md`. Mark incomplete figures as incomplete; never backfill an estimate to make a row look tidy.
3. Promote any generalized rule into `agents/MEMORY.md`. The session record keeps the incident; memory keeps the rule.
4. Commit. **A session record that is not committed has not been captured** — the working ledger it came from is gitignored.
5. Only then let `agents/TEMP/<FEATURE>/` be discarded.

### Periodically, and always before the write-up
Update `docs/EVALUATION-FINDINGS.md` — the synthesis across sessions. It argues; the session records only report.

---

## How to retrieve, later

Start here, then:

- **"What did X cost?"** → `docs/EVALUATION-LOG.md`, rows table, then its per-chunk breakdowns.
- **"What happened during X?"** → `docs/EVALUATION-SESSIONS/`, filed by date and slug. Index below.
- **"What did we conclude?"** → `docs/EVALUATION-FINDINGS.md`.
- **"What should an agent not repeat?"** → `agents/MEMORY.md`.
- **"What shipped, and when?"** → `agents/IMPLEMENTATION.md`.
- **"Why is the code like this?"** → `docs/ARCHITECTURE.md` for decisions with reasons; `plans/<FEATURE>/` for the design and specs of a specific chunk.
- **"What was decided but not built?"** → `docs/TODO.md` and `docs/ASSUMPTIONS.md`.

### Session index

| Date | Session record | Chunk |
|---|---|---|
| 2026-09-08 | `2026-09-08-ci-and-ai-review.md` | GitHub Actions CI, CodeQL, dependency review, and the AI code reviewer that was green and inert |
| 2026-09-08/09 | `2026-09-08-gated-deploy.md` | Gated deploy preparation: trusted-proxy client IP, retention task, Caddy/systemd, deploy workflow, runbook |

Earlier chunks (workspace init, scaffold, walking skeleton) predate this structure. Their evidence lives in `docs/EVALUATION-LOG.md`'s breakdowns and `docs/EVALUATION-FINDINGS.md`; they have no session record and should not be retrofitted with an invented one.

---

## Known gaps in the evidence — state them, do not quietly carry them

These are limits on what the evaluation can honestly claim. Keep this list current.

1. **Main-thread token counts are upper bounds, not measurements.** The session counter resets each user turn, so only within-turn deltas are usable and they double-count re-read context. Subagent figures are exact; orchestrator figures are not.
2. **A resumed subagent reports cumulative tokens, not per-round.** Summing every reported figure for a resumed agent double-counts. Session records must say which figures are cumulative.
3. **Tokens consumed by a subagent that dies mid-run are never reported.** Two agents were killed by a rate limit on 2026-09-09; their spend is real and unrecorded.
4. **No no-Rosetta baseline exists yet.** Every figure here characterizes Rosetta's own process. **There is no comparison.** 1:1 DM is the reserved baseline feature and must not be pre-designed — see `docs/CONTEXT.md`.
5. **The human reviewer is not a constant.** Rounds where the user found defects reflect that user's attention on that day. A different reviewer produces different numbers, and the design-phase costs in particular are a property of this run's rigor, not a fixed tax on the tool.
6. **This is greenfield.** Rosetta's marketed "2x" claim is about brownfield work. Do not report against it.

---

## Session record template

Copy this into a new `docs/EVALUATION-SESSIONS/YYYY-MM-DD-<slug>.md`.

```markdown
# <Chunk name> — <dates>

**Workflow:** <which, or "none — prep skills only"> · **Size:** <SMALL/MEDIUM/LARGE> · **Mode:** rosetta | baseline

## What was built
## Cost
## HITL gates — offered, chosen, rejected
## Defects, and which pass caught each
## Deviations, interruptions, and process failures
## What only execution could have found
## Carried forward
```

**The "which pass caught it" column is the point.** A defect table that does not say who caught what cannot support any claim about whether the workflow works.
