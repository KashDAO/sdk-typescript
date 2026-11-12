/**
 * Webhook **event payload** schemas — the JSON body the Kash webhook
 * sender POSTs to a customer's endpoint.
 *
 * Distinct from the schemas in `webhook.ts`:
 *
 *   - `webhook.ts` covers the *management* surface
 *     (`/v1/webhooks/events`, redeliver, rotate-secret).
 *   - This file covers the *delivery* surface — the body the customer
 *     receives + verifies + handles.
 *
 * Mirrors the API's webhook payload contract exactly.
 *
 * Stripe pattern. Use {@link WebhookEventSchema} to parse + narrow:
 *
 * @example
 * ```ts
 * import { WebhookEventSchema } from '@kashdao/sdk/schemas';
 *
 * const event = WebhookEventSchema.parse(JSON.parse(rawBody));
 * if (event.type === 'trade.completed') {
 *   // event.data.txHash — the base58 Solana signature
 *   // event.data.chainRef — "solana:mainnet-beta"
 * }
 * ```
 *
 * Or use {@link WebhooksClient.constructEvent} to verify + parse in
 * one call — the canonical helper.
 */

import { z } from 'zod';

import { openEnum } from './_open-enum.js';

// -----------------------------------------------------------------
// Chain transaction id: an EVM hash or a base58 Solana signature. The
// shape rule is documented on `TradeCompletedPayloadSchema.txHash`.
// -----------------------------------------------------------------

const chainTxIdSchema = z
  .string()
  .regex(
    /^(?:0x[a-fA-F0-9]{64}|[1-9A-HJ-NP-Za-km-z]+)$/,
    'must be an EVM transaction hash or a base58 Solana signature'
  );

// -----------------------------------------------------------------
// Common fields shared by every trade.* event payload.
// -----------------------------------------------------------------

const tradeWebhookCommonSchema = z.object({
  tradeId: z.guid(),
  marketId: z.guid(),
  /**
   * Self-describing chain identity of the trade's market — `"solana:mainnet-beta"`,
   * or `"evm:8453"` on an event for a historical Base trade.
   *
   * A webhook is pushed, so it carries no version header to negotiate with:
   * the server sends `chainRef` on every trade webhook whatever version the
   * key pins. Optional because an event enqueued before the field existed can
   * still be delivered after it, and a required field would reject it.
   */
  chainRef: z.string().optional(),
  outcomeIndex: z.number().int().nonnegative(),
  amount: z.string().regex(/^\d+(\.\d{1,6})?$/),
  side: openEnum(['buy', 'sell']),
  /**
   * Customer-supplied tags from `trades.create({ metadata })`. Always
   * present (defaults to `{}` server-side); echoed on every webhook so
   * handlers can branch (`metadata.strategy === 'momentum-v2'`)
   * without re-fetching the trade.
   */
  metadata: z.record(z.string(), z.string()),
});

// -----------------------------------------------------------------
// Per-event payload shapes (the value of `event.data`).
// -----------------------------------------------------------------

export const TradeConfirmationRequiredPayloadSchema = tradeWebhookCommonSchema.extend({
  status: z.literal('pending_confirmation'),
  /** ISO 8601; the trade auto-cancels after this if confirmation isn't POST'd. */
  confirmationExpiresAt: z.iso.datetime(),
});

export type TradeConfirmationRequiredPayload = z.infer<
  typeof TradeConfirmationRequiredPayloadSchema
>;

