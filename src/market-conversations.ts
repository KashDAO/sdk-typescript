/**
 * `@kashdao/sdk/market-conversations` (preview): the types, schemas and guard
 * of the market creation API's conversations. The methods are on the client
 * as always, as `kash.marketConversations`.
 *
 * Import from here to name a method's argument or result, to validate a
 * conversation resource yourself, or to recognise a content refusal with
 * {@link isMarketContentRefusal}. The client already validates every
 * response. Served from its own entry so the root and `@kashdao/sdk/schemas`
 * entries do not grow.
 *
 * `MarketConversationsClient` and `TranscriptPage` are exported as types
 * only: the client constructs both, and a class copied into this entry's
 * bundle would never match an instance from the root's under `instanceof`.
 * `isMarketContentRefusal` recognises an error by the SDK's cross-realm brand
 * for the same reason, so it answers for an error thrown by any entry or copy
 * of the SDK.
 *
 * @module @kashdao/sdk/market-conversations
 */

export type { IdempotentReplayFact } from './clients/partner-create-result.js';
export type {
  ListMarketConversationMessagesParams,
  ListMarketConversationsParams,
  MarketConversationMessageResult,
  MarketConversationReply,
  MarketConversationReplyOutcome,
  MarketConversationStartResult,
  MarketConversationsClient,
  MarketConversationWriteOptions,
  WaitForReplyOptions,
} from './clients/market-conversations.js';
export {
  isMarketContentRefusal,
  type MarketContentRefusalError,
} from './market-conversation-guards.js';
export type { ConversationMessageRef } from './internal/market-conversation-ids.js';
export type { TranscriptPage } from './internal/transcript-page.js';
export {
  GetMarketConversationResponseSchema,
  ListMarketConversationMessagesResponseSchema,
  ListMarketConversationsResponseSchema,
  MarketContentRefusalReasonSchema,
  MarketConversationMessageResourceSchema,
  MarketConversationMessageStatusSchema,
  MarketConversationResourceSchema,
  MarketConversationRoleSchema,
  MarketConversationStateSchema,
  MarketConversationStatusSchema,
  MarketConversationTurnSchema,
  SendMarketConversationMessageBodySchema,
  SendMarketConversationMessageResponseSchema,
  StartMarketConversationResponseSchema,
  TranscriptPaginationSchema,
  type GetMarketConversationResponse,
  type ListMarketConversationMessagesResponse,
  type ListMarketConversationsResponse,
  type MarketContentRefusalReason,
  type MarketConversationMessageResource,
  type MarketConversationMessageStatus,
  type MarketConversationResource,
  type MarketConversationRole,
  type MarketConversationState,
  type MarketConversationStatus,
  type MarketConversationTurn,
  type SendMarketConversationMessageBody,
  type SendMarketConversationMessageResponse,
  type StartMarketConversationResponse,
  type TranscriptPagination,
} from './schemas/market-conversation.js';
