/**
 * Fuzz / property-style tests for the security-adjacent string parsers.
 *
 * These functions are exposed to attacker-controlled input:
 *   - `parseRetryAfterSeconds` reads the `Retry-After` response header
 *     (the server is trusted, but an upstream proxy may corrupt it).
 *   - `parseSignatureHeader` (inside `verifySignature`) reads the
 *     `X-Kash-Signature` header on incoming webhooks — fully attacker-
 *     controlled.
 *
 * Bar: never throw, never return NaN, never accept absurd values
 * (negative seconds, non-numeric in numeric fields). The `verifySignature`
 * surface specifically must always return a tagged result rather than
 * throwing on bad input.
 */

import { describe, expect, it } from 'vitest';

import { classifyHttpError, KashRateLimitError } from '../../src/errors.js';
import { KashClient } from '../../src/index.js';

/**
 * Deterministic pseudo-random byte generator. Seeded so the fuzz
 * tests are reproducible — a CI failure can be re-played locally.
 */
function* rngBytes(seed: number): Generator<number, never, void> {
  // xorshift32 — tiny, deterministic, sufficient for random byte
  // generation in fuzzers.
  let x = seed | 0 || 1;
  while (true) {
    x ^= x << 13;
    x ^= x >>> 17;
    x ^= x << 5;
    yield (x >>> 0) & 0xff;
  }
}

function randomString(rng: Generator<number>, len: number): string {
  let s = '';
  for (let i = 0; i < len; i++) {
    const byte = rng.next().value;
    // Mix printable ASCII, separators, control chars, and a sprinkling
    // of high-bit bytes — exercise the parser's whole input domain.
    s += String.fromCharCode(byte);
  }
  return s;
}

describe('fuzz: parseRetryAfterSeconds (via classifyHttpError)', () => {
  // We don't export the parser directly; exercise it through the
  // public surface. classifyHttpError(429 with Retry-After) calls it.
  const ADVERSARIAL_INPUTS = [
    '',
    '   ',
    '\t\n',
    '0',
    '-1',
    '1.5',
    '999999999999',
    'not-a-date',
    'Fri, 31 Dec 1999 23:59:59 GMT',
    'Mon, 01 Jan 1970 00:00:00 GMT',
    'X'.repeat(10_000),
    '\x00\x01\x02\x03',
    '+1',
    '0x10',
    '1e10',
    'Infinity',
    'NaN',
    '\n\nset-cookie: pwned', // header-injection attempt
    '127',
    '127.0',
    '127a',
  ];

  it('never throws and returns sensible values for adversarial Retry-After', () => {
    for (const input of ADVERSARIAL_INPUTS) {
      const err = classifyHttpError({
        status: 429,
        problem: { code: 'RATE_LIMIT_EXCEEDED' },
        retryAfter: input,
      });
      expect(err).toBeInstanceOf(KashRateLimitError);
      const seconds = (err as KashRateLimitError).retryAfterSeconds;
      // Either undefined (rejected) or a finite, non-negative integer.
      if (seconds !== undefined) {
        expect(Number.isFinite(seconds)).toBe(true);
        expect(seconds).toBeGreaterThanOrEqual(0);
        expect(Number.isInteger(seconds)).toBe(true);
      }
    }
  });

  it('rejects negative integer strings (returns undefined, not negative)', () => {
    for (const input of ['-1', '-100', '-999999']) {
      const err = classifyHttpError({
        status: 429,
        problem: { code: 'RATE_LIMIT_EXCEEDED' },
        retryAfter: input,
      });
      expect((err as KashRateLimitError).retryAfterSeconds).toBeUndefined();
    }
  });

  it('1000 random byte strings: never throws, never NaN', () => {
    const rng = rngBytes(0xc0ffee);
    for (let i = 0; i < 1000; i++) {
      const len = (rng.next().value % 64) + 1;
      const input = randomString(rng, len);
      let err;
      try {
        err = classifyHttpError({
          status: 429,
          problem: { code: 'RATE_LIMIT_EXCEEDED' },
          retryAfter: input,
        });
      } catch (e) {
        throw new Error(`Threw on input ${JSON.stringify(input)}: ${String(e)}`);
      }
      const v = (err as KashRateLimitError).retryAfterSeconds;
      if (v !== undefined) expect(Number.isFinite(v)).toBe(true);
    }
  });
});

describe('fuzz: parseSignatureHeader (via verifySignature)', () => {
  const kash = new KashClient({ apiKey: 'kash_test_xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx' });
  const SECRET = 'whsec_TEST';
  const BODY = '{"id":"evt-1"}';

  const ADVERSARIAL_HEADERS = [
    '',
    ' ',
    'no-equals-here',
    't=,v1=',
    't=abc,v1=def',
    't=,v1=',
    't=999999999999999999999999999999999',
    't=1,v1=',
    't=1,v1',
    'v1=abc',
    't=1,v1=abc,t=2,v1=def',
    't=1,v1=' + 'X'.repeat(10_000),
    'a=1,b=2,c=3',
    '\n\nset-cookie: pwned',
    't=1,v1=' + 'a'.repeat(64),
    't=-1,v1=abc',
    't=1.5,v1=abc',
    't=NaN,v1=abc',
    't=Infinity,v1=abc',
    'T=1,V1=abc', // wrong case (header parse is case-sensitive in our scheme)
    `t=${Date.now()},v1=`, // empty v1
  ];

  it('rejects every adversarial header without throwing', async () => {
    for (const header of ADVERSARIAL_HEADERS) {
      const result = await kash.webhooks.verifySignature(BODY, header, SECRET);
      // Invalid headers must always return tagged-false, never throw.
      // (Empty secret / non-string body THROW — that's the documented
      // contract — but adversarial header content does not.)
      expect(result.valid).toBe(false);
    }
  });

  it('1000 random header strings: never throws', async () => {
    const rng = rngBytes(0xdeadbeef);
    for (let i = 0; i < 1000; i++) {
      const len = (rng.next().value % 256) + 1;
      const header = randomString(rng, len);
      let result;
      try {
        result = await kash.webhooks.verifySignature(BODY, header, SECRET);
      } catch (e) {
        // The only acceptable throw is on empty/non-string secret or
        // non-string body — and we pass valid versions of those.
        throw new Error(`Threw on header ${JSON.stringify(header)}: ${String(e)}`);
      }
      // Random data will essentially never produce a valid signature.
      expect(result.valid).toBe(false);
    }
  }, 15_000);
});
