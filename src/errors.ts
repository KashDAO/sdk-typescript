/**
 * Standalone error hierarchy for the public SDK.
 *
 * Every failure mode is named by a typed subclass and a stable
 * machine-readable `code` string. Customers can branch on
 * `instanceof KashError` / subclass for type-narrowed handling, or
 * on `code` for forward-compatible string switches.
 *
 * The HTTP-level codes (`MARKET_NOT_FOUND`, `IDEMPOTENCY_KEY_CONFLICT`,
 * `RATE_LIMIT_EXCEEDED`, …) come from the API's RFC 7807 problem
 * responses; SDK-internal codes (`SDK_TIMEOUT`, `SDK_NETWORK`,
 * `SDK_VALIDATION`) cover transport-layer failures. The mapping
 * function {@link classifyHttpError} routes any HTTP error to the
 * correct subclass.
 *
 * **Cross-realm safety**: every instance carries a `Symbol.for`-based
 * brand. The static {@link KashError.isKashError} method works even
 * when an error crosses realm boundaries (worker ↔ main thread,
 * iframe ↔ parent, two SDK copies in a hoisted-monorepo) where plain
 * `instanceof` breaks because each realm has its own class identity.
 */

/**
 * Cross-realm brand. We use `Symbol.for` (the registry) so two SDK
 * copies in different bundles still produce equal symbols. `for` is
 * intentional here despite the usual "Symbol() is unique" guidance:
 * the whole point is to recognise sibling instances across realms.
 */
const KASH_ERROR_BRAND: unique symbol = Symbol.for('@kashdao/sdk:KashError');

/**
 * Inputs shared by every `KashError` subclass. The constructor
 * mirrors `Error`'s `cause` option so consumers can chain root
 * causes without losing typing.
 */
export type KashErrorInit = {
  /**
   * Stable, machine-readable code. Either the `code` field of an
   * RFC 7807 problem response (e.g. `MARKET_NOT_FOUND`) or one of
   * the SDK-internal sentinels for transport-layer failures
   * (`SDK_TIMEOUT`, `SDK_NETWORK`, `SDK_VALIDATION`).
   */
  readonly code: string;
  /** HTTP status, when the error was triggered by an HTTP response. */
  readonly statusCode?: number | undefined;
  /** Server-side request id (`X-Request-ID` header or `_meta.requestId`). */
  readonly requestId?: string | undefined;
  /** Underlying error (network failure, parse error). */
  readonly cause?: unknown;
  /**
   * Server-reported rate-limit state, parsed from response headers.
   * Set at throw site by the HTTP layer when the error came from a
   * server response; remains `undefined` for caller-side errors
   * (config, validation) and transport errors that never reached the
   * server.
   */
  readonly rateLimit?:
    | { limit: number; remaining: number; resetSeconds: number }
    | null
    | undefined;
  /**
   * Dated server API version reported in the `X-API-Version` response
   * header. `undefined` for caller-side errors that never reached the
   * server (config validation, transport failures with no response).
   */
  readonly apiVersion?: string | undefined;
  /**
   * `true` when the server returned a cached idempotent replay
   * (signalled via `Idempotent-Replay: true`). `false` for fresh
   * executions. Surfaced on errors so consumers see whether the
   * failure is a fresh attempt or a replay of a prior failure.
   */
  readonly idempotentReplay?: boolean | undefined;
  /**
   * Server-emitted deprecation/sunset advisory at the moment of
   * failure. `null` when the response did not carry the headers.
   */
  readonly deprecation?:
    | { sunset: string | undefined; deprecation: string | undefined; link: string | undefined }
    | null
    | undefined;
  /**
   * RFC 7807 extension members from the problem body — every key
   * outside the standard `type|title|status|detail|instance|code|requestId`
   * set. Examples: `flag` on `ROUTE_DISABLED`, `signatureReason` on
   * `REQUEST_SIGNATURE_INVALID`. `undefined` for caller-side errors.
   */
  readonly extensions?: Readonly<Record<string, unknown>> | undefined;
};

