/**
 * The problem codes a partner branches on: each is named in
 * `KASH_ERROR_CODE` and lands in the error class its status implies, with
 * the code intact. `WITHDRAWALS_HELD` also carries the `Retry-After` the
 * server sends, as `retryAfterSeconds`.
 *
 * The statuses below are the API catalogue's (`ERROR_CODE_HTTP_STATUS`);
 * `sdk-classifier-error-codes.private.test.ts` pins both the names and the
 * statuses against that catalogue inside the monorepo.
 */

import { describe, expect, expectTypeOf, it } from 'vitest';

import { KASH_ERROR_CODE, type KashErrorCode } from '../../src/error-codes.js';
import { classifyHttpError, KashConflictError, KashError } from '../../src/errors.js';

import { PARTNER_CODE_CASES } from './_partner-code-cases.js';

describe('KASH_ERROR_CODE', () => {
  it('every case above is named, and every named code has a case', () => {
    expect(PARTNER_CODE_CASES.map(([code]) => code).sort()).toEqual(
      Object.values(KASH_ERROR_CODE).sort()
    );
  });

  it('each member is its own name, so the constant and the wire value cannot drift apart', () => {
    for (const [key, value] of Object.entries(KASH_ERROR_CODE)) expect(value).toBe(key);
  });

  it('is frozen', () => {
    expect(Object.isFrozen(KASH_ERROR_CODE)).toBe(true);
  });

  it('types err.code as the known codes plus any string', () => {
    expectTypeOf<KashError['code']>().toEqualTypeOf<KashErrorCode>();
    expectTypeOf<'WITHDRAWALS_HELD'>().toMatchTypeOf<KashErrorCode>();
    expectTypeOf<'SOME_FUTURE_CODE'>().toMatchTypeOf<KashErrorCode>();
    expectTypeOf<KashErrorCode>().toMatchTypeOf<string>();
  });
});

describe('classifyHttpError: partner problem codes', () => {
  it.each(PARTNER_CODE_CASES)('%s (%i) becomes %o with its code', (code, status, errorClass) => {
    const err = classifyHttpError({ status, problem: { code, detail: `${code} detail` } });

    expect(err).toBeInstanceOf(errorClass);
    expect(err.code).toBe(code);
    expect(err.statusCode).toBe(status);
    expect(err.message).toBe(`${code} detail`);
  });

  it('WITHDRAWALS_HELD carries the hold from Retry-After as retryAfterSeconds', () => {
    const err = classifyHttpError({
      status: 409,
      problem: { code: KASH_ERROR_CODE.WITHDRAWALS_HELD },
      retryAfter: '86340',
    });

    expect(err).toBeInstanceOf(KashConflictError);
    expect((err as KashConflictError).retryAfterSeconds).toBe(86_340);
    expect(err.isRetryable).toBe(false);
  });

  it('a conflict without Retry-After has retryAfterSeconds undefined, never 0', () => {
    const err = classifyHttpError({
      status: 409,
      problem: { code: KASH_ERROR_CODE.INSUFFICIENT_BALANCE },
    });

    expect(err.retryAfterSeconds).toBeUndefined();
  });

  it('an HTTP-date Retry-After on a conflict is converted to seconds', () => {
    const now = Date.parse('2026-11-11T10:00:00Z');
    const err = classifyHttpError({
      status: 409,
      problem: { code: KASH_ERROR_CODE.WITHDRAWALS_HELD },
      retryAfter: 'Wed, 11 Nov 2026 10:02:00 GMT',
      nowMs: now,
    });

    expect((err as KashConflictError).retryAfterSeconds).toBe(120);
  });

  it('retryAfterSeconds is on the base class: one read covers every status that sends Retry-After', () => {
    for (const status of [400, 404, 409, 429, 503]) {
      const err: KashError = classifyHttpError({ status, problem: {}, retryAfter: '7' });
      expect(err.retryAfterSeconds, String(status)).toBe(7);
      expect(err.toJSON()['retryAfterSeconds']).toBe(7);
    }
    expect(classifyHttpError({ status: 429, problem: {} }).retryAfterSeconds).toBeUndefined();
  });
});
