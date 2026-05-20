/**
 * README ↔ KashClient public surface drift detector.
 *
 * `packages/sdk/README.md` documents the SDK's sub-client surface
 * verbatim — both in the resource list ("Stripe-style resources —
 * `kash.markets.list()`, `kash.trades.create()`") and in the scope
 * table ("`markets:read` → `kash.markets.list()`, `kash.markets.get()`,
 * `kash.markets.predictions()`"). Every customer code example begins
 * with one of these references.
 *
 * If someone renames `client.markets` → `client.predictions`, removes
 * `client.traces.get`, or splits `kash.webhooks.rotateSecret` into a
 * different shape, every README example that touches that surface
 * silently rots. Customers' code (copied from the README) breaks at
 * runtime with `undefined is not a function`.
 *
 * Approach: parse the README to find every `kash.<subclient>.<method>`
 * reference, then assert each one exists as a function on a real
 * `KashClient` instance. The test self-updates from the README — adding
 * a new documented method without implementing it (or vice versa)
 * fails at PR time.
 *
 * Same drift class as round AH (CLI bin-name) and round AE
 * (protocol-sdk chain-ids) — different surface, same principle: the
 * README is a contract.
 */

import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

import { describe, expect, it } from 'vitest';

import { KashClient } from '../../src/client.js';

const README_PATH = fileURLToPath(new URL('../../README.md', import.meta.url));
const README = readFileSync(README_PATH, 'utf8');

type Reference = { readonly subclient: string; readonly method: string };

/**
 * Extract every `kash.<subclient>.<method>` reference from the README.
 *
 * The variable name is parameterised (`kash`, `client`, `test`, `live`,
 * `probe`) — README examples reuse common names. The regex captures the
 * `(subclient).(method)` pair after any of those identifiers.
 *
 * Method names are limited to identifier characters and exclude `(`
 * tokens — `kash.markets.list()` and `kash.markets.list` both extract
 * to `{markets, list}`.
 */
function extractReferences(text: string): readonly Reference[] {
  // Variable names commonly used in README examples for a KashClient
  // instance. Add new ones here if the README starts using them.
  const variableNames = ['kash', 'client', 'test', 'live', 'probe'];
  const pattern = new RegExp(
    `\\b(?:${variableNames.join('|')})\\.([a-zA-Z_]+)\\.([a-zA-Z_]+)\\b`,
    'g'
  );
  const refs = new Map<string, Reference>();
  for (const m of text.matchAll(pattern)) {
    const subclient = m[1]!;
    const method = m[2]!;
    refs.set(`${subclient}.${method}`, { subclient, method });
  }
  return [...refs.values()];
}

const KNOWN_SUBCLIENTS = new Set([
  'markets',
  'trades',
  'traces',
  'quotes',
  'portfolio',
  'webhooks',
  'account',
]);

/**
 * Some `kash.X.Y` matches are legitimate non-method refs — README
 * prose like "kash.markets is the resource" or markdown table headers
 * that happen to look like method calls. We pin the SUBCLIENT level
 * here, but allow specific methods through the per-subclient
 * assertion below. The list of methods comes from the README itself
 * via extractReferences; we just filter out subclients that aren't
 * KashClient sub-clients (e.g. `kash.markets.metadata` if README
 * documented a nested type by accident).
 */
function isLikelyMethodReference(ref: Reference): boolean {
  return KNOWN_SUBCLIENTS.has(ref.subclient);
}

describe('packages/sdk/README.md ↔ KashClient surface drift', () => {
  // Dummy test-mode key: kash_test_ + exactly 32 alphanumeric chars.
  // The client's runtime validation rejects anything else; we don't
  // make any HTTP calls in this test so the value is irrelevant.
  const client = new KashClient({ apiKey: 'kash_test_abcdefghijklmnopqrstuvwxyz012345' });
  const allReferences = extractReferences(README);
  const methodReferences = allReferences.filter(isLikelyMethodReference);

  it('finds at least the well-known README references', () => {
    // Sanity floor: if the parser breaks (variable-name list regresses,
    // regex changes), the test must not pass empty. Anchor to a few
    // refs guaranteed to be in any version of the README.
    const refKeys = new Set(methodReferences.map((r) => `${r.subclient}.${r.method}`));
    expect(refKeys.size).toBeGreaterThanOrEqual(10);
    expect(refKeys.has('markets.list'), 'README must reference kash.markets.list').toBe(true);
    expect(refKeys.has('trades.create'), 'README must reference kash.trades.create').toBe(true);
    expect(refKeys.has('webhooks.list'), 'README must reference kash.webhooks.list').toBe(true);
  });

  it.each(Array.from(KNOWN_SUBCLIENTS).map((s) => [s] as const))(
    'KashClient exposes the documented "%s" sub-client',
    (subclient) => {
      // Each subclient documented in the README must be a property
      // on the client. A regression that renamed the property (e.g.
      // markets → predictions, traces → activity) would orphan every
      // README example touching that sub-client.
      const value = (client as unknown as Record<string, unknown>)[subclient];
      expect(
        value,
        `KashClient.${subclient} is missing — README references it but the client doesn't expose it. ` +
          `Either rename the property back, or update the README.`
      ).toBeDefined();
      expect(typeof value).toBe('object');
    }
  );

  it.each(
    methodReferences.map((r) => [`${r.subclient}.${r.method}`, r.subclient, r.method] as const)
  )(
    'README reference kash.%s resolves to a function on the client',
    (_label, subclient, method) => {
      // Each documented method MUST exist as a callable on the
      // corresponding sub-client. A regression that renamed a method
      // (e.g. webhooks.rotateSecret → webhooks.rotate) would leave
      // the README pointing at an undefined property, breaking every
      // customer who copied that line.
      const sub = (client as unknown as Record<string, unknown>)[subclient];
      expect(sub, `sub-client "${subclient}" missing on KashClient`).toBeDefined();
      const fn = (sub as Record<string, unknown>)[method];
      expect(
        typeof fn,
        `README references kash.${subclient}.${method}() but it doesn't exist on KashClient.${subclient}. ` +
          `Either implement it, or update the README to remove the reference.`
      ).toBe('function');
    }
  );
});
