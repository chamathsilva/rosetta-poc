-- Up Migration
-- Seeds the well-known 'lobby' room (design §2, option B: name-as-contract,
-- id resolved once at startup via resolveLobbyRoomId). Separate from the
-- schema migration so that file stays pure DDL (PLAN "Migration mechanics").
-- `rooms.id` keeps its DEFAULT gen_random_uuid() - no literal UUID here.

INSERT INTO rooms (name) VALUES ('lobby');