export const TradeCompletedPayloadSchema = tradeWebhookCommonSchema.extend({
  status: z.literal('completed'),
  /**
   * Chain transaction id — an EVM hash (`0x` + 64 hex) OR a base58 Solana
   * signature.
   *
   * This carried `/^0x[a-fA-F0-9]{64}$/` until 2026-09-13, which describes one
   * of the two chains the API already serves: measured that day it held 83
   * completed Solana trades, whose ids are base58 and share no character class
   * with the hex form. Since this schema PARSES the payload in the customer's
   * own process — `WebhookEventSchema.parse`, or `constructEvent` — that
   * pattern would not have mis-documented a Solana trade, it would have THROWN
   * inside their webhook handler.
   *
   * The base58 branch checks the ALPHABET and deliberately not the length. A
   * signature is 64 bytes, but base58 renders leading zero bytes as `1`s that
   * carry no magnitude, so its output length is not fixed and any bound here
   * would invent a limit the chain does not have. The alphabet alone is enough
   * to keep this a real constraint — it excludes `0`, `O`, `I` and `l`, and
   * rejects anything with a separator in it.
   *
   * A SHAPE check, not a validity one: `constructEvent` has already verified
   * the HMAC, so the bytes are authenticated before they reach this schema.
   * Verifying that a signature is well-formed 64 bytes needs a base58 decoder,
   * and this package has exactly one dependency (`zod`) by design.
   */
  txHash: chainTxIdSchema,
  /** WAD-encoded outcome tokens received (integer string). */
  tokensOut: z.string().regex(/^\d+$/),
});

export type TradeCompletedPayload = z.infer<typeof TradeCompletedPayloadSchema>;

export const TradeFailedPayloadSchema = tradeWebhookCommonSchema.extend({
  status: z.literal('failed'),
  /** Stable machine-readable code from the same catalog as route errors. */
  errorCode: z.string().min(1),
  /** Sanitised human-readable message — no stack traces, no DB strings. */
  errorMessage: z.string().min(1),
});

export type TradeFailedPayload = z.infer<typeof TradeFailedPayloadSchema>;

/**
 * `trade.rejected` — the trade was declined before execution.
 *
 * Distinct from `trade.failed` (which covers on-chain/RPC failures
 * after submission). Rejection happens BEFORE the trade was ever
 * submitted on-chain, so there is no `txHash`. Customers can branch
 * on `status` to render rejection-specific UX. Shape mirrors
 * `trade.failed` deliberately so `errorCode` / `errorMessage`
 * rendering can be shared.
 */
export const TradeRejectedPayloadSchema = tradeWebhookCommonSchema.extend({
  status: z.literal('rejected'),
  errorCode: z.string().min(1),
  errorMessage: z.string().min(1),
});

export type TradeRejectedPayload = z.infer<typeof TradeRejectedPayloadSchema>;

// -----------------------------------------------------------------
// Partner webhooks: account, withdrawal and payout events for the
// accounts a partner organisation holds. Sent to the organisation's
// partner keys only. Each names the account by Kash's `accountId` (the
// value of the `Kash-Account` header) and by the partner's own
// `externalId`.
//
// Timestamps accept a UTC offset as well as `Z`: the server validates
// these with offsets allowed, so a parser that insisted on `Z` could
// refuse a delivery the server considers valid.
//
// Value sets the server may grow (a failure reason, a network, a failure
// code, a status) are open enums (`./_open-enum.ts`): the known values are
// typed, and a value this SDK version does not know is passed through
// rather than failing the delivery. What makes a delivery wrong rather than
// newer stays strict: the envelope, `type`, ids, amounts and timestamps.
// -----------------------------------------------------------------

const partnerTimestampSchema = z.iso.datetime({ offset: true });

/** A USDC amount in atomic units (6 decimals), as an integer string. */
const atomicAmountSchema = z.string().regex(/^\d+$/, 'USDC atomic units (integer string)');

const partnerAccountRefSchema = z.object({
  /** Kash's id for the account: the value you send in `Kash-Account`. */
  accountId: z.guid(),
  /** Your own id for the user, as sent when the account was created. */
  externalId: z.string().min(1).max(128),
});

/**
 * Why an account could not be created. Open: a reason added on the server
 * parses as its string, so branch on the known ones and treat any other as
 * "could not be created".
 */
export const PartnerAccountFailureReasonSchema = openEnum([
  'signer_missing',
  'no_solana_wallet',
  'privy_refused',
  'privy_identity_mismatch',
  'privy_user_already_linked',
]);

