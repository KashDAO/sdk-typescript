/**
 * `marketConversations` sub-client: wraps `/v1/market-conversations*`, the
 * market creation API's conversation routes.
 *
 * Preview: every route answers `503 ROUTE_DISABLED` ({@link KashMaintenanceError})
 * until the market creation API launches, and the surface may change in a
 * minor release before then.
 *
 * A conversation is a chat with Kash's market creation assistant: start one,
 * send the user's messages, and read the assistant's replies from the
 * transcript. Sending is asynchronous: `sendMessage` answers `202` once the
 * message is queued, and {@link MarketConversationsClient.waitForReply} polls
 * until the reply is written.
 *
 * Requires the `markets:write` scope on every route, reads included. A
 * partner key names the user with `account` (`Kash-Account`). Errors a
 * caller should branch on:
 *
 *   - `MARKET_CONTENT_REFUSED` ({@link KashValidationError}, 422): the
 *     message breaks Kash's market content rules; `isMarketContentRefusal`
 *     narrows `extensions.reason`. Not retried; the same text is refused again.
 *   - `MARKET_CREATION_DAILY_LIMIT_REACHED` ({@link KashRateLimitError}, 429):
 *     today's allowance is used; `retryAfterSeconds` runs to 00:00 UTC.
 *   - `MARKET_CONVERSATION_NOT_FOUND` ({@link KashNotFoundError}, 404): unknown,
 *     or not this caller's; the same answer for both by design.
 *   - `MARKET_CONVERSATION_NOT_WRITABLE` ({@link KashConflictError}, 409).
 */

import { KashValidationError } from '../errors.js';
import { canonicalConversationId, ownMessage } from '../internal/market-conversation-ids.js';
import { buildPage, type Page } from '../internal/pagination.js';
import { pollTiming, pollUntil } from '../internal/polling.js';
import { parseRequestBody } from '../internal/request-body.js';
import {
  accountOverrides,
  pageLimit,
  type AccountRequestOverrides,
} from '../internal/request-options.js';
import { buildTranscriptPage, type TranscriptPage } from '../internal/transcript-page.js';
import {
  GetMarketConversationResponseSchema,
  ListMarketConversationMessagesResponseSchema,
  ListMarketConversationsResponseSchema,
  SendMarketConversationMessageBodySchema,
  SendMarketConversationMessageResponseSchema,
  StartMarketConversationResponseSchema,
  type MarketConversationMessageResource,
  type MarketConversationResource,
  type MarketConversationState,
  type MarketConversationTurn,
  type SendMarketConversationMessageBody,
  type TranscriptPagination,
} from '../schemas/market-conversation.js';

import type { IdempotentReplayFact } from './partner-create-result.js';
import type { KashHttpClient } from '../internal/http.js';
import type { ConversationMessageRef } from '../internal/market-conversation-ids.js';
import type { Pagination } from '../schemas/envelope.js';

/**
 * Options for `start` and `sendMessage`. The SDK keys every POST it sends, so
 * its own retries never start a second conversation or send a message twice.
 * Pass your own `idempotencyKey` to make a retry of the whole call safe too
 * (after a crash, or from another process): the API then returns the stored
 * first answer, including a content refusal, and judges nothing again.
 */
export type MarketConversationWriteOptions = AccountRequestOverrides & {
  /** Sent as `Idempotency-Key`. Up to 255 characters of `[A-Za-z0-9_\-:.]`. */
  readonly idempotencyKey?: string;
};

/**
 * Return type of {@link MarketConversationsClient.start}. `idempotentReplay`
 * is read from the `Idempotent-Replay` header: the body's `_meta.idempotent`
 * is always `false` on these routes.
 */
export type MarketConversationStartResult = {
  readonly conversation: MarketConversationResource;
} & IdempotentReplayFact;

/**
 * Return type of {@link MarketConversationsClient.sendMessage}. Pass
 * `message` to {@link MarketConversationsClient.waitForReply}.
 * `idempotentReplay` is read from the `Idempotent-Replay` header.
 */
export type MarketConversationMessageResult = {
  readonly message: MarketConversationMessageResource;
} & IdempotentReplayFact;

