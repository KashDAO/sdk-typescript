import { defineConfig } from 'vitest/config';

/**
 * Vitest config for the public mirror repo. Excludes `*.private.test.ts`
 * which lives only in the monorepo (those tests import the private
 * server-side Zod schemas to catch drift; here we run the public
 * `tests/contract/wire-shape.test.ts` against the SDK schemas only).
 */
export default defineConfig({
  test: {
    include: ['tests/unit/**/*.test.ts', 'tests/contract/**/*.test.ts'],
    exclude: ['**/*.private.test.ts', '**/node_modules/**', '**/dist/**'],
    reporters: ['dot'],
  },
});