/**
 * Optional debugging context attached by the HTTP layer once the
 * error reaches the retry loop. Lets the consumer log the failing
 * route and how many tries it took without correlating timestamps.
 *
 * Populated by `KashHttpClient` after construction; the constructor
 * itself doesn't take it as input (it isn't known at throw site).
 */
export type KashErrorContext = {
  /** HTTP method, e.g. `'POST'`. */
  readonly method: string;
  /** Path relative to base URL, e.g. `'/trades'`. */
  readonly path: string;
  /** 1-indexed attempt count (1 = initial, 2 = first retry, …). */
  readonly attempt: number;
};

/**
 * Base class for every error the SDK throws. Always `instanceof
 * Error`; never thrown directly — see the typed subclasses below.
 */
export abstract class KashError extends Error {
  /**
   * Cross-realm brand. Present on every KashError instance regardless
   * of which SDK copy threw it. Use {@link KashError.isKashError}
   * instead of plain `instanceof` when the error may cross a realm
   * boundary (worker ↔ main thread, iframe ↔ parent, hoisted-monorepo
   * with multiple SDK copies).
   *
   * @internal
   */
  readonly [KASH_ERROR_BRAND] = true as const;

  readonly code: string;
  readonly statusCode: number | undefined;
  readonly requestId: string | undefined;
  /**
   * Method/path/attempt — set by the HTTP layer at throw time.
   * Undefined for errors thrown before any request was attempted
   * (e.g. configuration validation failures).
   */
  context: KashErrorContext | undefined;
  /**
   * Server-reported rate-limit state at the moment of failure, parsed
   * from `X-RateLimit-Limit` / `X-RateLimit-Remaining` / `X-RateLimit-Reset`.
   * `null` when the response did not carry these headers (network
   * errors, timeouts, upstream proxy failures), or `undefined` when
   * the error originated before any HTTP exchange (configuration
   * errors).
   *
   * Consumers can use this to schedule client-side backoff after
   * catching the error — e.g. on `KashRateLimitError`, sleep
   * `rateLimit?.resetSeconds` before retrying.
   */
  rateLimit: { limit: number; remaining: number; resetSeconds: number } | null | undefined;
  /**
   * Dated server API version reported in the `X-API-Version` response
   * header at the moment of failure. Lets consumers correlate errors
   * with a specific server-side version rollout. `undefined` when the
   * error originated before any HTTP exchange (configuration errors,
   * caller aborts before send) or when the response stripped the
   * header.
   */
  apiVersion: string | undefined;
  /**
   * `true` when the server returned a cached idempotent replay of a
   * prior failure (signalled via `Idempotent-Replay: true`). Lets
   * consumers tell a fresh failure apart from a deduplicated replay.
   * `undefined` when the error originated before any HTTP exchange.
   */
  idempotentReplay: boolean | undefined;
  /**
   * Server-emitted deprecation/sunset advisory at the moment of
   * failure, parsed from `Sunset` / `Deprecation` / `Link rel="sunset"`.
   * `null` when no such headers were present; `undefined` when the
   * error originated before any HTTP exchange.
   */
  deprecation:
    | { sunset: string | undefined; deprecation: string | undefined; link: string | undefined }
    | null
    | undefined;
  /**
   * RFC 7807 extension members from the problem body. Read these when
   * branching on code-specific server context (e.g.,
   * `err.extensions?.flag` on `ROUTE_DISABLED`,
   * `err.extensions?.signatureReason` on `REQUEST_SIGNATURE_INVALID`).
   * `undefined` for caller-side errors that never reached the server.
   */
  extensions: Readonly<Record<string, unknown>> | undefined;
  /**
   * Whether the error class represents a transient failure that the
   * caller may retry. Concrete subclasses set this; the base value
   * is `false` so opaque future codes default to non-retryable.
   */
  readonly isRetryable: boolean = false;

