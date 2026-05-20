/**
 * SDK README retry-default claims ↔ kashClientConfigSchema defaults.
 *
 * The README documents the SDK's retry defaults verbatim in the
 * resilience section (~lines 455–456, 935):
 *
 *   maxRetries: 3,         // 0 disables retry
 *   retryBaseDelayMs: 200, // exponential backoff base
 *
 * The actual defaults live in `kashClientConfigSchema` in
 * `src/internal/config.ts`. If anyone bumps a default (e.g.
 * maxRetries 3 → 5 for higher resilience) without updating the
 * README, customers reading the docs build their resource-cost
 * mental model around the wrong number. A customer who budgets for
 * 3 retries at 200ms base may be surprised by 5 retries chewing
 * twice the latency tail.
 *
 * Same drift class as rounds AS/AT/AU/AV (numeric literals in
 * customer docs vs source-of-truth constants), applied to retry
 * configuration — the highest-signal SDK-level "what does this do
 * by default" question customers ask.
 */

import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

import { describe, expect, it } from 'vitest';

import { kashClientConfigSchema } from '../../src/internal/config.js';

const README_PATH = fileURLToPath(new URL('../../README.md', import.meta.url));
const README = readFileSync(README_PATH, 'utf8');

/**
 * Walk the Zod schema's `.shape` to pull each field's default value.
 * The schema is built with `.default(N)` for retry knobs, so the
 * default sits under each field's `_def.defaultValue()`.
 */
function getZodDefault(field: string): unknown {
  const shape = (
    kashClientConfigSchema as unknown as { _def: { shape: () => Record<string, unknown> } }
  )._def.shape();
  const node = shape[field] as { _def: { defaultValue?: () => unknown } } | undefined;
  if (!node || typeof node._def.defaultValue !== 'function') {
    throw new Error(`Field "${field}" has no .default(...) — schema shape may have changed.`);
  }
  return node._def.defaultValue();
}

describe('packages/sdk/README.md ↔ kashClientConfigSchema retry defaults', () => {
  it('maxRetries default in README matches the schema default', () => {
    const schemaDefault = getZodDefault('maxRetries') as number;
    // The README opens its quick-config example with this line.
    // The trailing comment is informational — pin both the value
    // and the surrounding context (`maxRetries: <N>,`) so a future
    // refactor that bumps the constant but leaves the prose untouched
    // fails CI.
    expect(
      README.includes(`maxRetries: ${schemaDefault}`),
      `README must document "maxRetries: ${schemaDefault}" to match kashClientConfigSchema. ` +
        `If the constant changed, update README.md. Schema default: ${schemaDefault}.`
    ).toBe(true);
    // Plus the prose claim "(default ${schemaDefault})" downstream in
    // the resilience explainer.
    expect(
      README.includes(`(default ${schemaDefault})`),
      `README must mention "(default ${schemaDefault})" somewhere in the resilience prose.`
    ).toBe(true);
  });

  it('retryBaseDelayMs default in README matches the schema default', () => {
    const schemaDefault = getZodDefault('retryBaseDelayMs') as number;
    expect(
      README.includes(`retryBaseDelayMs: ${schemaDefault}`),
      `README must document "retryBaseDelayMs: ${schemaDefault}" to match kashClientConfigSchema.`
    ).toBe(true);
  });

  it('maxRetries=0 is documented as the retry-disable knob', () => {
    // The README's quick-config comment reads "// 0 disables retry"
    // — pin that this remains documented because customer code that
    // sets `maxRetries: 0` for testing depends on the SDK actually
    // disabling retry at 0 (which it does: the schema allows .min(0)).
    expect(
      /maxRetries:\s*0/.test(README) || /0 disables/.test(README),
      'README must explain that maxRetries: 0 disables retry (the lower-bound knob customers reach for in tests).'
    ).toBe(true);
  });

  it('schema retry defaults are sensible (defence-in-depth)', () => {
    // Belt-and-braces: a regression that flipped the defaults to
    // values that don't make sense (e.g. maxRetries: -1 via
    // intentional bypass, retryBaseDelayMs: 0 disabling backoff
    // entirely) would pass the parity-with-README check ABOVE if
    // someone also "fixed" the README — but it would still ship
    // broken behaviour. Pin reasonable bounds independently.
    const maxRetries = getZodDefault('maxRetries') as number;
    const retryBaseDelayMs = getZodDefault('retryBaseDelayMs') as number;
    const retryMaxDelayMs = getZodDefault('retryMaxDelayMs') as number;
    expect(maxRetries).toBeGreaterThanOrEqual(0);
    expect(maxRetries).toBeLessThanOrEqual(10); // schema's own upper bound
    expect(retryBaseDelayMs).toBeGreaterThan(0);
    expect(retryMaxDelayMs).toBeGreaterThanOrEqual(retryBaseDelayMs);
  });
});
