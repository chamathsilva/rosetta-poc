# Gated deploy — 2026-09-08 into 2026-09-09

**Workflow:** `coding-flow` · **Size:** MEDIUM · **Mode:** rosetta · **Outcome:** code complete, committed, unmerged; nothing provisioned; the provisioning gate (G4) is where it stops.

Prepared the walking skeleton's first real deployment: trusted-proxy client-IP extraction, a data-retention task, Caddy and systemd configuration, a `workflow_dispatch` deploy workflow, and a 16-step runbook the repository owner executes. Design in `plans/gated-deploy/architecture-notes.md`; contract in `GATED-DEPLOY-SPECS.md` (84 acceptance criteria); execution in `GATED-DEPLOY-PLAN.md` (9 batches, 5 gates).

---

## 1. Cost

**Subagent total: ~1,853,000 tokens across 12 completed runs**, plus two runs killed mid-flight whose spend is real and unreported.

| Phase | Role | Model | Tokens | Note |
|---|---|---|---|---|
| Discovery | `discoverer` | sonnet | 129,705 | |
| Design → specs → plan → corrections | `architect` | opus | 223,295 | **Cumulative across 3 runs**, one of which died at a rate limit after writing its file |
| Plan review | `reviewer` | sonnet | 167,346 | |
| B1 client-IP extractor | `engineer` | sonnet | 113,148 | |
| B2 wiring + loopback bind | `engineer` | sonnet | 98,867 | |
| B3 retention task | `engineer` | sonnet | 151,366 | **Cumulative across 2 runs** (initial + defect fix) |
| B4 Caddy + systemd | `engineer` | sonnet | 115,608 | |
| B5 deploy workflow | `engineer` | sonnet | 140,532 | |
| B6 runbook | `engineer` | sonnet | 148,054 | |
| B7 documentation | `engineer` | sonnet | 206,870 | Largest single batch |
| Code review | `reviewer` | sonnet | 189,889 | Second attempt; first killed by rate limit |
| Validation | `validator` | sonnet | 168,725 | Second attempt; first killed by rate limit |

**Caveats that make this number softer than it looks**, per `docs/EVALUATION-METHOD.md`:

- Resumed agents report **cumulative** tokens. Summing every reported figure would double-count; the table already collapses each resumed agent to its final figure.
- The two rate-limited runs consumed real tokens and reported none.
- Orchestrator (main-thread) cost is **not** included and is not reliably measurable.
- Wall clock spans two calendar days, but includes an overnight rate-limit wait, not two days of work.

**For comparison, from `docs/EVALUATION-LOG.md`:** the walking skeleton — the feature this one deploys — cost ~830,000 subagent tokens. Preparing to deploy it cost roughly **2.2×** what building it did. That ratio is the most interesting number this chunk produced, and it deserves care in the write-up: it is not evidence that deployment is intrinsically expensive, it is evidence that *this* run bought a lot of review, and review is where the defects were found.

---

## 2. HITL gates — what was offered, chosen, and rejected

12 questions across 4 rounds. Rejected options are recorded because a decision with no visible alternatives cannot be shown to have been a decision.

| Question | Chosen | Rejected |
|---|---|---|
| Who drives the droplet | Owner provisions, session prepares | Agent drives over SSH · prepare-only, provision later |
| Process weight | Full `coding-flow` with gates | Lighter `adhoc-flow` · split code/infra |
| How a build reaches the host | GitHub Actions over SSH | Local deploy script · droplet pulls |
| Deploy trigger | `workflow_dispatch` only | Every merge to `develop` · on a git tag |
| Hostname | DuckDNS subdomain | Existing real domain · decide at provisioning |
| Migrations | Automatic, before restart | Separate manual step |
| **Design gate** | **"Yes, I reviewed the design"** | Approve but consume CI artifact · hold for feedback |
| Retention eraser in scope | Yes, ship with this chunk | Keep out of scope |
| Deploy downtime | Accept brief downtime | Keep service up during migration |
| `bans` table handling | Guard the statement, no-op | Land the moderation migration now |
| Retention worst case | Accept ≤31 days | Tighten cutoff to guarantee ≤30 |
| **Plan gate** | **"Yes, I reviewed the plan"** | Hold for feedback |

**Two of these changed the deliverable materially.** The retention eraser was added at the design gate and was not in the original request — it is the component that then produced the chunk's most serious defect. And the design departed from the stated brief: the user asked for a workflow *consuming the CI artifact*, and the architect argued for rebuilding on the runner instead, because `workflow_dispatch` is ref-centric while artifact reuse is run-centric. That departure was surfaced, argued, and explicitly approved rather than absorbed.

---

## 3. Defects, and which pass caught each

**This is the table the evaluation exists to produce.**

