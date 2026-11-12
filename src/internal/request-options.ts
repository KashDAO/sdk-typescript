/**
 * The per-call options every resource method accepts, the account-scoped
 * variant, and the pickers that forward only those fields to the HTTP layer.
 */

import { KashValidationError } from '../errors.js';

/**
 * Per-call overrides accepted by every resource method's optional
 * trailing `opts` argument. Lets the consumer override transport-layer
 * defaults on a single request without spinning up a fresh
 * {@link KashClient} via {@link KashClient.withConfig}.
 *
 * @example
 * ```ts
 * await kash.markets.list(
 *   { status: 'ACTIVE' },
 *   {
 *     headers: { traceparent: '00-<trace-id>-<span-id>-01' },
 *     timeoutMs: 60_000,
 *     signal: controller.signal,
 *   }
 * );
 * ```
 */
export type RequestOverrides = {
  /**
   * Headers added to this single request. Merged on top of the
   * client-config `headers`. SDK-managed headers (`X-API-Key`,
   * `User-Agent`, `Content-Type`, `Accept`, `Idempotency-Key`,
   * `X-Kash-Api-Version`, `If-None-Match`, `Kash-Account`) always win and
   * are dropped from this bag: the consumer cannot set them here. Send
   * `Kash-Account` with the `account` option of the methods that take it.
   */
  readonly headers?: Record<string, string>;
  /** Override `timeoutMs` for this single request. */
  readonly timeoutMs?: number;
  /** Override `maxRetries` for this single request. */
  readonly maxRetries?: number;
  /** Caller-supplied AbortSignal — composed with the SDK's timeout signal. */
  readonly signal?: AbortSignal;
};

/**
 * {@link RequestOverrides} for a call that acts for one account: balance,
 * trades, portfolio, positions, redemptions and traces.
 *
 * A partner key has no user of its own; it names the partner account it acts
 * for with `account`, sent as the `Kash-Account` header. A user key always
 * acts for its own user and must leave `account` unset (the API answers
 * `400 ACCOUNT_HEADER_NOT_ALLOWED`).
 *
 * Only the methods of routes that accept the header take this type. Markets,
 * quotes, webhooks, account usage and the `partnerAccounts` routes (which
 * name the account in the path) take plain {@link RequestOverrides}, so
 * passing `account` to them in an object literal does not compile, and an
 * `account` that reaches them another way is dropped, never sent. For the same reason there is
 * no client-level default, and `Kash-Account` cannot be set through
 * `headers`: the SDK drops it there, as it drops every header it manages.
 *
 * @example
 * ```ts
 * const balance = await kash.balance.get({ account: accountId });
 * const trade = await kash.trades.create(body, { account: accountId, idempotencyKey });
 * ```
 */
export type AccountRequestOverrides = RequestOverrides & {
  /**
   * The partner account (`accountId`, a UUID) this call acts for, sent as
   * `Kash-Account`. Checked client-side: a value that is not a UUID throws
   * `KashValidationError` before any request.
   */
  readonly account?: string;
};

/**
 * Only the transport fields of `opts`: `headers`, `timeoutMs`, `maxRetries`,
 * `signal`. Methods of routes that act for no account pass their options
 * through this rather than spreading them, so an `account` that reached
 * them in a variable (the types refuse it only in an object literal) is
 * never forwarded as `Kash-Account`.
 */
export function transportOverrides(opts: RequestOverrides): RequestOverrides {
  return {
    ...(opts.headers === undefined ? {} : { headers: opts.headers }),
    ...(opts.timeoutMs === undefined ? {} : { timeoutMs: opts.timeoutMs }),
    ...(opts.maxRetries === undefined ? {} : { maxRetries: opts.maxRetries }),
    ...(opts.signal === undefined ? {} : { signal: opts.signal }),
  };
}

/**
 * {@link transportOverrides} plus `account`: what the account-scoped methods
 * forward. Picking the fields, rather than spreading the caller's object,
 * means an options bag that reached a method in a variable cannot override
 * the method's own `path`, `method`, `body`, `query` or `schema`.
 */
export function accountOverrides(opts: AccountRequestOverrides): AccountRequestOverrides {
  return {
    ...transportOverrides(opts),
    ...(opts.account === undefined ? {} : { account: opts.account }),
  };
}

/**
 * A canonical 8-4-4-4-12 hex UUID, any version: the rule the API applies to
 * `Kash-Account` and to the partner `{accountId}` path segment. Checked
 * before sending so a typo fails at the call site rather than as the API's
 * deliberately uninformative `404 ACCOUNT_NOT_FOUND`, and so a header value
 * can carry nothing but hex digits and hyphens.
 */
const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** Throw `KashValidationError` (code `SDK_VALIDATION`) unless `value` is a UUID. */
export function validateUuid(value: unknown, field: string): asserts value is string {
  if (typeof value !== 'string' || !UUID_PATTERN.test(value)) {
    throw new KashValidationError(
      `${field} must be a UUID, such as 3f2b8c1e-5d4a-4f6b-9c8d-7e6f5a4b3c2d.`,
      { code: 'SDK_VALIDATION', issues: [{ path: field, message: 'must be a UUID' }] }
    );
  }
}

/**
 * The page size for a partner list: `limit` if it is a whole number from 1 to
 * 100 (the API's bounds), else `KashValidationError` before any request.
 * Default 20, the API's.
 */
export function pageLimit(limit: number | undefined, label: string): number {
  if (limit === undefined) return 20;
  if (!Number.isInteger(limit) || limit < 1 || limit > 100) {
    throw new KashValidationError(`${label}: limit must be a whole number from 1 to 100.`, {
      code: 'SDK_VALIDATION',
      issues: [{ path: 'limit', message: 'must be an integer from 1 to 100' }],
    });
  }
  return limit;
}
