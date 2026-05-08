import { describe, expect, it } from 'vitest';

import { KashClient, KashConfigurationError, KashError } from '../../src/index.js';

describe('configuration validation', () => {
  it('empty apiKey → KashConfigurationError, not raw ZodError', () => {
    let err: unknown;
    try {
      // eslint-disable-next-line @typescript-eslint/no-unused-expressions
      new KashClient({ apiKey: '' });
    } catch (e) {
      err = e;
    }
    expect(err).toBeInstanceOf(KashConfigurationError);
    expect(err).toBeInstanceOf(KashError);
    const cfg = err as KashConfigurationError;
    expect(cfg.code).toBe('SDK_CONFIGURATION_INVALID');
    expect(cfg.issues.length).toBeGreaterThan(0);
    expect(cfg.issues[0]!.path).toEqual(['apiKey']);
  });

  it('non-positive timeoutMs → KashConfigurationError with the right path', () => {
    let err: unknown;
    try {
      // eslint-disable-next-line @typescript-eslint/no-unused-expressions
      new KashClient({ apiKey: 'kash_test_xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx', timeoutMs: 0 });
    } catch (e) {
      err = e;
    }
    expect(err).toBeInstanceOf(KashConfigurationError);
    expect((err as KashConfigurationError).issues[0]!.path).toEqual(['timeoutMs']);
  });

  it('non-URL baseUrl → KashConfigurationError', () => {
    let err: unknown;
    try {
      // eslint-disable-next-line @typescript-eslint/no-unused-expressions
      new KashClient({
        apiKey: 'kash_test_xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx',
        baseUrl: 'not a url',
      });
    } catch (e) {
      err = e;
    }
    expect(err).toBeInstanceOf(KashConfigurationError);
  });

  it('userAgentSuffix with invalid chars → KashConfigurationError', () => {
    let err: unknown;
    try {
      // eslint-disable-next-line @typescript-eslint/no-unused-expressions
      new KashClient({
        apiKey: 'kash_test_xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx',
        userAgentSuffix: 'bad\nheader',
      });
    } catch (e) {
      err = e;
    }
    expect(err).toBeInstanceOf(KashConfigurationError);
    expect((err as KashConfigurationError).issues[0]!.path).toEqual(['userAgentSuffix']);
  });

  it('valid config constructs without throwing and exposes normalised values', () => {
    const kash = new KashClient({ apiKey: 'kash_test_xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx' });
    // kash_test_* auto-routes to staging.
    expect(kash.config.baseUrl).toBe('https://api-staging.kash.bot/v1');
    expect(kash.config.timeoutMs).toBe(30_000);
    expect(kash.config.maxRetries).toBe(3);
  });

  it('kash_live_* key defaults to production baseUrl', () => {
    const kash = new KashClient({
      apiKey: 'kash_live_AAAaaaBBBbbbCCCcccDDDdddEEEeeeFF',
    });
    expect(kash.config.baseUrl).toBe('https://api.kash.bot/v1');
  });
});