/** Parameters for {@link MarketConversationsClient.list}. */
export type ListMarketConversationsParams = {
  /** Opaque cursor from a previous page's `nextCursor`. */
  readonly cursor?: string;
  /** Page size, 1-100. Default 20. */
  readonly limit?: number;
};

/** Parameters for {@link MarketConversationsClient.messages}. */
export type ListMarketConversationMessagesParams = {
  /** A previous page's `after`. Omit to read from the start. */
  readonly after?: string;
  /** Page size, 1-100. Default 50. */
  readonly limit?: number;
};

/** Options for {@link MarketConversationsClient.waitForReply}. */
export type WaitForReplyOptions = {
  /**
   * The message whose reply to wait for: the `message` `sendMessage`
   * returned. Its `createdAt` tells a later message by someone else from a
   * message that is not in this conversation.
   */
  readonly message: ConversationMessageRef;
  /**
   * The transcript position you held when you sent the message (a previous
   * `after`), so only what follows it is read. Omit or pass `null` to read the
   * transcript from the start. A position past the reply finds no reply and
   * waits until `timeoutMs`.
   */
  readonly after?: string | null;
  /**
   * Total time budget across all polls. Default 180 s. The bound is
   * approximate: the wait is checked between polls, and the last poll (which
   * can start at the deadline) runs to its end, the retries and backoff of
   * its requests included, so the wait can end somewhat after `timeoutMs`.
   * A value that is not a finite number of 0 or more is refused with
   * `KashValidationError`.
   */
  readonly timeoutMs?: number;
  /**
   * Delay between polls. Default 3 s; at least 250 ms and at most
   * 2,147,483,647 ms, and any other value is refused with
   * `KashValidationError`. Each poll is one request against
   * your rate limit.
   */
  readonly pollIntervalMs?: number;
  /** Invoked with each state read, for progress (`status`, `queuePosition`). */
  readonly onStatus?: (state: MarketConversationState) => void;
  /** Caller-driven abort. */
  readonly signal?: AbortSignal;
  /** The partner account the conversation belongs to, sent on every poll as `Kash-Account`. */
  readonly account?: string;
};

/**
 * How a wait ended. `replied`: the assistant answered the message (a reply
 * saying the drafting budget is used up is a reply too). `failed`: the
 * message could not be delivered and will get no reply; send it again with a
 * new key. `superseded`: a later message is now the conversation's latest,
 * so the reply will answer that one; the wait returns what is there.
 */
export type MarketConversationReplyOutcome = 'replied' | 'failed' | 'superseded';

/** Return type of {@link MarketConversationsClient.waitForReply}. */
export type MarketConversationReply = {
  readonly outcome: MarketConversationReplyOutcome;
  /** The state read that ended the wait. */
  readonly state: MarketConversationState;
  /**
   * The turns after `after`, one per `turnNumber` at its highest `revision`,
   * in turn order. Empty when the outcome is `failed`.
   */
  readonly turns: readonly MarketConversationTurn[];
  /**
   * Where the next read starts: keep it and pass it as `after` next time.
   * Null when no turn has been read from the start yet: read from the start.
   */
  readonly after: string | null;
};

/** What ended a wait, before the transcript is attached. */
type Settled = {
  readonly outcome: MarketConversationReplyOutcome;
  readonly state: MarketConversationState;
};

export class MarketConversationsClient {
  constructor(private readonly http: KashHttpClient) {}

  /**
   * Start a conversation (`201`). Nothing reaches the assistant until the
   * first message.
   *
   * @example
   * ```ts
   * const { conversation } = await kash.marketConversations.start({ idempotencyKey: `start-${jobId}` });
   * ```
   */
  async start(opts: MarketConversationWriteOptions = {}): Promise<MarketConversationStartResult> {
    const { idempotencyKey, ...rest } = opts;
    const response = await this.http.request({
      withResponse: true,
      path: '/market-conversations',
      method: 'POST',
      schema: StartMarketConversationResponseSchema,
      body: {},
      ...(idempotencyKey === undefined ? {} : { idempotencyKey }),
      ...accountOverrides(rest),
    });
    return {
      conversation: response.data.conversation,
      idempotentReplay: response.idempotentReplay,
    };
  }

