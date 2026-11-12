/**
 * Balance schemas: the wire shapes for `GET /v1/balance`.
 *
 * The acting account's USDC on Solana: what the chain holds, what pending
 * withdrawals hold back, and what is left to spend. A user key reads its own
 * user; a partner key reads the account it names with `account`. Every
 * amount is an integer string in USDC atomic units (6 decimals); a balance
 * the API cannot read answers `503 DEPENDENCY_UNAVAILABLE`, never zero.
 */

import { z } from 'zod';

import { MetaSchema } from './envelope.js';

/** USDC in atomic units (6 decimals), as an integer string: `'25000000'` is 25 USDC. */
export const UsdcAtomicSchema = z.string().regex(/^\d+$/, 'USDC atomic units (integer string)');

export type UsdcAtomic = z.infer<typeof UsdcAtomicSchema>;

export const BalanceResourceSchema = z.object({
  /** The account wallet's USDC on Solana, read from the chain. */
  usdcAtomic: UsdcAtomicSchema,
  /**
   * USDC held by this wallet's withdrawals that are not final yet. A
   * withdrawal to Arc also holds its network fee, which is charged on top of
   * its amount.
   */
  pendingWithdrawalsAtomic: UsdcAtomicSchema,
  /**
   * What a trade or a new withdrawal may spend: `usdcAtomic` minus
   * `pendingWithdrawalsAtomic`, never below zero.
   */
  availableAtomic: UsdcAtomicSchema,
  /** When the on-chain balance was read. */
  observedAt: z.iso.datetime({ offset: true }),
});

export type BalanceResource = z.infer<typeof BalanceResourceSchema>;

/** Wire envelope for `GET /v1/balance`. */
export const GetBalanceResponseSchema = z.object({
  balance: BalanceResourceSchema,
  /** Cross-endpoint dual-key alias: identical to `balance` when present. */
  data: BalanceResourceSchema.optional(),
  _meta: MetaSchema,
});

export type GetBalanceResponse = z.infer<typeof GetBalanceResponseSchema>;
