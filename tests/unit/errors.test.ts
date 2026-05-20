import { describe, expect, it } from 'vitest';

import {
  classifyHttpError,
  KashAbortedError,
  KashAuthenticationError,
  KashAuthorizationError,
  KashConflictError,
  KashError,
  KashMaintenanceError,
  KashNetworkError,
  KashNotFoundError,
  KashRateLimitError,
  KashServerError,
  KashTimeoutError,
  KashValidationError,
} from '../../src/errors.js';

describe('error hierarchy', () => {
  it('every subclass extends KashError and Error', () => {
    const authn = new KashAuthenticationError('x', { code: 'API_KEY_MISSING' });
    const authz = new KashAuthorizationError('x', { code: 'INSUFFICIENT_SCOPE' });
    const notFound = new KashNotFoundError('x', { code: 'RESOURCE_NOT_FOUND' });
    const conflict = new KashConflictError('x', { code: 'IDEMPOTENCY_KEY_CONFLICT' });
    const rate = new KashRateLimitError('x', { code: 'RATE_LIMIT_EXCEEDED' });
    const validation = new KashValidationError('x', { code: 'VALIDATION_FAILED' });
    const server = new KashServerError('x', { code: 'INTERNAL_ERROR' });
    const maintenance = new KashMaintenanceError('x', { code: 'API_TRADE_PROCESSING_HALTED' });
    const timeout = new KashTimeoutError('x', { code: 'SDK_TIMEOUT' });
    const network = new KashNetworkError('x', { code: 'SDK_NETWORK' });
    const aborted = new KashAbortedError('x', { code: 'SDK_ABORTED' });

    for (const err of [
      authn,
      authz,
      notFound,
      conflict,
      rate,
      validation,
      server,
      maintenance,
      timeout,
      network,
      aborted,
    ]) {
      expect(err).toBeInstanceOf(KashError);
      expect(err).toBeInstanceOf(Error);
    }
  });

  it('preserves the cause via ES2022 Error.cause', () => {
    const root = new Error('underlying');
    const err = new KashNetworkError('wrapper', { code: 'SDK_NETWORK', cause: root });
    expect(err.cause).toBe(root);
  });

  it('exposes name matching the constructor', () => {
    const err = new KashConflictError('x', { code: 'IDEMPOTENCY_KEY_CONFLICT' });
    expect(err.name).toBe('KashConflictError');
  });

  it('isRetryable defaults', () => {
    expect(new KashAuthenticationError('x', { code: 'A' }).isRetryable).toBe(false);
    expect(new KashAuthorizationError('x', { code: 'A' }).isRetryable).toBe(false);
    expect(new KashNotFoundError('x', { code: 'A' }).isRetryable).toBe(false);
    expect(new KashConflictError('x', { code: 'A' }).isRetryable).toBe(false);
    expect(new KashValidationError('x', { code: 'A' }).isRetryable).toBe(false);
    expect(new KashRateLimitError('x', { code: 'A' }).isRetryable).toBe(true);
    expect(new KashServerError('x', { code: 'A' }).isRetryable).toBe(true);
    expect(new KashMaintenanceError('x', { code: 'A' }).isRetryable).toBe(true);
    expect(new KashTimeoutError('x', { code: 'A' }).isRetryable).toBe(true);
    expect(new KashNetworkError('x', { code: 'A' }).isRetryable).toBe(true);
    // Caller-driven aborts are NOT retryable — the consumer asked us
    // to stop, so we must not loop back into another attempt.
    expect(new KashAbortedError('x', { code: 'SDK_ABORTED' }).isRetryable).toBe(false);
  });
});

