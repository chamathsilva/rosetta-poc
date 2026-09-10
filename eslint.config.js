// Flat ESLint config. Test tooling and linter are `[RESOLVED — 2026-09-05]`
// in docs/ASSUMPTIONS.md: `typescript-eslint`'s recommended config, no
// separate style plugin (PLAN B0 step 3: "flat config, typescript-eslint
// recommended").
import tseslint from 'typescript-eslint';

export default tseslint.config(
  {
    // agents/TEMP is gitignored scratch space subagents write into (build
    // reconstructions, .orig backups) - it can never reach a commit, but a
    // leftover file there still breaks a local `npm run lint`. Found
    // 2026-09-09 when a validator's minified-bundle reconstruction under
    // agents/TEMP/gated-deploy/sim-release/ produced 100+ false errors.
    ignores: ['dist/**', 'node_modules/**', 'coverage/**', 'agents/TEMP/**'],
  },
  ...tseslint.configs.recommended,
  {
    languageOptions: {
      parserOptions: {
        ecmaVersion: 'latest',
        sourceType: 'module',
      },
    },
  },
);
