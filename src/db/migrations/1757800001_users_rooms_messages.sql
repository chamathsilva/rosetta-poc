-- Up Migration
-- Walking skeleton schema: users, rooms, messages only. Verbatim from
-- docs/ARCHITECTURE.md "Data model — APPROVED", restricted to the three
-- tables this feature needs (PLAN "Migration mechanics"). `bans`,
-- `reports`, `moderation_actions` are approved-but-unmigrated - do not add
-- them here, they have no consumer yet.
--
-- Intra-file order is users, rooms, messages - messages FKs both of the
-- others (PLAN "Migration mechanics").

CREATE TABLE users (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  nickname      text NOT NULL,
  password_hash text,                                  -- NULL for guests
  is_guest      boolean NOT NULL DEFAULT true,
  is_admin      boolean NOT NULL DEFAULT false,
  created_at    timestamptz NOT NULL DEFAULT now(),
  last_seen_at  timestamptz NOT NULL DEFAULT now(),
  banned_at     timestamptz,                           -- account ban; IP ban lives in bans
  CONSTRAINT registered_users_have_a_password CHECK (is_guest OR password_hash IS NOT NULL)
);
CREATE UNIQUE INDEX users_nickname_key   ON users (lower(nickname));
CREATE        INDEX users_guest_reap_idx ON users (last_seen_at) WHERE is_guest;

CREATE TABLE rooms (
  id         uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name       text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX rooms_name_key ON rooms (lower(name));

CREATE TABLE messages (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  room_id         uuid NOT NULL REFERENCES rooms(id),
  author_id       uuid REFERENCES users(id) ON DELETE SET NULL,
  author_nickname text NOT NULL,                       -- snapshot; survives guest reaping
  body            text NOT NULL,
  ip              inet,                                -- nulled at 30 days, row kept
  created_at      timestamptz NOT NULL DEFAULT now(),
  deleted_at      timestamptz                          -- soft delete, auditable
);
CREATE INDEX messages_room_history_idx ON messages (room_id, created_at DESC);
CREATE INDEX messages_ip_purge_idx     ON messages (created_at) WHERE ip IS NOT NULL;