describe('classifyHttpError', () => {
  it('401 API_KEY_MISSING → KashAuthenticationError', () => {
    const err = classifyHttpError({
      status: 401,
      problem: { code: 'API_KEY_MISSING', detail: 'No key' },
    });
    expect(err).toBeInstanceOf(KashAuthenticationError);
    expect(err.code).toBe('API_KEY_MISSING');
    expect(err.statusCode).toBe(401);
  });

  it('401 API_KEY_REVOKED → KashAuthenticationError', () => {
    const err = classifyHttpError({ status: 401, problem: { code: 'API_KEY_REVOKED' } });
    expect(err).toBeInstanceOf(KashAuthenticationError);
  });

  it('403 INSUFFICIENT_SCOPE → KashAuthorizationError', () => {
    const err = classifyHttpError({ status: 403, problem: { code: 'INSUFFICIENT_SCOPE' } });
    expect(err).toBeInstanceOf(KashAuthorizationError);
  });

  it('403 IP_NOT_ALLOWED → KashAuthorizationError', () => {
    const err = classifyHttpError({ status: 403, problem: { code: 'IP_NOT_ALLOWED' } });
    expect(err).toBeInstanceOf(KashAuthorizationError);
  });

  it('404 MARKET_NOT_FOUND → KashNotFoundError', () => {
    const err = classifyHttpError({ status: 404, problem: { code: 'MARKET_NOT_FOUND' } });
    expect(err).toBeInstanceOf(KashNotFoundError);
  });

  it('404 RESOURCE_NOT_FOUND → KashNotFoundError', () => {
    const err = classifyHttpError({ status: 404, problem: { code: 'RESOURCE_NOT_FOUND' } });
    expect(err).toBeInstanceOf(KashNotFoundError);
  });

  it('409 IDEMPOTENCY_KEY_CONFLICT → KashConflictError, not retryable', () => {
    const err = classifyHttpError({
      status: 409,
      problem: { code: 'IDEMPOTENCY_KEY_CONFLICT' },
    });
    expect(err).toBeInstanceOf(KashConflictError);
    expect(err.isRetryable).toBe(false);
  });

  it('409 INSUFFICIENT_BALANCE → KashConflictError', () => {
    const err = classifyHttpError({ status: 409, problem: { code: 'INSUFFICIENT_BALANCE' } });
    expect(err).toBeInstanceOf(KashConflictError);
  });

  it('410 IDEMPOTENCY_KEY_EXPIRED → KashConflictError', () => {
    const err = classifyHttpError({ status: 410, problem: { code: 'IDEMPOTENCY_KEY_EXPIRED' } });
    expect(err).toBeInstanceOf(KashConflictError);
  });

  it('429 RATE_LIMIT_EXCEEDED → KashRateLimitError with parsed Retry-After', () => {
    const err = classifyHttpError({
      status: 429,
      problem: { code: 'RATE_LIMIT_EXCEEDED' },
      retryAfter: '60',
    });
    expect(err).toBeInstanceOf(KashRateLimitError);
    expect((err as KashRateLimitError).retryAfterSeconds).toBe(60);
    expect(err.isRetryable).toBe(true);
  });

  it('Retry-After HTTP-date form parses to seconds delta', () => {
    const now = 1_700_000_000_000;
    const tenSecondsLater = new Date(now + 10_000).toUTCString();
    const err = classifyHttpError({
      status: 429,
      problem: { code: 'RATE_LIMIT_EXCEEDED' },
      retryAfter: tenSecondsLater,
      nowMs: now,
    });
    expect((err as KashRateLimitError).retryAfterSeconds).toBe(10);
  });

  it('Retry-After malformed → undefined', () => {
    const err = classifyHttpError({
      status: 429,
      problem: { code: 'RATE_LIMIT_EXCEEDED' },
      retryAfter: 'not-a-date',
    });
    expect((err as KashRateLimitError).retryAfterSeconds).toBeUndefined();
  });

  it('Retry-After RFC 7231 asctime form parses to seconds delta when the runtime supports it', () => {
    // RFC 7231 §7.1.1.1 lists IMF-fixdate, RFC 850, and asctime as the
    // three accepted formats. asctime support is implementation-defined
    // in older Node engines, so this test is best-effort: when the host
    // `Date.parse` accepts it, we expect a parsed delta; when it
    // returns NaN we expect `undefined` (graceful degradation).
    const asctime = 'Sun Nov  6 08:49:37 1994';
    const parsed = Date.parse(asctime);
    const err = classifyHttpError({
      status: 429,
      problem: { code: 'RATE_LIMIT_EXCEEDED' },
      retryAfter: asctime,
      nowMs: parsed - 30_000,
    });
    if (Number.isFinite(parsed)) {
      expect((err as KashRateLimitError).retryAfterSeconds).toBe(30);
    } else {
      expect((err as KashRateLimitError).retryAfterSeconds).toBeUndefined();
    }
  });

  it('400 VALIDATION_FAILED → KashValidationError', () => {
    const err = classifyHttpError({ status: 400, problem: { code: 'VALIDATION_FAILED' } });
    expect(err).toBeInstanceOf(KashValidationError);
  });

  it('400 AMOUNT_TOO_LARGE → KashValidationError', () => {
    const err = classifyHttpError({ status: 400, problem: { code: 'AMOUNT_TOO_LARGE' } });
    expect(err).toBeInstanceOf(KashValidationError);
  });

  it('500 INTERNAL_ERROR → KashServerError', () => {
    const err = classifyHttpError({ status: 500, problem: { code: 'INTERNAL_ERROR' } });
    expect(err).toBeInstanceOf(KashServerError);
    expect(err.isRetryable).toBe(true);
  });

  it('503 API_TRADE_PROCESSING_HALTED → KashMaintenanceError with Retry-After', () => {
    const err = classifyHttpError({
      status: 503,
      problem: { code: 'API_TRADE_PROCESSING_HALTED' },
      retryAfter: '300',
    });
    expect(err).toBeInstanceOf(KashMaintenanceError);
    expect((err as KashMaintenanceError).retryAfterSeconds).toBe(300);
  });

  it('503 DEPENDENCY_UNAVAILABLE → KashServerError (not maintenance)', () => {
    const err = classifyHttpError({ status: 503, problem: { code: 'DEPENDENCY_UNAVAILABLE' } });
    expect(err).toBeInstanceOf(KashServerError);
    expect(err).not.toBeInstanceOf(KashMaintenanceError);
  });

  it('503 ROUTE_DISABLED → KashMaintenanceError (per-route kill switch)', () => {
    const err = classifyHttpError({
      status: 503,
      problem: { code: 'ROUTE_DISABLED', flag: 'api-trades-create' },
      retryAfter: '60',
    });
    expect(err).toBeInstanceOf(KashMaintenanceError);
    expect((err as KashMaintenanceError).retryAfterSeconds).toBe(60);
    // Per-route flag is surfaced via the RFC 7807 extensions bag.
    expect(err.extensions?.['flag']).toBe('api-trades-create');
  });

  it('classifyHttpError extracts RFC 7807 extension members onto err.extensions', () => {
    const err = classifyHttpError({
      status: 401,
      problem: {
        code: 'REQUEST_SIGNATURE_INVALID',
        signatureReason: 'expired_timestamp',
        // Standard fields should NOT appear in extensions.
        detail: 'Request signature expired',
      },
    });
    expect(err.extensions).toEqual({ signatureReason: 'expired_timestamp' });
    expect(err.extensions).not.toHaveProperty('detail');
    expect(err.extensions).not.toHaveProperty('code');
  });

  it('classifyHttpError leaves extensions undefined when the body has no extension members', () => {
    const err = classifyHttpError({
      status: 500,
      problem: { code: 'INTERNAL_ERROR', detail: 'oops' },
    });
    expect(err.extensions).toBeUndefined();
  });

  it('400 VALIDATION_FAILED → KashValidationError with server issues extracted from extensions', () => {
    const err = classifyHttpError({
      status: 400,
      problem: {
        code: 'VALIDATION_FAILED',
        detail: 'Invalid trade body',
        issues: [
          { path: ['amount'], message: 'Invalid format', code: 'invalid_string' },
          { path: ['outcomeIndex'], message: 'Must be non-negative' },
        ],
      },
    });
    expect(err).toBeInstanceOf(KashValidationError);
    const issues = (err as KashValidationError).issues;
    expect(issues).toEqual([
      { path: 'amount', message: 'Invalid format', code: 'invalid_string' },
      { path: 'outcomeIndex', message: 'Must be non-negative' },
    ]);
  });

  it('400 VALIDATION_FAILED → KashValidationError tolerates legacy "errors" extension key', () => {
    const err = classifyHttpError({
      status: 400,
      problem: {
        code: 'VALIDATION_FAILED',
        errors: [{ field: 'amount', message: 'Invalid' }],
      },
    });
    expect(err).toBeInstanceOf(KashValidationError);
    expect((err as KashValidationError).issues).toEqual([{ path: 'amount', message: 'Invalid' }]);
  });

  it('KashValidationError.issues is empty array when no structured issues present', () => {
    const err = classifyHttpError({
      status: 400,
      problem: { code: 'VALIDATION_FAILED', detail: 'bad input' },
    });
    expect(err).toBeInstanceOf(KashValidationError);
    expect((err as KashValidationError).issues).toEqual([]);
  });

  it('504 REQUEST_TIMEOUT → KashServerError', () => {
    const err = classifyHttpError({ status: 504, problem: { code: 'REQUEST_TIMEOUT' } });
    expect(err).toBeInstanceOf(KashServerError);
    expect(err.isRetryable).toBe(true);
  });

  it('populates requestId from input', () => {
    const err = classifyHttpError({
      status: 400,
      problem: { code: 'VALIDATION_FAILED' },
      requestId: 'req-123',
    });
    expect(err.requestId).toBe('req-123');
  });

  it('falls back to problem.requestId when header is absent', () => {
    const err = classifyHttpError({
      status: 400,
      problem: { code: 'VALIDATION_FAILED', requestId: 'body-req' },
    });
    expect(err.requestId).toBe('body-req');
  });

  it('uses problem.detail as message; falls back to problem.title', () => {
    const detailed = classifyHttpError({
      status: 400,
      problem: { code: 'VALIDATION_FAILED', detail: 'amount: must be positive' },
    });
    expect(detailed.message).toBe('amount: must be positive');
    const titleOnly = classifyHttpError({
      status: 500,
      problem: { code: 'INTERNAL_ERROR', title: 'Server burned down' },
    });
    expect(titleOnly.message).toBe('Server burned down');
    const empty = classifyHttpError({ status: 502, problem: {} });
    expect(empty.message).toBe('HTTP 502');
  });

  it('proxy-emitted body without code still classifies by status', () => {
    const err = classifyHttpError({ status: 502, problem: {} });
    expect(err).toBeInstanceOf(KashServerError);
    expect(err.code).toBe('INTERNAL_ERROR');
  });

  it('proxy-emitted 429 without code still parses Retry-After', () => {
    const err = classifyHttpError({ status: 429, problem: {}, retryAfter: '15' });
    expect(err).toBeInstanceOf(KashRateLimitError);
    expect((err as KashRateLimitError).retryAfterSeconds).toBe(15);
  });

  it('400 → KashValidationError, isRetryable false', () => {
    const err = classifyHttpError({ status: 400, problem: {} });
    expect(err.isRetryable).toBe(false);
  });

  // -------------------------------------------------------------------
  // hint propagation — the SDK appends client-side hints to error
  // messages when it can diagnose the failure better than the server.
  // The flagship case is the kash_live/kash_test ↔ baseUrl mismatch:
  // both round-trip to the server as a generic 401, but the SDK has
  // the key prefix AND the configured URL in hand, so it can append
  // "your kash_live_* key is being sent to a staging URL" without
  // any server change.
  //
  // A regression that drops the hint or shows the wrong one tanks the
  // diagnostic value of the auto-suggestion at the customer's worst
  // moment (when they're already debugging a 401).
  // -------------------------------------------------------------------
  describe('hint propagation', () => {
    it('appends "(Hint: …)" to the error message when hint is provided', () => {
      const err = classifyHttpError({
        status: 401,
        problem: { code: 'API_KEY_INVALID', detail: 'Invalid or revoked API key' },
        hint: 'your `kash_live_*` key is being sent to a staging URL',
      });
      // The hint format is `(Hint: …)` appended after the base detail.
      // Locking the literal so a future formatter change is intentional.
      expect(err.message).toContain('Invalid or revoked API key');
      expect(err.message).toContain('(Hint: your `kash_live_*` key');
    });

    it('omits the (Hint: …) suffix when no hint is provided', () => {
      const err = classifyHttpError({
        status: 401,
        problem: { code: 'API_KEY_INVALID', detail: 'Invalid or revoked API key' },
      });
      expect(err.message).toBe('Invalid or revoked API key');
      expect(err.message).not.toContain('Hint:');
    });

    it('hint appends even when problem.detail is absent (falls back to title or "HTTP <status>")', () => {
      // Without `detail` the baseDetail comes from problem.title or
      // `HTTP <status>` — the hint must still append cleanly.
      const err = classifyHttpError({
        status: 401,
        problem: { code: 'API_KEY_INVALID' },
        hint: 'baseUrl/key mismatch',
      });
      expect(err.message).toContain('(Hint: baseUrl/key mismatch)');
    });
  });
});