  protected constructor(message: string, init: KashErrorInit) {
    // Preserve ES2022 `Error.cause` behaviour — the second argument
    // to the `Error` constructor is the standardised `{ cause }`
    // options object. Passing it through means `err.cause` is the
    // original failure without us having to redeclare the property.
    super(message, init.cause === undefined ? undefined : { cause: init.cause });
    // Class name — using the constructor's name stays correct when
    // SDK consumers subclass these errors (rare, but supported).
    this.name = new.target.name;
    this.code = init.code;
    this.statusCode = init.statusCode;
    this.requestId = init.requestId;
    this.context = undefined;
    this.rateLimit = init.rateLimit;
    this.apiVersion = init.apiVersion;
    this.idempotentReplay = init.idempotentReplay;
    this.deprecation = init.deprecation;
    this.extensions = init.extensions;
    // Restore prototype chain after `super` (matters when consumers
    // transpile to ES5 or use `Object.setPrototypeOf` lints).
    Object.setPrototypeOf(this, new.target.prototype);
  }

  /**
   * Cross-realm-safe check. Returns true for any object that was
   * thrown by `@kashdao/sdk` (any version, any realm), via the
   * `Symbol.for(@kashdao/sdk:KashError)` brand.
   *
   * Use this in code paths where the error might have travelled
   * across a realm boundary — `instanceof KashError` will return
   * false in those cases even though the error is structurally one
   * of ours.
   *
   * @example
   * ```ts
   * try { await kash.trades.create({...}); }
   * catch (err) {
   *   if (KashError.isKashError(err)) {
   *     // err.code, err.statusCode, err.requestId all typed
   *   }
   * }
   * ```
   */
  static isKashError(value: unknown): value is KashError {
    if (value === null || typeof value !== 'object') return false;
    return (value as { [KASH_ERROR_BRAND]?: unknown })[KASH_ERROR_BRAND] === true;
  }

  /**
   * Build a structured payload safe to log. Excludes `cause` (which
   * may carry runtime-specific objects) and the `stack`. Suitable for
   * JSON serialisation in production logs.
   */
  toJSON(): Record<string, unknown> {
    return {
      name: this.name,
      message: this.message,
      code: this.code,
      statusCode: this.statusCode,
      requestId: this.requestId,
      isRetryable: this.isRetryable,
      context: this.context,
      rateLimit: this.rateLimit,
      apiVersion: this.apiVersion,
      idempotentReplay: this.idempotentReplay,
      deprecation: this.deprecation,
      extensions: this.extensions,
    };
  }
}

// -----------------------------------------------------------------
// 401 — authentication
// -----------------------------------------------------------------

/**
 * The `X-API-Key` header is missing, malformed, invalid, revoked, or
 * expired. NOT retryable — the consumer must fix their key.
 */
export class KashAuthenticationError extends KashError {
  constructor(message: string, init: KashErrorInit) {
    super(message, init);
  }
}

// -----------------------------------------------------------------
// 403 — authorisation
// -----------------------------------------------------------------

/**
 * Authenticated but the key lacks the scope this route needs, or
 * the request's IP is not in the key's allowlist. NOT retryable.
 */
export class KashAuthorizationError extends KashError {
  constructor(message: string, init: KashErrorInit) {
    super(message, init);
  }
}

// -----------------------------------------------------------------
// 404 — resource missing
// -----------------------------------------------------------------

export class KashNotFoundError extends KashError {
  constructor(message: string, init: KashErrorInit) {
    super(message, init);
  }
}

// -----------------------------------------------------------------
// 409 / 410 — logical conflict (idempotency, account state, etc.)
// -----------------------------------------------------------------

/**
 * Idempotency-Key conflict, client-request-id conflict, market not
 * tradeable, smart account not provisioned, insufficient balance, etc.
 * The consumer must reconcile the conflict — auto-retry would usually
 * re-trigger the same conflict.
 */
export class KashConflictError extends KashError {
  constructor(message: string, init: KashErrorInit) {
    super(message, init);
  }
}

// -----------------------------------------------------------------
// 429 — rate limited
// -----------------------------------------------------------------

export type KashRateLimitErrorInit = KashErrorInit & {
  /**
   * Parsed `Retry-After` value (seconds). The HTTP layer parses
   * either the integer-seconds form or the HTTP-date form before
   * constructing the error; consumers see seconds either way.
   */
  readonly retryAfterSeconds?: number | undefined;
};