  /**
   * Send the user's message (`202`): it is queued, and the reply arrives in
   * the transcript. The body is checked client-side first; the API resolves
   * `timezone` itself and answers `400 VALIDATION_FAILED` for an unknown zone
   * or a UTC offset. A message sent while an earlier one is still queued is
   * queued behind it.
   *
   * @example
   * ```ts
   * const sent = await kash.marketConversations.sendMessage(
   *   conversation.id,
   *   { content: 'Will Calgary get more than 10 cm of snow on 1 December 2026?' },
   *   { idempotencyKey: `msg-${jobId}-1` }
   * );
   * const reply = await kash.marketConversations.waitForReply(conversation.id, {
   *   message: sent.message,
   * });
   * ```
   */
  async sendMessage(
    conversationId: string,
    body: SendMarketConversationMessageBody,
    opts: MarketConversationWriteOptions = {}
  ): Promise<MarketConversationMessageResult> {
    const path = `${conversationPath(conversationId)}/messages`;
    const parsed = parseRequestBody(
      SendMarketConversationMessageBodySchema,
      body,
      'marketConversations.sendMessage'
    );
    const { idempotencyKey, ...rest } = opts;
    const response = await this.http.request({
      withResponse: true,
      path,
      method: 'POST',
      schema: SendMarketConversationMessageResponseSchema,
      body: parsed,
      ...(idempotencyKey === undefined ? {} : { idempotencyKey }),
      ...accountOverrides(rest),
    });
    return { message: response.data.message, idempotentReplay: response.idempotentReplay };
  }

  /**
   * Your conversations, newest first. Returns a {@link Page}: the first page,
   * and an `AsyncIterable` over every page.
   */
  async list(
    params: ListMarketConversationsParams = {},
    opts: AccountRequestOverrides = {}
  ): Promise<Page<MarketConversationResource>> {
    const limit = pageLimit(params.limit, 'marketConversations.list');
    const fetchPage = async (
      cursor: string | undefined
    ): Promise<{ data: readonly MarketConversationResource[]; pagination: Pagination }> =>
      this.http.request({
        path: '/market-conversations',
        method: 'GET',
        schema: ListMarketConversationsResponseSchema,
        query: { cursor, limit },
        ...accountOverrides(opts),
      });
    return buildPage<MarketConversationResource>(fetchPage, params.cursor, { limit });
  }

  /** The conversation's state: whether a reply is on its way, and the latest message. */
  async get(
    conversationId: string,
    opts: AccountRequestOverrides = {}
  ): Promise<MarketConversationState> {
    const path = conversationPath(conversationId);
    const response = await this.http.request({
      path,
      method: 'GET',
      schema: GetMarketConversationResponseSchema,
      ...accountOverrides(opts),
    });
    return response.conversation;
  }

  /**
   * The transcript after `after`, oldest change first, as a
   * {@link TranscriptPage}. Keep the last page's `after` and pass it next time
   * to read only what is new; a turn rewritten since comes back with a
   * higher `revision`.
   */
  async messages(
    conversationId: string,
    params: ListMarketConversationMessagesParams = {},
    opts: AccountRequestOverrides = {}
  ): Promise<TranscriptPage<MarketConversationTurn>> {
    const path = `${conversationPath(conversationId)}/messages`;
    const limit = pageLimit(params.limit, 'marketConversations.messages', 50);
    const fetchPage = async (
      after: string | undefined
    ): Promise<{
      data: readonly MarketConversationTurn[];
      pagination: TranscriptPagination;
    }> =>
      this.http.request({
        path,
        method: 'GET',
        schema: ListMarketConversationMessagesResponseSchema,
        query: { after, limit },
        ...accountOverrides(opts),
      });
    return buildTranscriptPage<MarketConversationTurn>(fetchPage, params.after);
  }

