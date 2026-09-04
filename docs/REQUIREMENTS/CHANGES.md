# REQUIREMENTS — CHANGES

Changelog for `docs/REQUIREMENTS/`. One entry per change, newest first.

## 2026-09-04 — data model review — REQ-MOD-002 and REQ-MOD-003 corrected [DRAFT, awaiting approval]

Both requirements were left contradicting the data model approved the same day, so their tests would have passed against a wrong implementation.

- **REQ-MOD-002**: "ban the user who authored it" → prevent the author participating, by `users.banned_at` for a registered author or a time-limited `bans` row for a guest. Guests have no account to ban.
- **REQ-MOD-003**: "no longer retrievable after 30 days" → the IP is erased after 30 days and the message is retained; no copy, backups included, may outlive the window.

No requirement was added or removed; only the statement and testable-as of two existing units changed. Full `requirements-authoring-flow` still runs per feature when moderation is actually built.

## 2026-09-04 — Phase 8 (init-workspace-flow) — initial capture

**[USER-DECIDED]** Created `docs/REQUIREMENTS/` with `INDEX.md` holding the four launch-blocking moderation gates as atomic requirements (REQ-MOD-001 through REQ-MOD-004), sourced from `docs/CONTEXT.md`'s "Moderation floor" section. No requirements beyond these four were added.

Full `requirements-authoring-flow` (drafting, review, user-approval validation) is deferred to run later, per feature, as each feature is actually built.
