/**
 * `Idempotency-Key` rules: the server's format and length limits, checked
 * client-side, and the key the SDK generates for an unkeyed POST.
 */

import { KashValidationError } from '../errors.js';

/**
 * Server-enforced `Idempotency-Key` constraints:
 *
 *   - Max 255 characters (`IDEMPOTENCY_KEY_TOO_LONG`).
 *   - Allowed alphabet `[A-Za-z0-9_\-:.]+` — letters, digits, underscore,
 *     hyphen, colon, dot. Whitespace, control chars, semicolons, slashes,
 *     equals signs, unicode, surrogate pairs are all rejected
 *     (`IDEMPOTENCY_KEY_FORMAT_INVALID`).
 *
 * Fail fast on the client so the consumer hits the bug at the call site
 * rather than after a round trip.
 */
const IDEMPOTENCY_KEY_MAX_LENGTH = 255;
const IDEMPOTENCY_KEY_PATTERN = /^[A-Za-z0-9_\-:.]+$/;

/**
 * An `Idempotency-Key` for a POST the caller did not key themselves.
 *
 * The SDK retries a POST on connection errors, timeouts and 5xx — measured
 * three attempts of `POST /v1/trades` from a single `trades.create()` when
 * `fetch` throws transiently. A transport error is NOT evidence the server did
 * nothing: a reset while reading the response leaves a trade created and the
 * client believing it failed, so an unkeyed retry places a SECOND real trade.
 * `idempotencyKey` and `clientRequestId` are both optional and the README
 * offers them as a convenience ("pick one or both"), which left the SDK's own
 * advertised resilience as the thing that could duplicate a customer's money.
 *
 * Generated ONCE per logical request, before the retry loop, so every attempt
 * of one call carries the same key and distinct calls carry distinct keys —
 * the server replays the original response instead of executing again. A
 * caller-supplied key always wins; this only fills the gap.
 *
 * Returns `undefined` when no randomness source exists, which is NOT treated
 * as "generate nothing and carry on": `request` drops maxRetries to 0 for that
 * POST rather than repeating an unprotected write (`.claude/rules/failed-reads.md`).
 * `crypto.randomUUID` is secure-context-only in browsers, so `getRandomValues`
 * — which is not — is a real fallback rather than a formality.
 */
export function autoIdempotencyKey(): string | undefined {
  const c = globalThis.crypto as Partial<Crypto> | undefined;
  if (typeof c?.randomUUID === 'function') return c.randomUUID();
  if (typeof c?.getRandomValues === 'function') {
    const bytes = c.getRandomValues(new Uint8Array(16));
    let hex = '';
    for (const b of bytes) hex += b.toString(16).padStart(2, '0');
    return `sdk-auto-${hex}`;
  }
  return undefined;
}

export function validateIdempotencyKey(key: string): void {
  if (typeof key !== 'string' || key.length === 0) {
    throw new KashValidationError('idempotencyKey must be a non-empty string.', {
      code: 'SDK_VALIDATION',
    });
  }
  if (key.length > IDEMPOTENCY_KEY_MAX_LENGTH) {
    throw new KashValidationError(
      `idempotencyKey is ${key.length} chars; the server caps it at ${IDEMPOTENCY_KEY_MAX_LENGTH}.`,
      { code: 'IDEMPOTENCY_KEY_TOO_LONG' }
    );
  }
  if (!IDEMPOTENCY_KEY_PATTERN.test(key)) {
    // Pinpoint the first offending character so the consumer can
    // edit-fix at the call site rather than guessing.
    const badIndex = [...key].findIndex((c) => !/^[A-Za-z0-9_\-:.]$/.test(c));
    const badChar = badIndex >= 0 ? JSON.stringify(key[badIndex]) : '<unknown>';
    throw new KashValidationError(
      `idempotencyKey contains ${badChar} at position ${badIndex}; ` +
        'allowed alphabet: A-Z, a-z, 0-9, `_`, `-`, `:`, `.`. ' +
        'Whitespace, control chars, and unicode are rejected by the server.',
      { code: 'IDEMPOTENCY_KEY_FORMAT_INVALID' }
    );
  }
}

/**
 * How long the API honours an `Idempotency-Key` claim for a request that is
 * still running (`IN_FLIGHT_SECONDS` in its idempotency plugin; a private
 * contract test pins the two together). From that moment another request may
 * take the claim over and run the work again.
 */
export const IDEMPOTENCY_CLAIM_LIFETIME_MS = 60_000;

/** Head room below the claim lifetime that absorbs clock and network delay. */
export const IN_PROGRESS_RETRY_MARGIN_MS = 15_000;

/**
 * The SDK never sends a retry on `IDEMPOTENCY_REQUEST_IN_PROGRESS` this long
 * or more after the call's first send. The claim began no earlier than that
 * send, so every retry the SDK makes reaches the server while the claim is
 * still held and can only be answered from it (in progress, or the stored
 * result), never by a second execution. Past the cutoff the conflict reaches
 * the caller, who should read the resource's state before retrying.
 */
export const IN_PROGRESS_RETRY_CUTOFF_MS =
  IDEMPOTENCY_CLAIM_LIFETIME_MS - IN_PROGRESS_RETRY_MARGIN_MS;
