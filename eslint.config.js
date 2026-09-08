// Flat ESLint config. Test tooling and linter are `[RESOLVED — 2026-09-05]`
// in docs/ASSUMPTIONS.md: `typescript-eslint`'s recommended config, no
// separate style plugin (PLAN B0 step 3: "flat config, typescript-eslint
// recommended").
import tseslint from 'typescript-eslint';

export default tseslint.config(
  {
    ignores: ['dist/**', 'node_modules/**', 'coverage/**'],
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
