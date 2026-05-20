/**
 * SDK README error-class table ↔ exported Kash*Error classes.
 *
 * The README documents every `Kash<X>Error` subclass in a single
 * table around lines 871–885 — what triggers it, whether it's
 * retryable. Customers branch on `instanceof Kash<X>Error` to route
 * recovery logic. If the SDK adds a new error class without updating
 * the README, customers don't know to branch on it; if the README
 * documents a class that doesn't exist, customer code with
 * `import { KashFooError } ...` won't compile.
 *
 * 13 classes today. Two parity axes:
 *   - Every exported class has a row in the README table.
 *   - Every row in the table corresponds to a real exported class.
 *
 * Same drift class as round AK (SDK README ↔ KashClient surface) and
 * AW (SDK README ↔ API_KEY_SCOPES), applied to the SDK's exception
 * surface — the third public-facing axis customers care about.
 */

import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

import { describe, expect, it } from 'vitest';

import * as kashErrors from '../../src/errors.js';

const README_PATH = fileURLToPath(new URL('../../README.md', import.meta.url));
const README = readFileSync(README_PATH, 'utf8');

/**
 * Every exported class on the SDK's errors module whose name matches
 * the `Kash<X>Error` pattern. We import the namespace and filter so a
 * new exported class is picked up automatically — no need to update
 * a hardcoded list when the SDK adds a new error subtype.
 */
const EXPORTED_ERROR_CLASSES: readonly string[] = Object.keys(kashErrors)
  .filter((name) => /^Kash[A-Z]\w*Error$/.test(name))
  // Filter out the abstract base class — README's table is
  // specifically the SUBCLASSES customers branch on, not the parent.
  .filter((name) => name !== 'KashError');

/**
 * Extract every `Kash<X>Error` token mentioned inside a markdown
 * table row (i.e. wrapped in backticks AND inside a `| ... |` row).
 * This intentionally narrows to the table — prose mentions of
 * KashAuthorizationError elsewhere in the README don't count as
 * "this class is documented in the catalog table."
 */
function extractReadmeTableClasses(text: string): readonly string[] {
  const out = new Set<string>();
  // Each table row line starts with `|`. We split on lines and pick
  // only rows containing both `|` and a backticked Kash*Error token.
  for (const line of text.split('\n')) {
    if (!line.startsWith('|')) continue;
    for (const m of line.matchAll(/`(Kash[A-Z]\w*Error)`/g)) {
      out.add(m[1]!);
    }
  }
  return [...out];
}

const README_TABLE_CLASSES = extractReadmeTableClasses(README);

describe('packages/sdk/README.md error-class table ↔ exported Kash*Error classes drift', () => {
  it('sanity floor: both sides declare a non-empty set', () => {
    expect(EXPORTED_ERROR_CLASSES.length).toBeGreaterThanOrEqual(5);
    expect(
      README_TABLE_CLASSES.length,
      'README table has no `Kash*Error` rows — either the table was removed (drop this test) or the format changed (update the extractor regex).'
    ).toBeGreaterThanOrEqual(5);
  });

  it.each(EXPORTED_ERROR_CLASSES.map((c) => [c] as const))(
    'exported "%s" is documented in the README error catalog table',
    (cls) => {
      expect(
        README_TABLE_CLASSES.includes(cls),
        `${cls} is exported from @kashdao/sdk but has no row in the README error catalog table. ` +
          `Customers branching on instanceof ${cls} won't know it exists. ` +
          `Add a row to the table around lines 871–885 of packages/sdk/README.md. ` +
          `Currently documented: ${README_TABLE_CLASSES.sort().join(', ')}.`
      ).toBe(true);
    }
  );

  it.each(README_TABLE_CLASSES.map((c) => [c] as const))(
    'README table row "%s" corresponds to a real exported class',
    (cls) => {
      expect(
        EXPORTED_ERROR_CLASSES.includes(cls),
        `README error catalog table documents ${cls}, but it isn't exported from packages/sdk/src/errors.ts. ` +
          `Customer code doing "import { ${cls} } from '@kashdao/sdk'" won't compile. ` +
          `Either restore the class export or remove the row from the README table. ` +
          `Currently exported: ${EXPORTED_ERROR_CLASSES.sort().join(', ')}.`
      ).toBe(true);
    }
  );

  it('the sets are equal in size (no orphan exports OR phantom rows)', () => {
    // Belt-and-braces: the per-class assertions above check both
    // directions, but a single equality on the set sizes makes the
    // overall "13 exports = 13 rows" invariant visible at a glance.
    // If a new class is added to BOTH sides correctly, this still
    // passes; if it's added to only one side, the per-class
    // assertions fire first and this remains the summary.
    expect(EXPORTED_ERROR_CLASSES.length).toBe(README_TABLE_CLASSES.length);
  });
});
