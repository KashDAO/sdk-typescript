/**
 * Type-narrowing helpers — runtime + compile-time tests.
 *
 * The runtime tests cover what each guard returns for every
 * `TradeStatus`. The `expectTypeOf` blocks assert that the narrowed
 * type really is what the consumer's `if (isCompletedTrade(t)) { … }`
 * branch will see in the editor.
 */

import { describe, expect, expectTypeOf, it } from 'vitest';

import {
  type AwaitingConfirmationTrade,
  type CompletedTrade,
  type FailedTrade,
  isAwaitingConfirmation,
  isCompletedTrade,
  isFailedTrade,
  isPendingTrade,
  isRejectedTrade,
  isTerminalTrade,
  type PendingTrade,
  type RejectedTrade,
  type TerminalTrade,
  TradeStatusSchema,
} from '../../src/index.js';
import type { TradeResource, TradeStatus } from '../../src/index.js';

function tradeWith(status: TradeStatus): TradeResource {
  return {
    id: '00000000-0000-4000-8000-000000000000',
    marketId: '11111111-1111-4111-8111-111111111111',
    outcomeIndex: 0,
    amount: '100',
    side: 'buy',
    status,
    correlationId: '22222222-2222-4222-8222-222222222222',
    clientRequestId: null,
    txHash: null,
    tokensOut: null,
    errorCode: null,
    errorMessage: null,
    webhookDelivery: null,
    metadata: {},
    createdAt: '2026-04-30T12:00:00.000Z',
    updatedAt: '2026-04-30T12:00:00.000Z',
  };
}

describe('isTerminalTrade', () => {
  it('returns true for completed/failed/rejected', () => {
    expect(isTerminalTrade(tradeWith('completed'))).toBe(true);
    expect(isTerminalTrade(tradeWith('failed'))).toBe(true);
    expect(isTerminalTrade(tradeWith('rejected'))).toBe(true);
  });

  it('returns false for in-flight statuses', () => {
    expect(isTerminalTrade(tradeWith('pending'))).toBe(false);
    expect(isTerminalTrade(tradeWith('validating'))).toBe(false);
    expect(isTerminalTrade(tradeWith('executing'))).toBe(false);
    expect(isTerminalTrade(tradeWith('pending_confirmation'))).toBe(false);
  });

  it('narrows the status union', () => {
    const t = tradeWith('completed') as TradeResource;
    if (isTerminalTrade(t)) {
      expectTypeOf(t).toMatchTypeOf<TerminalTrade>();
      expectTypeOf(t.status).toEqualTypeOf<'completed' | 'failed' | 'rejected'>();
    }
  });
});

describe('isPendingTrade', () => {
  it('returns true for pending/validating/executing', () => {
    expect(isPendingTrade(tradeWith('pending'))).toBe(true);
    expect(isPendingTrade(tradeWith('validating'))).toBe(true);
    expect(isPendingTrade(tradeWith('executing'))).toBe(true);
  });

  it('returns false for terminal + awaiting-confirmation', () => {
    expect(isPendingTrade(tradeWith('completed'))).toBe(false);
    expect(isPendingTrade(tradeWith('failed'))).toBe(false);
    expect(isPendingTrade(tradeWith('rejected'))).toBe(false);
    expect(isPendingTrade(tradeWith('pending_confirmation'))).toBe(false);
  });

  it('narrows to PendingTrade', () => {
    const t = tradeWith('pending') as TradeResource;
    if (isPendingTrade(t)) {
      expectTypeOf(t).toMatchTypeOf<PendingTrade>();
      expectTypeOf(t.status).toEqualTypeOf<'pending' | 'validating' | 'executing'>();
    }
  });
});

