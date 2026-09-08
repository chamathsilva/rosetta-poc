-- DELIBERATE DEFECT - validation of the CI gate. Not for merge.
-- Invalid SQL: proves the "Migrate the test database" step is load-bearing
-- and not a decorative step that CI would walk past.
-- Up Migration
CREATE TABLE negative_defect (
