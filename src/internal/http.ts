/**
 * The internal HTTP layer. Every sub-client routes through
 * {@link KashHttpClient.request}; nothing else in the SDK calls
 * `fetch` directly.
 *
 * Responsibilities (all in one place so the security/correctness
 * surface is auditable as a unit):
 *
 *   - Inject `X-API-Key`, `User-Agent`, `Accept`, `X-Kash-Api-Version`.
 *   - Inject `Idempotency-Key` from per-call opts when supplied.
 *   - Inject `Kash-Account` from the per-call `account` option, which only
 *     the account-scoped sub-client methods accept.
 *   - Honour AbortController timeouts → {@link KashTimeoutError}.
 *   - Retry 429 / 5xx with exponential backoff + full jitter.
 *   - Honour `Retry-After` on 429 (delta-seconds OR HTTP-date),
 *     bounded by `retryAfterMaxMs` — past the cap, the SDK surfaces
 *     the error rather than retrying too soon.
 *   - Send `If-None-Match` on a GET whose URL it has an `ETag` for, and
 *     resolve a `304 Not Modified` from the remembered body
 *     (`conditionalRequests`).
 *   - Parse RFC 7807 problem responses and classify into typed errors.
 *   - Validate every 2xx body against the supplied Zod schema.
 *   - Fire lifecycle hooks (request / response / retry / error) so
 *     consumers can wire their own logging without us picking a logger.
 *
 * The HTTP layer is deliberately ignorant of route details — paths,
 * params, and query strings are the responsibility of each sub-client.
 */

import {
  classifyHttpError,
  KashAbortedError,
  KashConfigurationError,
  KashError,
  KashNetworkError,
  KashRateLimitError,
  KashServerError,
  KashTimeoutError,
  KashValidationError,
  type ProblemDetailsLike,
} from '../errors.js';

import { ConditionalCache, type ConditionalCacheEntry } from './conditional-cache.js';
import { PRODUCTION_BASE_URL, STAGING_BASE_URL } from './config.js';
import {
  autoIdempotencyKey,
  IN_PROGRESS_RETRY_CUTOFF_MS,
  validateIdempotencyKey,
} from './idempotency-key.js';
import { parseProblemDetails } from './problem-details.js';
import { conditionalCacheKey, sanitizeCustomHeaders } from './request-headers.js';
import { validateUuid } from './request-options.js';
import {
  parseDeprecationHeaders,
  parseIdempotentReplayHeader,
  parseRateLimitHeaders,
} from './response-headers.js';
import { sleepWithAbort } from './sleep.js';
import { USER_AGENT } from './version.js';
import { joinIssuePath } from './zod-issues.js';

import type {
  ErrorHookEvent,
  FetchLike,
  KashClientConfig,
  KashClientHooks,
  RateLimitState,
  RequestHookEvent,
  ResponseHookEvent,
  RetryHookEvent,
} from './config.js';
import type { z } from 'zod';

export type HttpMethod = 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE';

export type RequestOptions<T> = {
  /** Path relative to `baseUrl`. Should start with `/`. */
  readonly path: string;
  readonly method: HttpMethod;
  /** Zod schema for the 2xx response body. Failures throw `KashValidationError`. */
  readonly schema: z.ZodType<T>;
  /** JSON body. Stringified once at the call site. */
  readonly body?: unknown;
  /** Query parameters; numeric / boolean values are stringified. */
  readonly query?: Record<string, string | number | boolean | undefined | null>;
  /** Optional `Idempotency-Key` (POST routes only). */
  readonly idempotencyKey?: string;
  /** The account to act for, sent as `Kash-Account`. See {@link AccountRequestOverrides}. */
  readonly account?: string;
  /** Override the global timeout for this request. */
  readonly timeoutMs?: number;
  /** Override the global maxRetries for this request. */
  readonly maxRetries?: number;
  /** Caller-supplied AbortSignal — composed with the timeout signal. */
  readonly signal?: AbortSignal;
  /**
   * Per-request headers. Merged with the client-level `headers` config
   * and the SDK-managed headers (which always win on collision).
   */
  readonly headers?: Record<string, string>;
  /** Return the status and replay flag with the body. See {@link KashHttpClient.request}. */
  readonly withResponse?: boolean;
};

