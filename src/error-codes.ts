/**
 * The problem codes the SDK names, and the type of `KashError.code`.
 */

/**
 * Problem codes a caller is expected to branch on, by name. Compare
 * `err.code` against these instead of a string literal so a typo fails to
 * compile:
 *
 * ```ts
 * if (err instanceof KashConflictError && err.code === KASH_ERROR_CODE.WITHDRAWALS_HELD) {
 *   retryAt(Date.now() + (err.retryAfterSeconds ?? 0) * 1000);
 * }
 * ```
 *
 * Not exhaustive: the API has more codes, and adds new ones without an SDK
 * release, so `err.code` stays open ({@link KashErrorCode}). Every value
 * here exists in the API's catalogue; a contract test pins that.
 */
export const KASH_ERROR_CODE = Object.freeze({
  /** 401: the key was revoked. Issue a new one. */
  API_KEY_REVOKED: 'API_KEY_REVOKED',
  /** 403: the key lacks the scope; a user key on a partner route is also refused this way. */
  INSUFFICIENT_SCOPE: 'INSUFFICIENT_SCOPE',
  /** 403: the request's IP is not in the key's allowlist. */
  IP_NOT_ALLOWED: 'IP_NOT_ALLOWED',
  /** 403: a partner key without a specific IP allowlist, or a test key, in production. */
  PARTNER_KEY_REQUIRES_IP_ALLOWLIST: 'PARTNER_KEY_REQUIRES_IP_ALLOWLIST',
  /** 400: the request failed validation; `KashValidationError.issues` says where. */
  VALIDATION_FAILED: 'VALIDATION_FAILED',
  /** 400: the `Idempotency-Key` is longer than 255 characters (also checked client-side). */
  IDEMPOTENCY_KEY_TOO_LONG: 'IDEMPOTENCY_KEY_TOO_LONG',
  /** 400: the `Idempotency-Key` has a character outside `[A-Za-z0-9_\-:.]` (also checked client-side). */
  IDEMPOTENCY_KEY_FORMAT_INVALID: 'IDEMPOTENCY_KEY_FORMAT_INVALID',
  /** 400: `account` was sent on a call that acts for no account, or with a user key. */
  ACCOUNT_HEADER_NOT_ALLOWED: 'ACCOUNT_HEADER_NOT_ALLOWED',
  /** 400: a partner key called an account-scoped route without `account`. */
  ACCOUNT_HEADER_REQUIRED: 'ACCOUNT_HEADER_REQUIRED',
  /** 404: the account is unknown, another partner's, or released. */
  ACCOUNT_NOT_FOUND: 'ACCOUNT_NOT_FOUND',
  /** 409: the account is not `active` (still provisioning, suspended, or failed); `detail` names the status. */
  ACCOUNT_NOT_ACTIVE: 'ACCOUNT_NOT_ACTIVE',
  /** 409: a release was refused because the account still holds funds or work in flight. */
  RELEASE_REQUIRES_EMPTY_ACCOUNT: 'RELEASE_REQUIRES_EMPTY_ACCOUNT',
  /** 422: the destination network is not one Kash withdraws to here. */
  DESTINATION_NOT_SUPPORTED: 'DESTINATION_NOT_SUPPORTED',
  /** 400: the amount is below the network's minimum or its fee; `detail` names the figure. */
  WITHDRAWAL_BELOW_MINIMUM: 'WITHDRAWAL_BELOW_MINIMUM',
  /** 409: withdrawals are held for 24 hours after a destination change; see `retryAfterSeconds`. */
  WITHDRAWALS_HELD: 'WITHDRAWALS_HELD',
  /** 409: the available balance does not cover the amount. */
  INSUFFICIENT_BALANCE: 'INSUFFICIENT_BALANCE',
  /** 409: the `Idempotency-Key` was already used with a different request. */
  IDEMPOTENCY_KEY_CONFLICT: 'IDEMPOTENCY_KEY_CONFLICT',
  /**
   * 409: an earlier request with this `Idempotency-Key` is still running
   * (typically a retry after a timeout). Nothing was refused, and the earlier
   * request may still complete. The SDK retries it itself while the API's
   * claim on the key is safely held; when it reaches you, read the
   * withdrawal's state in `withdrawals.list`, then retry with the SAME key
   * if it did not happen. Never use a new key: that could act twice. For a
   * trade, call `trades.create` again with the same body and the error's
   * `clientRequestId`: the API returns the trade if it was recorded and
   * places it if it was not.
   */
  IDEMPOTENCY_REQUEST_IN_PROGRESS: 'IDEMPOTENCY_REQUEST_IN_PROGRESS',
  /**
   * 409: the `clientRequestId` already names a trade with a different body.
   * With an unchanged body, a concurrent attempt recorded the trade a moment
   * ago: call again to receive it. The SDK does that itself, once, for an id
   * it generated.
   */
  CLIENT_REQUEST_ID_CONFLICT: 'CLIENT_REQUEST_ID_CONFLICT',
  /** 410: the key is past the API's retention window; send the request with a new key. */
  IDEMPOTENCY_KEY_EXPIRED: 'IDEMPOTENCY_KEY_EXPIRED',
  /** 429: a rate limit ran out; see `retryAfterSeconds`. */
  RATE_LIMIT_EXCEEDED: 'RATE_LIMIT_EXCEEDED',
  /** 503: the route is switched off for now; `extensions.flag` names it. */
  ROUTE_DISABLED: 'ROUTE_DISABLED',
  /** 503: something Kash depends on could not be read; nothing was changed, so retry. */
  DEPENDENCY_UNAVAILABLE: 'DEPENDENCY_UNAVAILABLE',
} as const);

/** A code named in {@link KASH_ERROR_CODE}. */
export type KnownKashErrorCode = (typeof KASH_ERROR_CODE)[keyof typeof KASH_ERROR_CODE];

/**
 * The type of `KashError.code`: a {@link KnownKashErrorCode}, or any other
 * string. Open on purpose: the API adds codes without an SDK release, and the
 * SDK's own transport codes (`SDK_TIMEOUT`, `SDK_NETWORK`, ...) share the
 * field. The known codes still autocomplete and narrow.
 */
export type KashErrorCode = KnownKashErrorCode | (string & {});
