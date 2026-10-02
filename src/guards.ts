/**
 * Type-narrowing helpers for SDK resource types.
 *
 * Each guard is a TypeScript type-predicate function: it narrows the
 * input type for the rest of the consumer's branch without requiring
 * the consumer to spell out the discriminating field.
 *
 * Use these in place of inline status comparisons — they keep the
 * status enum encapsulated and read more like product code.
 *
 * @example
 * ```ts
 * import { isAwaitingConfirmation, isTerminalTrade } from '@kashdao/sdk';
 *
 * const trade = await kash.trades.get(id);
 *
 * if (isAwaitingConfirmation(trade)) {
 *   // trade.status is narrowed to 'pending_confirmation'
 *   // (capture the confirmation token from the create response, then call kash.trades.confirm)
 * } else if (isTerminalTrade(trade)) {
 *   // trade.status is narrowed to 'completed' | 'failed' | 'rejected'
 * }
 * ```
 */

import { TERMINAL_TRADE_STATUSES } from './schemas/trade.js';

import type { TradeResource, TradeStatus } from './schemas/trade.js';

// ---- Trade status guards ------------------------------------------------

/**
 * The terminal statuses for a trade — these are the statuses
 * `waitForCompletion()` polls for.
 */
type TerminalTradeStatus = 'completed' | 'failed' | 'rejected';

/**
 * The non-terminal, non-confirmation statuses for a trade — the trade
 * is in the pipeline and will progress on its own.
 */
type PendingTradeStatus = 'pending' | 'validating' | 'executing';

/** Narrowed `TradeResource` whose `status` is in the terminal set. */
export type TerminalTrade = TradeResource & { readonly status: TerminalTradeStatus };

/** Narrowed `TradeResource` whose `status` is `'completed'`. */
export type CompletedTrade = TradeResource & { readonly status: 'completed' };

/** Narrowed `TradeResource` whose `status` is `'failed'`. */
export type FailedTrade = TradeResource & { readonly status: 'failed' };

/** Narrowed `TradeResource` whose `status` is `'rejected'`. */
export type RejectedTrade = TradeResource & { readonly status: 'rejected' };

/** Narrowed `TradeResource` whose `status` is `'pending_confirmation'`. */
export type AwaitingConfirmationTrade = TradeResource & {
  readonly status: 'pending_confirmation';
};

/** Narrowed `TradeResource` whose `status` is in the pending set (in-flight). */
export type PendingTrade = TradeResource & { readonly status: PendingTradeStatus };

/*
 * DERIVED from `TERMINAL_TRADE_STATUSES`, not a second hand-written copy.
 *
 * `isTerminalTrade` and `waitForCompletion` are both public surface and both
 * answer "has this trade stopped moving?", so they must not be able to
 * disagree — `trades.waitForCompletion` polls until the status is in
 * `TERMINAL_TRADE_STATUSES`, and a consumer's `isTerminalTrade(trade)` branch
 * is how they act on the result.
 *
 * The exported list keeps its wide `readonly TradeStatus[]` annotation
 * deliberately. Narrowing it to a tuple would let `TerminalTradeStatus` be
 * derived too, but it would also narrow the parameter of the
 * `TERMINAL_TRADE_STATUSES.includes(...)` calls that `clients/trades.ts` and
 * published consumer code make — a breaking type change to a customer-facing
 * export, in exchange for removing one three-word type alias. Not worth it.
 */
const TERMINAL_SET: ReadonlySet<TradeStatus> = new Set(TERMINAL_TRADE_STATUSES);
const PENDING_SET: ReadonlySet<TradeStatus> = new Set(['pending', 'validating', 'executing']);

/**
 * Trade has reached a terminal status (`'completed' | 'failed' | 'rejected'`)
 * and will not progress further. Polling can stop.
 */
export function isTerminalTrade(trade: TradeResource): trade is TerminalTrade {
  return TERMINAL_SET.has(trade.status);
}

/**
 * Trade is in the on-chain pipeline: validated and progressing toward
 * a terminal status. Excludes `'pending_confirmation'` — those need
 * the consumer to confirm before the pipeline can advance.
 */
export function isPendingTrade(trade: TradeResource): trade is PendingTrade {
  return PENDING_SET.has(trade.status);
}

/**
 * Trade reached `'completed'` — the on-chain transaction was included.
 * Read `txHash` and `tokensOut` for the result.
 */
export function isCompletedTrade(trade: TradeResource): trade is CompletedTrade {
  return trade.status === 'completed';
}

/**
 * Trade reached `'failed'` — the on-chain transaction reverted or the
 * pipeline could not produce one. Read `errorCode` / `errorMessage`.
 */
export function isFailedTrade(trade: TradeResource): trade is FailedTrade {
  return trade.status === 'failed';
}

/**
 * Trade reached `'rejected'` — the request did not enter the
 * pipeline (risk-engine reject, account state, market state). Read
 * `errorCode` / `errorMessage`.
 */
export function isRejectedTrade(trade: TradeResource): trade is RejectedTrade {
  return trade.status === 'rejected';
}

/**
 * Trade is `'pending_confirmation'` — the high-value gate fired and
 * the consumer must confirm before the trade can proceed. Capture the
 * confirmation token from the original `kash.trades.create()` result.
 *
 * @see TradesClient.confirm
 */
export function isAwaitingConfirmation(trade: TradeResource): trade is AwaitingConfirmationTrade {
  return trade.status === 'pending_confirmation';
}
