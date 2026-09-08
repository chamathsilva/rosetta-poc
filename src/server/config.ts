// Startup configuration, read once from process.env. See
// docs/PATTERNS/env-config-secrets.md - read only via loadConfig(), fail
// fast on anything missing, never scatter process.env reads elsewhere.
//
// ALLOWED_ORIGIN joins REQUIRED here in the same commit as .env.example
// (B0) declares it - the two halves of one rule living in different
// batches (PLAN "H-8").
//
// TEST_DATABASE_URL is deliberately NOT here. It is a real documented
// variable in .env.example, but it is consumed only by test/reset tooling,
// never by the running server - nothing in production ever reads a test
// database URL. Putting it in this REQUIRED list would force the
// production droplet's systemd EnvironmentFile to carry a variable it has
// no use for, and would force every unrelated test file that merely calls
// loadConfig() to fake one just to pass the fail-fast check (which is
// exactly what happened before this was corrected - orchestrator finding,
// 2026-09-07). Test/reset code that actually needs it should read
// process.env['TEST_DATABASE_URL'] directly with its own local check.

const REQUIRED = ['DATABASE_URL', 'JWT_SECRET', 'PORT', 'ALLOWED_ORIGIN'] as const;

export interface Config {
  readonly databaseUrl: string;
  readonly jwtSecret: string;
  readonly port: number;
  readonly allowedOrigin: string;
}

export function loadConfig(): Config {
  const missing = REQUIRED.filter((key) => !process.env[key]);
  if (missing.length > 0) {
    throw new Error(`Missing required environment variables: ${missing.join(', ')}`);
  }
  return {
    databaseUrl: process.env['DATABASE_URL']!,
    jwtSecret: process.env['JWT_SECRET']!,
    port: Number(process.env['PORT']),
    allowedOrigin: process.env['ALLOWED_ORIGIN']!,
  };
}