export class KashRateLimitError extends KashError {
  override readonly isRetryable = true;
  readonly retryAfterSeconds: number | undefined;

  constructor(message: string, init: KashRateLimitErrorInit) {
    super(message, init);
    this.retryAfterSeconds = init.retryAfterSeconds;
  }
}

// -----------------------------------------------------------------
// 400 — input validation (server-side OR SDK-side parse failure)
// -----------------------------------------------------------------

/**
 * One field-level validation issue surfaced on `KashValidationError.issues`.
 * Mirrors the Zod issue shape so consumers can render structured forms
 * regardless of whether the issue came from the SDK's client-side
 * pre-validation or the server's 400 response body.
 */
export type KashValidationIssue = {
  /** Dot-path to the failing field (e.g. `'metadata.strategy'`). */
  readonly path: string;
  /** Human-readable explanation, ready to render in a form helper. */
  readonly message: string;
  /** Stable machine code where available (e.g. `'invalid_type'`). */
  readonly code?: string;
};

/**
 * Thrown for any input validation failure — from two distinct origins:
 *
 *   1. **Client-side**: SDK pre-validates request bodies (e.g.,
 *      `trades.create`) and `Idempotency-Key` format before any HTTP
 *      exchange. `context` and `apiVersion` are `undefined` in this case.
 *   2. **Server-side**: a 400 response with `code: VALIDATION_FAILED`
 *      (or any other 400-level code) flows through `classifyHttpError`
 *      into this class. `context` carries `{ method, path, attempt }`.
 *
 * In both cases `issues` carries field-level details when available.
 * Distinguish origins via `err.context === undefined` (client-side).
 */
export class KashValidationError extends KashError {
  /**
   * Field-level validation issues. Populated from the SDK's own Zod
   * `safeParse` failures on the client side, or from the server's
   * RFC 7807 extension members (`extensions.issues` / `extensions.errors`)
   * on the server side. Empty array when no structured issues were
   * available (e.g., a generic 400 from an upstream proxy).
   */
  readonly issues: readonly KashValidationIssue[];

  constructor(
    message: string,
    init: KashErrorInit & {
      readonly issues?: readonly KashValidationIssue[] | undefined;
    }
  ) {
    super(message, init);
    this.issues = init.issues ?? extractIssuesFromExtensions(init.extensions) ?? [];
  }

  override toJSON(): Record<string, unknown> {
    return { ...super.toJSON(), issues: this.issues };
  }
}

/**
 * Extract field-level issues from RFC 7807 extension members. The Kash
 * server emits validation issues under `extensions.issues` (preferred,
 * Zod-shaped) or `extensions.errors` (legacy). Returns `undefined` when
 * neither is present so the constructor falls back to an empty array.
 */
function extractIssuesFromExtensions(
  extensions: Readonly<Record<string, unknown>> | undefined
): readonly KashValidationIssue[] | undefined {
  if (!extensions) return undefined;
  const raw = extensions['issues'] ?? extensions['errors'];
  if (!Array.isArray(raw)) return undefined;
  const issues: KashValidationIssue[] = [];
  for (const entry of raw) {
    if (!entry || typeof entry !== 'object') continue;
    const e = entry as Record<string, unknown>;
    const pathSrc = e['path'] ?? e['field'];
    const path = Array.isArray(pathSrc)
      ? pathSrc.join('.')
      : typeof pathSrc === 'string'
        ? pathSrc
        : '';
    const message = typeof e['message'] === 'string' ? e['message'] : 'Invalid value.';
    const code = typeof e['code'] === 'string' ? e['code'] : undefined;
    issues.push(code ? { path, message, code } : { path, message });
  }
  return issues;
}

// -----------------------------------------------------------------
// Webhook signature failure — caller-side, no HTTP exchange
// -----------------------------------------------------------------

