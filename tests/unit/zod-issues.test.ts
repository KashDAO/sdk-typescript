/**
 * The validation issues a caller sees under zod 4, as the CHANGELOG states:
 * zod 4 codes, paths joined with dots, never a symbol that would throw when
 * joined, and a problem body whose standard members are absent still parsed.
 */

import { describe, expect, it } from 'vitest';

import { KashValidationError } from '../../src/errors.js';
import { KashClient } from '../../src/index.js';
import { parseProblemDetails } from '../../src/internal/problem-details.js';
import { joinIssuePath, pathSegment } from '../../src/internal/zod-issues.js';

const kash = new KashClient({
  apiKey: 'kash_test_xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx',
  fetch: (async () => new Response('{}')) as typeof fetch,
});

describe('zod 4 issues on KashValidationError', () => {
  it('carry zod 4 codes and dot-joined paths', async () => {
    const err = await kash.trades
      .create({
        marketId: '11111111-1111-4111-8111-111111111111',
        outcomeIndex: 0,
        amount: '1',
        side: 'hold' as never,
        metadata: { 'bad key!': 'x' },
      })
      .catch((e: unknown) => e);

    expect(err).toBeInstanceOf(KashValidationError);
    const issues = (err as KashValidationError).issues;
    expect(issues.find((i) => i.path === 'side')?.code).toBe('invalid_value');
    expect(issues.every((i) => typeof i.path === 'string')).toBe(true);
  });

  it('render a symbol path segment as text instead of throwing', () => {
    const sym = Symbol('key');
    expect(pathSegment(sym)).toBe('Symbol(key)');
    expect(joinIssuePath(['a', 0, sym])).toBe('a.0.Symbol(key)');
    expect(joinIssuePath([])).toBe('');
  });
});

describe('problem bodies under zod 4', () => {
  it('a body with only some standard members still parses (absent members are optional)', () => {
    expect(parseProblemDetails({ code: 'ACCOUNT_NOT_FOUND', flag: 'x' })).toEqual({
      code: 'ACCOUNT_NOT_FOUND',
      flag: 'x',
    });
  });

  it('a standard member of the wrong type reads as absent, extensions pass through', () => {
    expect(parseProblemDetails({ code: 42, status: '409', detail: 'd' })).toEqual({
      detail: 'd',
    });
  });
});
