/**
 * Partner withdrawal schemas: the wire shapes for
 * `/v1/partner/accounts/{accountId}/withdrawals`.
 *
 * A withdrawal always goes to the account's registered destination; the
 * request names only an amount. Amounts are integer strings in USDC atomic
 * units (6 decimals), never numbers. Requires a partner API key with the
 * `partner:accounts` scope.
 */

import { z } from 'zod';

import { openEnum } from './_open-enum.js';
import { UsdcAtomicSchema } from './balance.js';
import { MetaSchema } from './envelope.js';
import { PartnerDestinationSchema } from './webhook-event.js';

/**
 * A withdrawal amount: a positive whole number of USDC atomic units, at most
 * 30 digits, as a string (`'2500000'` is 2.5 USDC). The API's own rule.
 */
export const WithdrawalAmountAtomicSchema = z
  .string()
  .regex(
    /^[1-9]\d{0,29}$/,
    'must be a positive whole number of atomic USDC units, such as 2500000'
  );

/** Body for {@link PartnerWithdrawalsClient.create}, and the query of `quote`. */
export const CreatePartnerWithdrawalBodySchema = z
  .object({ amountAtomic: WithdrawalAmountAtomicSchema })
  .strict();

export type CreatePartnerWithdrawalBody = z.infer<typeof CreatePartnerWithdrawalBodySchema>;

/**
 * Where a withdrawal is: `pending` until the worker claims it, then
 * `processing`, `confirming` (sent, awaiting the chain) and, for Arc,
 * `bridging`; finally `completed`, `failed` or `cancelled`. Open: a status
 * added later parses as its string.
 */
export const PartnerWithdrawalStatusSchema = openEnum([
  'pending',
  'processing',
  'confirming',
  'bridging',
  'completed',
  'failed',
  'cancelled',
]);

export type PartnerWithdrawalStatus = z.infer<typeof PartnerWithdrawalStatusSchema>;

export const PartnerWithdrawalResourceSchema = z.object({
  withdrawalId: z.guid(),
  accountId: z.guid(),
  /** The amount requested. */
  amountAtomic: UsdcAtomicSchema,
  /**
   * What the destination was measured to receive: on Solana, what the
   * confirmed transfer proved arrived (on a send-all the network fee comes out
   * of the amount). `null` until measured, on a failed or cancelled
   * withdrawal, and always for Arc: read `minimumDeliveredAtomic` there.
   */
  deliveredAmountAtomic: UsdcAtomicSchema.nullable(),
  /**
   * For Arc: the least the bridge quote the withdrawal was sent against
   * guarantees to deliver. `null` for Solana, until the withdrawal is handed
   * to the bridge, and on a failed or cancelled withdrawal.
   */
  minimumDeliveredAtomic: UsdcAtomicSchema.nullable(),
  status: PartnerWithdrawalStatusSchema,
  /** The account's registered destination at the time of the withdrawal. */
  destination: PartnerDestinationSchema,
  /** The Solana transaction signature, once sent. */
  transactionHash: z.string().nullable(),
  /**
   * The transaction that delivered the USDC: on Arc for an Arc withdrawal,
   * otherwise the same Solana transaction as `transactionHash`, once
   * completed. `null` until then, and on a failed or cancelled withdrawal.
   */
  destinationTransactionHash: z.string().nullable(),
  /**
   * The network fee actually charged for this withdrawal, in atomic USDC;
   * `null` until it is charged. Optional: an API release without fee
   * disclosure omits it. Absent means "not disclosed", never zero.
   */
  networkFeeAtomic: UsdcAtomicSchema.nullable().optional(),
  createdAt: z.iso.datetime({ offset: true }),
  updatedAt: z.iso.datetime({ offset: true }),
});

export type PartnerWithdrawalResource = z.infer<typeof PartnerWithdrawalResourceSchema>;

/** Wire envelope for `GET .../withdrawals/{withdrawalId}`. */
export const GetPartnerWithdrawalResponseSchema = z.object({
  withdrawal: PartnerWithdrawalResourceSchema,
  /** Cross-endpoint dual-key alias: identical to `withdrawal` when present. */
  data: PartnerWithdrawalResourceSchema.optional(),
  _meta: MetaSchema,
});

