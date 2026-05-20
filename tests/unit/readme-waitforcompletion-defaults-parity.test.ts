/**
 * SDK README `waitForCompletion` defaults ↔ TradesClient source.
 *
 * The README documents `trades.waitForCompletion(id)` polling
 * defaults inline:
 *
 *   const done = await kash.trades.waitForCompletion(tradeId, {
 *     timeoutMs: 60_000,     // default
 *     pollIntervalMs: 2_000, // default
 *     ...
 *   });
 *
 * The actual defaults live in `TradesClient.waitForCompletion` as
 * `opts.timeoutMs ?? 60_000` / `opts.pollIntervalMs ?? 2_000`. These
 * are NOT Zod schema fields — they're inline `??` literals in the
 * method body, so they need source-level extraction.
 *
 * Customer impact of drift: a trader writing a runbook based on the
 * README's "default 60s timeout" assumption is surprised when the SDK
 * times out at 30s (or never times out at 120s) on the same trade.
 * The promise of waitForCompletion is "I'll block until done or up to
 * <documented> seconds" — both sides of that bound are load-bearing.
 *
 * Same drift class as round BD (kashClientConfigSchema retry defaults)
 * for the polling-specific defaults. Pairs with round BB (trade-status
 * enum parity) which pins the OTHER half of waitForCompletion's
 * contract: the terminal states it polls until.
 */

import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

import { describe, expect, it } from 'vitest';

const README_PATH = fileURLToPath(new URL('../../README.md', import.meta.url));
const README = readFileSync(README_PATH, 'utf8');

const TRADES_PATH = fileURLToPath(new URL('../../src/clients/trades.ts', import.meta.url));
const TRADES_SOURCE = readFileSync(TRADES_PATH, 'utf8');

/**
 * Extract the `??` default for a given option inside the
 * `waitForCompletion` method body. The pattern is
 * `opts.<field> ?? <N>`. The number can be either a plain digit
 * sequence or an underscore-separated literal like `60_000`.
 */
function extractWaitDefault(source: string, field: string): number {
  const re = new RegExp(`opts\\.${field}\\s*\\?\\?\\s*([\\d_]+)`);
  const m = re.exec(source);
  if (!m) {
    throw new Error(`Could not find "opts.${field} ?? <N>" in trades.ts source.`);
  }
  return Number.parseInt(m[1]!.replace(/_/g, ''), 10);
}

const TIMEOUT_DEFAULT = extractWaitDefault(TRADES_SOURCE, 'timeoutMs');
const POLL_INTERVAL_DEFAULT = extractWaitDefault(TRADES_SOURCE, 'pollIntervalMs');

/**
 * Match a numeric literal in the same form the README and source
 * use: `60_000` (with underscore) AND `60000` (without). The README
 * uses the underscore form for readability; tests should tolerate
 * either since a future codemod might change formatting.
 */
function literalForms(n: number): readonly string[] {
  const flat = String(n);
  if (n < 1000) return [flat];
  // 60000 → "60_000"; 200 → "200" (no separator). The README uses
  // the `_` thousands separator throughout, so prefer that form for
  // the parity check.
  const withSep = flat.replace(/(\d)(?=(\d{3})+(?!\d))/g, '$1_');
  return [flat, withSep];
}

describe('packages/sdk/README.md ↔ waitForCompletion defaults', () => {
  it('README documents the actual timeoutMs default', () => {
    const forms = literalForms(TIMEOUT_DEFAULT);
    const found = forms.some((f) => README.includes(`timeoutMs: ${f}, // default`));
    expect(
      found,
      `README must document "timeoutMs: <${forms.join(' OR ')}>, // default" in the waitForCompletion ` +
        `example, matching trades.ts:opts.timeoutMs ?? ${TIMEOUT_DEFAULT}. ` +
        `If the constant changed, update README.md.`
    ).toBe(true);
  });

  it('README documents the actual pollIntervalMs default', () => {
    const forms = literalForms(POLL_INTERVAL_DEFAULT);
    const found = forms.some((f) => README.includes(`pollIntervalMs: ${f}, // default`));
    expect(
      found,
      `README must document "pollIntervalMs: <${forms.join(' OR ')}>, // default" matching ` +
        `trades.ts:opts.pollIntervalMs ?? ${POLL_INTERVAL_DEFAULT}.`
    ).toBe(true);
  });

  it('defaults are sensible (defence-in-depth bounds)', () => {
    // The polling loop is bounded by timeoutMs. If pollIntervalMs
    // ever exceeded timeoutMs, waitForCompletion would never check
    // status after the first fetch. Pin the relationship so a
    // regression that swapped the constants fails loudly.
    expect(TIMEOUT_DEFAULT).toBeGreaterThan(POLL_INTERVAL_DEFAULT);
    // Both must be positive integers (already enforced at the
    // Number.parseInt boundary, but pin explicitly).
    expect(TIMEOUT_DEFAULT).toBeGreaterThan(0);
    expect(POLL_INTERVAL_DEFAULT).toBeGreaterThan(0);
    // The poll-interval must be small enough to give the loop at
    // least a few opportunities to check status. <= timeoutMs / 5
    // means at least 5 status checks in the default window.
    expect(POLL_INTERVAL_DEFAULT * 5).toBeLessThanOrEqual(TIMEOUT_DEFAULT);
  });
});
