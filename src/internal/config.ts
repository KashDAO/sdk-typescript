/**
 * Configuration for {@link KashClient}. Validated with Zod at the
 * client constructor so misconfiguration fails fast and loud rather
 * than turning into mysterious 401s at first request.
 */

import { z } from 'zod';

import { SDK_API_VERSION } from './version.js';

/**
 * The runtime `fetch` signature. Mirrors the global type without
 * importing it directly (so the SDK still works in environments where
 * `lib.dom` isn't part of the consumer's tsconfig — Deno, Bun, Node
 * 22+ all expose the symbol).
 */
export type FetchLike = typeof fetch;

/**
 * Lifecycle hook payloads. Consumers can wire their own logger,
 * tracing, or metrics by passing handlers in the `hooks` config —
 * the SDK never logs by itself.
 */
export type RequestHookEvent = {
  readonly method: string;
  readonly url: string;
  readonly attempt: number;
  /** `Idempotency-Key` if the call provided one. */
  readonly idempotencyKey: string | undefined;
};

/**
 * Server-reported rate-limit state, parsed from the response headers
 * `X-RateLimit-Limit`, `X-RateLimit-Remaining`, `X-RateLimit-Reset`.
 *
 * The Kash API attaches all three on every response (success AND
 * 429 rejection) when the request hit a rate-limited route. Use
 * `remaining` / `resetSeconds` for client-side throttling: e.g. pause
 * issuing requests when `remaining < 5` and resume after `resetSeconds`.
 *
 * `null` when the response didn't carry the headers (rare — only
 * happens for upstream proxy errors before our rate-limit plugin runs).
 */
export type RateLimitState = {
  /** Server-side cap for this rate-limit bucket (per second / per minute). */
  readonly limit: number;
  /** Requests remaining in the current window. Clamped to `>= 0`. */
  readonly remaining: number;
  /** Seconds until the bucket resets — relative, not absolute epoch. */
  readonly resetSeconds: number;
};

/**
 * Server-emitted deprecation/sunset advisory parsed from RFC 8594
 * `Sunset`, draft-ietf-httpapi-deprecation `Deprecation`, and an
 * optional `Link rel="sunset"` header pointing at migration docs.
 *
 * The whole point of advance notice is that consumers see it well
 * before traffic breaks — the SDK surfaces these headers on every
 * response (success AND failure) so structured loggers can trip a
 * one-shot warn and dashboards can flag client fleets still on the
 * winding-down version. The SDK never logs by itself; subscribe to
 * the hook (`onResponse`) or read `KashError.deprecation`.
 *
 * `null` when the response did not carry any of the three headers
 * (the common case while the version is current).
 */
export type ServerDeprecationNotice = {
  /**
   * Raw `Sunset` header value (RFC 8594) — IMF-fixdate, e.g.
   * `'Sun, 29 Apr 2027 00:00:00 GMT'`. The date this version stops
   * accepting traffic. `undefined` when the header was absent.
   */
  readonly sunset: string | undefined;
  /**
   * Raw `Deprecation` header value
   * (draft-ietf-httpapi-deprecation-header). Typically the bare
   * token `'true'` or an HTTP-date marking the deprecation start.
   * `undefined` when the header was absent.
   */
  readonly deprecation: string | undefined;
  /**
   * Migration-docs URL extracted from a `Link` header with
   * `rel="sunset"`. The SDK parses `<…>; rel="sunset"` and surfaces
   * the bare URL. `undefined` when no such Link relation was emitted.
   */
  readonly link: string | undefined;
};

export type ResponseHookEvent = RequestHookEvent & {
  readonly status: number;
  readonly durationMs: number;
  readonly requestId: string | undefined;
  /**
   * Rate-limit state from the response headers (`X-RateLimit-*`). `null`
   * when the response did not carry them — see {@link RateLimitState}.
   */
  readonly rateLimit: RateLimitState | null;
  /**
   * Dated API version the server reported in the `X-API-Version`
   * response header (e.g. `"2026-04-29"`). `undefined` when the response
   * did not carry the header (e.g. an upstream proxy stripped it). Use
   * this to detect server-side version rollouts in tests and logs.
   */
  readonly apiVersion: string | undefined;
  /**
   * `true` when the server returned a cached idempotent replay of an
   * earlier request — signalled via the `Idempotent-Replay: true`
   * response header. `false` when the call executed fresh server-side.
   *
   * For routes whose response body already carries `_meta.idempotent`
   * (e.g. `trades.create`), this is the same signal at the transport
   * layer. For routes that don't (e.g. `webhooks.redeliver`), this is
   * the only client-visible indicator that the response is a replay.
   */
  readonly idempotentReplay: boolean;
  /**
   * Server-emitted deprecation/sunset advisory parsed from `Sunset`,
   * `Deprecation`, and `Link rel="sunset"` headers. `null` when the
   * response did not carry any of these — see
   * {@link ServerDeprecationNotice}.
   */
  readonly deprecation: ServerDeprecationNotice | null;
};