export type PartnerAccountFailureReason = z.infer<typeof PartnerAccountFailureReasonSchema>;

/**
 * The network a partner account's withdrawals are sent on. Open: a network
 * Kash adds later parses as its string rather than failing the payload.
 */
export const PartnerDestinationNetworkSchema = openEnum(['solana', 'arc']);

export type PartnerDestinationNetwork = z.infer<typeof PartnerDestinationNetworkSchema>;

/**
 * An account's registered withdrawal destination. `address` is an opaque
 * chain address: base58 on Solana, `0x` hex on Arc.
 */
export const PartnerDestinationSchema = z.object({
  network: PartnerDestinationNetworkSchema,
  address: z.string().min(1),
});

export type PartnerDestination = z.infer<typeof PartnerDestinationSchema>;

/** `account.active`: the account is provisioned and ready to fund. */
export const AccountActivePayloadSchema = partnerAccountRefSchema.extend({
  status: z.literal('active'),
  /** The account's Solana address. Send USDC on Solana here. */
  depositAddress: z.string().min(1),
  activatedAt: partnerTimestampSchema,
});

export type AccountActivePayload = z.infer<typeof AccountActivePayloadSchema>;

/** `account.provisioning_failed`: the account could not be created, for good. */
export const AccountProvisioningFailedPayloadSchema = partnerAccountRefSchema.extend({
  status: z.literal('provisioning_failed'),
  reason: PartnerAccountFailureReasonSchema,
  failedAt: partnerTimestampSchema,
});

export type AccountProvisioningFailedPayload = z.infer<
  typeof AccountProvisioningFailedPayloadSchema
>;

/**
 * `account.destination_changed`: the account's withdrawal destination was
 * changed. Withdrawals are held for 24 hours from `changedAt`, so a change
 * you did not make can be acted on before any funds move.
 */
export const AccountDestinationChangedPayloadSchema = partnerAccountRefSchema.extend({
  /** Where withdrawals went before the change. */
  previousDestination: PartnerDestinationSchema,
  /** Where withdrawals go now. */
  destination: PartnerDestinationSchema,
  changedAt: partnerTimestampSchema,
});

export type AccountDestinationChangedPayload = z.infer<
  typeof AccountDestinationChangedPayloadSchema
>;

/** `account.released`: your link to the account ended. No further webhooks follow for it. */
export const AccountReleasedPayloadSchema = partnerAccountRefSchema.extend({
  status: z.literal('released'),
  releasedAt: partnerTimestampSchema,
});

export type AccountReleasedPayload = z.infer<typeof AccountReleasedPayloadSchema>;

/** Fields every withdrawal webhook carries, as the withdrawal resource names them. */
const partnerWithdrawalCommonSchema = partnerAccountRefSchema.extend({
  withdrawalId: z.guid(),
  /** The amount requested. */
  amountAtomic: atomicAmountSchema,
  /**
   * What the destination was measured to receive: on Solana, what the confirmed
   * transfer's receipt proved arrived (on a send-all the network fee comes out
   * of the amount). `null` until measured, on a failed or cancelled withdrawal,
   * and always for Arc, where the bridge reports no delivered amount: read
   * `minimumDeliveredAtomic` there.
   */
  deliveredAmountAtomic: atomicAmountSchema.nullable(),
  /**
   * For Arc: the least the bridge quote the withdrawal was sent against
   * guarantees to deliver. `null` for Solana, until the withdrawal is handed to
   * the bridge, and on a failed or cancelled withdrawal.
   */
  minimumDeliveredAtomic: atomicAmountSchema.nullable(),
  /** The account's registered destination. */
  destination: PartnerDestinationSchema,
});

/** `withdrawal.submitted`: Kash accepted the withdrawal and queued it for sending. */
export const WithdrawalSubmittedPayloadSchema = partnerWithdrawalCommonSchema.extend({
  status: z.literal('pending'),
  submittedAt: partnerTimestampSchema,
});