export type GetPartnerWithdrawalResponse = z.infer<typeof GetPartnerWithdrawalResponseSchema>;

/**
 * Wire envelope for `POST .../withdrawals`: `202` for a new withdrawal, `200`
 * with `_meta.idempotent: true` for the one an earlier request with the same
 * `Idempotency-Key` made.
 */
export const CreatePartnerWithdrawalResponseSchema = z.object({
  withdrawal: PartnerWithdrawalResourceSchema,
  /** Cross-endpoint dual-key alias: identical to `withdrawal` when present. */
  data: PartnerWithdrawalResourceSchema.optional(),
  _meta: MetaSchema.extend({ idempotent: z.boolean() }),
});

export type CreatePartnerWithdrawalResponse = z.infer<typeof CreatePartnerWithdrawalResponseSchema>;

/** Wire envelope for `GET .../withdrawals`: newest first, cursor-paginated. */
export const ListPartnerWithdrawalsResponseSchema = z.object({
  data: z.array(PartnerWithdrawalResourceSchema),
  pagination: z.object({
    cursor: z.string().nullable(),
    hasMore: z.boolean(),
    limit: z.number().int().positive(),
  }),
  _meta: MetaSchema,
});

export type ListPartnerWithdrawalsResponse = z.infer<typeof ListPartnerWithdrawalsResponseSchema>;

/**
 * What a withdrawal of `amountAtomic` would do now. Not a promise: the
 * withdrawal also checks that the account is `active`, the 24-hour hold
 * after a destination change, and its `Idempotency-Key`.
 */
export const PartnerWithdrawalQuoteSchema = z.object({
  /** The amount quoted. */
  amountAtomic: UsdcAtomicSchema,
  /** The account's registered destination. */
  destination: PartnerDestinationSchema,
  /**
   * What would arrive. When `receiveEstimated` is true it is a lower bound:
   * a Solana fee that may come out of the amount, or the least an Arc
   * bridge quote guarantees.
   */
  receiveAtomic: UsdcAtomicSchema,
  /** `true` when `receiveAtomic` is the least that arrives rather than the exact amount. */
  receiveEstimated: z.boolean(),
  /** The bridge time estimate for Arc, in seconds; `null` on Solana and when not quoted. */
  estimatedSeconds: z.number().nonnegative().nullable(),
  /** The largest amount the account can withdraw now; `'0'` when none. */
  maxAmountAtomic: UsdcAtomicSchema,
  /**
   * The most the network fee will cost, in atomic USDC, including creating
   * the destination's USDC account on a first withdrawal to it. Show it to
   * the user before they confirm. Optional: an API release without fee
   * disclosure omits it. Absent means "not disclosed", never zero.
   */
  networkFeeAtomic: UsdcAtomicSchema.optional(),
  /**
   * `true` when `networkFeeAtomic` is an upper bound rather than the exact
   * fee. Optional, as `networkFeeAtomic`.
   */
  networkFeeEstimated: z.boolean().optional(),
  /**
   * What leaves the balance, in atomic USDC: the amount plus the fee when the
   * fee is charged on top, the amount itself on a send-all (the fee then
   * comes out of it). Show it to the user before they confirm. Optional, as
   * `networkFeeAtomic`: absent means "not disclosed", never zero.
   */
  totalDebitAtomic: UsdcAtomicSchema.optional(),
});

export type PartnerWithdrawalQuote = z.infer<typeof PartnerWithdrawalQuoteSchema>;

/** Wire envelope for `GET .../withdrawals/quote`. */
export const PartnerWithdrawalQuoteResponseSchema = z.object({
  quote: PartnerWithdrawalQuoteSchema,
  /** Cross-endpoint dual-key alias: identical to `quote` when present. */
  data: PartnerWithdrawalQuoteSchema.optional(),
  _meta: MetaSchema,
});

export type PartnerWithdrawalQuoteResponse = z.infer<typeof PartnerWithdrawalQuoteResponseSchema>;
