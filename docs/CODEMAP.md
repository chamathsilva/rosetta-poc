# Code Map

**PROPOSED** — no code exists yet; this describes the intended top-level layout only.

**Greenfield repo.** Source code is unbuilt. This section will be populated as code is added.

## Repository structure (intended)

```
rosetta-poc/
  src/
    server/          Node.js HTTP + WebSocket server entry point
    client/          Static client assets (HTML, CSS, client-side JS)
    db/              Database schema and migrations
  docs/              Project documentation (this file, TECHSTACK, DEPENDENCIES, etc.)
  agents/            Rosetta workflow state and plans
  .github/workflows/ GitHub Actions CI configuration
  package.json       Node.js dependencies
  tsconfig.json      TypeScript compiler configuration
  dist/              Compiled JavaScript — build output, not committed; what systemd runs
```

Sources are TypeScript (`.ts`) as of 2026-09-04; see `docs/TECHSTACK.md`.

This layout is UNCONFIRMED. It remains a proposal until real code exists — the init workflow could not confirm it, because the repo is still greenfield. Re-derive this file from actual structure once the walking skeleton lands, and treat any difference between this sketch and the real tree as the sketch being wrong.
