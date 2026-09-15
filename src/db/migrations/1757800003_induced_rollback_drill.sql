-- Up Migration
-- DO NOT MERGE. Induced-failure rollback drill (runbook step 14, AC-ROL-2/3/8).
-- Fails ONLY against the production database name, so CI's migration run
-- against rosetta_poc_test passes (the deploy precondition requires green CI)
-- while the deploy's chat-migrate step on the droplet fails and the deploy
-- script's rollback() must restore the previous release.
DO $$
BEGIN
  IF current_database() = 'rosetta_chat' THEN
    RAISE EXCEPTION 'induced rollback drill: intentional migration failure on production database';
  END IF;
END
$$;