/**
 * Thrown by {@link WebhooksClient.constructEvent} when the
 * `X-Kash-Signature` header fails to verify against the raw body. The
 * message includes the failure reason from
 * {@link WebhooksClient.verifySignature} (malformed header, replay
 * outside the timestamp tolerance, mismatched HMAC, etc.).
 *
 * Non-retryable — return a 400 to the sender; the next legitimate
 * delivery will carry a fresh signature. Specifically NOT a
 * `KashAuthenticationError` because the SDK doesn't authenticate to
 * the server here — the customer's own webhook secret is what
 * verifies.
 */
export class KashWebhookSignatureError extends KashError {
  constructor(message: string, init: KashErrorInit) {
    super(message, init);
  }
}

// -----------------------------------------------------------------
// 5xx — server-side fault
// -----------------------------------------------------------------

/**
 * Generic 5xx response. Retryable — the SDK's HTTP layer already
 * applies bounded retries; if this error reaches the consumer it
 * means retries were exhausted.
 *
 * Carries `retryAfterSeconds` for parity with `KashRateLimitError`
 * — some 503s (DEPENDENCY_UNAVAILABLE) include a `Retry-After`
 * header. The retry loop uses it; consumers can read it for
 * application-level backoff after retries are exhausted.
 */
export class KashServerError extends KashError {
  override readonly isRetryable = true;
  readonly retryAfterSeconds: number | undefined;

  constructor(
    message: string,
    init: KashErrorInit & { readonly retryAfterSeconds?: number | undefined }
  ) {
    super(message, init);
    this.retryAfterSeconds = init.retryAfterSeconds;
  }
}

/**
 * 503 with a kill-switch code — `API_TRADE_PROCESSING_HALTED`
 * (global trade-processing pause) or `ROUTE_DISABLED` (per-route
 * kill switch via `flag` extension). Retryable but the consumer
 * should respect the `Retry-After` (typically 5 minutes for
 * trade-processing, 60s for route kill switches) and back off
 * generously. Distinct from `KashServerError` so consumers can
 * branch their alerting / fallback logic on the kill-switch class.
 */
export class KashMaintenanceError extends KashError {
  override readonly isRetryable = true;
  readonly retryAfterSeconds: number | undefined;

  constructor(
    message: string,
    init: KashErrorInit & { readonly retryAfterSeconds?: number | undefined }
  ) {
    super(message, init);
    this.retryAfterSeconds = init.retryAfterSeconds;
  }
}

// -----------------------------------------------------------------
// Transport-layer failures (no HTTP response received)
// -----------------------------------------------------------------

/**
 * The request was aborted because it exceeded `timeoutMs`. The HTTP
 * layer fires this on `AbortController.abort()` from the timeout
 * timer; consumer-driven aborts surface as a different `DOMException`.
 */
export class KashTimeoutError extends KashError {
  override readonly isRetryable = true;
  constructor(message: string, init: KashErrorInit) {
    super(message, init);
  }
}

/**
 * `fetch` itself threw — DNS failure, TLS handshake error, connection
 * refused. The original error is in `cause`.
 */
export class KashNetworkError extends KashError {
  override readonly isRetryable = true;
  constructor(message: string, init: KashErrorInit) {
    super(message, init);
  }
}

/**
 * Raised when the caller's `AbortSignal` fires. Distinct from
 * `KashTimeoutError` (the SDK's own timeout) and `KashNetworkError`
 * (transport-layer failure) because it is **not** retryable — the
 * consumer asked us to stop, so we honour that.
 */
export class KashAbortedError extends KashError {
  override readonly isRetryable = false;
  constructor(message: string, init: KashErrorInit) {
    super(message, init);
  }
}

// -----------------------------------------------------------------
// Configuration — failures during client construction
// -----------------------------------------------------------------

/**
 * One structured issue produced by Zod-validating client configuration.
 * Distinct from {@link KashValidationIssue} on purpose:
 *
 *   - `KashConfigurationIssue.path` is the **raw Zod path** (an array of
 *     keys/indices) so config-system tooling can walk into nested
 *     `headers[]` / `hooks.onError` programmatically.
 *   - `KashValidationIssue.path` is the **joined display string**
 *     (`'metadata.strategy'`) for surfacing in form helpers.
 *
 * Both shapes carry the same logical information; the divergence is
 * deliberate (Zod-raw for programmatic config introspection, joined
 * string for user-facing validation rendering).
 */