/**
 * A parsed response with the transport facts a sub-client may need to report:
 * the HTTP status and whether the server marked it an idempotent replay.
 */
export type HttpResult<T> = {
  readonly data: T;
  readonly status: number;
  /** `true` when the server sent `Idempotent-Replay: true`: the stored answer to an earlier request. */
  readonly idempotentReplay: boolean;
};

/**
 * Internal fetch wrapper. Shared by every sub-client.
 */
export class KashHttpClient {
  private readonly baseUrl: string;
  private readonly apiKey: string | undefined;
  private readonly userAgent: string;
  private readonly timeoutMs: number;
  private readonly maxRetries: number;
  private readonly retryBaseDelayMs: number;
  private readonly retryMaxDelayMs: number;
  private readonly retryAfterMaxMs: number;
  private readonly fetchImpl: FetchLike;
  private readonly hooks: KashClientHooks;
  private readonly customHeaders: Readonly<Record<string, string>>;
  private readonly apiVersion: string;
  /** `null` when `conditionalRequests` is off. */
  private readonly conditionalCache: ConditionalCache | null;

  constructor(config: KashClientConfig) {
    // Strip trailing slashes once so we can join with `/<path>`.
    this.baseUrl = config.baseUrl.replace(/\/+$/, '');
    this.apiKey = config.apiKey;
    this.userAgent = config.userAgentSuffix
      ? `${USER_AGENT} ${config.userAgentSuffix}`
      : USER_AGENT;
    this.timeoutMs = config.timeoutMs;
    this.maxRetries = config.maxRetries;
    this.retryBaseDelayMs = config.retryBaseDelayMs;
    this.retryMaxDelayMs = config.retryMaxDelayMs;
    this.retryAfterMaxMs = config.retryAfterMaxMs;
    this.apiVersion = config.apiVersion;
    this.hooks = config.hooks ?? {};
    this.customHeaders = sanitizeCustomHeaders(config.headers);
    this.conditionalCache = config.conditionalRequests
      ? new ConditionalCache(config.conditionalCacheMaxEntries)
      : null;
    // Late-bind to globalThis.fetch so consumers don't have to provide
    // it explicitly. Capturing here means a global polyfill installed
    // after the client is constructed won't take effect — that's the
    // intended behaviour (one fetch per client, deterministic).
    const resolved = config.fetch ?? globalThis.fetch;
    if (typeof resolved !== 'function') {
      // Runtime-environment misconfiguration — Node ≤ 17, ancient
      // Browsers, or any host that exposes neither `globalThis.fetch`
      // nor a `fetch` shim. KashConfigurationError keeps the SDK's
      // "every throw is typed" contract.
      throw new KashConfigurationError(
        '@kashdao/sdk: global `fetch` is not available. ' +
          'Provide a `fetch` implementation via config in environments without one.',
        { code: 'SDK_FETCH_UNAVAILABLE' }
      );
    }
    this.fetchImpl = resolved;
  }

