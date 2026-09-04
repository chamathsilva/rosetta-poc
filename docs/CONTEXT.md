# CONTEXT

Business context, product behavior, and target state. Stakeholder perspective.
No technology (see `docs/ARCHITECTURE.md`, `docs/TECHSTACK.md`). No changelog (see `agents/IMPLEMENTATION.md`).
Style: bulleted, terse, grep-friendly headers.

Provenance is marked per section: **[USER-DECIDED]** = stated by the user or `POC-BRIEF.md`. **[AI-INFERRED]** = derived by an agent, unverified.

## This repo has two subjects

**[USER-DECIDED]**

- Subject 1: a chat product, built for real public use.
- Subject 2: an **evaluation of Rosetta** (`griddynamics/rosetta`, an instruction layer for AI coding agents), conducted by building subject 1 through its workflows.
- **The evaluation is the deliverable. The chat app is the vehicle.** A session that optimizes only the app has lost the point.

## Product

**[USER-DECIDED]**

- A [chatib.us](https://www.chatib.us/)-style web chat application.
- Guest access: join with a nickname alone — no password, no persistent account, ephemeral session.
- Registered accounts: durable identity with credentials; can be created fresh or upgraded in place from an active guest session, preserving nickname and room membership.
- Multi-room public chat with a live presence roster.
- 1:1 direct messaging (see reservation below — it is scope, but must not be pre-designed).
- **Minimum feature set. YAGNI is binding.** No feature beyond this list is in scope.

## Users

**[AI-INFERRED — not stated explicitly in any source; verify in Phase 8]**

- Anonymous strangers on the public internet, arriving with no prior relationship to the product or each other.
- A returning subset who register to keep a nickname and identity.
- One operator/admin (the project owner) who moderates and runs the infrastructure.

## Staged launch — "deployed" is not "public"

**[USER-DECIDED — supersedes `POC-BRIEF.md`]**

- The product **will be publicly launched to real strangers**, not left as a demo.
- Launch is staged, and the distinction is load-bearing:
  - **Gated launch** — deployed, reachable, real infrastructure, but closed to strangers behind **Caddy basic auth**, enforced in the reverse proxy, above the application (no application code). **[USER-DECIDED]** Removing it at public launch is a config change. This is the state for the walking skeleton and every phase before moderation ships.
  - **Public launch** — anonymous open access. Opens **only after** rate limiting and the minimum moderation set are live.
- Do not treat "it is deployed" as permission to open anonymous access.

## Moderation floor — non-deferrable before anonymous public access

**[USER-DECIDED]**

- Report button available to users on user-generated content.
- Admin capability to remove content and ban a user.
- IP address + timestamp logging, retained for **30 days**. **[USER-DECIDED]** The retention promise covers backups too — database dumps are capped at 30 days so none outlives the data it holds. **[USER-DECIDED — 2026-09-04]**
- A published abuse contact address.
- Heavier trust-and-safety tooling may follow later. These four may not.

## Evaluation guardrails — protect these

**[USER-DECIDED — from `POC-BRIEF.md` "Evaluation guardrails"]**

- **One feature is built WITHOUT Rosetta, as a control baseline.** This is the step people skip. Without it there is no finding, only a demo.
- **1:1 private messaging is reserved as that baseline feature and MUST NOT be pre-designed.** Guest entry and the architecture were designed outside Rosetta; using them as the baseline would bias the comparison. Do not write DM specs, schema, endpoints, or plans until the baseline run.
- **Record token cost and wall-clock time per feature as the work happens.** It cannot be reconstructed afterwards. Recorded in `docs/EVALUATION-LOG.md` (append-only, one row per feature). **[USER-DECIDED]**
- **The "2x productivity" claim Rosetta markets is about brownfield work.** This POC is greenfield, so it tests workflow discipline and consistency — not that claim. Do not report against it.
- **Ops and deployment work counts as evaluation surface, not setup noise.** Rosetta claims to govern the SDLC; infra is inside that claim. Record how it handles TLS, systemd, backups, firewall, patching.
- The architecture was researched and decided before Rosetta was activated. Transcribe it; do not re-derive, re-litigate, or "improve" it. Disagreement goes to `docs/ASSUMPTIONS.md` as an open question, never into a silent change.

## Target state

**[AI-INFERRED from `POC-BRIEF.md` "Plan" — sequencing is the brief's; the phrasing is not]**

1. Walking skeleton: guest nickname + join + send + receive in one room, deployed to real infrastructure behind the gate.
   **Messages are persisted from day one** — the skeleton proves the full path including PostgreSQL, not a memory-only slice. **[USER-DECIDED — 2026-09-04]**
   The data model is reviewed and approved (`docs/ARCHITECTURE.md`). The migration-tool choice and the first-admin bootstrap still block this step. See `docs/TODO.md`.
2. Multi-room + presence roster.
3. Accounts: registration, login, guest→registered upgrade.
4. 1:1 DM — **built as the no-Rosetta baseline**.
5. Rate limiting + the moderation floor.
6. Open anonymous public access.
7. Write up the evaluation: consistency, token/time overhead, whether plan→HITL→review caught anything real, whether generated docs stayed accurate as code changed.

## Constraints on this repo

**[USER-DECIDED]**

- Do not modify `POC-BRIEF.md` — it is the pre-Rosetta record and its staleness is itself evidence.
- Corrections that supersede `POC-BRIEF.md` live here and in `docs/ARCHITECTURE.md`, not by editing the brief.

MUST USE SKILL CODEMAP AND typescript-lsp FOR CODE NAVIGATION
