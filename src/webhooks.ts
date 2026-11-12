/**
 * `@kashdao/sdk/webhooks`: the payload schemas and types of the partner
 * webhooks and of `trade.rejected`.
 *
 * `kash.webhooks.constructEvent` (root entry) already parses every event into
 * the typed `WebhookEvent` union, so most integrations need nothing from here.
 * Import from this subpath when you validate or type one payload on its own,
 * for example in a queue consumer that receives the payload without its
 * envelope. The schemas are re-exported from `@kashdao/sdk/schemas` (the build
 * keeps that import external), so each is the same object from either entry; the trade payload types stay on the
 * root entry.
 *
 * @module @kashdao/sdk/webhooks
 */

export {
  AccountActivePayloadSchema,
  AccountDestinationChangedPayloadSchema,
  AccountProvisioningFailedPayloadSchema,
  AccountReleasedPayloadSchema,
  PartnerAccountFailureReasonSchema,
  PartnerDestinationNetworkSchema,
  PartnerDestinationSchema,
  PayoutCompletedPayloadSchema,
  TradeRejectedPayloadSchema,
  WithdrawalCompletedPayloadSchema,
  WithdrawalFailedPayloadSchema,
  WithdrawalFailedStatusSchema,
  WithdrawalFailureCodeSchema,
  WithdrawalSubmittedPayloadSchema,
} from './schemas/index.js';
export type {
  AccountActivePayload,
  AccountDestinationChangedPayload,
  AccountProvisioningFailedPayload,
  AccountReleasedPayload,
  PartnerAccountFailureReason,
  PartnerDestination,
  PartnerDestinationNetwork,
  PayoutCompletedPayload,
  TradeRejectedPayload,
  WithdrawalCompletedPayload,
  WithdrawalFailedPayload,
  WithdrawalFailedStatus,
  WithdrawalFailureCode,
  WithdrawalSubmittedPayload,
} from './schemas/webhook-event.js';