  /**
   * Send a request and return its parsed body. With `withResponse: true` it
   * returns the body with the HTTP status and the `Idempotent-Replay` flag,
   * for the few methods whose result reports them.
   */
  request<T>(opts: RequestOptions<T> & { readonly withResponse: true }): Promise<HttpResult<T>>;
  request<T>(opts: RequestOptions<T>): Promise<T>;
  async request<T>(rawOpts: RequestOptions<T>): Promise<T | HttpResult<T>> {
    if (rawOpts.idempotencyKey !== undefined) validateIdempotencyKey(rawOpts.idempotencyKey);
    if (rawOpts.account !== undefined) validateUuid(rawOpts.account, 'account');

    // Auto-key an unkeyed POST so this method's own retries cannot duplicate a
    // write. See `autoIdempotencyKey`. Resolved here — once, outside the retry
    // loop — and threaded through `opts` so the hooks report the key that was
    // actually sent rather than only the one the caller passed.
    const autoKey =
      rawOpts.method === 'POST' && rawOpts.idempotencyKey === undefined
        ? autoIdempotencyKey()
        : undefined;
    const opts: RequestOptions<T> =
      autoKey === undefined ? rawOpts : { ...rawOpts, idempotencyKey: autoKey };

    // A POST with no key at all — no caller key and no randomness source — must
    // not be repeated. Failing the call is recoverable; a duplicate trade is not.
    const unprotectedPost = opts.method === 'POST' && opts.idempotencyKey === undefined;

    const url = this.buildUrl(opts.path, opts.query);
    // Layering: client-config headers, then per-call headers, then
    // SDK-managed headers overwrite all. SDK headers (`X-API-Key`,
    // `User-Agent`, `Content-Type`, `Accept`, `Idempotency-Key`,
    // `X-Kash-Api-Version`, `Kash-Account`) always win — `traceparent`,
    // proxy auth, tenant tags, etc. are honoured.
    const perCallHeaders = opts.headers ? sanitizeCustomHeaders(opts.headers) : undefined;
    const headers: Record<string, string> = {
      ...this.customHeaders,
      ...(perCallHeaders ?? {}),
      Accept: 'application/json',
      'User-Agent': this.userAgent,
      // Public-API contract version pin. The API reads this
      // header lower-cased and routes the request through a
      // version-appropriate code path. Header absent (or empty
      // value) → the server's default, `2026-08-19`
      // (`DEFAULT_PUBLIC_API_VERSION`). The SDK always sends the value
      // the consumer pinned via `apiVersion: '...'` at construction,
      // `SDK_API_VERSION` unless overridden.
      'X-Kash-Api-Version': this.apiVersion,
    };
    if (this.apiKey) headers['X-API-Key'] = this.apiKey;
    if (opts.body !== undefined) headers['Content-Type'] = 'application/json';
    if (opts.idempotencyKey) headers['Idempotency-Key'] = opts.idempotencyKey;
    if (opts.account !== undefined) headers['Kash-Account'] = opts.account;
    // Conditional GET: only for a request this client has an ETag for. Read
    // once, outside the retry loop, so every attempt of one call revalidates
    // the same remembered body. The account is part of the key: one URL serves
    // a different representation for each account it acts for.
    const conditionalKey =
      opts.method === 'GET' && this.conditionalCache !== null
        ? conditionalCacheKey(url, opts.account)
        : undefined;
    const remembered =
      conditionalKey === undefined ? undefined : this.conditionalCache?.get(conditionalKey);
    if (remembered !== undefined) headers['If-None-Match'] = remembered.etag;

    const init: RequestInit = {
      method: opts.method,
      headers,
      // `fetch` only includes the body if it's not undefined; we
      // serialise once here so the same bytes are reused across retries
      // (matters for idempotent semantics — the server hashes the body
      // when matching `Idempotency-Key`).
      ...(opts.body === undefined ? {} : { body: JSON.stringify(opts.body) }),
    };

    const maxRetries = unprotectedPost ? 0 : (opts.maxRetries ?? this.maxRetries);
    const timeoutMs = opts.timeoutMs ?? this.timeoutMs;

    let attempt = 0;
    let lastErr: KashError | undefined;
    // Wall clock (not performance.now): the cutoff is about the server's claim
    // age, which began no earlier than this call's first send.
    const callStartedAt = Date.now();
    // The retry loop runs at most `maxRetries + 1` times (initial
    // attempt + retries). Each iteration either returns the parsed
    // body, throws a non-retryable error, or schedules a backoff.
    //
    // Caller-driven aborts (`opts.signal`) short-circuit the loop —
    // the consumer asked us to stop, so we never sleep or retry.
    while (attempt <= maxRetries) {
      if (opts.signal?.aborted) {
        throw this.decorate(
          new KashAbortedError('Request aborted by caller.', {
            code: 'SDK_ABORTED',
            cause: opts.signal.reason,
          }),
          opts.method,
          opts.path,
          attempt
        );
      }

      const startedAt = nowMs();
      this.fireRequest(opts, url, attempt);

      try {
        const result = await this.attempt<T>(
          url,
          init,
          opts.schema,
          timeoutMs,
          opts.signal,
          conditionalKey,
          remembered
        );
        this.fireResponse(
          opts,
          url,
          attempt,
          result.status,
          startedAt,
          result.requestId,
          result.rateLimit,
          result.apiVersion,
          result.idempotentReplay,
          result.deprecation,
          result.notModified
        );
        if (rawOpts.withResponse !== true) return result.data;
        return {
          data: result.data,
          status: result.status,
          idempotentReplay: result.idempotentReplay,
        };
      } catch (err) {
        const wrapped = err instanceof KashError ? err : wrapUnknown(err);
        const decorated = this.decorate(wrapped, opts.method, opts.path, attempt);
        lastErr = decorated;
        const durationMs = nowMs() - startedAt;
        this.fireResponse(
          opts,
          url,
          attempt,
          decorated.statusCode,
          startedAt,
          decorated.requestId,
          decorated.rateLimit ?? null,
          decorated.apiVersion,
          decorated.idempotentReplay ?? false,
          decorated.deprecation ?? null,
          false
        );

        // Caller-driven aborts and other non-retryables stop here.
        if (!isRetryableFor(decorated, opts.idempotencyKey) || attempt >= maxRetries) {
          this.fireError(opts, url, attempt, decorated, durationMs);
          throw decorated;
        }

        // Compute the backoff. If the server gave us a Retry-After
        // longer than `retryAfterMaxMs`, surface the error rather
        // than waiting past the cap and then doing one more attempt
        // — that respects the server's "wait this long" intent.
        const delay = computeDelayMs(
          decorated,
          attempt,
          this.retryBaseDelayMs,
          this.retryMaxDelayMs,
          this.retryAfterMaxMs
        );
        if (delay === RETRY_AFTER_EXCEEDS_CAP) {
          this.fireError(opts, url, attempt, decorated, durationMs);
          throw decorated;
        }
        // Never retry an in-progress claim at or after the cutoff: from the
        // claim's expiry the API lets a new request take the key over and run
        // the work again. See IN_PROGRESS_RETRY_CUTOFF_MS.
        if (
          decorated.code === 'IDEMPOTENCY_REQUEST_IN_PROGRESS' &&
          Date.now() + delay - callStartedAt >= IN_PROGRESS_RETRY_CUTOFF_MS
        ) {
          this.fireError(opts, url, attempt, decorated, durationMs);
          throw decorated;
        }

        this.fireRetry(opts, url, attempt, decorated, delay);

        // Sleep is interruptible — if the caller aborts during the
        // backoff, we surface the abort instead of continuing. The
        // shared `sleepWithAbort` throws a bare `KashAbortedError`;
        // decorate it here so the abort error carries the same
        // `context: { method, path, attempt }` as the top-of-loop
        // abort path at line 209-218.
        try {
          await sleepWithAbort(delay, opts.signal);
        } catch (sleepErr) {
          if (sleepErr instanceof KashAbortedError) {
            const decoratedAbort = this.decorate(sleepErr, opts.method, opts.path, attempt);
            this.fireError(opts, url, attempt, decoratedAbort, nowMs() - startedAt);
            throw decoratedAbort;
          }
          throw sleepErr;
        }
        attempt += 1;
      }
    }
    // Unreachable — the loop always either returns or throws — but
    // TypeScript can't see that and the explicit throw documents the
    // invariant.
    throw lastErr ?? new KashServerError('exhausted retries', { code: 'INTERNAL_ERROR' });
  }

