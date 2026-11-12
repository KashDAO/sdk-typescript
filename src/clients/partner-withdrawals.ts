/**
 * `partnerAccounts.withdrawals` sub-client: wraps
 * `/v1/partner/accounts/{accountId}/withdrawals`.
 *
 * Sends an account's USDC to its registered destination. The request names
 * only the amount, in USDC atomic units as a string. Requires a partner key
 * with the `partner:accounts` scope. The account is named in the path, so
 * these methods take no `account` option.
 *
 * Errors a caller should branch on (`err.code`, see `KASH_ERROR_CODE`):
 *
 *   - `ACCOUNT_NOT_ACTIVE` ({@link KashConflictError}): the account is not
 *     `active`. A suspended account can be quoted but not withdrawn from.
 *   - `WITHDRAWALS_HELD` ({@link KashConflictError}): withdrawals are held for
 *     24 hours after a destination change; `retryAfterSeconds` is the time
 *     left.
 *   - `INSUFFICIENT_BALANCE` ({@link KashConflictError}): the amount, plus the
 *     network fee to Arc, is above `availableAtomic`. The quote's
 *     `maxAmountAtomic` is the limit.
 *   - `WITHDRAWAL_BELOW_MINIMUM` ({@link KashValidationError}): below 1 USDC
 *     to Arc, or no more than the network fee could cost.
 *   - `DESTINATION_NOT_SUPPORTED` ({@link KashValidationError}, 422): Kash
 *     cannot withdraw to the account's destination network here.
 *   - `IDEMPOTENCY_KEY_CONFLICT` ({@link KashConflictError}): the key was used
 *     for a different amount.
 *   - `IDEMPOTENCY_REQUEST_IN_PROGRESS` ({@link KashConflictError}): an earlier
 *     request with this key is still running, typically after a timeout.
 *     NOT a refusal: retry with the SAME key to receive its answer. Never
 *     retry a withdrawal with a new key unless you know the first one made
 *     nothing (`list` shows it otherwise).
 *   - `DEPENDENCY_UNAVAILABLE` ({@link KashServerError}): a balance, fee or
 *     bridge quote could not be read. Nothing was withdrawn; retry.
 */

import { buildPage, type Page } from '../internal/pagination.js';
import { pollUntil } from '../internal/polling.js';
import { parseRequestBody, requireIdempotencyKey } from '../internal/request-body.js';
import { pageLimit, transportOverrides, validateUuid } from '../internal/request-options.js';
import {
  CreatePartnerWithdrawalBodySchema,
  CreatePartnerWithdrawalResponseSchema,
  GetPartnerWithdrawalResponseSchema,
  ListPartnerWithdrawalsResponseSchema,
  PartnerWithdrawalQuoteResponseSchema,
  type CreatePartnerWithdrawalBody,
  type PartnerWithdrawalQuote,
  type PartnerWithdrawalResource,
} from '../schemas/partner-withdrawal.js';

import { partnerCreateFacts, type PartnerCreateResult } from './partner-create-result.js';

import type { KashHttpClient } from '../internal/http.js';
import type { RequestOverrides } from '../internal/request-options.js';
import type { Pagination } from '../schemas/envelope.js';

/**
 * Options for {@link PartnerWithdrawalsClient.create}. `idempotencyKey` is
 * required: money moves, so a retry must return the same withdrawal rather
 * than make a second one. Use one key per withdrawal you intend, and reuse it
 * for every retry of that withdrawal.
 */
export type CreatePartnerWithdrawalOptions = RequestOverrides & {
  /** Sent as `Idempotency-Key`. Up to 255 characters of `[A-Za-z0-9_\-:.]`. */
  readonly idempotencyKey: string;
};

/** Return type of {@link PartnerWithdrawalsClient.create}. */
export type PartnerWithdrawalCreateResult = PartnerCreateResult<
  'withdrawal',
  PartnerWithdrawalResource
>;

/** Parameters for {@link PartnerWithdrawalsClient.quote}. */
export type PartnerWithdrawalQuoteParams = {
  /** The amount to quote, in USDC atomic units, as a string. */
  readonly amountAtomic: string;
};

/** Options for {@link PartnerWithdrawalsClient.waitForCompletion}. */
export type WaitForWithdrawalOptions = {
  /** Total time budget across all polls. Default 600 s: a bridge to Arc can take minutes. */
  readonly timeoutMs?: number;
  /** Delay between polls. Default 5 s. */
  readonly pollIntervalMs?: number;
  /** Invoked with each fetched withdrawal, for status logs. */
  readonly onStatus?: (withdrawal: PartnerWithdrawalResource) => void;
  /** Caller-driven abort. */
  readonly signal?: AbortSignal;
};

/** The statuses a withdrawal ends in. Any other status, known or not, is waited on. */
const TERMINAL_WITHDRAWAL_STATUSES = new Set(['completed', 'failed', 'cancelled']);

/** Parameters for {@link PartnerWithdrawalsClient.list}. */
export type ListPartnerWithdrawalsParams = {
  /** Opaque cursor from a previous page's `nextCursor`. */
  readonly cursor?: string;
  /** Page size, 1-100. Default 20. */
  readonly limit?: number;
};

export class PartnerWithdrawalsClient {
  constructor(private readonly http: KashHttpClient) {}

