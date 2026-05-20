/**
 * SDK README ↔ source-side `getEnv()` reads.
 *
 * The SDK reads a small set of env vars (`KASH_API_KEY` for auto-
 * discovery, `KASH_BASE_URL` for the staging/prod override) via a
 * type-erased `getEnv()` helper in src/client.ts. Each one MUST
 * appear in the README's configuration section, otherwise a
 * customer setting `export KASH_BASE_URL=…` has no way to discover
 * that the SDK respects it.
 *
 * INVERSE direction (source → README) — every env var the SDK reads
 * via getEnv() must be documented. The forward direction (every
 * README KASH_* must be read) has false positives — README examples
 * use customer-side env-var names like KASH_LIVE_KEY / KASH_TEST_KEY
 * which are illustrative, not SDK-read.
 *
 * Same drift class as round BH (CLI README ↔ source process.env reads)
 * but the SDK uses a `getEnv()` helper instead of direct
 * `process.env` for browser/Deno/Bun compatibility — different
 * extractor regex.
 */

import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

import { describe, expect, it } from 'vitest';

const README_PATH = fileURLToPath(new URL('../../README.md', import.meta.url));
const README = readFileSync(README_PATH, 'utf8');

const CLIENT_PATH = fileURLToPath(new URL('../../src/client.ts', import.meta.url));
const CLIENT_SOURCE = readFileSync(CLIENT_PATH, 'utf8');

/**
 * Extract every `getEnv('KASH_<X>')` call. The SDK uses this
 * indirection (not `process.env.X`) so it stays portable across
 * browsers (no `process`), Deno (different env API), Bun (mostly
 * compatible but partial), and Node.
 */
function extractGetEnvReads(source: string): readonly string[] {
  const out = new Set<string>();
  for (const m of source.matchAll(/getEnv\(\s*['"](KASH_[A-Z_]+)['"]\s*\)/g)) {
    out.add(m[1]!);
  }
  return [...out];
}

const SOURCE_READS = extractGetEnvReads(CLIENT_SOURCE);

describe('packages/sdk/README.md ↔ src/client.ts getEnv() reads', () => {
  it('sanity floor: SDK reads at least KASH_API_KEY (the load-bearing auto-discovery var)', () => {
    expect(SOURCE_READS.length).toBeGreaterThan(0);
    expect(
      SOURCE_READS.includes('KASH_API_KEY'),
      `SDK must read KASH_API_KEY via getEnv(). Currently reads: ${SOURCE_READS.sort().join(', ')}.`
    ).toBe(true);
  });

  it.each(SOURCE_READS.sort().map((v) => [v] as const))(
    'SDK reads "%s" via getEnv() — that env var is documented in the README',
    (envVar) => {
      // The most dangerous drift: the SDK adds a new env-var read
      // (e.g. KASH_TIMEOUT_MS) without updating the README. A
      // customer setting that env var on production never finds out
      // it works, and a customer NOT setting it doesn't know they
      // can. Pin every getEnv() read to a README mention.
      expect(
        README.includes(envVar),
        `SDK reads "${envVar}" via getEnv() but the README does not document it. ` +
          `Add it to the configuration section. ` +
          `Currently in README: ${[...README.matchAll(/KASH_[A-Z_]+/g)]
            .map((m) => m[0])
            .filter((v, i, a) => a.indexOf(v) === i)
            .sort()
            .join(', ')}.`
      ).toBe(true);
    }
  );

  it('README explicitly states which env vars the SDK reads', () => {
    // Belt-and-braces: the prose around line 432 says "The SDK reads
    // `KASH_API_KEY` and `KASH_BASE_URL` from the environment" —
    // pin the literal phrase. If a future SDK adds KASH_TIMEOUT_MS
    // (etc.), this passes silently UNLESS someone also updates the
    // prose. A separate task, but the assertion makes the gap
    // visible at PR time.
    for (const envVar of SOURCE_READS) {
      const inSdkReadsList =
        new RegExp(`SDK reads[^.]*\`${envVar}\``).test(README) ||
        new RegExp(`reads \`${envVar}\``).test(README);
      // We accept either phrasing — the test pins that the env var
      // appears in a sentence describing "SDK reads X" specifically,
      // not just in an unrelated code-fence example.
      expect(
        inSdkReadsList,
        `README must explicitly state in prose that the SDK reads ${envVar}. ` +
          `An example like "process.env.${envVar}" alone is not enough — customers ` +
          `need a discoverable list of what the SDK actually respects.`
      ).toBe(true);
    }
  });
});
