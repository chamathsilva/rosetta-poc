# REQUIREMENTS — INDEX

**[USER-DECIDED]** Requirements captured here so far are limited to the four launch-blocking moderation gates identified in `docs/CONTEXT.md` ("Moderation floor — non-deferrable before anonymous public access"). Nothing else is in scope.

Each requirement is atomic and testable. Full `requirements-authoring-flow` (drafting, review, validation with user approval) runs later, **per feature**, as each feature is actually built — this index is a placeholder capture of the four gates, not a substitute for that process.

Do not add requirements beyond the four below without running `requirements-authoring-flow`.

## Moderation floor requirements

| ID | Requirement | Source |
|---|---|---|
| REQ-MOD-001 | Report button available to users on user-generated content. | `docs/CONTEXT.md` — Moderation floor |
| REQ-MOD-002 | Admin capability to remove content and prevent the author participating (account ban or IP ban). | `docs/CONTEXT.md` — Moderation floor |
| REQ-MOD-003 | IP address + timestamp logging on user-generated content; IP erased after 30 days, backups included. | `docs/CONTEXT.md` — Moderation floor; retention period decided Phase 8 |
| REQ-MOD-004 | A published, genuine, stable abuse contact address. | `docs/CONTEXT.md` — Moderation floor; requires a real registered domain (`docs/ARCHITECTURE.md`) |

### REQ-MOD-001 — Report button

- **Statement**: Any user-generated content visible to a user MUST offer a control to report it.
- **Testable as**: Given a message in a room, when a user invokes the report control on it, then a report record is created (see the approved `reports` table in `docs/ARCHITECTURE.md`).
- **Non-deferrable** before anonymous public access opens.

### REQ-MOD-002 — Admin remove-and-ban

- **Status**: **Draft — corrected 2026-09-04 to match the approved data model. Awaiting explicit approval.**
- **Statement**: An admin identity MUST be able to remove a specific piece of user-generated content and prevent its author from continuing to participate, in one moderation action or two auditable ones.
- **Testable as**: Given an admin session, when the admin acts on a reported message, then the content is soft-deleted (`messages.deleted_at` is set) and the author is prevented from participating — a registered author via `users.banned_at`, a guest author via a time-limited row in `bans` keyed on the IP recorded with the message. Given the banned party attempts to rejoin, then access is refused while the ban is active.
- **Why corrected**: the prior wording said "ban the user who authored it". Guests are most of the population and are banned by IP, not by account, so the prior test would have passed against a mechanism that does not stop a guest.
- **Non-deferrable** before anonymous public access opens.

### REQ-MOD-003 — IP + timestamp logging, 30-day retention

- **Status**: **Draft — corrected 2026-09-04 to match the approved data model. Awaiting explicit approval.**
- **Statement**: Every user-generated content submission MUST be logged with the submitting IP address and a timestamp. The IP address MUST be erased after 30 days, and no copy of it — database backups included — may outlive that window. The message itself is retained.
- **Testable as**: Given a submission, when it is stored, then `messages.ip` and `messages.created_at` are populated. Given a message row older than 30 days, then `messages.ip` is NULL and the message is still retrievable. Given the backup set, then no dump older than 30 days exists.
- **Why corrected**: the prior wording said the record "is no longer retrievable" after 30 days, which the approved design contradicts — the message survives and only the IP is erased. The prior wording also ignored backups, which is where the retention promise actually breaks.
- **Non-deferrable** before anonymous public access opens.

### REQ-MOD-004 — Published abuse contact address

- **Statement**: A genuine, stable abuse-contact address MUST be published and reachable by the public before anonymous access opens.
- **Testable as**: Given the public-facing site, when a user looks for an abuse contact, then a working contact address is visible. Depends on a real registered domain (`docs/ARCHITECTURE.md` — Domain).
- **Non-deferrable** before anonymous public access opens.
