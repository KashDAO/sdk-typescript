/**
 * docs/api-errors/IDEMPOTENCY_KEY_TOO_LONG.md ↔ SDK `IDEMPOTENCY_KEY_MAX_LENGTH` parity.
 *
 * The SDK enforces a client-side length check before the request goes
 * out, and the API enforces the same cap server-side. The customer-
 * facing markdown for `IDEMPOTENCY_KEY_TOO_LONG` quotes the cap as
 * a numeric literal in the prose. If any of those three sources drift
 * — SDK says 255, API says 255, docs say 128 (the literal drift this
 * test caught) — customers reading the docs will redesign their key
 * generation pipeline to fit a smaller ceiling that doesn't actually
 * exist, or worse, will have valid 200-char keys reading the docs and
 * thinking something's wrong.
 *
 * Round AS found this for API key shape; round AT finds it for
 * idempotency key length. Same drift class, same fix template:
 * pin the doc against the SDK constant, fail loudly when either
 * moves.
 *
 * Lives in the SDK because the SDK is the natural carrier of both
 * the constant and the doc-tree (via the monorepo file path; the
 * docs ship as part of `docs/` to GitHub, not to npm).
 */

import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

import { describe, expect, it } from 'vitest';

// IDEMPOTENCY_KEY_MAX_LENGTH is not exported from the SDK's public
// barrel — it's an internal constant in http.ts. We read it via the
// source file, the same way the documentation test extracts the
// `{N}` quantifier from API_KEY_SHAPE in api-key-malformed-doc-parity.
const SDK_HTTP_PATH = fileURLToPath(new URL('../../src/internal/http.ts', import.meta.url));
const SDK_HTTP_SOURCE = readFileSync(SDK_HTTP_PATH, 'utf8');

const DOC_PATH = fileURLToPath(
  new URL('../../../../docs/api-errors/IDEMPOTENCY_KEY_TOO_LONG.md', import.meta.url)
);
const DOC = readFileSync(DOC_PATH, 'utf8');

function extractSdkMaxLength(source: string): number {
  const m = /IDEMPOTENCY_KEY_MAX_LENGTH\s*=\s*(\d+)\s*;/.exec(source);
  if (!m) {
    throw new Error('Could not find `IDEMPOTENCY_KEY_MAX_LENGTH = <N>;` in SDK http.ts');
  }
  return Number.parseInt(m[1]!, 10);
}

const SDK_MAX = extractSdkMaxLength(SDK_HTTP_SOURCE);

describe('docs/api-errors/IDEMPOTENCY_KEY_TOO_LONG.md ↔ SDK IDEMPOTENCY_KEY_MAX_LENGTH drift', () => {
  it('SDK constant is set to a sensible positive integer', () => {
    expect(SDK_MAX).toBeGreaterThan(0);
    // Sanity floor — if the regex extractor breaks we want to know,
    // not silently match against zero. The current value is 255.
    expect(SDK_MAX).toBeGreaterThanOrEqual(64);
  });

  it('doc mentions the SDK-enforced max length verbatim', () => {
    // Round AT caught: SDK was 255, doc said 128. A customer reading
    // 128 would redesign their key generation to fit, or worse, would
    // have a valid 200-char key and panic. Pin the literal in the
    // doc to the source-of-truth constant.
    expect(
      DOC.includes(String(SDK_MAX)),
      `docs/api-errors/IDEMPOTENCY_KEY_TOO_LONG.md must mention the actual SDK-enforced max length (${SDK_MAX}). ` +
        `If the SDK constant changed (e.g., a future longer cap), update the doc to match. ` +
        `If the doc was already updated but uses different phrasing, update this test to recognise it.`
    ).toBe(true);
  });

  it('doc does NOT mention the historically-wrong "128" cap', () => {
    // Belt-and-braces against the specific number that was wrong.
    // If someone re-introduces "128" in the doc (a copy-paste from
    // older revision, a misremembered constant), fail loudly. The
    // SDK's actual cap is 255 — the doc must not contradict that.
    //
    // Skip the check if the actual cap IS 128 (unlikely, but
    // defensively correct: a future shrink to 128 would make this
    // assertion contradict the prior one).
    if (SDK_MAX === 128) return;
    expect(
      /\b128[-\s]?(?:char|character)/.test(DOC),
      'docs/api-errors/IDEMPOTENCY_KEY_TOO_LONG.md mentions "128-char" or "128 character" — ' +
        'but the SDK enforces a different cap. This is the historical drift round AT found. ' +
        `Update the doc to use ${SDK_MAX} instead.`
    ).toBe(false);
  });

  it('doc gives concrete guidance about safe lengths (UUID, ULID)', () => {
    // Verifies the prose includes the helpful "use a UUID/ULID"
    // recommendation. A regression that stripped the guidance would
    // leave customers reading only "your key is too long" with no
    // remediation hint.
    expect(/UUID|ULID/i.test(DOC), 'doc must mention UUID or ULID as safe alternatives').toBe(true);
  });
});
