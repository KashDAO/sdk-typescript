import { defineConfig } from 'tsup';

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
  },
  format: ['esm', 'cjs'],
  dts: true,
  sourcemap: true,
  clean: true,
  treeshake: true,
  splitting: false,
  target: 'es2022',
});
