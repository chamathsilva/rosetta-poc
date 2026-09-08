-- Runs once, on first container init (docker-entrypoint-initdb.d), after
-- POSTGRES_DB is created. Creates the dedicated test database referenced by
-- TEST_DATABASE_URL in .env.example - distinct from the app database, and
-- named with the `_test` suffix the destructive reset requires (PLAN, "Test
-- database and reset safety").
CREATE DATABASE rosetta_poc_test;
