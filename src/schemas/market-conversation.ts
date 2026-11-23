/**
 * Market conversation schemas: the wire shapes for `/v1/market-conversations*`,
 * the market creation API's conversation routes.
 *
 * A conversation is a chat with Kash's market creation assistant. The caller
 * starts one, sends the user's messages, and reads the assistant's replies
 * from the transcript; the assistant drafts the market as the chat goes.
 * Every route needs the `markets:write` scope, reads included.
 *
 * Preview: the routes answer `503 ROUTE_DISABLED` until the market creation
 * API launches.
 */

import { z } from 'zod';

import { openEnum } from './_open-enum.js';
import { MetaSchema, PaginationSchema } from './envelope.js';

/** The longest message the API accepts, in UTF-16 code units (JavaScript's `string.length`). */
export const MARKET_CONVERSATION_MESSAGE_MAX_LENGTH = 2000;

/** An unpaired UTF-16 surrogate: a high one not followed by a low one, or a low one not preceded by a high one. */
const LONE_SURROGATE = /[\uD800-\uDBFF](?![\uDC00-\uDFFF])|(?<![\uD800-\uDBFF])[\uDC00-\uDFFF]/u;

/**
 * Body for `marketConversations.sendMessage()`. Mirrors the server's strict
 * schema in the rules that hold on every runtime, so a bad message fails at
 * the call site.
 *
 * `timezone` is checked for length only. The API resolves it against the IANA
 * database and refuses an unknown zone or a UTC offset with
 * `400 VALIDATION_FAILED`; that check is not repeated here, because the zones
 * a runtime knows depend on its ICU data, and a browser could refuse a zone
 * the API accepts.
 */
export const SendMarketConversationMessageBodySchema = z
  .object({
    /** What the user wrote, up to 2,000 UTF-16 code units. Market text is drafted in English whatever the language. */
    content: z
      .string()
      // Counted in UTF-16 code units as the API counts them, not with
      // `.max()`, which in zod 4 counts code points and would let through an
      // emoji-heavy message the API refuses.
      .refine(
        (value) => value.length <= MARKET_CONVERSATION_MESSAGE_MAX_LENGTH,
        `content must be at most ${MARKET_CONVERSATION_MESSAGE_MAX_LENGTH} UTF-16 code units`
      )
      .refine((value) => value.trim().length > 0, 'content must not be blank')
      .refine((value) => !value.includes('\u0000'), 'content must not contain a NUL character')
      .refine(
        (value) => !LONE_SURROGATE.test(value),
        'content must be well-formed text (no unpaired surrogate)'
      ),
    /**
     * `create_market` when the user explicitly asked to turn the conversation
     * into a market (the Kash app's "Turn this into a market"). Omit for a
     * typed message.
     */
    declaredAction: z.literal('create_market').optional(),
    /**
     * The user's IANA time zone (`America/Edmonton`), used only to read
     * relative dates such as "next Friday". Defaults to UTC.
     */
    timezone: z.string().min(1).max(64).optional(),
  })
  .strict();

export type SendMarketConversationMessageBody = z.infer<
  typeof SendMarketConversationMessageBodySchema
>;

/**
 * Which content rule refused a message, the `reason` of a
 * `422 MARKET_CONTENT_REFUSED` (read it with `isMarketContentRefusal`).
 * Open: the API may add a rule.
 */
export const MarketContentRefusalReasonSchema = openEnum([
  'personal_harm',
  'doxxing',
  'insider_information',
  'outcome_manipulation',
  'profanity',
]);

export type MarketContentRefusalReason = z.infer<typeof MarketContentRefusalReasonSchema>;

/** A conversation as `start()` and `list()` report it. */
export const MarketConversationResourceSchema = z.object({
  id: z.guid(),
  createdAt: z.iso.datetime({ offset: true }),
});

export type MarketConversationResource = z.infer<typeof MarketConversationResourceSchema>;

/**
 * `queued`: a message is waiting to be picked up; `working`: a reply is being
 * written; `idle`: nothing is in flight.
 */
export const MarketConversationStatusSchema = openEnum(['idle', 'queued', 'working']);

export type MarketConversationStatus = z.infer<typeof MarketConversationStatusSchema>;

/**
 * `pending`: accepted, not yet handed to the assistant; `published`: handed
 * over; `failed`: it could not be delivered and will get no reply. A message
 * the assistant has already answered can still read `pending`: read
 * `MarketConversationState.status` to know whether a reply is on its way.
 */
export const MarketConversationMessageStatusSchema = openEnum(['pending', 'published', 'failed']);

export type MarketConversationMessageStatus = z.infer<typeof MarketConversationMessageStatusSchema>;

/** Who wrote a transcript turn. */
export const MarketConversationRoleSchema = openEnum(['user', 'assistant']);

export type MarketConversationRole = z.infer<typeof MarketConversationRoleSchema>;

