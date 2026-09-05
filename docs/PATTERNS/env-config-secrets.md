# Configuration and Secrets via Environment Variables

## Description

All configuration that varies by environment or is sensitive (DB credentials, JWT signing secret, port) is read from environment variables, supplied on the droplet via systemd `EnvironmentFile` (`docs/TECHSTACK.md`: "Secrets management: systemd EnvironmentFile"). Nothing sensitive is committed. `.gitignore` already excludes `.env`, `.env.*` (allowing only `.env.example`) — this pattern is the code-side half of that boundary.

Use when: adding any new configuration value (DB connection string, JWT secret, port, CORS origin, etc.) or any code that currently hardcodes such a value.

## Rule

- Read config only via `process.env.*`, at a single startup point — not scattered `process.env` reads deep in business logic.
- Fail fast: if a required variable is missing at startup, throw before the server starts listening, rather than failing later on first use.
- Every new required variable MUST be added to the committed `.env.example` with a placeholder value (no real secret). The file exists at the repo root as of 2026-09-04.
- Never log the value of a secret-bearing variable.
- `.env.example` may also carry conventional values that are NOT fail-fast checked (`NODE_ENV`). Mark them as such in the file. Everything else in `.env.example` must appear in `REQUIRED`, and everything in `REQUIRED` must appear in `.env.example`.
- Values that are **decisions**, not configuration — session lifetimes, bcrypt cost, retention periods — stay as constants in code. Making a decided value env-tunable creates a second copy that drifts from the decision.

## Template

```ts
// src/server/config.ts
const REQUIRED = ['DATABASE_URL', 'JWT_SECRET', 'PORT'] as const;

export interface Config {
  readonly databaseUrl: string;
  readonly jwtSecret: string;
  readonly port: number;
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
  };
}
```

Notes on the template: `noUncheckedIndexedAccess` is on, so `process.env[key]` is `string | undefined`. The non-null assertions are sound only because `REQUIRED` was checked immediately above — do not copy that assertion to any read that has not been checked.

The committed `.env.example` is the contract. It exists at the repo root; keep it in step with `REQUIRED`.

## Extension points

- Applies to every future secret or per-environment value (rate-limit thresholds, moderation contact address, etc.) — add to `required` and to `.env.example` together, never one without the other.