  private buildUrl(path: string, query: RequestOptions<unknown>['query']): string {
    const normalisedPath = path.startsWith('/') ? path : `/${path}`;
    const url = new URL(this.baseUrl + normalisedPath);
    if (query) {
      for (const [key, value] of Object.entries(query)) {
        if (value === undefined || value === null) continue;
        url.searchParams.set(key, String(value));
      }
    }
    return url.toString();
  }

  /**
   * Decorate an error with method/path/attempt context. Done at the
   * retry-loop layer (rather than inside `attempt()`) so the attempt
   * counter is meaningful — every error reaching the consumer says
   * how many tries it took.
   */
  private decorate(err: KashError, method: string, path: string, attempt: number): KashError {
    err.context = { method, path, attempt: attempt + 1 };
    return err;
  }

  private fireRequest(opts: RequestOptions<unknown>, url: string, attempt: number): void {
    if (!this.hooks.onRequest) return;
    safeFire(this.hooks.onRequest, {
      method: opts.method,
      url,
      attempt: attempt + 1,
      idempotencyKey: opts.idempotencyKey,
    });
  }

  private fireResponse(
    opts: RequestOptions<unknown>,
    url: string,
    attempt: number,
    status: number | undefined,
    startedAt: number,
    requestId: string | undefined,
    rateLimit: RateLimitState | null,
    apiVersion: string | undefined,
    idempotentReplay: boolean,
    deprecation: ReturnType<typeof parseDeprecationHeaders>,
    notModified: boolean
  ): void {
    if (!this.hooks.onResponse) return;
    safeFire(this.hooks.onResponse, {
      method: opts.method,
      url,
      attempt: attempt + 1,
      idempotencyKey: opts.idempotencyKey,
      status: status ?? 0,
      durationMs: nowMs() - startedAt,
      requestId,
      rateLimit,
      apiVersion,
      idempotentReplay,
      deprecation,
      notModified,
    });
  }

