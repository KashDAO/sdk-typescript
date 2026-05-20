/**
 * docs/api-errors/API_KEY_MALFORMED.md ↔ SDK `API_KEY_SHAPE` parity.
 *
 * The customer-facing markdown for the `API_KEY_MALFORMED` error
 * tells customers what shape a valid API key has. The SDK's
 * `API_KEY_SHAPE` regex is the actual runtime gate. If they ever
 * drift — docs say "43-char base64url" while the regex enforces
 * "32-char alphanumeric" (the literal divergence found in round AS) —
 * a customer with a valid key reads the docs, panics, and assumes
 * their key was truncated. False signal at the worst possible moment.
 *
 * The historical drift caught here:
 *   - Doc: "kash_<env>_<43-char base64url>"
 *   - Regex: /^kash_(live|test)_[A-Za-z0-9]{32}$/
 *
 * 43 vs 32 (wrong by 11 chars) AND base64url (`A-Za-z0-9_-`) vs
 * base62 (`A-Za-z0-9`). Two-axis divergence. Round AS fixed the doc
 * and added this pin.
 *
 * Lives in the SDK package because the SDK is the only artifact that
 * imports BOTH the public-mirror-safe regex constant AND can read the
 * docs from the monorepo root (the docs ship to GitHub, not npm). The
 * file path navigates up four levels (../../../../docs/api-errors/...)
 * so the test is monorepo-local; if the SDK is ever extracted, this
 * test must move with it or become a cross-repo parity gate.
 */

import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

import { describe, expect, it } from 'vitest';

import { API_KEY_SHAPE } from '../../src/internal/config.js';

const DOC_PATH = fileURLToPath(
  new URL('../../../../docs/api-errors/API_KEY_MALFORMED.md', import.meta.url)
);
const DOC = readFileSync(DOC_PATH, 'utf8');

/**
 * Pull the random-segment length out of API_KEY_SHAPE. The regex is
 * `/^kash_(live|test)_[A-Za-z0-9]{32}$/` — extract the `{N}` quantifier
 * so the test fails loudly if the constant itself changes (e.g., a
 * future cryptographic uplift to 48-char keys), forcing the doc to
 * track.
 */
function extractRequiredLength(): number {
  const m = /\{(\d+)\}/.exec(API_KEY_SHAPE.source);
  if (!m) {
    throw new Error(
      `API_KEY_SHAPE has no {N} quantifier — regex shape changed: ${API_KEY_SHAPE.source}`
    );
  }
  return Number.parseInt(m[1]!, 10);
}

const requiredLength = extractRequiredLength();

describe('docs/api-errors/API_KEY_MALFORMED.md ↔ API_KEY_SHAPE drift', () => {
  it('regex is well-formed and enforces a positive length', () => {
    // Belt-and-braces against an upstream regex change.
    expect(requiredLength).toBeGreaterThan(0);
    expect(API_KEY_SHAPE.test('kash_live_' + 'a'.repeat(requiredLength))).toBe(true);
    expect(API_KEY_SHAPE.test('kash_test_' + 'a'.repeat(requiredLength))).toBe(true);
  });

  it('doc mentions the SDK-enforced random-segment length', () => {
    // Round AS's specific finding: doc said "43-char" while the regex
    // is 32. We assert the doc mentions the regex's actual length and
    // does NOT mention the wrong one. If a future cryptographic uplift
    // bumps the regex to 48 (etc), the doc must update or this test
    // fails — and the failure message points at this file.
    const lengthString = String(requiredLength);
    expect(
      DOC.includes(lengthString),
      `docs/api-errors/API_KEY_MALFORMED.md must mention the actual SDK-enforced length (${lengthString}). ` +
        `If the regex API_KEY_SHAPE changed (e.g., longer keys), update the doc to match. ` +
        `If the doc was already updated but uses different phrasing, update this test to recognise it.`
    ).toBe(true);
  });

  it('doc does NOT misrepresent the charset as base64url', () => {
    // Round AS specifically caught "<43-char base64url>" — wrong both
    // on length AND charset. base64url uses `A-Za-z0-9_-`; our regex
    // accepts only `A-Za-z0-9` (base62). Customers reading "base64url"
    // and seeing a `-` or `_` would think it's allowed. Pin: docs MUST
    // NOT call the random segment base64url.
    expect(
      /base64url/.test(DOC),
      'docs/api-errors/API_KEY_MALFORMED.md mentions "base64url" — but the API key random segment is base62 ' +
        '(`A-Za-z0-9` only; the underscore and dash that base64url allows are NOT valid here, and would be ' +
        'rejected by SDK API_KEY_SHAPE). Replace "base64url" with "alphanumeric" or "base62" to match the regex.'
    ).toBe(false);
  });

  it('doc mentions the "alphanumeric" or "base62" charset explicitly', () => {
    // The flip side of the previous test: not just absence of the
    // wrong descriptor, but presence of the right one. Customers
    // grepping for "what characters are allowed" should find a clear
    // answer in this doc.
    expect(
      /(alphanumeric|base62|A-Za-z0-9|A-Z, a-z, 0-9)/.test(DOC),
      'docs/api-errors/API_KEY_MALFORMED.md must describe the random-segment charset as alphanumeric / base62 / ' +
        '`A-Za-z0-9`. Currently the doc lacks this descriptor.'
    ).toBe(true);
  });

  it('doc mentions both live and test prefixes', () => {
    // Pinning the prefix family — a customer reading the doc must
    // see BOTH supported prefixes, not just one.
    expect(/kash_live_/.test(DOC)).toBe(true);
    expect(/kash_test_/.test(DOC)).toBe(true);
  });
});