/** A conversation's state, as `get()` reports it. */
export const MarketConversationStateSchema = z.object({
  id: z.guid(),
  createdAt: z.iso.datetime({ offset: true }),
  status: MarketConversationStatusSchema,
  /** While `queued` behind other conversations: how many are ahead. Approximate. */
  queuePosition: z.number().int().nonnegative().nullable(),
  /** While `queued`: an approximate wait in seconds, never a promise. */
  estimatedWaitSeconds: z.number().int().nonnegative().nullable(),
  /** The latest reply holds a draft ready to submit as a market request. */
  readyToPublish: z.boolean(),
  /** The market request this conversation drafted, once one exists. */
  marketRequestId: z.guid().nullable(),
  /** The newest message sent to the conversation, by anyone, or null before the first. */
  latestMessage: z
    .object({
      id: z.guid(),
      status: MarketConversationMessageStatusSchema,
      createdAt: z.iso.datetime({ offset: true }),
    })
    .nullable(),
});

export type MarketConversationState = z.infer<typeof MarketConversationStateSchema>;

/** An accepted message, as `sendMessage()` reports it. Its `id` is what `waitForReply()` waits on. */
export const MarketConversationMessageResourceSchema = z.object({
  id: z.guid(),
  conversationId: z.guid(),
  createdAt: z.iso.datetime({ offset: true }),
});

export type MarketConversationMessageResource = z.infer<
  typeof MarketConversationMessageResourceSchema
>;

/**
 * One turn of the transcript. A turn the assistant rewrites keeps its
 * `turnNumber` and comes back with a higher `revision`.
 */
export const MarketConversationTurnSchema = z.object({
  turnNumber: z.number().int().nonnegative(),
  role: MarketConversationRoleSchema,
  content: z.string(),
  /** Starts at 1 and rises each time the turn is rewritten. */
  revision: z.number().int().positive(),
  createdAt: z.iso.datetime({ offset: true }),
  updatedAt: z.iso.datetime({ offset: true }),
});

export type MarketConversationTurn = z.infer<typeof MarketConversationTurnSchema>;

/**
 * `_meta` of the two write routes. `idempotent` is always `false` on them,
 * replay or not: the `Idempotent-Replay` response header is what says a
 * response is a replay, and the SDK reports it as `idempotentReplay`.
 */
const WriteMetaSchema = MetaSchema.extend({ idempotent: z.boolean() });

/** Wire envelope for `POST /v1/market-conversations` (`201`). */
export const StartMarketConversationResponseSchema = z.object({
  conversation: MarketConversationResourceSchema,
  /** Cross-endpoint dual-key alias: identical to `conversation` when present. */
  data: MarketConversationResourceSchema.optional(),
  _meta: WriteMetaSchema,
});

export type StartMarketConversationResponse = z.infer<typeof StartMarketConversationResponseSchema>;

/** Wire envelope for `GET /v1/market-conversations/{conversationId}`. */
export const GetMarketConversationResponseSchema = z.object({
  conversation: MarketConversationStateSchema,
  /** Cross-endpoint dual-key alias: identical to `conversation` when present. */
  data: MarketConversationStateSchema.optional(),
  _meta: MetaSchema,
});

export type GetMarketConversationResponse = z.infer<typeof GetMarketConversationResponseSchema>;

/** Wire envelope for `POST /v1/market-conversations/{conversationId}/messages` (`202`). */
export const SendMarketConversationMessageResponseSchema = z.object({
  message: MarketConversationMessageResourceSchema,
  /** Cross-endpoint dual-key alias: identical to `message` when present. */
  data: MarketConversationMessageResourceSchema.optional(),
  _meta: WriteMetaSchema,
});

export type SendMarketConversationMessageResponse = z.infer<
  typeof SendMarketConversationMessageResponseSchema
>;

/** Wire envelope for `GET /v1/market-conversations`: the caller's conversations, newest first. */
export const ListMarketConversationsResponseSchema = z.object({
  data: z.array(MarketConversationResourceSchema),
  pagination: PaginationSchema,
  _meta: MetaSchema,
});

export type ListMarketConversationsResponse = z.infer<typeof ListMarketConversationsResponseSchema>;

/**
 * The transcript's paging envelope. `after` is where the next read starts:
 * the position after the last turn served, kept even when `hasMore` is false.
 * A page that serves no turn keeps the position it was read from, so a read
 * from the start that finds nothing (before the first turn, or while the
 * assistant is writing one) answers null: read from the start next time.
 */
export const TranscriptPaginationSchema = z.object({
  after: z.string().nullable(),
  hasMore: z.boolean(),
  limit: z.number().int().positive(),
});

export type TranscriptPagination = z.infer<typeof TranscriptPaginationSchema>;

/** Wire envelope for `GET /v1/market-conversations/{conversationId}/messages`. */
export const ListMarketConversationMessagesResponseSchema = z.object({
  data: z.array(MarketConversationTurnSchema),
  pagination: TranscriptPaginationSchema,
  _meta: MetaSchema,
});

export type ListMarketConversationMessagesResponse = z.infer<
  typeof ListMarketConversationMessagesResponseSchema
>;
