# rosetta-poc

A guest-and-registered web chat application, built as the vehicle for an **evaluation of [Rosetta](https://github.com/griddynamics/rosetta)** — an instruction layer for AI coding agents.

**The evaluation is the deliverable. The chat app is the vehicle.**

No application code exists yet. See `agents/IMPLEMENTATION.md` for actual state.

## Where things are

| Read this | For |
|---|---|
| `docs/CONTEXT.md` | What the product is, who uses it, the staged-launch model, and the evaluation guardrails |
| `docs/ARCHITECTURE.md` | Architecture, data model, deployment topology, and the rejected alternatives with reasons |
| `docs/TECHSTACK.md` | Chosen technologies |
| `docs/DEPENDENCIES.md` | Packages and infrastructure components |
| `docs/CODEMAP.md` | Intended repository layout |
| `docs/PATTERNS/INDEX.md` | Prescribed coding conventions the first code must follow |
| `docs/ASSUMPTIONS.md` | Open decisions and unverified inferences |
| `docs/TODO.md` | Unstarted work, by priority |
| `agents/IMPLEMENTATION.md` | Implementation state and the only changelog |
| `agents/MEMORY.md` | Lessons from prior agent sessions |
| `POC-BRIEF.md` | The pre-Rosetta human record. **Partly stale by design** — `docs/ARCHITECTURE.md` states what supersedes it. Do not edit it. |

## Two constraints worth knowing before you touch anything

- **1:1 direct messaging must not be pre-designed.** It is reserved as the without-Rosetta control baseline. See `docs/CONTEXT.md`.
- **The architecture is already decided and researched.** Transcribe it; disagreement goes to `docs/ASSUMPTIONS.md`, never into a silent change.

## Git

This repo uses the `chamath` SSH host alias deliberately (`git@chamath:chamathsilva/rosetta-poc.git`). Do not "fix" the remote to `git@github.com:...` — that authenticates as the wrong user.