| # | Defect | Caught by | Passes that missed it |
|---|---|---|---|
| 1 | **Retention job would fail every run, forever, silently.** Three statements in one transaction; statement 2 references `bans`; no migration creates it; Postgres aborts the whole transaction, so `messages.ip` is never erased while the unit reports success | **Plan review** (subagent) | Design authoring, specs authoring, plan authoring — 3 passes |
| 2 | **Rollback undefined on the first deploy** — nothing exists to flip back to, and the first deploy is exactly the next action | **Plan review** | Design authoring |
| 3 | No failure-table row for a failed stop or a failed flip | **Plan review** | Design authoring |
| 4 | "Six existing tests" — there are seven | **Plan review** | Discovery → arch-notes → plan, unverified at each hop |
| 5 | An acceptance criterion asserted a retention bound the same document flagged as open | **Plan review** | Specs authoring |
| 6 | A criterion checked at a runbook step where it passes vacuously | **Plan review** | Specs authoring |
| 7 | Status block contradicted its own dependency table | **Plan review** | Plan authoring |
| 8 | **The release could not boot.** `dist/db` never copied, though the server imports from it and a systemd unit targets it directly | **Validation**, by reconstructing the release tree and running it | Design, specs, plan, plan review, B5 authoring, code review — 6 passes |
| 9 | **Rollback's own flip-back was unguarded** while the primary flip three lines away was guarded; under `set -euo pipefail` it dies silently on the one path that exists for when everything else failed | **Code review**, reading it as a shell reader | B5 authoring, validation |
| 10 | `agents/IMPLEMENTATION.md` claimed both trust-rule mutations produced 5 failures; one produces 6 | **Code review**, by mutating the code itself | Orchestrator (wrote it), B7 |
| 11 | A retention test could never have passed — fixture teardown violated a foreign key | **Orchestrator**, running the suite against a real database | B3, which reported it as "written, unproven locally" |
| 12 | B3 concluded no database was reachable from missing `psql`/`docker`, while Postgres was listening and credentials sat in `.env` | **Orchestrator**, checking the I/O path the code actually uses | B3 |
| 13 | File-ownership table's `docs/*.md` glob swallowed another batch's exclusively-owned file | **Orchestrator**, before dispatch | Plan authoring, **and plan review — which explicitly verified "no path appears twice"** |
| 14 | A correction instruction named a location that never contained the error it was correcting | **Orchestrator**, applying it | Plan authoring |
| 15 | `build:server`'s test-artifact cleanup covered only `dist/server`, so `dist/db/*.test.js` would ship once #8 was fixed | **Validation** | All prior passes |
| 16 | Dead array-handling branch and a comment wrong about Node's header behavior | **Code review**, verified against a live `http.Server` | B1, orchestrator |
| 17 | `docs/TECHSTACK.md` used an undeclared third status value, inconsistently | **Code review** | B7 |

### What this table says

