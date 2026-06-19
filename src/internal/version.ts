/**
 * Package version + User-Agent string.
 *
 * The version is hardcoded here rather than imported from package.json
 * because:
 *
 *   1. JSON imports vary across runtimes (Node 22 supports them with
 *      an import attribute, browsers don't).
 *   2. tsup bundles JSON imports into the dist, but the result depends
 *      on bundler behaviour we'd rather not depend on.
 *   3. A simple constant is auditable — `git grep` finds it instantly.
 *
 * **Maintenance**: bumped in lockstep with `package.json#version` by
 * the release flow (`packages/sdk/scripts/publish.sh`). The unit test
 * in `tests/unit/user-agent.test.ts` asserts the two stay in sync so
 * a forgotten bump fails CI.
 */
export const SDK_VERSION = '0.1.1';

/**
 * The Kash API version this SDK release was tested against. Sent as
 * the `X-Kash-Api-Version` header on every request; the server uses it to
 * keep this SDK on its compatible behaviour even after newer dated
 * versions ship.
 *
 * Format: ISO date (`YYYY-MM-DD`). Lexicographic comparison ==
 * chronological.
 *
 * Stripe-style policy: every SDK release pins a specific API version.
 * To upgrade to newer server-side behaviour, bump this constant in
 * a new SDK release and document the changes in CHANGELOG.md. Existing
 * consumers continue to receive the API version their SDK pinned.
 *
 * Consumers can override per-client via `apiVersion` in the
 * {@link KashClientConfig} — useful for staying ahead of the SDK
 * release cadence or for testing newer server-side behaviour without
 * a SDK upgrade.
 */
export const SDK_API_VERSION = '2026-04-29';

/**
 * The runtime tag added to the `User-Agent`. Best-effort detection;
 * falls back to `unknown` so the header is always set.
 *
 * Recognised:
 *   - Node.js (`process.versions.node`)
 *   - Bun (`globalThis.Bun.version`)
 *   - Deno (`globalThis.Deno.version.deno`)
 *   - Browsers (`globalThis.navigator.userAgent` first 60 chars)
 */
function detectRuntime(): string {
  // Use type-erased lookups so this file compiles cleanly under
  // `lib: ["ES2022", "DOM"]` without requiring `@types/node`.
  const g = globalThis as Record<string, unknown>;

  const bun = g['Bun'] as { version?: string } | undefined;
  if (bun?.version) return `bun/${bun.version}`;

  const deno = g['Deno'] as { version?: { deno?: string } } | undefined;
  if (deno?.version?.deno) return `deno/${deno.version.deno}`;

  const proc = g['process'] as { versions?: { node?: string; bun?: string } } | undefined;
  if (proc?.versions?.node) return `node/${proc.versions.node}`;

  const nav = g['navigator'] as { userAgent?: string } | undefined;
  if (nav?.userAgent) return `browser/${nav.userAgent.slice(0, 60).replace(/[\s;]+/g, '_')}`;

  return 'unknown';
}

/**
 * The fully-formed `User-Agent` we send. Computed once per process.
 *
 * Format: `@kashdao/sdk/<version> (<runtime>)`
 *
 * Examples:
 *   - `@kashdao/sdk/0.1.0 (node/22.4.1)`
 *   - `@kashdao/sdk/0.1.0 (bun/1.2.0)`
 *   - `@kashdao/sdk/0.1.0 (deno/2.0.0)`
 *   - `@kashdao/sdk/0.1.0 (browser/Mozilla_5.0_...)`
 */
export const USER_AGENT = `@kashdao/sdk/${SDK_VERSION} (${detectRuntime()})`;