  private fireRetry(
    opts: RequestOptions<unknown>,
    url: string,
    attempt: number,
    err: KashError,
    delayMs: number
  ): void {
    if (!this.hooks.onRetry) return;
    safeFire(this.hooks.onRetry, {
      method: opts.method,
      url,
      attempt: attempt + 1,
      idempotencyKey: opts.idempotencyKey,
      reason: retryReason(err),
      delayMs,
    });
  }

  private fireError(
    opts: RequestOptions<unknown>,
    url: string,
    attempt: number,
    err: KashError,
    durationMs: number
  ): void {
    if (!this.hooks.onError) return;
    safeFire(this.hooks.onError, {
      method: opts.method,
      url,
      attempt: attempt + 1,
      idempotencyKey: opts.idempotencyKey,
      status: err.statusCode,
      code: err.code,
      durationMs,
    });
  }

  private async attempt<T>(
    url: string,
    init: RequestInit,
    schema: z.ZodType<T>,
    timeoutMs: number,
    callerSignal: AbortSignal | undefined,
    conditionalKey: string | undefined,
    remembered: ConditionalCacheEntry | undefined
  ): Promise<{
    data: T;
    status: number;
    requestId: string | undefined;
    rateLimit: RateLimitState | null;
    apiVersion: string | undefined;
    idempotentReplay: boolean;
    deprecation: ReturnType<typeof parseDeprecationHeaders>;
    notModified: boolean;
  }> {
    const controller = new AbortController();
    const timeoutHandle = setTimeout(() => controller.abort(new TimeoutSentinel()), timeoutMs);
    // Compose the caller's signal with the timeout signal — the first
    // to abort wins.
    const onCallerAbort = (): void => {
      controller.abort(callerSignal?.reason);
    };
    if (callerSignal) {
      if (callerSignal.aborted) {
        clearTimeout(timeoutHandle);
        throw new KashAbortedError('Request aborted by caller before send.', {
          code: 'SDK_ABORTED',
          cause: callerSignal.reason,
        });
      }
      callerSignal.addEventListener('abort', onCallerAbort);
    }

    let response: Response;
    try {
      response = await this.fetchImpl(url, { ...init, signal: controller.signal });
    } catch (err) {
      if (controller.signal.aborted && controller.signal.reason instanceof TimeoutSentinel) {
        throw new KashTimeoutError(`Request timed out after ${timeoutMs}ms.`, {
          code: 'SDK_TIMEOUT',
          cause: err,
        });
      }
      // The fetch was aborted via the inner controller. If the caller
      // signal is the trigger, surface that; otherwise treat as a
      // generic transport failure.
      if (callerSignal?.aborted) {
        throw new KashAbortedError('Request aborted by caller mid-flight.', {
          code: 'SDK_ABORTED',
          cause: callerSignal.reason ?? err,
        });
      }
      throw new KashNetworkError(err instanceof Error ? err.message : 'Network request failed.', {
        code: 'SDK_NETWORK',
        cause: err,
      });
    } finally {
      clearTimeout(timeoutHandle);
      if (callerSignal) callerSignal.removeEventListener('abort', onCallerAbort);
    }

    // 304 is not `response.ok`, so it must be handled before the error path.
    if (response.status === 304) {
      return {
        data: fromNotModified(remembered, schema),
        status: 304,
        requestId: response.headers.get('x-request-id') ?? undefined,
        rateLimit: parseRateLimitHeaders(response),
        apiVersion: response.headers.get('x-api-version') ?? undefined,
        idempotentReplay: false,
        deprecation: parseDeprecationHeaders(response),
        notModified: true,
      };
    }

    if (!response.ok) {
      throw await this.classifyResponse(response);
    }

    const rateLimit = parseRateLimitHeaders(response);
    const apiVersion = response.headers.get('x-api-version') ?? undefined;
    const requestId = response.headers.get('x-request-id') ?? undefined;
    const idempotentReplay = parseIdempotentReplayHeader(response);
    const deprecation = parseDeprecationHeaders(response);
    const status = response.status;

    // 204 No Content / empty body — schemas can opt in via z.void()
    // or z.undefined(). Skip the JSON parse to avoid a SyntaxError.
    if (response.status === 204) {
      const parsed = schema.safeParse(undefined);
      if (!parsed.success) {
        throw new KashValidationError(
          `Response schema rejected the empty 204 body: ${formatZodIssue(parsed.error)}`,
          { code: 'SDK_VALIDATION', statusCode: 204 }
        );
      }
      return {
        data: parsed.data,
        status,
        requestId,
        rateLimit,
        apiVersion,
        idempotentReplay,
        deprecation,
        notModified: false,
      };
    }

    const contentType = response.headers.get('content-type') ?? '';
    if (!contentType.toLowerCase().includes('application/json')) {
      throw new KashValidationError(
        `Expected application/json response, received "${contentType || '<missing>'}"`,
        { code: 'SDK_CONTENT_TYPE', statusCode: response.status }
      );
    }

    let json: unknown;
    try {
      json = await response.json();
    } catch (err) {
      throw new KashValidationError('Response body is not valid JSON.', {
        code: 'SDK_PARSE',
        statusCode: response.status,
        cause: err,
      });
    }

    const parsed = schema.safeParse(json);
    if (!parsed.success) {
      throw new KashValidationError(`Response schema mismatch: ${formatZodIssue(parsed.error)}`, {
        code: 'SDK_VALIDATION',
        statusCode: response.status,
      });
    }
    if (conditionalKey !== undefined) this.remember(conditionalKey, response, json);
    return {
      data: parsed.data,
      status,
      requestId,
      rateLimit,
      apiVersion,
      idempotentReplay,
      deprecation,
      notModified: false,
    };
  }

