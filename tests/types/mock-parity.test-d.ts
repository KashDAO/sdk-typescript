/**
 * Every method on `MockKashClient` accepts exactly the real client's
 * parameters, options included, so a test written against the mock compiles
 * against `KashClient` and the other way round. `watchPositions` is the one
 * real method the mock leaves out (it polls forever by design).
 */

import { describe, expectTypeOf, it } from 'vitest';

import type { KashClient } from '../../src/index.js';
import type { MockKashClient } from '../../src/testing/index.js';

type Fn = (...args: never[]) => unknown;

/** For each method both sides have: does a real call's argument list fit the mock? */
type ParamsFit<Real, Mock> = {
  [K in keyof Real & keyof Mock]: Real[K] extends Fn
    ? Mock[K] extends Fn
      ? Parameters<Real[K]> extends Parameters<Mock[K]>
        ? Parameters<Mock[K]> extends Parameters<Real[K]>
          ? true
          : false
        : false
      : never
    : never;
}[keyof Real & keyof Mock];

/** The real methods the mock does not have. */
type Missing<Real, Mock> = Exclude<
  { [K in keyof Real]: Real[K] extends Fn ? K : never }[keyof Real],
  keyof Mock
>;

type Subclients =
  | 'markets'
  | 'trades'
  | 'redemptions'
  | 'quotes'
  | 'portfolio'
  | 'webhooks'
  | 'account'
  | 'traces'
  | 'balance'
  | 'partnerAccounts';

describe('MockKashClient parameter parity with KashClient', () => {
  it('every shared method takes the same parameters', () => {
    expectTypeOf<
      { [S in Subclients]: ParamsFit<KashClient[S], MockKashClient[S]> }[Subclients]
    >().toEqualTypeOf<true>();
    expectTypeOf<
      ParamsFit<
        KashClient['partnerAccounts']['withdrawals'],
        MockKashClient['partnerAccounts']['withdrawals']
      >
    >().toEqualTypeOf<true>();
  });

  it('the mock has every real method but watchPositions', () => {
    expectTypeOf<
      { [S in Subclients]: Missing<KashClient[S], MockKashClient[S]> }[Subclients]
    >().toEqualTypeOf<'watchPositions'>();
    expectTypeOf<
      Missing<
        KashClient['partnerAccounts']['withdrawals'],
        MockKashClient['partnerAccounts']['withdrawals']
      >
    >().toEqualTypeOf<never>();
  });
});
