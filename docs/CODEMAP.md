# Code Map

**PARTLY REAL** — the project is scaffolded; `src/` is still empty of application code.

Scaffolded and verified 2026-09-04: `package.json` (ESM, Node 24), `tsconfig.json` (strict, `nodenext`, `src` → `dist`), `.nvmrc`, `.env.example`, `package-lock.json`. Everything under `src/` remains unbuilt.

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
  package.json         Node.js dependencies
  package-lock.json    Resolved versions - committed
  tsconfig.json        Server TypeScript config (nodenext, emits to dist/server)
  tsconfig.client.json Client TypeScript config (DOM lib, react-jsx, noEmit)
  vite.config.ts       Client build: src/client -> dist/client
  .nvmrc               Node 24
  .env.example         Required configuration, placeholders only
  dist/                Build output, not committed
    server/            tsc output - what systemd runs
    client/            Vite output - static assets Express serves
```

Sources are TypeScript (`.ts`) as of 2026-09-04; see `docs/TECHSTACK.md`.

This layout is UNCONFIRMED. It remains a proposal until real code exists — the init workflow could not confirm it, because the repo is still greenfield. Re-derive this file from actual structure once the walking skeleton lands, and treat any difference between this sketch and the real tree as the sketch being wrong.