  /**
   * Store (or forget) the body of a successful GET for revalidation. A
   * response without an `ETag` forgets the key: the remembered tag described a
   * representation the server has since stopped validating.
   */
  private remember(key: string, response: Response, json: unknown): void {
    const etag = response.headers.get('etag');
    if (etag) this.conditionalCache?.set(key, { etag, body: json });
    else this.conditionalCache?.delete(key);
  }

  private async classifyResponse(response: Response): Promise<KashError> {
    const requestId = response.headers.get('x-request-id') ?? undefined;
    const retryAfter = response.headers.get('retry-after');
    const rateLimit = parseRateLimitHeaders(response);
    const apiVersion = response.headers.get('x-api-version') ?? undefined;
    const idempotentReplay = parseIdempotentReplayHeader(response);
    const deprecation = parseDeprecationHeaders(response);

    let problem: ProblemDetailsLike = {};
    const contentType = response.headers.get('content-type') ?? '';
    if (
      contentType.includes('application/problem+json') ||
      contentType.includes('application/json')
    ) {
      try {
        problem = parseProblemDetails(await response.json());
      } catch {
        // Body wasn't JSON despite the content-type — fall through
        // with an empty problem object so the status-based classifier
        // still produces the right subclass.
      }
    }

    return classifyHttpError({
      status: response.status,
      problem,
      requestId,
      retryAfter,
      hint: this.crossModeHint(response.status, problem.code),
      rateLimit,
      apiVersion,
      idempotentReplay,
      deprecation,
    });
  }

