# REQUIREMENTS — INDEX

**[USER-DECIDED]** Requirements captured here so far are limited to the four launch-blocking moderation gates identified in `docs/CONTEXT.md` ("Moderation floor — non-deferrable before anonymous public access"). Nothing else is in scope.

Each requirement is atomic and testable. Full `requirements-authoring-flow` (drafting, review, validation with user approval) runs later, **per feature**, as each feature is actually built — this index is a placeholder capture of the four gates, not a substitute for that process.

Do not add requirements beyond the four below without running `requirements-authoring-flow`.

## Moderation floor requirements

| ID | Requirement | Source |
|---|---|---|
| REQ-MOD-001 | Report button available to users on user-generated content. | `docs/CONTEXT.md` — Moderation floor |
| REQ-MOD-002 | Admin capability to remove content and ban a user. | `docs/CONTEXT.md` — Moderation floor |
| REQ-MOD-003 | IP address + timestamp logging on user-generated content, retained for 30 days. | `docs/CONTEXT.md` — Moderation floor; retention period decided Phase 8 |
| REQ-MOD-004 | A published, genuine, stable abuse contact address. | `docs/CONTEXT.md` — Moderation floor; requires a real registered domain (`docs/ARCHITECTURE.md`) |

### REQ-MOD-001 — Report button

- **Statement**: Any user-generated content visible to a user MUST offer a control to report it.
- **Testable as**: Given a message in a room, when a user invokes the report control on it, then a report record is created (see `moderation_actions`/`reports` DRAFT schema in `docs/ARCHITECTURE.md`, pending human review).
- **Non-deferrable** before anonymous public access opens.

### REQ-MOD-002 — Admin remove-and-ban

- **Statement**: An admin identity MUST be able to remove a specific piece of user-generated content and ban the user who authored it, in one moderation action or two auditable ones.
- **Testable as**: Given an admin session, when the admin acts on a reported message, then the content is removed (soft-delete) and the authoring user is banned from further access.
- **Non-deferrable** before anonymous public access opens.

### REQ-MOD-003 — IP + timestamp logging, 30-day retention

- **Statement**: Every user-generated content submission MUST be logged with the submitting IP address and a timestamp. Logged records MUST be retained for exactly 30 days and not indefinitely.
- **Testable as**: Given a submission, when it is stored, then an IP + timestamp record exists; given a record older than 30 days, then it is no longer retrievable.
- **Non-deferrable** before anonymous public access opens.

### REQ-MOD-004 — Published abuse contact address

- **Statement**: A genuine, stable abuse-contact address MUST be published and reachable by the public before anonymous access opens.
- **Testable as**: Given the public-facing site, when a user looks for an abuse contact, then a working contact address is visible. Depends on a real registered domain (`docs/ARCHITECTURE.md` — Domain).
- **Non-deferrable** before anonymous public access opens.
