// Destructive reset for the disposable test database. PLAN "Test database
// and reset safety": "The reset refuses to run unless the target database
// name ends `_test`. Mandatory, not advisory: a reset is destructive and
// DATABASE_URL may point at data someone cares about. The check is on the
// resolved connection target, not on which variable was read" — so this
// reads TEST_DATABASE_URL directly rather than trusting that whoever set
// it up named it correctly.
//
// Drops and recreates the `public` schema, then the caller re-applies
// migrations (see the `db:reset:test` script in package.json) — there is
// no down migration to invoke instead (the migration files are up-only,
// docs/PATTERNS/parameterized-pg-queries.md "Extension points": "plain SQL
// files, not query-builder DSL").
import { Client } from 'pg';

function resolveDatabaseName(connectionString: string): string {
  // pathname is "/<dbname>"; strip the leading slash.
  return new URL(connectionString).pathname.replace(/^\//, '');
}

async function main(): Promise<void> {
  const connectionString = process.env['TEST_DATABASE_URL'];
  if (!connectionString) {
    throw new Error('TEST_DATABASE_URL is not set - refusing to guess a target.');
  }

  const databaseName = resolveDatabaseName(connectionString);
  if (!databaseName.endsWith('_test')) {
    throw new Error(
      `TEST_DATABASE_URL must point at a database whose name ends "_test" - refusing to reset "${databaseName}".`,
    );
  }

  const client = new Client({ connectionString });
  await client.connect();
  try {
    console.log(`Resetting "${databaseName}": DROP SCHEMA public CASCADE; CREATE SCHEMA public;`);
    await client.query('DROP SCHEMA public CASCADE');
    await client.query('CREATE SCHEMA public');
    console.log('Schema reset. Re-run migrations against TEST_DATABASE_URL to recreate tables.');
  } finally {
    await client.end();
  }
}

main().catch((err: unknown) => {
  console.error(err);
  process.exitCode = 1;
});