  /**
   * Detects a key-prefix vs canonical-base-URL mismatch on 401 /
   * `API_KEY_INVALID` and returns a hint string the classifier can
   * append to the user-facing message. `kash_test_*` against production,
   * or `kash_live_*` against staging, both round-trip to the server as
   * a generic 401 — the SDK can do better client-side because it has
   * both pieces of state.
   *
   * **Best-effort, 401-only.** The hint only fires when the server
   * returns a 401 with no code OR a code starting with `API_KEY_`. If
   * an upstream proxy strips auth before the server's key check (and
   * returns e.g. 403 / 502 / a data-shape error), no hint is appended.
   * Consumers who want eager detection can compare
   * `kash.config.apiKey?.startsWith('kash_test_')` against
   * `kash.config.baseUrl` themselves at construction time.
   *
   * Match is strict against the canonical {@link PRODUCTION_BASE_URL}
   * and {@link STAGING_BASE_URL} constants — substring matching on
   * `'staging'` was fragile (false-positive on `staging-proxy.example.com`,
   * miss on `http://localhost:3000`). Custom mirrors / dev URLs receive
   * no hint by design — we don't know what audience they're for.
   */
  private crossModeHint(status: number, code: string | undefined): string | undefined {
    if (status !== 401) return undefined;
    if (code !== undefined && !code.startsWith('API_KEY_')) return undefined;
    if (!this.apiKey) return undefined;
    const isTestKey = this.apiKey.startsWith('kash_test_');
    const isLiveKey = this.apiKey.startsWith('kash_live_');
    const targetingProduction = this.baseUrl === PRODUCTION_BASE_URL;
    const targetingStaging = this.baseUrl === STAGING_BASE_URL;
    if (isLiveKey && targetingStaging) {
      return 'your `kash_live_*` key is being sent to a staging URL — remove the explicit `baseUrl` or use a `kash_test_*` key';
    }
    if (isTestKey && targetingProduction) {
      return 'your `kash_test_*` key is being sent to a production URL — remove the explicit `baseUrl` or use a `kash_live_*` key';
    }
    return undefined;
  }
}

class TimeoutSentinel extends Error {
  constructor() {
    super('timeout');
    this.name = 'TimeoutSentinel';
  }
}

/**
 * The value for a `304`: the body remembered when the request was SENT, parsed
 * afresh through the call's schema. Resolving from the entry captured before
 * sending, not from a fresh cache lookup, means a concurrent eviction or a
 * concurrent un-tagged 200 cannot turn a valid 304 into an error. A 304 with
 * nothing remembered (one the SDK did not ask for) has nothing to resolve to
 * and is an error, never an empty value.
 */
function fromNotModified<T>(
  remembered: ConditionalCacheEntry | undefined,
  schema: z.ZodType<T>
): T {
  if (remembered === undefined) {
    throw new KashValidationError(
      'Received 304 Not Modified for a request the SDK did not make conditional.',
      { code: 'SDK_UNEXPECTED_NOT_MODIFIED', statusCode: 304 }
    );
  }
  const parsed = schema.safeParse(remembered.body);
  if (!parsed.success) {
    throw new KashValidationError(
      `Remembered response no longer matches the schema: ${formatZodIssue(parsed.error)}`,
      { code: 'SDK_VALIDATION', statusCode: 304 }
    );
  }
  return parsed.data;
}

