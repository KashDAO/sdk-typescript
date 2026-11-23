/**
 * The mock client's `marketConversations`: its override handlers and their
 * defaults. Re-exported by name from `./index.ts`, which is the
 * `@kashdao/sdk/testing` surface; `createMockKashClient` builds it with
 * {@link createMockMarketConversations}.
 */

import { canonicalConversationId, ownMessage } from '../internal/market-conversation-ids.js';
import { parseRequestBody } from '../internal/request-body.js';
import { pageLimit } from '../internal/request-options.js';
import { TranscriptPage } from '../internal/transcript-page.js';
import {
  SendMarketConversationMessageBodySchema,
  type MarketConversationResource,
  type MarketConversationState,
  type MarketConversationTurn,
  type SendMarketConversationMessageBody,
} from '../schemas/market-conversation.js';

import {
  DEFAULT_MARKET_CONVERSATION,
  DEFAULT_MARKET_CONVERSATION_MESSAGE,
  DEFAULT_MARKET_CONVERSATION_STATE,
  DEFAULT_MARKET_CONVERSATION_TURN,
} from './fixtures.js';
import { checkOptions, toMockPage, type MockListResult } from './mock-support.js';

import type {
  ListMarketConversationMessagesParams,
  ListMarketConversationsParams,
  MarketConversationMessageResult,
  MarketConversationReply,
  MarketConversationsClient,
  MarketConversationStartResult,
  MarketConversationWriteOptions,
  WaitForReplyOptions,
} from '../clients/market-conversations.js';
import type { AccountRequestOverrides } from '../internal/request-options.js';

/**
 * The market conversation handlers. `messages` returns the turns of one page,
 * or `{ data, after?, hasMore? }`; the mock does not page further.
 */
export type MockMarketConversationsOverrides = {
  readonly start?: (
    opts?: MarketConversationWriteOptions
  ) => MarketConversationStartResult | Promise<MarketConversationStartResult>;
  readonly sendMessage?: (
    conversationId: string,
    body: SendMarketConversationMessageBody,
    opts?: MarketConversationWriteOptions
  ) => MarketConversationMessageResult | Promise<MarketConversationMessageResult>;
  readonly list?: (
    params?: ListMarketConversationsParams,
    opts?: AccountRequestOverrides
  ) => MockListResult<MarketConversationResource>;
  readonly get?: (
    conversationId: string,
    opts?: AccountRequestOverrides
  ) => MarketConversationState | Promise<MarketConversationState>;
  readonly messages?: (
    conversationId: string,
    params?: ListMarketConversationMessagesParams,
    opts?: AccountRequestOverrides
  ) => MockTranscriptResult | Promise<MockTranscriptResult>;
  readonly waitForReply?: (
    conversationId: string,
    opts: WaitForReplyOptions
  ) => MarketConversationReply | Promise<MarketConversationReply>;
};

/** One transcript page as a `messages` handler states it. */
export type MockTranscriptPage = {
  readonly data: readonly MarketConversationTurn[];
  readonly after?: string | null;
  readonly hasMore?: boolean;
};

/** What a `messages` handler returns: the turns, or a {@link MockTranscriptPage}. */
export type MockTranscriptResult = readonly MarketConversationTurn[] | MockTranscriptPage;

/** The mock's `marketConversations`: the real methods, picked by name. */
export type MockMarketConversations = Pick<
  MarketConversationsClient,
  'start' | 'sendMessage' | 'list' | 'get' | 'messages' | 'waitForReply'
>;

/**
 * Build the mock's `marketConversations`. The methods mirror the real
 * client's client-side checks (the body schema, UUID ids sent lower-case,
 * the page limits).
 */
export function createMockMarketConversations(
  mc: MockMarketConversationsOverrides
): MockMarketConversations {
  return {
    start: async (opts?: MarketConversationWriteOptions) => {
      checkOptions(opts);
      if (mc.start) return mc.start(opts);
      return { conversation: DEFAULT_MARKET_CONVERSATION, idempotentReplay: false };
    },
    sendMessage: async (
      conversationId: string,
      body: SendMarketConversationMessageBody,
      opts?: MarketConversationWriteOptions
    ) => {
      const id = canonicalConversationId(conversationId);
      parseRequestBody(
        SendMarketConversationMessageBodySchema,
        body,
        'marketConversations.sendMessage'
      );
      checkOptions(opts);
      if (mc.sendMessage) return mc.sendMessage(id, body, opts);
      return {
        message: { ...DEFAULT_MARKET_CONVERSATION_MESSAGE, conversationId: id },
        idempotentReplay: false,
      };
    },
    list: async (params?: ListMarketConversationsParams, opts?: AccountRequestOverrides) => {
      const limit = pageLimit(params?.limit, 'marketConversations.list');
      checkOptions(opts);
      return toMockPage(
        mc.list ? await mc.list(params, opts) : [DEFAULT_MARKET_CONVERSATION],
        limit
      );
    },
    get: async (conversationId: string, opts?: AccountRequestOverrides) => {
      const id = canonicalConversationId(conversationId);
      checkOptions(opts);
      return mc.get ? mc.get(id, opts) : { ...DEFAULT_MARKET_CONVERSATION_STATE, id };
    },
    messages: async (
      conversationId: string,
      params?: ListMarketConversationMessagesParams,
      opts?: AccountRequestOverrides
    ) => {
      const id = canonicalConversationId(conversationId);
      const limit = pageLimit(params?.limit, 'marketConversations.messages', 50);
      checkOptions(opts);
      const result = mc.messages
        ? await mc.messages(id, params, opts)
        : [DEFAULT_MARKET_CONVERSATION_TURN];
      const page: MockTranscriptPage = isTurnList(result) ? { data: result } : result;
      const after =
        page.after === undefined ? (page.data.length > 0 ? 'mock-after' : null) : page.after;
      return new TranscriptPage<MarketConversationTurn>(
        { data: page.data, pagination: { after, hasMore: page.hasMore ?? false, limit } },
        () => Promise.resolve({ data: [], pagination: { after, hasMore: false, limit } })
      );
    },
    waitForReply: async (conversationId: string, opts: WaitForReplyOptions) => {
      const id = canonicalConversationId(conversationId);
      ownMessage(id, opts.message);
      checkOptions(opts);
      const result = mc.waitForReply
        ? await mc.waitForReply(id, opts)
        : {
            outcome: 'replied' as const,
            state: { ...DEFAULT_MARKET_CONVERSATION_STATE, id },
            turns: [DEFAULT_MARKET_CONVERSATION_TURN],
            after: 'mock-after',
          };
      opts.onStatus?.(result.state);
      return result;
    },
  };
}

function isTurnList(result: MockTranscriptResult): result is readonly MarketConversationTurn[] {
  return Array.isArray(result);
}
