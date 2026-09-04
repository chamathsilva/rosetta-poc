# Configuration and Secrets via Environment Variables

## Description

All configuration that varies by environment or is sensitive (DB credentials, JWT signing secret, port) is read from environment variables, supplied on the droplet via systemd `EnvironmentFile` (`docs/TECHSTACK.md`: "Secrets management: systemd EnvironmentFile"). Nothing sensitive is committed. `.gitignore` already excludes `.env`, `.env.*` (allowing only `.env.example`) — this pattern is the code-side half of that boundary.

Use when: adding any new configuration value (DB connection string, JWT secret, port, CORS origin, etc.) or any code that currently hardcodes such a value.

## Rule

- Read config only via `process.env.*`, at a single startup point — not scattered `process.env` reads deep in business logic.
- Fail fast: if a required variable is missing at startup, throw before the server starts listening, rather than failing later on first use.
- Every new required variable MUST be added to a committed `.env.example` with a placeholder value (no real secret) — `.env.example` does not exist yet and should be created alongside the first code that needs it.
- Never log the value of a secret-bearing variable.

## Template

```js
// src/server/config.js
function loadConfig() {
  const required = ['DATABASE_URL', 'JWT_SECRET', 'PORT'];
  const missing = required.filter((key) => !process.env[key]);
  if (missing.length) {
    throw new Error(`Missing required environment variables: ${missing.join(', ')}`);
  }
  return {
    databaseUrl: process.env.DATABASE_URL,
    jwtSecret: process.env.JWT_SECRET,
    port: Number(process.env.PORT),
  };
}

module.exports = { loadConfig };
```

```
# .env.example (to be created with the first code that needs config — placeholders only)
DATABASE_URL=postgres://user:password@localhost:5432/dbname
JWT_SECRET=replace-with-a-long-random-value
PORT=3000
```

## Extension points

- Applies to every future secret or per-environment value (rate-limit thresholds, moderation contact address, etc.) — add to `required` and to `.env.example` together, never one without the other.