export type KashConfigurationIssue = {
  readonly path: ReadonlyArray<string | number>;
  readonly message: string;
};

export type KashConfigurationErrorInit = KashErrorInit & {
  /**
   * Structured field-level issues, mirroring the shape Zod produces.
   * Provided so consumers can render targeted messages ("apiKey
   * cannot be empty") without parsing the message string.
   */
  readonly issues?: readonly KashConfigurationIssue[];
};

/**
 * The `KashClient` constructor received configuration that failed
 * validation. Distinct from `KashValidationError` (which is for
 * server-rejected request bodies OR client-side body pre-validation)
 * so the consumer can branch on "I misconfigured the SDK" vs "the API
 * rejected my request."
 */
export class KashConfigurationError extends KashError {
  override readonly isRetryable = false;
  readonly issues: readonly KashConfigurationIssue[];

  constructor(message: string, init: KashConfigurationErrorInit) {
    super(message, init);
    this.issues = init.issues ?? [];
  }
}

// -----------------------------------------------------------------
// classifyHttpError — sole entry point for "HTTP status → KashError"
// -----------------------------------------------------------------

/**
 * RFC 7807-shaped error body. The public API always emits these on
 * non-2xx responses; we still tolerate missing fields because some
 * upstream proxies can interpose plain text on early errors.
 */
export type ProblemDetailsLike = {
  readonly type?: string | undefined;
  readonly title?: string | undefined;
  readonly status?: number | undefined;
  readonly detail?: string | undefined;
  readonly instance?: string | undefined;
  readonly code?: string | undefined;
  readonly requestId?: string | undefined;
  /**
   * RFC 7807 §3.2 allows arbitrary extension members on the problem
   * body. Indexer signature so the SDK can read code-specific fields
   * the server emits (e.g., `flag` on `ROUTE_DISABLED`,
   * `signatureReason` on `REQUEST_SIGNATURE_INVALID`) without
   * requiring an SDK release per new extension.
   */
  readonly [extension: string]: unknown;
};

export type ClassifyHttpErrorInput = {
  readonly status: number;
  readonly problem: ProblemDetailsLike;
  readonly requestId?: string | undefined;
  /**
   * Raw `Retry-After` header value. Either an integer-seconds string
   * or an RFC 7231 HTTP-date. Parsed once at the call site.
   */
  readonly retryAfter?: string | null | undefined;
  /** Override the clock for `Retry-After` HTTP-date parsing in tests. */
  readonly nowMs?: number | undefined;
  /**
   * Optional client-side hint to append to the user-facing message —
   * e.g. "your `kash_live_*` key is being sent to a staging URL" when
   * the SDK detects a key-prefix vs base-URL mismatch on 401.
   *
   * Server-emitted `detail` already covers the wire-level failure;
   * this slot is for diagnostic context that's only visible client-side
   * (the SDK's own `apiKey` + `baseUrl` config).
   */
  readonly hint?: string | undefined;
  /**
   * Server-reported rate-limit state, parsed from the response headers.
   * Threaded into the constructed error so consumers see it on `err.rateLimit`
   * without the HTTP layer mutating the error after construction.
   */
  readonly rateLimit?:
    | { limit: number; remaining: number; resetSeconds: number }
    | null
    | undefined;
  /**
   * Dated server API version from the `X-API-Version` response header.
   * Threaded into the constructed error so consumers can correlate
   * errors with a specific server-side rollout.
   */
  readonly apiVersion?: string | undefined;
  /**
   * `Idempotent-Replay: true` flag from the response. Threaded so the
   * caller can distinguish a fresh failure from a deduplicated replay
   * of an earlier failure.
   */
  readonly idempotentReplay?: boolean | undefined;
  /**
   * Parsed `Sunset` / `Deprecation` / `Link rel="sunset"` headers, or
   * `null` when the response did not carry them.
   */
  readonly deprecation?:
    | { sunset: string | undefined; deprecation: string | undefined; link: string | undefined }
    | null
    | undefined;
};

