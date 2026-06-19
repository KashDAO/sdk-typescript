/**
 * Error handling — branch on `KashError` subclasses.
 *
 * Every failure throws a typed subclass of `KashError`. Use `instanceof`
 * for narrow type guards; `code` for stable string-based switches.
 */

import {
  KashAuthenticationError,
  KashClient,
  KashConfigurationError,
  KashConflictError,
  KashNotFoundError,
  KashRateLimitError,
  KashServerError,
  KashTimeoutError,
  KashValidationError,
} from '@kashdao/sdk';

let kash: KashClient;
try {
  kash = new KashClient({ apiKey: process.env['KASH_API_KEY']! });
} catch (err) {
  if (err instanceof KashConfigurationError) {
    console.error('SDK misconfigured:', err.issues);
    process.exit(1);
  }
  throw err;
}

try {
  await kash.trades.create({
    marketId: '00000000-0000-0000-0000-000000000001',
    outcomeIndex: 0,
    amount: '100',
    side: 'buy',
  });
} catch (err) {
  if (err instanceof KashRateLimitError) {
    console.error(`Rate limited. Retry after ${err.retryAfterSeconds}s.`);
  } else if (err instanceof KashConflictError) {
    // IDEMPOTENCY_KEY_CONFLICT, MARKET_NOT_TRADEABLE, INSUFFICIENT_BALANCE …
    console.error(`Conflict (${err.code}):`, err.message);
  } else if (err instanceof KashNotFoundError) {
    // MARKET_NOT_FOUND, TRADE_NOT_FOUND, WEBHOOK_EVENT_NOT_FOUND …
    console.error(`Not found (${err.code}):`, err.message);
  } else if (err instanceof KashValidationError) {
    console.error('Bad request:', err.message);
  } else if (err instanceof KashAuthenticationError) {
    console.error('API key rejected:', err.code);
  } else if (err instanceof KashTimeoutError) {
    console.error('Request timed out — consider raising timeoutMs.');
  } else if (err instanceof KashServerError) {
    // After exhausting retries.
    console.error(`Server error (${err.code}); request id: ${err.requestId}`);
  } else {
    throw err; // unknown — let it propagate
  }
}