export type WithdrawalSubmittedPayload = z.infer<typeof WithdrawalSubmittedPayloadSchema>;

/** `withdrawal.completed`: the USDC reached the destination. */
export const WithdrawalCompletedPayloadSchema = partnerWithdrawalCommonSchema.extend({
  status: z.literal('completed'),
  /** The Solana transaction that sent the USDC, or `null` if not recorded. */
  transactionHash: chainTxIdSchema.nullable(),
  /**
   * The transaction that delivered it: on Arc for an Arc withdrawal,
   * otherwise the same Solana transaction.
   */
  destinationTransactionHash: chainTxIdSchema,
  completedAt: partnerTimestampSchema,
});

export type WithdrawalCompletedPayload = z.infer<typeof WithdrawalCompletedPayloadSchema>;

/**
 * Why a withdrawal ended without delivering. `withdrawal_failed`: Kash did
 * not send it. `bridge_refunded`: the bridge to the destination network
 * failed and the USDC came back to the account's Solana wallet.
 * `bridge_failed`: the bridge failed and the USDC did not come back. Open: a
 * code added later parses as its string; read `errorMessage` for it.
 */
export const WithdrawalFailureCodeSchema = openEnum([
  'withdrawal_failed',
  'bridge_refunded',
  'bridge_failed',
]);

export type WithdrawalFailureCode = z.infer<typeof WithdrawalFailureCodeSchema>;

/**
 * The final status a `withdrawal.failed` reports: `failed` when Kash did not
 * send it, `cancelled` when the bridge to the destination network failed.
 * Open, like the other partner value sets.
 */
export const WithdrawalFailedStatusSchema = openEnum(['failed', 'cancelled']);

export type WithdrawalFailedStatus = z.infer<typeof WithdrawalFailedStatusSchema>;

/**
 * `withdrawal.failed`: the withdrawal ended without delivering. `status` is
 * `failed` when Kash did not send it and `cancelled` when the bridge to the
 * destination network failed.
 */
export const WithdrawalFailedPayloadSchema = partnerWithdrawalCommonSchema.extend({
  status: WithdrawalFailedStatusSchema,
  errorCode: WithdrawalFailureCodeSchema,
  errorMessage: z.string().min(1),
  failedAt: partnerTimestampSchema,
});

export type WithdrawalFailedPayload = z.infer<typeof WithdrawalFailedPayloadSchema>;

/** `payout.completed`: winnings from a resolved market were paid into the account. */
export const PayoutCompletedPayloadSchema = partnerAccountRefSchema.extend({
  payoutId: z.guid(),
  marketId: z.guid(),
  outcomeIndex: z.number().int().nonnegative(),
  /** What arrived in the wallet, in USDC atomic units. */
  amountAtomic: atomicAmountSchema,
  /** Self-describing chain identity, e.g. `"solana:mainnet-beta"`. */
  chainRef: z.string().min(1),
  transactionHash: chainTxIdSchema,
  paidAt: partnerTimestampSchema,
});

export type PayoutCompletedPayload = z.infer<typeof PayoutCompletedPayloadSchema>;

// -----------------------------------------------------------------
// Outer envelope — every customer-facing webhook body has this shape.
// -----------------------------------------------------------------

/** One webhook body: the envelope fields around a `type`-specific `data`. */
function envelope<TType extends string, TData extends z.ZodType>(
  type: TType,
  data: TData
): z.ZodObject<{
  id: z.ZodGUID;
  type: z.ZodLiteral<TType>;
  apiVersion: z.ZodString;
  createdAt: z.ZodISODateTime;
  data: TData;
}> {
  return z.object({
    id: z.guid(),
    type: z.literal(type),
    apiVersion: z.string(),
    createdAt: z.iso.datetime(),
    data,
  });
}