/**
 * Maps a non-2xx HTTP response to the right `KashError` subclass.
 *
 * Branches on the RFC 7807 `code` field first (so a 409 with
 * `IDEMPOTENCY_KEY_CONFLICT` lands in `KashConflictError` rather
 * than a generic class), falling back to the status code when the
 * `code` is missing or unrecognised — that still produces the right
 * subclass for proxy-emitted errors that don't share our catalog.
 */
export function classifyHttpError(input: ClassifyHttpErrorInput): KashError {
  const {
    status,
    problem,
    requestId,
    retryAfter,
    nowMs,
    hint,
    rateLimit,
    apiVersion,
    idempotentReplay,
    deprecation,
  } = input;
  const resolvedRequestId = requestId ?? problem.requestId;
  const code = problem.code ?? defaultCodeForStatus(status);
  const baseDetail = problem.detail ?? problem.title ?? `HTTP ${status}`;
  const detail = hint ? `${baseDetail} (Hint: ${hint})` : baseDetail;
  const extensions = extractExtensions(problem);
  const init = {
    code,
    statusCode: status,
    requestId: resolvedRequestId,
    rateLimit,
    apiVersion,
    idempotentReplay,
    deprecation,
    extensions,
  } as const;

  // 401 — authentication
  if (status === 401 || code.startsWith('API_KEY_')) {
    return new KashAuthenticationError(detail, init);
  }

  // 403 — authorisation
  if (status === 403 || code === 'INSUFFICIENT_SCOPE' || code === 'IP_NOT_ALLOWED') {
    return new KashAuthorizationError(detail, init);
  }

  // 404 — not found
  if (status === 404 || code === 'MARKET_NOT_FOUND' || code === 'RESOURCE_NOT_FOUND') {
    return new KashNotFoundError(detail, init);
  }

  // 410 — idempotency key past TTL. Logically a "this key is gone";
  // group with conflicts because the consumer's recovery (generate a
  // new key, re-execute) is the same.
  if (status === 410) {
    return new KashConflictError(detail, init);
  }

  // 429 — rate limited
  if (status === 429 || code === 'RATE_LIMIT_EXCEEDED') {
    return new KashRateLimitError(detail, {
      ...init,
      retryAfterSeconds: parseRetryAfterSeconds(retryAfter, nowMs),
    });
  }

  // 503 — maintenance (kill switch) vs generic dependency unavailable.
  // Both kill-switch codes (`API_TRADE_PROCESSING_HALTED`,
  // `ROUTE_DISABLED`) land in `KashMaintenanceError` so consumers can
  // branch on the class without needing to inspect `code`. The
  // per-route flag is on `err.extensions.flag` for `ROUTE_DISABLED`.
  // Generic 503s (proxy, dependency outage) → `KashServerError`. All
  // three carry the parsed Retry-After so the retry loop can respect it.
  if (status === 503) {
    const retryAfterSeconds = parseRetryAfterSeconds(retryAfter, nowMs);
    if (code === 'API_TRADE_PROCESSING_HALTED' || code === 'ROUTE_DISABLED') {
      return new KashMaintenanceError(detail, { ...init, retryAfterSeconds });
    }
    return new KashServerError(detail, { ...init, retryAfterSeconds });
  }

  // 504 — gateway timeout (REQUEST_TIMEOUT in the catalog)
  if (status === 504 || code === 'REQUEST_TIMEOUT') {
    return new KashServerError(detail, {
      ...init,
      retryAfterSeconds: parseRetryAfterSeconds(retryAfter, nowMs),
    });
  }

  // 409 — conflicts. Idempotency, client-request-id, market state,
  // smart-account state, insufficient balance, confirmation flow.
  if (status === 409) {
    return new KashConflictError(detail, init);
  }

  // 400 — generic validation. Includes IDEMPOTENCY_KEY_TOO_LONG,
  // VALIDATION_FAILED, AMOUNT_TOO_LARGE, OUTCOME_INDEX_INVALID.
  if (status === 400 || status === 422) {
    return new KashValidationError(detail, init);
  }

  // Catch-all for 5xx — server fault, retryable.
  if (status >= 500) {
    return new KashServerError(detail, {
      ...init,
      retryAfterSeconds: parseRetryAfterSeconds(retryAfter, nowMs),
    });
  }

  // Anything else (rare 4xx not above): treat as validation since
  // the request body is the most-likely culprit.
  return new KashValidationError(detail, init);
}