export type RetryHookEvent = RequestHookEvent & {
  /** Why the retry was scheduled. */
  readonly reason: 'rate_limit' | 'server_error' | 'network' | 'timeout';
  /** How long the SDK is about to sleep before the next attempt. */
  readonly delayMs: number;
};

export type ErrorHookEvent = RequestHookEvent & {
  readonly status: number | undefined;
  readonly code: string;
  readonly durationMs: number;
};

export type KashClientHooks = {
  readonly onRequest?: (event: RequestHookEvent) => void;
  readonly onResponse?: (event: ResponseHookEvent) => void;
  readonly onRetry?: (event: RetryHookEvent) => void;
  readonly onError?: (event: ErrorHookEvent) => void;
};

const userAgentSuffixSchema = z
  .string()
  .min(1)
  .max(120)
  .regex(/^[\w/.+\- ()]+$/, 'Allowed: letters, digits, dot, dash, slash, plus, space, parens')
  .optional();

/**
 * Custom default headers. Layered onto every request, with two
 * collision rules:
 *
 *   1. SDK-managed headers (`X-API-Key`, `User-Agent`, `Content-Type`,
 *      `Accept`, `Idempotency-Key`) always win — consumers can't
 *      override them via this config.
 *   2. Header NAMES are case-insensitive at the HTTP layer; the SDK
 *      normalises to the literal name you provide.
 *
 * Validation rejects header names with control chars / colons (RFC
 * 7230 token grammar) and values with newlines (header-injection guard).
 */
