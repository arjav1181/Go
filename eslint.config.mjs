import { defineConfig, globalIgnores } from 'eslint/config';
import nextVitals from 'eslint-config-next/core-web-vitals';
import nextTs from 'eslint-config-next/typescript';

export default defineConfig([
  ...nextVitals,
  ...nextTs,
  globalIgnores(['.next/**', 'out/**', 'build/**', 'next-env.d.ts', '.test-dist/**']),
  {
    /**
     * `tests/helpers/alias.cjs` is loaded by Node as a CommonJS *preload*
     * (`node --require`), before any module system the project uses is in
     * play. It has to call require() to patch Module._resolveFilename at all —
     * an ESM import would not have run yet. Scoped exemption rather than a
     * blanket disable of the rule, so require() stays banned everywhere else.
     */
    files: ['tests/helpers/*.cjs'],
    rules: { '@typescript-eslint/no-require-imports': 'off' }
  }
]);
