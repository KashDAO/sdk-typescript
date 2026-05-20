/**
 * README ↔ source-of-truth drift detector for SDK base URLs.
 *
 * `packages/sdk/README.md` advertises the canonical production and
 * staging URLs verbatim (in the "Auto-routing" matrix and the inline
 * env-var examples). If `PRODUCTION_BASE_URL` or `STAGING_BASE_URL` in
 * `src/internal/config.ts` ever changes — a hosting move, a new
 * region, a versioned `/v2` rollout — the README will silently stale
 * and customers will hit a 404 on the URL the docs told them to use.
 *
 * Same drift class as round AB (api-tiers.md ↔ tier defaults) and
 * round AC (api-errors/<CODE>.md ↔ ERROR_CODE_HTTP_STATUS), applied
 * to the SDK's public-facing README.
 */

import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

import { describe, expect, it } from 'vitest';

import { PRODUCTION_BASE_URL, STAGING_BASE_URL } from '../../src/internal/config.js';

const README_PATH = fileURLToPath(new URL('../../README.md', import.meta.url));
const README = readFileSync(README_PATH, 'utf8');

describe('packages/sdk/README.md ↔ PRODUCTION_BASE_URL / STAGING_BASE_URL drift', () => {
  it('README contains the canonical PRODUCTION_BASE_URL', () => {
    // The literal must appear in the README so the URL matrix +
    // env-var examples remain accurate. A regression that bumped the
    // constant without updating the README would leave the docs
    // pointing at a stale host — customers would hit DNS NXDOMAIN /
    // 404s using the URL the docs told them to use.
    expect(
      README.includes(PRODUCTION_BASE_URL),
      `README is missing the production base URL "${PRODUCTION_BASE_URL}". ` +
        `If the constant changed, update README.md to match (look for the URL matrix near "Auto-routing"). ` +
        `If the README intentionally moved away from literal URLs, this test is the place to record that decision.`
    ).toBe(true);
  });

  it('README contains the canonical STAGING_BASE_URL', () => {
    expect(
      README.includes(STAGING_BASE_URL),
      `README is missing the staging base URL "${STAGING_BASE_URL}". ` +
        `Same fix as the production case above.`
    ).toBe(true);
  });

  it('README does not contain a stale base URL pattern (sanity check)', () => {
    // Scan the README for `https://api*.kash.bot/v*` URLs and assert
    // each one is either PRODUCTION_BASE_URL or STAGING_BASE_URL.
    // Catches the case where the README adds a NEW URL (e.g., a
    // region) that isn't backed by the SDK's constants — the
    // customer would target an endpoint the SDK doesn't know how to
    // auto-route to.
    const matches = README.match(/https?:\/\/api[a-z0-9-]*\.kash\.bot\/v\d+/g) ?? [];
    const unique = Array.from(new Set(matches));
    const allowed = new Set<string>([PRODUCTION_BASE_URL, STAGING_BASE_URL]);
    const orphans = unique.filter((u) => !allowed.has(u));
    expect(
      orphans,
      `README mentions Kash API URLs that are NOT in {PRODUCTION_BASE_URL, STAGING_BASE_URL}: ${orphans.join(', ')}. ` +
        `Either add these to the SDK's config constants, or remove them from the README. ` +
        `Customers will copy any URL the README documents.`
    ).toEqual([]);
  });
});