describe('terminal-status guards', () => {
  it('isCompletedTrade only matches completed', () => {
    expect(isCompletedTrade(tradeWith('completed'))).toBe(true);
    expect(isCompletedTrade(tradeWith('failed'))).toBe(false);
    expect(isCompletedTrade(tradeWith('rejected'))).toBe(false);
    expect(isCompletedTrade(tradeWith('pending'))).toBe(false);
  });

  it('isFailedTrade only matches failed', () => {
    expect(isFailedTrade(tradeWith('failed'))).toBe(true);
    expect(isFailedTrade(tradeWith('completed'))).toBe(false);
    expect(isFailedTrade(tradeWith('rejected'))).toBe(false);
  });

  it('isRejectedTrade only matches rejected', () => {
    expect(isRejectedTrade(tradeWith('rejected'))).toBe(true);
    expect(isRejectedTrade(tradeWith('completed'))).toBe(false);
    expect(isRejectedTrade(tradeWith('failed'))).toBe(false);
  });

  it('narrows to the literal status', () => {
    const t = tradeWith('completed') as TradeResource;
    if (isCompletedTrade(t)) expectTypeOf(t).toMatchTypeOf<CompletedTrade>();
    const f = tradeWith('failed') as TradeResource;
    if (isFailedTrade(f)) expectTypeOf(f).toMatchTypeOf<FailedTrade>();
    const r = tradeWith('rejected') as TradeResource;
    if (isRejectedTrade(r)) expectTypeOf(r).toMatchTypeOf<RejectedTrade>();
  });
});

describe('isAwaitingConfirmation', () => {
  it('returns true only for pending_confirmation', () => {
    expect(isAwaitingConfirmation(tradeWith('pending_confirmation'))).toBe(true);
    expect(isAwaitingConfirmation(tradeWith('pending'))).toBe(false);
    expect(isAwaitingConfirmation(tradeWith('completed'))).toBe(false);
  });

  it('narrows to AwaitingConfirmationTrade', () => {
    const t = tradeWith('pending_confirmation') as TradeResource;
    if (isAwaitingConfirmation(t)) {
      expectTypeOf(t).toMatchTypeOf<AwaitingConfirmationTrade>();
      expectTypeOf(t.status).toEqualTypeOf<'pending_confirmation'>();
    }
  });
});

describe('exhaustiveness', () => {
  /*
   * DERIVED from the enum, not hand-listed.
   *
   * This matrix is the ONLY thing asserting that `isAwaitingConfirmation` /
   * `isPendingTrade` / `isTerminalTrade` partition the status space, and it
   * used to iterate its own copy of the seven statuses. A copy cannot see a
   * status it does not contain: measured by adding `'cancelling'` to BOTH
   * `tradeResourceSchema.status` and `TradeStatusSchema` — the shape a real
   * API release takes — all 42 files and 610 tests passed while
   * `guardsMatching` was **0** for the new status. The API/SDK parity test
   * cannot catch it either; it passes precisely because both sides agree.
   *
   * Reading `TradeStatusSchema.options` makes the next added status fail HERE,
   * which is the point: the guards do not partition by construction, and they
   * must not. `isPendingTrade` deliberately excludes `pending_confirmation`,
   * so "pending" is not the complement of "terminal" — a new status has to be
   * classified by a human, and this is what stops it being classified by
   * silence.
   */
  const ALL_STATUSES: readonly TradeStatus[] = TradeStatusSchema.options;

  it('sanity floor: the enum still declares the seven known statuses', () => {
    // Anti-vacuity. An empty or truncated `.options` would make the matrix
    // below pass by iterating nothing.
    expect(ALL_STATUSES.length).toBeGreaterThanOrEqual(7);
  });

  it('every TradeStatus is covered by exactly one of the four mutually-exclusive guards', () => {
    for (const status of ALL_STATUSES) {
      const t = tradeWith(status);
      const matches = [isAwaitingConfirmation(t), isPendingTrade(t), isTerminalTrade(t)].filter(
        Boolean
      ).length;
      expect(
        matches,
        `Trade status "${status}" is matched by ${matches} of the three top-level guards, not 1. ` +
          `Every status must be classified by exactly one of isAwaitingConfirmation / ` +
          `isPendingTrade / isTerminalTrade — a consumer's if/else-if chain over them ` +
          `silently drops any status none of them claims.`
      ).toBe(1);
    }
  });
});
