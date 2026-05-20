/**
 * SDK README ↔ packages/sdk/examples/ link validity.
 *
 * The README points customers at specific example files for deeper
 * walkthroughs — `examples/06-high-value-trade.ts`,
 * `examples/05-observability.ts`. If anyone renames or removes an
 * example without updating the README, the README link goes 404 in
 * the rendered docs on GitHub and customers lose the
 * "see canonical example" escape hatch right when they need it most.
 *
 * Same drift class as round BA (cross-link validity in error docs)
 * — different surface (README → examples vs error-docs →
 * error-docs), same pattern.
 */

import { existsSync, readFileSync, readdirSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import { describe, expect, it } from 'vitest';

const here = dirname(fileURLToPath(import.meta.url));
const packageRoot = resolve(here, '..', '..');
const README = readFileSync(resolve(packageRoot, 'README.md'), 'utf8');
const EXAMPLES_DIR = resolve(packageRoot, 'examples');

/**
 * Extract every `./examples/<path>` reference from the README. We
 * accept three forms:
 *
 *   - Markdown link target: `(./examples/01-basic-trade.ts)`
 *   - Backtick-only mention: `` `examples/06-high-value-trade.ts` ``
 *   - Plain `./examples/foo` path inside prose
 *
 * Returns the path relative to the examples root.
 */
function extractReadmeReferences(text: string): readonly string[] {
  const out = new Set<string>();
  // `(./examples/<rest>)` — markdown link
  for (const m of text.matchAll(/\(\.\/examples\/([\w/.-]+)\)/g)) {
    out.add(m[1]!);
  }
  // backtick-only ``examples/<rest>``
  for (const m of text.matchAll(/`examples\/([\w/.-]+)`/g)) {
    out.add(m[1]!);
  }
  return [...out];
}

const README_REFS = extractReadmeReferences(README);

describe('packages/sdk/README.md ↔ examples/ link validity', () => {
  it('sanity floor: README references at least one example file', () => {
    expect(
      README_REFS.length,
      'README has no ./examples/<path> references — either the README was refactored away from example pointers (drop this test) or the regex needs updating.'
    ).toBeGreaterThan(0);
  });

  it.each(README_REFS.map((p) => [p] as const))(
    'README reference "examples/%s" resolves to a real path on disk',
    (relPath) => {
      // Bare "examples" (the directory itself, not a specific file)
      // resolves to the directory existence check.
      const candidate = resolve(EXAMPLES_DIR, relPath);
      expect(
        existsSync(candidate),
        `README references "./examples/${relPath}" but no such file or directory exists. ` +
          `Either restore the path, rename the link in README.md, or remove the reference.`
      ).toBe(true);
    }
  );

  it('every numbered example in examples/ is reachable via the README index', () => {
    // Belt-and-braces inverse — every `0N-<name>.ts` example file
    // should be mentioned SOMEWHERE in the README so customers can
    // discover it. Allow either the full filename or just its numeric
    // prefix (`01-`) in case the README uses a different shorthand.
    const numberedExamples = readdirSync(EXAMPLES_DIR)
      .filter((name) => /^\d+-[\w-]+\.ts$/.test(name))
      .sort();
    expect(numberedExamples.length).toBeGreaterThanOrEqual(3);
    // Either README mentions `examples/` as a directory link
    // (one-stop discovery point) OR mentions each file. The current
    // README does the directory-pointer form via `[examples/](./examples)`.
    // Pin that at least.
    expect(
      /\[`?examples\/`?\]\(\.\/examples\)/.test(README),
      'README must include a top-level pointer to the `examples/` directory ' +
        '(e.g. `[examples/](./examples)`) so customers can discover the runnable scripts.'
    ).toBe(true);
  });
});
