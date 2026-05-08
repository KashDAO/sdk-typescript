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
 *   - Honour AbortController timeouts → {@link KashTimeoutError}.
 *   - Retry 429 / 5xx with exponential backoff + full jitter.
 *   - Honour `Retry-After` on 429 (delta-seconds OR HTTP-date),
 *     bounded by `retryAfterMaxMs` — past the cap, the SDK surfaces
 *     the error rather than retrying too soon.
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

import { PRODUCTION_BASE_URL, STAGING_BASE_URL } from './config.js';
import { sleepWithAbort } from './sleep.js';
import { USER_AGENT } from './version.js';

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
   * `X-Kash-Api-Version`) always win — consumer cannot override them via
   * this option.
   */
  readonly headers?: Record<string, string>;
  /** Override `timeoutMs` for this single request. */
  readonly timeoutMs?: number;
  /** Override `maxRetries` for this single request. */
  readonly maxRetries?: number;
  /** Caller-supplied AbortSignal — composed with the SDK's timeout signal. */
  readonly signal?: AbortSignal;
};

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

  async request<T>(opts: RequestOptions<T>): Promise<T> {
    if (opts.idempotencyKey !== undefined) validateIdempotencyKey(opts.idempotencyKey);
    const url = this.buildUrl(opts.path, opts.query);
    // Layering: client-config headers, then per-call headers, then
    // SDK-managed headers overwrite all. SDK headers (`X-API-Key`,
    // `User-Agent`, `Content-Type`, `Accept`, `Idempotency-Key`,
    // `X-Kash-Api-Version`) always win — `traceparent`, proxy auth,
    // tenant tags, etc. are honoured.
    const perCallHeaders = opts.headers ? sanitizeCustomHeaders(opts.headers) : undefined;
    const headers: Record<string, string> = {
      ...this.customHeaders,
      ...(perCallHeaders ?? {}),
      Accept: 'application/json',
      'User-Agent': this.userAgent,
      // Public-API contract version pin. The plugin at
      // `apps/public-api/src/plugins/api-version.ts` reads this
      // header lower-cased and routes the request through a
      // version-appropriate code path. Header absent (or empty
      // value) → server defaults to the canonical
      // `PUBLIC_API_VERSION`. The SDK always sends the value the
      // consumer pinned via `apiVersion: '...'` at construction.
      'X-Kash-Api-Version': this.apiVersion,
    };
    if (this.apiKey) headers['X-API-Key'] = this.apiKey;
    if (opts.body !== undefined) headers['Content-Type'] = 'application/json';
    if (opts.idempotencyKey) headers['Idempotency-Key'] = opts.idempotencyKey;

    const init: RequestInit = {
      method: opts.method,
      headers,
      // `fetch` only includes the body if it's not undefined; we
      // serialise once here so the same bytes are reused across retries
      // (matters for idempotent semantics — the server hashes the body
      // when matching `Idempotency-Key`).
      ...(opts.body === undefined ? {} : { body: JSON.stringify(opts.body) }),
    };

    const maxRetries = opts.maxRetries ?? this.maxRetries;
    const timeoutMs = opts.timeoutMs ?? this.timeoutMs;

    let attempt = 0;
    let lastErr: KashError | undefined;
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
        const result = await this.attempt<T>(url, init, opts.schema, timeoutMs, opts.signal);
        this.fireResponse(
          opts,
          url,
          attempt,
          200,
          startedAt,
          undefined,
          result.rateLimit,
          result.apiVersion,
          result.idempotentReplay,
          result.deprecation
        );
        return result.data;
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
          decorated.deprecation ?? null
        );

        // Caller-driven aborts and other non-retryables stop here.
        if (!decorated.isRetryable || attempt >= maxRetries) {
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
    deprecation: ReturnType<typeof parseDeprecationHeaders>
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
    callerSignal: AbortSignal | undefined
  ): Promise<{
    data: T;
    rateLimit: RateLimitState | null;
    apiVersion: string | undefined;
    idempotentReplay: boolean;
    deprecation: ReturnType<typeof parseDeprecationHeaders>;
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

    if (!response.ok) {
      throw await this.classifyResponse(response);
    }

    const rateLimit = parseRateLimitHeaders(response);
    const apiVersion = response.headers.get('x-api-version') ?? undefined;
    const idempotentReplay = parseIdempotentReplayHeader(response);
    const deprecation = parseDeprecationHeaders(response);

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
      return { data: parsed.data, rateLimit, apiVersion, idempotentReplay, deprecation };
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
    return { data: parsed.data, rateLimit, apiVersion, idempotentReplay, deprecation };
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
        const body = (await response.json()) as ProblemDetailsLike;
        if (body && typeof body === 'object') problem = body;
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

/**
 * Parse the rate-limit response headers (`X-RateLimit-Limit`,
 * `X-RateLimit-Remaining`, `X-RateLimit-Reset`) into a typed object.
 * Returns `null` when any header is missing or non-numeric — we don't
 * surface partial state because partial state is a footgun (a
 * `remaining: 0` without context could be misread as "I'm rate-limited").
 *
 * The Kash API attaches all three on every response from a rate-limited
 * route — see `apps/public-api/src/plugins/rate-limit.ts`.
 *
 * **Header lookup case**: lowercase keys are intentional and match the
 * Fetch spec — `Headers.prototype.get` is case-insensitive (see
 * https://fetch.spec.whatwg.org/#dom-headers-get). Using one canonical
 * casing here keeps maintenance straightforward; future maintainers
 * should NOT add uppercase variants for the same logical header.
 */
function parseRateLimitHeaders(response: Response): RateLimitState | null {
  const limit = response.headers.get('x-ratelimit-limit');
  const remaining = response.headers.get('x-ratelimit-remaining');
  const reset = response.headers.get('x-ratelimit-reset');
  if (!limit || !remaining || !reset) return null;
  const limitN = Number(limit);
  const remainingN = Number(remaining);
  const resetN = Number(reset);
  if (!Number.isFinite(limitN) || !Number.isFinite(remainingN) || !Number.isFinite(resetN)) {
    return null;
  }
  return {
    limit: Math.trunc(limitN),
    remaining: Math.max(0, Math.trunc(remainingN)),
    resetSeconds: Math.max(0, Math.trunc(resetN)),
  };
}

/**
 * Parse the `Idempotent-Replay` response header. The server emits
 * `Idempotent-Replay: true` only when the response is a cached replay
 * of an earlier idempotent request; absence (or any other value)
 * means a fresh execution.
 */
function parseIdempotentReplayHeader(response: Response): boolean {
  return response.headers.get('idempotent-replay') === 'true';
}

/**
 * Parse the `Sunset` (RFC 8594), `Deprecation`
 * (draft-ietf-httpapi-deprecation-header), and `Link rel="sunset"`
 * response headers into a structured advisory. Returns `null` when
 * none of the three headers are present (the steady-state case).
 *
 * The `Link` header may contain multiple semicolon-separated relations;
 * only the first match with `rel="sunset"` is surfaced. The bare URL
 * is extracted from `<URL>` per RFC 8288.
 */
function parseDeprecationHeaders(response: Response): {
  sunset: string | undefined;
  deprecation: string | undefined;
  link: string | undefined;
} | null {
  const sunset = response.headers.get('sunset') ?? undefined;
  const deprecation = response.headers.get('deprecation') ?? undefined;
  const linkHeader = response.headers.get('link');
  let link: string | undefined;
  if (linkHeader) {
    // Split on commas not inside angle brackets — RFC 8288 allows
    // multiple Link values in one header. For each value, parse the
    // `<URL>` then look up the `rel` parameter (quoted or not). Per
    // RFC 8288 §3.3 `rel` is a space-separated set of relation
    // types — `rel="preload sunset"` is valid and refers to the same
    // target — so we tokenise the value and look for `sunset`.
    for (const candidate of linkHeader.split(/,(?=\s*<)/)) {
      const m = candidate.match(/<([^>]+)>[^,]*\brel\s*=\s*(?:"([^"]*)"|(\S+))/i);
      if (!m || !m[1]) continue;
      const relValue = m[2] ?? m[3] ?? '';
      if (relValue.split(/\s+/).includes('sunset')) {
        link = m[1].trim();
        break;
      }
    }
  }
  if (!sunset && !deprecation && !link) return null;
  return { sunset, deprecation, link };
}

class TimeoutSentinel extends Error {
  constructor() {
    super('timeout');
    this.name = 'TimeoutSentinel';
  }
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

/**
 * Pull the parsed `Retry-After` (seconds) off the error if present.
 * Both `KashRateLimitError` (429) and `KashMaintenanceError` (503
 * kill switch) carry it.
 */
function retryAfterFromError(err: KashError): number | undefined {
  if (err instanceof KashRateLimitError) return err.retryAfterSeconds;
  // Use a structural check rather than `instanceof KashMaintenanceError`
  // to avoid an import cycle and to keep this helper colocated with
  // the retry logic. The shape is documented on the class.
  const ra = (err as { retryAfterSeconds?: number }).retryAfterSeconds;
  return typeof ra === 'number' ? ra : undefined;
}

function retryReason(err: KashError): RetryHookEvent['reason'] {
  if (err instanceof KashRateLimitError) return 'rate_limit';
  if (err instanceof KashTimeoutError) return 'timeout';
  if (err instanceof KashNetworkError) return 'network';
  return 'server_error';
}

function formatZodIssue(error: z.ZodError): string {
  const issue = error.issues[0];
  if (!issue) return error.message;
  const path = issue.path.length > 0 ? issue.path.join('.') : '(root)';
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

/**
 * Strip SDK-controlled header names from the consumer's custom
 * header bag (case-insensitive). Belt-and-suspenders alongside the
 * "SDK headers overwrite custom headers" ordering in `request()`:
 * removing them here means the merged bag is small and
 * `Object.assign` can't accidentally re-promote them via key order.
 */
const SDK_RESERVED_HEADER_NAMES_LOWER = new Set([
  'accept',
  'user-agent',
  'x-api-key',
  'content-type',
  'idempotency-key',
  'kash-version',
]);

/**
 * Server-enforced `Idempotency-Key` constraints (mirror of
 * `apps/public-api/src/plugins/idempotency.ts`):
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

function validateIdempotencyKey(key: string): void {
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

function sanitizeCustomHeaders(
  headers: Record<string, string> | undefined
): Readonly<Record<string, string>> {
  if (!headers) return Object.freeze({});
  const out: Record<string, string> = {};
  for (const [name, value] of Object.entries(headers)) {
    if (SDK_RESERVED_HEADER_NAMES_LOWER.has(name.toLowerCase())) continue;
    out[name] = value;
  }
  return Object.freeze(out);
}

export type {
  RequestHookEvent,
  ResponseHookEvent,
  RetryHookEvent,
  ErrorHookEvent,
  KashClientHooks,
};
