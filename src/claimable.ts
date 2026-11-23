/**
 * `@kashdao/sdk/claimable`: the types and schemas of claiming. What an
 * account can claim now (`kash.portfolio.claimable()`, whose method is on
 * the client as always) and the `position.claimable` webhook payload that
 * says when to ask.
 *
 * Import from here to name `claimable()`'s argument and result, or to
 * validate a claimable resource or payload yourself. The client already
 * validates every response, and `kash.webhooks.constructEvent` already parses
 * `position.claimable`. The payload's schema and type are also on
 * `@kashdao/sdk/webhooks` with every other webhook payload: the build keeps
 * that entry's import of this one external, so the schema is the same object
 * from either entry.
 *
 * @module @kashdao/sdk/claimable
 */

export type { ListClaimableParams } from './clients/portfolio.js';
export {
  ClaimablePositionResourceSchema,
  ClaimablePositionsResponseSchema,
  type ClaimablePositionResource,
  type ClaimablePositionsResponse,
} from './schemas/portfolio.js';
export {
  PositionClaimablePayloadSchema,
  type PositionClaimablePayload,
} from './schemas/webhook-event.js';
