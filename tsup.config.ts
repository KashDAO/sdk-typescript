import { defineConfig } from 'tsup';

import type { Plugin } from 'esbuild';

/**
 * `src/webhooks.ts` re-exports its payload schemas from `./schemas/index.js`.
 * Bundled as is, every entry would carry its own copy, so
 * `@kashdao/sdk/webhooks` and `@kashdao/sdk/schemas` would hand out two
 * different objects for one schema. The `/webhooks` build imports
 * `@kashdao/sdk/schemas` by package name instead, so both entries share one
 * object. Source keeps the relative import, which type-checks and tests
 * without a prior build.
 */
const schemasEntryStaysExternal: Plugin = {
  name: 'schemas-entry-stays-external',
  setup(build) {
    build.onResolve({ filter: /^\.\/schemas\/index\.js$/ }, (args) =>
      args.importer.endsWith('/src/webhooks.ts')
        ? { path: '@kashdao/sdk/schemas', external: true }
        : undefined
    );
  },
};

/**
 * Bundle config for @kashdao/sdk.
 *
 * Dual ESM + CJS output with declaration files. Targets ES2022 so the
 * package works in Node 22+, modern browsers, Deno, and Bun without a
 * downlevel compile. `treeshake` keeps unused error subclasses out of
 * the consumer bundle when they only import a subset of the surface.
 */
export default defineConfig({
  entry: {
    index: 'src/index.ts',
    'testing/index': 'src/testing/index.ts',
    webhooks: 'src/webhooks.ts',
    partner: 'src/partner.ts',
    schemas: 'src/schemas/index.ts',
  },
  format: ['esm', 'cjs'],
  dts: true,
  sourcemap: true,
  clean: true,
  treeshake: true,
  splitting: false,
  target: 'es2022',
  esbuildPlugins: [schemasEntryStaysExternal],
});
