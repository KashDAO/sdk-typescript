/**
 * The guard of market conversations: whether an error is the API's content
 * refusal of a message. Served from `@kashdao/sdk/market-conversations`; kept
 * apart from `./guards.ts`, whose trade guards would pull the trade schemas
 * into that entry's bundle.
 */

import { KashError } from './errors.js';

import type { KashValidationError } from './errors.js';
import type { MarketContentRefusalReason } from './schemas/market-conversation.js';

/** A `KashValidationError` for `422 MARKET_CONTENT_REFUSED`, its `reason` typed. */
export type MarketContentRefusalError = KashValidationError & {
  readonly code: 'MARKET_CONTENT_REFUSED';
  readonly extensions: Readonly<Record<string, unknown>> & {
    readonly reason: MarketContentRefusalReason;
  };
};

/**
 * The error is the API's refusal of a market conversation message under
 * Kash's content rules (`422 MARKET_CONTENT_REFUSED`). Narrows
 * `err.extensions.reason` to the rule that refused it; `err.message` is the
 * server's explanation, written to show the user. Sending the same text again
 * is refused again, so ask the user to rephrase rather than retrying.
 *
 * Recognises the error by the SDK's cross-realm brand ({@link KashError.isKashError})
 * rather than `instanceof`, so it answers for an error thrown by any entry or
 * copy of the SDK: it is served from `@kashdao/sdk/market-conversations`,
 * whose bundle does not share the root's error classes. Every SDK maps a 422
 * to {@link KashValidationError}.
 *
 * @example
 * ```ts
 * try {
 *   await kash.marketConversations.sendMessage(conversationId, { content });
 * } catch (err) {
 *   if (isMarketContentRefusal(err)) showUser(err.message, err.extensions.reason);
 *   else throw err;
 * }
 * ```
 */
export function isMarketContentRefusal(err: unknown): err is MarketContentRefusalError {
  if (
    !KashError.isKashError(err) ||
    err.statusCode !== 422 ||
    err.code !== 'MARKET_CONTENT_REFUSED'
  ) {
    return false;
  }
  const reason = err.extensions?.['reason'];
  return typeof reason === 'string' && reason.length > 0;
}