/**
 * The discriminated union of every webhook event the SDK recognises.
 * `event.type` narrows `event.data` to the matching payload.
 *
 * The envelope's `id` field is also returned in the `X-Kash-Event-Id`
 * header. Dedupe on it to make repeated deliveries (and manually
 * triggered redeliveries) safe.
 *
 * Forward compatibility: a field the SDK does not declare is accepted and
 * stripped, so a newer server adding a field never breaks parsing. A `type`
 * the SDK does not know is refused (`constructEvent` throws
 * `KashValidationError`); upgrade the SDK, or verify with
 * `verifySignature` and parse the body yourself.
 */
export const WebhookEventSchema = z.discriminatedUnion('type', [
  envelope('trade.confirmation-required', TradeConfirmationRequiredPayloadSchema),
  envelope('trade.completed', TradeCompletedPayloadSchema),
  envelope('trade.failed', TradeFailedPayloadSchema),
  envelope('trade.rejected', TradeRejectedPayloadSchema),
  envelope('account.active', AccountActivePayloadSchema),
  envelope('account.provisioning_failed', AccountProvisioningFailedPayloadSchema),
  envelope('account.destination_changed', AccountDestinationChangedPayloadSchema),
  envelope('account.released', AccountReleasedPayloadSchema),
  envelope('withdrawal.submitted', WithdrawalSubmittedPayloadSchema),
  envelope('withdrawal.completed', WithdrawalCompletedPayloadSchema),
  envelope('withdrawal.failed', WithdrawalFailedPayloadSchema),
  envelope('payout.completed', PayoutCompletedPayloadSchema),
]);

/**
 * The wire shape of a webhook delivery body. Use the typed
 * discriminator (`event.type`) to narrow `event.data`.
 */
export type WebhookEvent = z.infer<typeof WebhookEventSchema>;

/** The string literal type of every webhook event the SDK knows about. */
export type WebhookEventType = WebhookEvent['type'];

// -----------------------------------------------------------------
// Event types this SDK version does not know.
// -----------------------------------------------------------------

/**
 * A verified delivery whose `type` this SDK version does not know: a webhook
 * type the API added after this release. `constructEvent` returns it rather
 * than throwing, so a new type never breaks a working handler. The envelope
 * is checked (`id`, `type`, `apiVersion`, `createdAt`); `data` is passed
 * through unparsed. Recognise it with {@link isUnknownWebhookEvent}.
 */
export type UnknownWebhookEvent = {
  /** The discriminant `isUnknownWebhookEvent` reads. Absent on known events. */
  readonly known: false;
  readonly id: string;
  /** The type as sent, for example `account.suspended`. */
  readonly type: string;
  readonly apiVersion: string;
  readonly createdAt: string;
  /** The payload, unparsed: this SDK version has no schema for it. */
  readonly data: unknown;
};

/** What `constructEvent` returns: a typed known event, or an {@link UnknownWebhookEvent}. */
export type ConstructedWebhookEvent = WebhookEvent | UnknownWebhookEvent;

/**
 * True for a delivery whose type this SDK version does not know. Check it
 * first; after it, `event.type` narrows over the known types, so a `switch`
 * on it stays exhaustive with a `default` for nothing else.
 *
 * @example
 * ```ts
 * const event = await kash.webhooks.constructEvent(body, header, secret);
 * if (isUnknownWebhookEvent(event)) return log.info('unhandled webhook', event.type);
 * switch (event.type) { ... }
 * ```
 */
export function isUnknownWebhookEvent(
  event: ConstructedWebhookEvent
): event is UnknownWebhookEvent {
  return (event as { readonly known?: unknown }).known === false;
}

/** The envelope every delivery carries, whatever its type. */
export const WebhookEnvelopeSchema = z.object({
  id: z.guid(),
  type: z.string().min(1),
  apiVersion: z.string(),
  createdAt: z.iso.datetime(),
  data: z.unknown(),
});

/** The `type` of every event this SDK version parses into a typed payload. */
export const KNOWN_WEBHOOK_EVENT_TYPES: ReadonlySet<string> = new Set(
  WebhookEventSchema.options.map((option) => option.shape.type.value)
);