function wrapUnknown(err: unknown): KashError {
  return new KashNetworkError(err instanceof Error ? err.message : String(err), {
    code: 'SDK_UNKNOWN',
    cause: err,
  });
}

/**
 * Sentinel returned by {@link computeDelayMs} when the server's
 * `Retry-After` exceeds the configured cap. The retry loop converts
 * this into "throw immediately" so the consumer can apply
 * application-level backoff.
 */
const RETRY_AFTER_EXCEEDS_CAP = -1 as const;

/**
 * Backoff = min(maxDelay, base * 2^attempt) with full jitter — the
 * sleep is uniformly distributed in [0, computed). For 429s with a
 * `Retry-After`, we respect the server's value up to `retryAfterMaxMs`;
 * past that, we surface the error (signalled by the sentinel) so the
 * caller doesn't get a silent "wait less than asked" retry.
 */
function computeDelayMs(
  err: KashError,
  attempt: number,
  baseMs: number,
  maxMs: number,
  retryAfterMaxMs: number
): number {
  const retryAfterSeconds = retryAfterFromError(err);
  if (retryAfterSeconds !== undefined) {
    const requestedMs = retryAfterSeconds * 1000;
    if (requestedMs > retryAfterMaxMs) return RETRY_AFTER_EXCEEDS_CAP;
    return requestedMs;
  }
  const exp = Math.min(maxMs, baseMs * 2 ** attempt);
  return Math.floor(Math.random() * exp);
}

/** The parsed `Retry-After` (seconds) every `KashError` carries, when the response sent one. */
function retryAfterFromError(err: KashError): number | undefined {
  return err.retryAfterSeconds;
}

/**
 * Whether the loop may try again. Beyond the error's own `isRetryable`, a
 * `409 IDEMPOTENCY_REQUEST_IN_PROGRESS` on a KEYED request is retried: it
 * means an earlier attempt with the same key is still running on the server,
 * which this loop itself causes when an attempt times out (client
 * `timeoutMs` 30 s against the server's 60 s claim). Retrying with the same
 * key returns that attempt's answer once it finishes, and can never act
 * twice. A request without a key is never retried on it.
 */
function isRetryableFor(err: KashError, idempotencyKey: string | undefined): boolean {
  // The API answers in-progress with a short Retry-After (at most 5 s), so
  // the SDK polls while the claim is held; without one (an older API) the
  // backoff is short and the budget may run out first. Either way the
  // conflict can reach the caller: read the resource before retrying.
  if (err.isRetryable) return true;
  return idempotencyKey !== undefined && err.code === 'IDEMPOTENCY_REQUEST_IN_PROGRESS';
}

function retryReason(err: KashError): RetryHookEvent['reason'] {
  if (err.code === 'IDEMPOTENCY_REQUEST_IN_PROGRESS') return 'idempotency_in_progress';
  if (err instanceof KashRateLimitError) return 'rate_limit';
  if (err instanceof KashTimeoutError) return 'timeout';
  if (err instanceof KashNetworkError) return 'network';
  return 'server_error';
}

function formatZodIssue(error: z.ZodError): string {
  const issue = error.issues[0];
  if (!issue) return error.message;
  const path = issue.path.length > 0 ? joinIssuePath(issue.path) : '(root)';
  return `${path}: ${issue.message}`;
}

/**
 * `performance.now()` when available, otherwise `Date.now()`. The
 * relative measurements we use (request duration) work either way.
 */
function nowMs(): number {
  const perf = (globalThis as { performance?: { now: () => number } }).performance;
  return perf?.now ? perf.now() : Date.now();
}

/**
 * Run a hook handler without ever letting it bubble out — the SDK
 * must not crash because the consumer's logger threw. Errors thrown
 * by hooks are intentionally swallowed; instrumentation should never
 * break the request path.
 */
function safeFire<E>(handler: (event: E) => void, event: E): void {
  try {
    handler(event);
  } catch {
    // Intentional swallow. See the doc comment.
  }
}

export type {
  RequestHookEvent,
  ResponseHookEvent,
  RetryHookEvent,
  ErrorHookEvent,
  KashClientHooks,
};
