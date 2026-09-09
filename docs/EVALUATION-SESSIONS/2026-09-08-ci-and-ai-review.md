# CI and automated code review — 2026-09-08

**Workflow:** none — `load-project-context` + `hitl` prep skills only · **Size:** SMALL, grew to MEDIUM · **Mode:** rosetta · **Outcome:** PR #3 open against `develop`, all required checks green.

Built the repository's first CI from nothing — it had no `.github/` directory at all, while `gain.json` had named GitHub Actions as build management since day one. Five workflows: quality gate (lint, typecheck, tests against a real PostgreSQL 17, build), CodeQL, dependency review, Claude PR review, and `@claude` on demand.

---

## 1. Cost

**No subagents were used in this chunk.** All orchestrator work, in three recorded units:

| Unit | Main tokens (upper bound) | Wall clock |
|---|---|---|
| CI + code review setup | ~107,000 | ~20 min |
| CI gate validation by negative testing | ~40,000 | ~25 min |
| AI reviewer diagnosis | ~30,000 | ~20 min |

Main-thread figures are upper bounds, not measurements — see `docs/EVALUATION-METHOD.md`. That an entire CI system, its validation, and a non-trivial diagnosis cost less than a *single* subagent batch in the gated-deploy chunk (~113,000–207,000 each) is itself worth noting: orchestrator-direct work is dramatically cheaper than delegated work, and this task did not obviously suffer for it.

---

## 2. HITL gates

7 questions across 2 rounds before any file was written.

| Question | Chosen | Rejected |
|---|---|---|
| What "code review configuration" means | CI quality gate **+** AI reviewer **+** security/static analysis | PR hygiene config (CODEOWNERS, templates, Dependabot) |
| Run Postgres-dependent tests in CI | Yes, `postgres:17` service container | Skip DB tests |
| Which branches | All PRs, any base | Only the then-default branch · main + default |
| Delivery | Feature branch + PR | Commit to current branch · commit without pushing |
| AI reviewer auth | Claude GitHub App | API key secret · decide later |
| AI reviewer trigger | Auto on PR + `@claude` mention | Auto only · mention only |
| Enforcement | Protect the default branch | Advisory only |

**The first question was the load-bearing one.** "Create code review configurations" reads unambiguous and is not — it maps to at least three different deliverables. Two rounds of questions settled it in about two minutes and produced all three. An agent that guessed had roughly a one-in-three chance of building the intended thing.

---

## 3. Defects, and which pass caught each

| # | Defect | Caught by |
|---|---|---|
| 1 | `id-token: write` missing — the action died on an OIDC exchange *before* reaching its credentials | **Running it.** The error named OIDC, not the missing permission |
| 2 | Repository's Dependency graph was disabled, so dependency-review could only ever fail | **Running it** |
| 3 | **The AI reviewer had never reviewed anything, and reported success while doing so.** `claude-code-action` requires its workflow file to match the copy on the *default* branch and exits `success` when it does not; the default branch was a stale one carrying no Claude workflows | **Deliberate probe** — a defect that passes lint and typecheck, plus reading job duration (12 s for a job that must read a diff and call a model) |
| 4 | The vendor-generated workflow cannot run at all — its plugin path hits an open upstream bug (`claude-code-action#1290`), spawning a `claude` binary the installer never creates | **Running it again** after fixing #3 |
| 5 | Ten issues in the new workflow files — `npx` fetching on demand, lifecycle scripts on install, a hardcoded service-container password | **SonarCloud**, which turned out to be already installed on the repository and recorded nowhere |
| 6 | Client artifact named after the ephemeral `pull_request` merge commit, a SHA present in no branch | **Inspection**, during validation |

### The finding that matters most here

**A green check meant nothing, and looked exactly like a green check that meant something.** The `claude-review` job passed on every PR while never once reviewing. Nothing about it looked wrong: green tick, no comments, empty summary — indistinguishable from a clean review. The tell was **duration**, not colour.

Two independent causes stacked: the workflow-validation skip (silent, reports success), and an upstream bug (loud, but only reachable after fixing the first). It took three throwaway pull requests to establish, each carrying a deliberate WebSocket-cleanup defect that passes lint and typecheck — the one bug class `docs/ARCHITECTURE.md` names for this design. The reviewer never saw it.

---

## 4. Validation by deliberate failure

Before trusting the new CI, every check was **made to fail on purpose** on a throwaway PR (#5, closed, branch deleted) — following the ACTIVE rule already in `agents/MEMORY.md`: *prove a config is doing work by making it fail on purpose.*

| Injected defect | Check | Result |
|---|---|---|
| Unused variable | Lint step | failed as intended |
| `const answer: number = 'forty-two'` | Typecheck step, and Build | both failed |
| `assert.equal(1, 2)` | Tests (PostgreSQL 17) | failed |
| Invalid SQL in a third migration | Tests, at the *migrate* step | failed — the step is load-bearing, not decorative |
| Request input concatenated into SQL | CodeQL | `js/sql-injection`, high, correct line |
| `lodash@4.17.15` | Dependency review | failed on 3 high advisories |
| (a draft PR) | Claude review | skipped — the draft guard worked |

Removing the defects returned CodeQL and dependency review to green, proving the failures tracked the diff rather than being constant noise. **Cost: one scratch branch and two CI runs.** This is the cheapest high-value technique the project has found so far, and it settled in minutes what a green run could not settle at all.

---

## 5. Discoveries about the repository itself

- **SonarCloud was already installed** and analysing every PR, recorded in no project document. `gain.json` still lists no security tool. Found only because it failed the new PR.
- **The default branch was a stale `docs/data-model-approval`**, not `develop` where work actually merged — which is what silently disabled the AI reviewer. Changed to `develop`.
- **Branch protection did not exist.** Added, requiring the three CI jobs plus CodeQL, admins exempt.
- **A coupling was created and recorded**: the deploy workflow's CI-precondition step matches CI job names as exact strings, and those same strings are the required status checks in branch protection. Renaming a CI job silently breaks the merge gate and the deploy gate at once, neither loudly.

---

## 6. Carried forward

**Into `agents/MEMORY.md`** — a third-party action that skips itself still reports SUCCESS; verify by wall-clock and by artifact, never by colour alone.

**Still open** — the AI reviewer has *still* never demonstrably reviewed anything. The fix (default branch corrected, plugin config replaced with a grounded prompt) cannot be observed working until it merges, because the action validates against the default branch. `docs/TODO.md` carries this as the first check to run on the next PR that touches no workflow file.
