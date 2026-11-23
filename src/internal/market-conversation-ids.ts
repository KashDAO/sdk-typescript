/**
 * The id rules of the market conversation routes, shared by the client and
 * its mock so the two refuse the same input.
 */

import { KashValidationError } from '../errors.js';

import { validateUuid } from './request-options.js';

import type { MarketConversationMessageResource } from '../schemas/market-conversation.js';

/** The fields of a sent message a reply wait needs: what `sendMessage` returned. */
export type ConversationMessageRef = Pick<
  MarketConversationMessageResource,
  'id' | 'conversationId' | 'createdAt'
>;

/**
 * The conversation id as the API matches it: a UUID (checked client-side, so
 * `../`, `%2F` or a typo fail at the call site), lower-cased, because the API
 * compares conversation ids in lower case only and would answer an
 * upper-case form of a real id `404 MARKET_CONVERSATION_NOT_FOUND`.
 */
export function canonicalConversationId(conversationId: string): string {
  validateUuid(conversationId, 'conversationId');
  return conversationId.toLowerCase();
}

/**
 * The message a wait is for, checked before any request: its id a UUID and
 * its conversation the one waited on.
 */
export function ownMessage(
  conversationId: string,
  message: ConversationMessageRef
): { readonly id: string; readonly sentAt: number } {
  validateUuid(message.id, 'message.id');
  const sentAt = Date.parse(message.createdAt);
  if (canonicalConversationId(message.conversationId) !== conversationId || Number.isNaN(sentAt)) {
    throw new KashValidationError(
      'marketConversations.waitForReply: message must be the result of sendMessage for this ' +
        'conversation (its conversationId and createdAt).',
      { code: 'SDK_VALIDATION', issues: [{ path: 'message', message: 'not this conversation' }] }
    );
  }
  return { id: message.id.toLowerCase(), sentAt };
}