  /**
   * Poll the conversation until the assistant has answered `message` (the
   * one `sendMessage` returned), then return the new turns and the position
   * to read from next time.
   *
   * Resolves with `outcome: 'replied'` once the conversation is idle and the
   * newest assistant turn in the transcript after `after` was written since
   * the message; `'failed'` as soon as the message is marked undeliverable;
   * and `'superseded'` when a message sent after it has become the latest
   * (the reply will answer that one, so it is not waited for). A message
   * that is not in the conversation is refused with `KashValidationError`
   * (`SDK_VALIDATION`). Rejects with
   * `KashTimeoutError` (`SDK_POLL_TIMEOUT`) when `timeoutMs` passes first: the
   * reply may still come, so keep `after` and read the transcript later. A
   * spend-cap reply ("today's budget is used up") is an assistant turn, so
   * it resolves as `replied`.
   */
  async waitForReply(
    conversationId: string,
    opts: WaitForReplyOptions
  ): Promise<MarketConversationReply> {
    const timing = pollTiming(
      'marketConversations.waitForReply',
      { timeoutMs: opts.timeoutMs ?? 180_000, pollIntervalMs: opts.pollIntervalMs ?? 3_000 },
      MIN_POLL_INTERVAL_MS
    );
    const id = canonicalConversationId(conversationId);
    const message = ownMessage(id, opts.message);
    const inner: AccountRequestOverrides = {
      ...(opts.signal === undefined ? {} : { signal: opts.signal }),
      ...(opts.account === undefined ? {} : { account: opts.account }),
    };
    const turns = new Map<number, MarketConversationTurn>();
    let after = opts.after ?? null;

    const readNewTurns = async (): Promise<void> => {
      const first = await this.messages(id, after === null ? {} : { after }, inner);
      for await (const page of first.pages()) {
        for (const turn of page.data) {
          const held = turns.get(turn.turnNumber);
          if (held === undefined || turn.revision > held.revision) turns.set(turn.turnNumber, turn);
        }
        after = page.after ?? after;
      }
    };

    const settle = async (): Promise<Settled | null> => {
      const state = await this.get(id, inner);
      opts.onStatus?.(state);
      const latest = state.latestMessage;
      if (latest === null || latest.id.toLowerCase() !== message.id) {
        // The latest message is ordered by its creation, so another message
        // created no earlier than ours is a later one; anything else means
        // ours is not in this conversation.
        if (latest === null || Date.parse(latest.createdAt) < message.sentAt) {
          throw notInConversation(id, message.id);
        }
        await readNewTurns();
        return { outcome: 'superseded', state };
      }
      if (latest.status === 'failed') return { outcome: 'failed', state };
      // `idle` with our message latest and not failed: the API has seen an
      // assistant turn written since it (`awaiting_reply` reads the newest
      // assistant turn). The transcript can briefly lag the state (it serves
      // only committed changes), so the newest assistant turn read must be
      // that reply before the wait ends.
      if (state.status !== 'idle') return null;
      await readNewTurns();
      const newest = newestAssistantTurn(turns);
      const replied = newest !== undefined && Date.parse(newest.createdAt) >= message.sentAt;
      return replied ? { outcome: 'replied', state } : null;
    };

    const { outcome, state } = await pollUntil(
      settle,
      (value): value is Settled => value !== null,
      {
        timing,
        ...(opts.signal === undefined ? {} : { signal: opts.signal }),
      }
    );
    return {
      outcome,
      state,
      turns:
        outcome === 'failed' ? [] : [...turns.values()].sort((a, b) => a.turnNumber - b.turnNumber),
      after,
    };
  }
}

function conversationPath(conversationId: string): string {
  return `/market-conversations/${encodeURIComponent(canonicalConversationId(conversationId))}`;
}

/** The shortest delay `waitForReply` polls at: each poll is a request against the caller's rate limit. */
const MIN_POLL_INTERVAL_MS = 250;

function notInConversation(conversationId: string, messageId: string): KashValidationError {
  return new KashValidationError(
    `marketConversations.waitForReply: message ${messageId} is not one of conversation ` +
      `${conversationId}'s messages.`,
    { code: 'SDK_VALIDATION', issues: [{ path: 'message.id', message: 'not in conversation' }] }
  );
}

/** The assistant turn with the highest `turnNumber`, the one the API calls the reply. */
function newestAssistantTurn(
  turns: ReadonlyMap<number, MarketConversationTurn>
): MarketConversationTurn | undefined {
  let newest: MarketConversationTurn | undefined;
  for (const turn of turns.values()) {
    if (
      turn.role === 'assistant' &&
      (newest === undefined || turn.turnNumber > newest.turnNumber)
    ) {
      newest = turn;
    }
  }
  return newest;
}
