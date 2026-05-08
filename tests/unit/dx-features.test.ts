/**
 * Developer-experience features:
 *
 *   - `KASH_API_KEY` env-var auto-discovery
 *   - `kash_(live|test)_<32 alphanumeric>` shape validation
 *   - `kash.healthCheck()` connectivity probe
 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { KashClient, KashConfigurationError } from '../../src/index.js';

const VALID_TEST_KEY = 'kash_test_xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx';

function jsonResponse(body: unknown, init: ResponseInit = {}): Response {
  return new Response(JSON.stringify(body), {
    status: init.status ?? 200,
    headers: { 'content-type': 'application/json', ...(init.headers ?? {}) },
  });
}

describe('apiKey shape validation', () => {
  it('accepts kash_test_<32 alphanum>', () => {
    expect(() => new KashClient({ apiKey: VALID_TEST_KEY })).not.toThrow();
  });

  it('accepts kash_live_<32 alphanum>', () => {
    expect(
      () =>
        new KashClient({
          apiKey: 'kash_live_AAAaaaBBBbbbCCCcccDDDdddEEEeeeFF',
        })
    ).not.toThrow();
  });

  it('rejects webhook secret pasted as API key', () => {
    let err: unknown;
    try {
      // eslint-disable-next-line @typescript-eslint/no-unused-expressions
      new KashClient({ apiKey: 'whsec_iWasMeantToBeAWebhookSecretNotAnApiKey' });
    } catch (e) {
      err = e;
    }
    expect(err).toBeInstanceOf(KashConfigurationError);
    expect((err as KashConfigurationError).message).toContain('webhook');
  });

  it('rejects truncated key (too short for 32-char tail)', () => {
    expect(() => new KashClient({ apiKey: 'kash_test_short' })).toThrow(KashConfigurationError);
  });

  it('rejects key with non-alphanumeric tail', () => {
    expect(
      () =>
        new KashClient({
          apiKey: 'kash_test_oh-no-dashes-and-symbols!@#$%^&*()_+',
        })
    ).toThrow(KashConfigurationError);
  });

  it('rejects empty string', () => {
    expect(() => new KashClient({ apiKey: '' })).toThrow(KashConfigurationError);
  });

  it('omitted apiKey is allowed at construction (resource calls will then fail server-side)', () => {
    expect(() => new KashClient({})).not.toThrow();
    // eslint-disable-next-line @typescript-eslint/no-unused-expressions
    expect(() => new KashClient()).not.toThrow();
  });
});

describe('env-var auto-discovery', () => {
  beforeEach(() => {
    delete (globalThis as { process?: { env: Record<string, string | undefined> } }).process?.env
      .KASH_API_KEY;
    delete (globalThis as { process?: { env: Record<string, string | undefined> } }).process?.env
      .KASH_BASE_URL;
  });

  afterEach(() => {
    delete (globalThis as { process?: { env: Record<string, string | undefined> } }).process?.env
      .KASH_API_KEY;
    delete (globalThis as { process?: { env: Record<string, string | undefined> } }).process?.env
      .KASH_BASE_URL;
  });

  it('reads KASH_API_KEY from env when not passed explicitly', () => {
    process.env.KASH_API_KEY = VALID_TEST_KEY;
    const kash = new KashClient();
    expect(kash.config.apiKey).toBe(VALID_TEST_KEY);
  });

  it('reads KASH_BASE_URL from env when not passed explicitly', () => {
    process.env.KASH_BASE_URL = 'https://api-staging.kash.bot/v1';
    const kash = new KashClient({ apiKey: VALID_TEST_KEY });
    expect(kash.config.baseUrl).toBe('https://api-staging.kash.bot/v1');
  });

  it('explicit config beats env (caller wins)', () => {
    process.env.KASH_API_KEY = VALID_TEST_KEY;
    const explicit = 'kash_live_AAAaaaBBBbbbCCCcccDDDdddEEEeeeFF';
    const kash = new KashClient({ apiKey: explicit });
    expect(kash.config.apiKey).toBe(explicit);
  });

  it('env-var still gets shape-validated; bad env fails the constructor', () => {
    process.env.KASH_API_KEY = 'whsec_garbage_pasted_in_env_var_oh_no';
    expect(() => new KashClient()).toThrow(KashConfigurationError);
  });
});

describe('baseUrl auto-routing from key prefix', () => {
  beforeEach(() => {
    delete (globalThis as { process?: { env: Record<string, string | undefined> } }).process?.env
      .KASH_API_KEY;
    delete (globalThis as { process?: { env: Record<string, string | undefined> } }).process?.env
      .KASH_BASE_URL;
  });
  afterEach(() => {
    delete (globalThis as { process?: { env: Record<string, string | undefined> } }).process?.env
      .KASH_API_KEY;
    delete (globalThis as { process?: { env: Record<string, string | undefined> } }).process?.env
      .KASH_BASE_URL;
  });

  it('kash_test_* key → staging baseUrl by default', () => {
    const kash = new KashClient({ apiKey: VALID_TEST_KEY });
    expect(kash.config.baseUrl).toBe('https://api-staging.kash.bot/v1');
  });

  it('kash_live_* key → production baseUrl by default', () => {
    const kash = new KashClient({
      apiKey: 'kash_live_AAAaaaBBBbbbCCCcccDDDdddEEEeeeFF',
    });
    expect(kash.config.baseUrl).toBe('https://api.kash.bot/v1');
  });

  it('no key → production baseUrl by default', () => {
    const kash = new KashClient();
    expect(kash.config.baseUrl).toBe('https://api.kash.bot/v1');
  });

  it('explicit baseUrl wins over auto-route', () => {
    const kash = new KashClient({
      apiKey: VALID_TEST_KEY, // would auto-route to staging
      baseUrl: 'https://api.kash.bot/v1', // but consumer pinned production
    });
    expect(kash.config.baseUrl).toBe('https://api.kash.bot/v1');
  });

  it('KASH_BASE_URL env wins over auto-route too', () => {
    process.env.KASH_BASE_URL = 'https://my-private-mirror.example.com/v1';
    const kash = new KashClient({ apiKey: VALID_TEST_KEY });
    expect(kash.config.baseUrl).toBe('https://my-private-mirror.example.com/v1');
  });

  it('env-only KASH_API_KEY=test still auto-routes to staging', () => {
    process.env.KASH_API_KEY = VALID_TEST_KEY;
    const kash = new KashClient();
    expect(kash.config.baseUrl).toBe('https://api-staging.kash.bot/v1');
    expect(kash.config.apiKey).toBe(VALID_TEST_KEY);
  });
});

describe('healthCheck()', () => {
  it('returns ok:true when the server returns 2xx', async () => {
    const fetchSpy = vi.fn(async () =>
      jsonResponse({ status: 'ok', service: 'public-api', version: '1.2.3' })
    );
    const kash = new KashClient({
      apiKey: VALID_TEST_KEY,
      baseUrl: 'https://api.test.local/v1',
      fetch: fetchSpy as typeof fetch,
      maxRetries: 0,
    });
    const result = await kash.healthCheck();
    expect(result.ok).toBe(true);
    expect(result.version).toBe('1.2.3');
    expect(result.status).toBe('ok');
    expect(result.latencyMs).toBeGreaterThanOrEqual(0);
    const url = fetchSpy.mock.calls[0]![0] as string;
    expect(url).toContain('/v1/health');
  });

  it('returns ok:false on server error — does NOT throw', async () => {
    const fetchSpy = vi.fn(
      async () =>
        new Response(JSON.stringify({ code: 'INTERNAL_ERROR' }), {
          status: 500,
          headers: { 'content-type': 'application/problem+json' },
        })
    );
    const kash = new KashClient({
      apiKey: VALID_TEST_KEY,
      baseUrl: 'https://api.test.local/v1',
      fetch: fetchSpy as typeof fetch,
      maxRetries: 0,
    });
    const result = await kash.healthCheck();
    expect(result.ok).toBe(false);
    expect(result.latencyMs).toBeGreaterThanOrEqual(0);
  });

  it('returns ok:false on network failure — does NOT throw', async () => {
    const fetchSpy = vi.fn(async () => {
      throw new Error('ECONNREFUSED');
    });
    const kash = new KashClient({
      apiKey: VALID_TEST_KEY,
      baseUrl: 'https://api.test.local/v1',
      fetch: fetchSpy as typeof fetch,
      maxRetries: 0,
    });
    const result = await kash.healthCheck();
    expect(result.ok).toBe(false);
  });

  it('does not retry — health check should fail fast', async () => {
    const fetchSpy = vi.fn(
      async () =>
        new Response(JSON.stringify({}), {
          status: 503,
          headers: { 'content-type': 'application/problem+json' },
        })
    );
    const kash = new KashClient({
      apiKey: VALID_TEST_KEY,
      baseUrl: 'https://api.test.local/v1',
      fetch: fetchSpy as typeof fetch,
      maxRetries: 5, // even with retries enabled, healthCheck overrides to 0
    });
    const result = await kash.healthCheck();
    expect(result.ok).toBe(false);
    expect(fetchSpy).toHaveBeenCalledOnce();
  });
});
