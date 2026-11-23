import { defineConfig } from 'tsup';

import type { Plugin } from 'esbuild';

/**
 * `src/webhooks.ts` re-exports its payload schemas from `./schemas/index.js`,
 * and the `position.claimable` one from `./claimable.js`. Bundled as is, every
 * entry would carry its own copy, so `@kashdao/sdk/webhooks` and the entry it
 * re-exports from would hand out two different objects for one schema. The
 * `/webhooks` build imports `@kashdao/sdk/schemas` and `@kashdao/sdk/claimable`
 * by package name instead, so both entries share one object. Source keeps the
 * relative imports, which type-check and test without a prior build.
 */
const WEBHOOKS_EXTERNAL_ENTRIES: Readonly<Record<string, string>> = {
  './schemas/index.js': '@kashdao/sdk/schemas',
  './claimable.js': '@kashdao/sdk/claimable',
};

const sharedEntriesStayExternal: Plugin = {
  name: 'shared-entries-stay-external',
  setup(build) {
    build.onResolve({ filter: /^\.\/(schemas\/index|claimable)\.js$/ }, (args) => {
      const entry = WEBHOOKS_EXTERNAL_ENTRIES[args.path];
      return args.importer.endsWith('/src/webhooks.ts') && entry !== undefined
        ? { path: entry, external: true }
        : undefined;
    });
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
    claimable: 'src/claimable.ts',
    'market-conversations': 'src/market-conversations.ts',
  },
  format: ['esm', 'cjs'],
  dts: true,
  sourcemap: true,
  clean: true,
  treeshake: true,
  splitting: false,
  target: 'es2022',
  esbuildPlugins: [sharedEntriesStayExternal],
});
