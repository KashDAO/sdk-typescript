/**
 * SDK README ↔ `kashClientConfigSchema` field-name parity.
 *
 * The SDK README has a "Quick config" code block (~lines 451–465)
 * that enumerates every knob `new KashClient({...})` accepts:
 * apiKey, baseUrl, timeoutMs, maxRetries, retryBaseDelayMs,
 * retryMaxDelayMs, retryAfterMaxMs, userAgentSuffix, headers, fetch,
 * hooks, apiVersion. Customers copy this block as their starting
 * config — every field rename or addition must propagate to it (or
 * to some downstream prose mention) so customers can find the knob.
 *
 * If a schema field is renamed (e.g. `timeoutMs` → `requestTimeoutMs`)
 * without README update, customer code that previously worked
 * silently breaks at config-parse time because Zod rejects the
 * unknown key. If a new field is added (e.g. `keepAliveMs`) without
 * README mention, customers don't know to use it.
 *
 * Inverse direction (every README config-block field is a real
 * schema field) is intentionally not asserted here — the README's
 * config block uses backtick fenced TypeScript code, and the
 * value-side parser would generate false positives on hook callback
 * names and inline option objects (`onRequest`, `onResponse` etc).
 *
 * Same drift class as rounds AK (KashClient surface), AW (scopes),
 * BF (error classes), and BD (retry defaults) — pins the SDK's
 * public configuration surface against its source-of-truth schema.
 */

import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

import { describe, expect, it } from 'vitest';

import { kashClientConfigSchema } from '../../src/internal/config.js';

const README_PATH = fileURLToPath(new URL('../../README.md', import.meta.url));
const README = readFileSync(README_PATH, 'utf8');

/**
 * Pull every field name from the schema's `.shape` accessor. Works
 * across Zod major versions because `_def.shape()` is the canonical
 * lazy accessor — same pattern as round AV (api-tiers cell
 * extraction) and BD (retry defaults).
 */
function getSchemaFields(): readonly string[] {
  const shape = (
    kashClientConfigSchema as unknown as { _def: { shape: () => Record<string, unknown> } }
  )._def.shape();
  return Object.keys(shape);
}

const SCHEMA_FIELDS = getSchemaFields();

describe('packages/sdk/README.md ↔ kashClientConfigSchema field names', () => {
  it('sanity floor: schema has at least the well-known config knobs', () => {
    // If the schema is empty or the regex is broken, the per-field
    // parametric tests would degenerate to "no work done." Pin a
    // few load-bearing names so a regex regression doesn't silently
    // pass.
    expect(SCHEMA_FIELDS.length).toBeGreaterThanOrEqual(8);
    for (const required of ['apiKey', 'baseUrl', 'timeoutMs', 'maxRetries'] as const) {
      expect(
        SCHEMA_FIELDS.includes(required),
        `kashClientConfigSchema must declare "${required}". ` +
          `Currently declares: ${[...SCHEMA_FIELDS].sort().join(', ')}.`
      ).toBe(true);
    }
  });

  it.each([...SCHEMA_FIELDS].sort().map((f) => [f] as const))(
    'schema field "%s" is mentioned in the README',
    (field) => {
      // Forward direction: every config knob the schema accepts must
      // be discoverable in the README. The customer's mental model of
      // "what can I configure?" comes from the README — undocumented
      // schema fields might as well not exist.
      //
      // We accept any literal occurrence of the field name in the
      // README — quick-config code blocks, prose, references, etc.
      // This is intentionally permissive: a strict "must appear in
      // the quick-config block" assertion would over-fit to the
      // current README layout and fail any reasonable refactor.
      //
      // We require a colon after the field name (`apiKey:` style) OR
      // a backtick wrapping (`` `apiKey` ``) so we don't match prose
      // mentions of `fetch` (the global Fetch API), `headers` (HTTP
      // headers in general), `hooks` (React hooks!), etc.
      const literalRe = new RegExp(`\`${field}\`|\\b${field}:`);
      expect(
        literalRe.test(README),
        `kashClientConfigSchema declares "${field}" but the README does not mention it ` +
          `(needs either \`${field}\` or "${field}:" form). ` +
          `Add it to the Quick config code block (~lines 451–465) or document elsewhere.`
      ).toBe(true);
    }
  );

  it('schema has no obvious typos in field names', () => {
    // Belt-and-braces: every field must be a sensible camelCase
    // identifier. A typo'd field declaration (e.g. `apIKey` vs
    // `apiKey`) would pass the parametric tests above if the
    // README happened to share the typo, but lots of customer
    // code generators or TypeScript autocomplete tools would
    // produce the canonical form. Pin the shape.
    for (const field of SCHEMA_FIELDS) {
      expect(
        /^[a-z][a-zA-Z0-9]*$/.test(field),
        `Field "${field}" does not match camelCase. Likely a typo or naming-convention regression.`
      ).toBe(true);
    }
  });
});
