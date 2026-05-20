import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

import { describe, expect, it, vi } from 'vitest';

import { KashClient, SDK_VERSION, USER_AGENT } from '../../src/index.js';

import { META } from './_test-utils.js';

// Resolve packages/sdk/package.json relative to this test file so the
// drift check works regardless of cwd (Vitest worker pool varies).
const PACKAGE_JSON_PATH = fileURLToPath(new URL('../../package.json', import.meta.url));
const PACKAGE_JSON_VERSION = (
  JSON.parse(readFileSync(PACKAGE_JSON_PATH, 'utf8')) as {
    version: string;
  }
).version;

function jsonResponse(body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status: 200,
    headers: { 'content-type': 'application/json' },
  });
}

describe('User-Agent', () => {
  it('USER_AGENT starts with the package name + version', () => {
    expect(USER_AGENT.startsWith(`@kashdao/sdk/${SDK_VERSION} (`)).toBe(true);
    expect(USER_AGENT).toMatch(/\)$/);
  });

  it('SDK_VERSION matches the package.json version', () => {
    // SDK_VERSION lives in src/internal/version.ts (hardcoded — see the
    // docstring there for why we can't import package.json directly at
    // runtime). This guard reads package.json AT TEST TIME and asserts
    // the two match, so a release that bumps package.json without
    // updating the constant (or vice versa) fails CI before the User-
    // Agent header drifts from the published version.
    expect(SDK_VERSION).toBe(PACKAGE_JSON_VERSION);
  });

  it('sends User-Agent on every request', async () => {
    const fetchSpy = vi.fn(async () => {
      const m = stubMarket();
      return jsonResponse({ market: m, data: m, _meta: META });
    });
    const kash = new KashClient({
      apiKey: 'kash_test_xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx',
      baseUrl: 'https://api.test.local/v1',
      fetch: fetchSpy as typeof fetch,
      maxRetries: 0,
    });
    await kash.markets.get('00000000-0000-0000-0000-000000000001');
    const init = fetchSpy.mock.calls[0]![1] as RequestInit;
    const headers = init.headers as Record<string, string>;
    expect(headers['User-Agent']).toBe(USER_AGENT);
  });

  it('appends userAgentSuffix when configured', async () => {
    const fetchSpy = vi.fn(async () => {
      const m = stubMarket();
      return jsonResponse({ market: m, data: m, _meta: META });
    });
    const kash = new KashClient({
      apiKey: 'kash_test_xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx',
      baseUrl: 'https://api.test.local/v1',
      fetch: fetchSpy as typeof fetch,
      userAgentSuffix: 'acme-trader/1.4.2',
      maxRetries: 0,
    });
    await kash.markets.get('00000000-0000-0000-0000-000000000001');
    const init = fetchSpy.mock.calls[0]![1] as RequestInit;
    const headers = init.headers as Record<string, string>;
    expect(headers['User-Agent']).toBe(`${USER_AGENT} acme-trader/1.4.2`);
  });
});

function stubMarket(): unknown {
  return {
    id: '00000000-0000-0000-0000-000000000001',
    contractAddress: '0xabc',
    chainId: 8453,
    title: 'Test',
    description: null,
    status: 'ACTIVE',
    outcomeCount: 2,
    outcomes: [
      { index: 0, label: 'Yes', probability: 0.5 },
      { index: 1, label: 'No', probability: 0.5 },
    ],
    imageUrl: null,
    createdAt: '2026-04-30T12:00:00.000Z',
    expiresAt: null,
    resolvedAt: null,
  };
}