const headersSchema = z
  .record(
    z.string().regex(/^[!#$%&'*+\-.^_`|~0-9A-Za-z]+$/, 'Invalid header name'),
    z.string().regex(/^[\t\x20-\x7E\x80-\xFF]*$/, 'Invalid header value (no CR/LF)')
  )
  .optional();

/**
 * Plaintext API-key shape. The server emits `kash_live_<32 base62>`
 * for mainnet and `kash_test_<32 base62>` for staging. Validating
 * client-side catches the "I pasted my webhook secret instead"
 * mistake within microseconds and surfaces a typed
 * `KashConfigurationError` instead of the server's 401 round-trip.
 */
export const API_KEY_SHAPE = /^kash_(live|test)_[A-Za-z0-9]{32}$/;

/**
 * Canonical base URLs by environment. The SDK auto-routes based on
 * the API-key prefix: a `kash_test_*` key targets staging, a
 * `kash_live_*` key targets production. An explicit `baseUrl` config
 * always wins so consumers can target a private mirror, a local
 * mock, or a future region.
 */
export const PRODUCTION_BASE_URL = 'https://api.kash.bot/v1' as const;
export const STAGING_BASE_URL = 'https://api-staging.kash.bot/v1' as const;

/**
 * Derive the base URL from the API key when the consumer didn't pass
 * one explicitly. Returns `undefined` if the key shape isn't
 * recognised (the schema's default of {@link PRODUCTION_BASE_URL}
 * then takes over).
 */
export function inferBaseUrlFromApiKey(apiKey: string | undefined): string | undefined {
  if (!apiKey) return undefined;
  if (apiKey.startsWith('kash_test_')) return STAGING_BASE_URL;
  if (apiKey.startsWith('kash_live_')) return PRODUCTION_BASE_URL;
  return undefined;
}

const apiKeySchema = z
  .string()
  .min(1)
  .regex(
    API_KEY_SHAPE,
    "Expected 'kash_live_<32 alphanumeric>' or 'kash_test_<32 alphanumeric>'. " +
      "If you're holding a webhook signing secret (`whsec_...`), that's a " +
      'different value — see Settings → API Keys for your API key.'
  )
  .optional();

export const kashClientConfigSchema = z.object({
  /**
   * `kash_(live|test)_*` API key. Optional **at construction time** —
   * the SDK reads `KASH_API_KEY` from the process environment when
   * available (Node, Bun, Deno; not browsers). Every resource method
   * except `kash.healthCheck()` requires a key at call time; missing
   * keys surface as a server-side 401 (`KashAuthenticationError`).
   */
  apiKey: apiKeySchema,
  /**
   * Base URL for the public API. Trailing slash is normalised by the
   * HTTP client; no need to include it.
   *
   * **Auto-routed** when omitted: a `kash_test_*` key defaults to
   * `https://api-staging.kash.bot/v1` and a `kash_live_*` key (or
   * no key) defaults to `https://api.kash.bot/v1`. Pass an explicit
   * value to override (private mirror, local mock, future region).
   */
  baseUrl: z.string().url().default(PRODUCTION_BASE_URL),
  /** Per-request timeout (ms). Default 30s; matches the server-side cap. */
  timeoutMs: z.number().int().positive().default(30_000),
  /**
   * Maximum number of retries for retryable failures (429, 5xx, network
   * errors, timeouts). 0 disables retry entirely.
   */
  maxRetries: z.number().int().min(0).max(10).default(3),
  /**
   * Base delay for the exponential backoff (ms). Jittered uniformly
   * in [0, delay) on each retry so a herd of clients doesn't sync up
   * after a transient outage.
   */
  retryBaseDelayMs: z.number().int().positive().default(200),
  /** Cap on the per-attempt backoff (ms). */
  retryMaxDelayMs: z.number().int().positive().default(10_000),
  /**
   * Cap on a server-supplied `Retry-After` value (ms). If the server
   * tells us to wait longer than this, the SDK surfaces the rate-limit
   * error immediately rather than sleeping past the cap and then
   * making one more (wasted) retry. Default 60s.
   *
   * The intent is to **respect the server's wishes**: if the server
   * says "wait 5 minutes," we don't retry sooner than that — we hand
   * the error to the consumer so application-level backoff kicks in.
   */
  retryAfterMaxMs: z.number().int().positive().default(60_000),
  /**
   * Custom suffix appended to the `User-Agent` header. Use to identify
   * your application in our request logs:
   *
   * ```ts
   * new KashClient({ userAgentSuffix: 'acme-trader/1.4.2' });
   * // → User-Agent: @kashdao/sdk/0.1.0 (node/22.4.1) acme-trader/1.4.2
   * ```
   *
   * Restricted to printable ASCII to avoid header injection issues.
   */
  userAgentSuffix: userAgentSuffixSchema,
  /**
   * Custom default headers added to every request. Common uses:
   * distributed tracing (`traceparent`), proxy auth, tenant
   * identification.
   *
   * SDK-managed headers (`X-API-Key`, `User-Agent`, `Content-Type`,
   * `Accept`, `Idempotency-Key`, `X-Kash-Api-Version`) always win — consumers
   * can't override them via this option.
   */
  headers: headersSchema,
  /** Custom fetch implementation — used by tests + logging proxies. */
  fetch: z.custom<FetchLike>().optional(),
  /** Lifecycle hooks for observability. See {@link KashClientHooks}. */
  hooks: z.custom<KashClientHooks>().optional(),
  /**
   * The Kash API version this client targets — sent as the
   * `X-Kash-Api-Version` request header on every call. Format: `YYYY-MM-DD`
   * (ISO date).
   *
   * Defaults to {@link SDK_API_VERSION}, the version this SDK release
   * was tested against. Override to pin a specific value:
   *
   * ```ts
   * new KashClient({ apiKey, apiVersion: '2026-08-15' });
   * ```
   *
   * **Server behaviour:** the public API reads `X-Kash-Api-Version`
   * via the `api-version` plugin. Header absent (or empty) → request
   * runs against the canonical `PUBLIC_API_VERSION` the server is
   * deployed with; header present and recognised → request routes
   * through that version's code path; header present but not
   * supported → `410 API_VERSION_UNSUPPORTED` with the supported
   * list in `metadata.supported`. The server's canonical version is
   * always emitted as `X-API-Version` on the response (independent
   * of the client pin). To detect server-side version rollouts,
   * subscribe to `onResponse` and compare the reported `apiVersion`
   * against your pinned {@link SDK_API_VERSION}.
   */
  apiVersion: z
    .string()
    .regex(/^\d{4}-\d{2}-\d{2}$/, "Expected an ISO date in 'YYYY-MM-DD' form")
    .default(SDK_API_VERSION),
});

export type KashClientConfig = z.infer<typeof kashClientConfigSchema>;
export type KashClientConfigInput = z.input<typeof kashClientConfigSchema>;