- **Independent review found what authoring could not, repeatedly.** Seven defects came from the plan review alone, before a line of code existed. Three authoring passes had written past #1.
- **Execution found what all reading missed.** #8 survived six passes of people reading files, and died in seconds the moment someone assembled the release and ran it. This is the second time this project has produced that exact result — the walking skeleton's missing migration verb was the first.
- **Review of review works.** #10 and #13 are defects *in the review layer itself* — a wrong number in a document describing a verification, and a collision the reviewer had explicitly checked for and cleared.
- **A checked box is not a check.** #13 is the sharpest instance: the reviewer verified "no path appears twice" and was correct about the literal strings, while the glob overlap made it false in effect.
- **Four defects (#1, #4, #13, #14) share one shape** — a claim true as written and false in fact, because the check and the claim were looking at different things. Generalized into `agents/MEMORY.md`.

---

## 4. Deviations, interruptions, and process failures

- **Rate limit killed three subagent runs.** The architect died after writing its design file (work preserved); the code reviewer and validator both died mid-run and were relaunched the next morning. Both were read-only, and `git status` confirmed a clean tree — but their token spend is unrecorded.
- **The plan's own escalation trigger did not fire.** B3's notes said "stop-and-report if the `bans` question changes scope." The same authoring pass that wrote that instruction then implemented around the gap it existed to catch. A written escalation condition is not evidence that escalation occurred.
- **The orchestrator fenced a batch off from its own assigned work.** B7's plan items included files under `plans/**`, which the dispatch prompt excluded. B7 flagged the conflict rather than overreaching or silently dropping the work; the orchestrator completed those items directly.
- **A workflow instruction was deliberately not followed.** The `planning` skill prescribes per-session files plus a `HANDOFF.md`; two files were requested instead, appropriate to MEDIUM size. Recorded in the plan's header rather than left implicit.
- **A subagent's scratch output broke the build tooling.** A validator's release reconstruction under gitignored `agents/TEMP/` made `npm run lint` fail on a minified bundle. Harmless to any commit, fixed by widening the eslint ignore list.

---

## 5. What only execution could have found

Five things in this chunk were unreachable by any amount of reading:

1. `dist/db` missing from the release — `ERR_MODULE_NOT_FOUND`, reproduced twice.
2. The retention guard's necessity — removing it fails 8 named tests with Postgres `42P01`.
3. The client-IP trust rule's teeth — inverting it fails 5 tests one way, 6 the other.
4. A test fixture that could never pass — foreign-key violation on teardown.
5. Node never produces an array for `x-forwarded-for` — verified against a live `http.Server`, contradicting a comment that had been written from the TypeScript type.

Every one of these was cheap to run and none was found by reading. The pattern is now consistent enough across this project to state plainly: **in this codebase, execution and inspection find disjoint defect sets, and inspection is the one that produces false confidence.**

---

## 5a. A third-party analyser caught what two AI passes missed — PR #9, 2026-09-09

Worth recording because it cuts against the rest of this chunk's story.

After code review and validation had both run, passed, and had their findings fixed, **SonarCloud flagged a MAJOR security issue neither had raised**: `${{ secrets.DEPLOY_SSH_KEY }}` interpolated directly into a `run:` block. GitHub substitutes `${{ }}` into the shell script's *source text* before bash parses it, so a value carrying newlines or shell metacharacters can alter the script — and an SSH private key is multi-line by definition. Fixed by passing it through `env:`, where it is only ever data.

Both AI passes read that exact file. The code reviewer specifically walked the deploy workflow's failure paths line by line as a shell reader and found a different real defect there (the unguarded rollback flip-back). Neither flagged the secret expansion.

**The finding:** a cheap, deterministic, rule-based analyser contributed something that two thorough LLM passes did not — on a known, catalogued vulnerability class with a fixed shape. That is the kind of defect pattern-matching is *better* at than reasoning. It argues for keeping conventional static analysis in the loop rather than treating AI review as a superset of it.

**The counter-observation, for honesty:** of SonarCloud's 10 findings on that PR, 1 was this real issue, 1 was a style preference declined with reasons, 1 was a deliberate documented decision flagged as a hotspot, and 6 were false positives triggered by comments that reference `docs/TODO.md` by name. A 10% true-positive rate on a real finding is still worth it at this price — but the signal-to-noise is the opposite shape from the AI reviews, which produced few findings and almost all real.

## 5b. A merge landed one commit behind the fix it was meant to include — 2026-09-10

**PR #9 merged at commit `ccaa26c`, one commit before `131d044`** — the commit that fixed all five blocking findings the human reviewer raised at the G4 gate in section 5a's aftermath. The merge event's timestamp (05:36:10 UTC) predates the fix commit's own timestamp (05:43:25 UTC), so whatever triggered the merge used a HEAD that was already stale by the time it executed — most plausibly a merge action taken against a page or CLI state that had not yet observed the final push.

**The orchestrator's advice in the prior turn had already told the user to re-review the runbook diff before merging.** That advice was sound and was overtaken by events anyway: the merge happened before the fix was even fully in view, not after a review that missed it. No review layer failed here — a sequencing race did.

**Caught by**, in order: the user reporting "PR is merged, check it" rather than assuming silence meant success; then a direct diff of `develop`'s file against both the pre-fix and post-fix commits, which showed `develop`'s runbook byte-identical to the *pre-fix* version. Not caught by any CI check, because the merged content was internally valid — it was simply the wrong, already-superseded version. **A green CI run on a merge cannot tell you the merge included what you meant it to.**

**Fixed** by a new PR (#10) containing exactly the missing commit, verified as a clean, conflict-free, single-commit diff before opening it (`git merge-tree`).

**The transferable point:** "the PR merged" and "the PR's latest reviewed content merged" are different claims, and the gap between them is invisible to every check that runs *inside* the merged commit. The only way to catch it is to diff the destination branch against the specific commit you believe was merged, not against the PR number.

## 6. Carried forward

**Into `agents/MEMORY.md`** — a flag that does not escalate is not a control · absence of the tools you expected is not absence of the capability · a claim that rides between documents without re-verification is how a wrong number survives three passes · a third-party action that skips itself still reports success.

**Still open**, and named honestly rather than closed optimistically. Nothing is deployed, so 31 of 84 acceptance criteria await a droplet. Precisely on retention: **the task covers the current schema completely** — `messages.ip` erasure and guest reaping both run; the `bans.ip` statement is *intentionally dormant* because the `bans` table does not exist, and it is guarded so its absence cannot abort the rest. That is a designed no-op, not a shortfall. Also open: no backups; no monitoring or alerting; **no patching or unattended-upgrade policy**; **no log-retention control** (journald's default rotation is a disk policy, not the 30-day privacy promise); no rate limiting; **no registered, owner-controlled domain** — DuckDNS provides a real, working hostname, but the published abuse contact needs one the owner controls; the capacity ceiling is unmeasured. All from arch-notes §11. See `docs/TODO.md`.

**The comparison that would give all of this meaning still does not exist.** 1:1 DM remains the reserved no-Rosetta baseline. Until it runs, every number here describes Rosetta's process without measuring it against anything.