/**
 * RFC 7807 §3.2 extension members — every key on the problem body
 * that is NOT one of the standard `type|title|status|detail|instance|
 * code|requestId` fields. Returns `undefined` when the body carried
 * only standard fields (the common case for non-extension errors).
 */
const PROBLEM_STANDARD_KEYS = new Set([
  'type',
  'title',
  'status',
  'detail',
  'instance',
  'code',
  'requestId',
]);
function extractExtensions(
  problem: ProblemDetailsLike
): Readonly<Record<string, unknown>> | undefined {
  let result: Record<string, unknown> | undefined;
  for (const key of Object.keys(problem)) {
    if (PROBLEM_STANDARD_KEYS.has(key)) continue;
    const value = (problem as Record<string, unknown>)[key];
    if (value === undefined) continue;
    if (!result) result = {};
    result[key] = value;
  }
  return result;
}

/**
 * Default code when the response body has no `code` field. Used only
 * for proxy-emitted bodies (the public API always sets `code`).
 */
function defaultCodeForStatus(status: number): string {
  if (status === 401) return 'API_KEY_INVALID';
  if (status === 403) return 'INSUFFICIENT_SCOPE';
  if (status === 404) return 'RESOURCE_NOT_FOUND';
  if (status === 409) return 'CONFLICT';
  if (status === 410) return 'IDEMPOTENCY_KEY_EXPIRED';
  if (status === 429) return 'RATE_LIMIT_EXCEEDED';
  if (status === 503) return 'DEPENDENCY_UNAVAILABLE';
  if (status === 504) return 'REQUEST_TIMEOUT';
  if (status >= 500) return 'INTERNAL_ERROR';
  if (status === 400 || status === 422) return 'VALIDATION_FAILED';
  return `HTTP_${status}`;
}

/**
 * Parse `Retry-After`. Accepts both forms per RFC 7231:
 *
 *   - delta-seconds (e.g. `120`)
 *   - HTTP-date (e.g. `Fri, 31 Dec 1999 23:59:59 GMT`)
 *
 * Returns `undefined` if the header is missing or unparseable —
 * never NaN, so consumers can compare with `??`.
 */
function parseRetryAfterSeconds(
  value: string | null | undefined,
  nowMs?: number
): number | undefined {
  if (!value) return undefined;
  const trimmed = value.trim();
  if (!trimmed) return undefined;

  // Delta-seconds: pure non-negative integer. Reject negative,
  // floating-point, hex, exponential, etc. — Number.parseInt is
  // permissive, the regex is the gate.
  if (/^\d+$/.test(trimmed)) {
    const n = Number.parseInt(trimmed, 10);
    return Number.isFinite(n) ? n : undefined;
  }

  // HTTP-date per RFC 7231 §7.1.1.1 always starts with a weekday
  // abbreviation. Gate `Date.parse` with a structural check so
  // adversarial inputs like `-1` (which Date.parse interprets as
  // year -1) don't slip through as "0 seconds".
  if (
    !/^(?:Mon|Tue|Wed|Thu|Fri|Sat|Sun|Monday|Tuesday|Wednesday|Thursday|Friday|Saturday|Sunday)\b/.test(
      trimmed
    )
  ) {
    return undefined;
  }
  const target = Date.parse(trimmed);
  if (!Number.isFinite(target)) return undefined;
  const now = nowMs ?? Date.now();
  // Reject timestamps far in the past — legitimate Retry-After is
  // always in the future. Allow up to 60s skew to tolerate clock
  // drift on near-future dates that arrive slightly late.
  if (target < now - 60_000) return undefined;
  const delta = Math.max(0, Math.round((target - now) / 1000));
  return delta;
}