  /**
   * What a withdrawal of `amountAtomic` would deliver now
   * (`receiveAtomic`), and the most the account can withdraw
   * (`maxAmountAtomic`). Not a promise that the withdrawal will be accepted:
   * see {@link PartnerWithdrawalQuote}.
   *
   * @example
   * ```ts
   * const quote = await kash.partnerAccounts.withdrawals.quote(accountId, { amountAtomic: '2500000' });
   * ```
   */
  async quote(
    accountId: string,
    params: PartnerWithdrawalQuoteParams,
    opts: RequestOverrides = {}
  ): Promise<PartnerWithdrawalQuote> {
    validateUuid(accountId, 'accountId');
    const { amountAtomic } = parseRequestBody(
      CreatePartnerWithdrawalBodySchema,
      params,
      'partnerAccounts.withdrawals.quote'
    );
    const result = await this.http.request({
      path: `${withdrawalsPath(accountId)}/quote`,
      method: 'GET',
      schema: PartnerWithdrawalQuoteResponseSchema,
      query: { amountAtomic },
      ...transportOverrides(opts),
    });
    return result.quote;
  }

  /**
   * Withdraw `amountAtomic` to the account's registered destination. The
   * answer is `202` with the withdrawal in `pending`; it completes later
   * (`withdrawal.completed` or `withdrawal.failed` webhook, or poll
   * {@link get}).
   *
   * @example
   * ```ts
   * const withdrawal = await kash.partnerAccounts.withdrawals.create(
   *   accountId,
   *   { amountAtomic: '2500000' },
   *   { idempotencyKey: `withdraw-${requestId}` },
   * );
   * ```
   */
  async create(
    accountId: string,
    body: CreatePartnerWithdrawalBody,
    opts: CreatePartnerWithdrawalOptions
  ): Promise<PartnerWithdrawalCreateResult> {
    validateUuid(accountId, 'accountId');
    const parsed = parseRequestBody(
      CreatePartnerWithdrawalBodySchema,
      body,
      'partnerAccounts.withdrawals.create'
    );
    // Required by the type, and checked again for callers the type does not
    // reach.
    const { idempotencyKey, ...rest } =
      (opts as Partial<CreatePartnerWithdrawalOptions> | undefined) ?? {};
    requireIdempotencyKey(idempotencyKey, 'partnerAccounts.withdrawals.create');
    const response = await this.http.request({
      withResponse: true,
      path: withdrawalsPath(accountId),
      method: 'POST',
      schema: CreatePartnerWithdrawalResponseSchema,
      body: parsed,
      idempotencyKey,
      ...transportOverrides(rest),
    });
    return { withdrawal: response.data.withdrawal, ...partnerCreateFacts(response) };
  }

  /** Read one withdrawal. */
  async get(
    accountId: string,
    withdrawalId: string,
    opts: RequestOverrides = {}
  ): Promise<PartnerWithdrawalResource> {
    validateUuid(accountId, 'accountId');
    validateUuid(withdrawalId, 'withdrawalId');
    const result = await this.http.request({
      path: `${withdrawalsPath(accountId)}/${encodeURIComponent(withdrawalId)}`,
      method: 'GET',
      schema: GetPartnerWithdrawalResponseSchema,
      ...transportOverrides(opts),
    });
    return result.withdrawal;
  }

  /**
   * Poll the withdrawal until it reaches a final status (`completed`,
   * `failed` or `cancelled`) and return it; check `status` for which. The
   * `withdrawal.completed` and `withdrawal.failed` webhooks say the same
   * without polling. Rejects with `KashTimeoutError` (`SDK_POLL_TIMEOUT`)
   * when `timeoutMs` passes first.
   *
   * @example
   * ```ts
   * const done = await kash.partnerAccounts.withdrawals.waitForCompletion(accountId, withdrawalId);
   * if (done.status !== 'completed') await reopen(done.withdrawalId);
   * ```
   */
  async waitForCompletion(
    accountId: string,
    withdrawalId: string,
    opts: WaitForWithdrawalOptions = {}
  ): Promise<PartnerWithdrawalResource> {
    validateUuid(accountId, 'accountId');
    validateUuid(withdrawalId, 'withdrawalId');
    const inner: RequestOverrides = opts.signal === undefined ? {} : { signal: opts.signal };
    return pollUntil(
      () => this.get(accountId, withdrawalId, inner),
      (withdrawal) => TERMINAL_WITHDRAWAL_STATUSES.has(withdrawal.status),
      {
        timeoutMs: opts.timeoutMs ?? 600_000,
        pollIntervalMs: opts.pollIntervalMs ?? 5_000,
        ...(opts.onStatus === undefined ? {} : { onStatus: opts.onStatus }),
        ...(opts.signal === undefined ? {} : { signal: opts.signal }),
      }
    );
  }

  /**
   * The account's withdrawals, newest first. Returns a {@link Page}: the
   * first page, and an `AsyncIterable` over every page.
   */
  async list(
    accountId: string,
    params: ListPartnerWithdrawalsParams = {},
    opts: RequestOverrides = {}
  ): Promise<Page<PartnerWithdrawalResource>> {
    validateUuid(accountId, 'accountId');
    const limit = pageLimit(params.limit, 'partnerAccounts.withdrawals.list');
    const fetchPage = async (
      cursor: string | undefined
    ): Promise<{ data: readonly PartnerWithdrawalResource[]; pagination: Pagination }> =>
      this.http.request({
        path: withdrawalsPath(accountId),
        method: 'GET',
        schema: ListPartnerWithdrawalsResponseSchema,
        query: { cursor, limit },
        ...transportOverrides(opts),
      });
    return buildPage<PartnerWithdrawalResource>(fetchPage, params.cursor, { limit });
  }
}

function withdrawalsPath(accountId: string): string {
  return `/partner/accounts/${encodeURIComponent(accountId)}/withdrawals`;
}
