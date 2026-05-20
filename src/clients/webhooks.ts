/**
 * `webhooks` sub-client — wraps the redeliver route + the secret
 * rotation route, plus a standalone signature verification utility.
 *
 * `verifySignature` runs on the consumer's side (their webhook
 * handler), so it must work in any modern JS runtime without pulling
 * in heavyweight dependencies. We use Web Crypto for HMAC-SHA256
 * (portable to browsers, Deno, Cloudflare Workers, Bun) and a
 * constant-time hex compare implemented in user space.
 */

import {
  KashConfigurationError,
  KashValidationError,
  KashWebhookSignatureError,
} from '../errors.js';
import { buildPage, type Page } from '../internal/pagination.js';
import { WebhookEventSchema, type WebhookEvent } from '../schemas/webhook-event.js';
import {
  ListWebhookEventsResponseSchema,
  RedeliverWebhookResponseSchema,
  RotateWebhookSecretResponseSchema,
  type RedeliverWebhookEvent,
  type WebhookEventResource,
} from '../schemas/webhook.js';

import type { KashHttpClient, RequestOverrides } from '../internal/http.js';
import type { Pagination } from '../schemas/common.js';

/**
 * Result of {@link WebhooksClient.rotateSecret}. The plaintext
 * `secret` is returned ONCE — capture it from this result. Subsequent
 * reads of the API key never include the secret.
 */
export type RotatedWebhookSecret = {
  /** Fresh `whsec_…` plaintext secret. */
  readonly secret: string;
  /** Server timestamp when the rotation took effect. */
  readonly rotatedAt: string;
  /** ISO timestamp until which the previous secret is retained for emergency rollback. */
  readonly previousRetainedUntil: string;
};

export type VerifySignatureOptions = {
  /**
   * Acceptable window between the signature timestamp and now.
   * Default 5 minutes — matches the server-side signer and Stripe's
   * recommendation. Tighten to taste if your endpoint is co-located
   * with our infrastructure.
   */
  readonly toleranceMs?: number;
  /** Override `Date.now()` for tests. */
  readonly nowMs?: number;
};

export type VerifySignatureResult =
  | { readonly valid: true }
  | { readonly valid: false; readonly reason: string };

/**
 * Crypto primitives we need from the host runtime. Node 22+ exposes
 * these natively as `globalThis.crypto.subtle` and `crypto.timingSafeEqual`,
 * but the latter only exists in `node:crypto`. The SDK uses Web
 * Crypto's `subtle.importKey` + `subtle.sign` for HMAC and a constant-time
 * compare implemented in user space (so the package stays portable
 * to browsers and Deno without a `node:` import).
 */

export type ListWebhookEventsParams = {
  /** Page size (1..100, default 25). */
  readonly limit?: number;
  /** Opaque cursor from the previous response's `pagination.cursor`. */
  readonly cursor?: string;
  /**
   * Filter by derived delivery status. Acceptable values:
   * `none`, `pending`, `retrying`, `delivered`, `failed`. Multiple
   * statuses can be passed as an array — they're joined into a single
   * comma-separated query param.
   */
  readonly status?: WebhookEventResource['status'] | ReadonlyArray<WebhookEventResource['status']>;
};

export class WebhooksClient {
  constructor(private readonly http: KashHttpClient) {}

  /**
   * List recent webhook events for the calling key. Newest first; cursor-paginated.
   *
   * Returns a {@link Page} — usable as both a first page (data + cursor)
   * and an `AsyncIterable<WebhookEventResource>` for walking every page lazily.
   *
   * @example
   * ```ts
   * // First page only:
   * const page = await kash.webhooks.list({ limit: 50 });
   * for (const event of page.data) console.log(event.id, event.status);
   *
   * // Async-iterate every failed delivery (across all pages):
   * for await (const event of await kash.webhooks.list({ status: 'failed' })) {
   *   console.log(event.id, event.delivery.lastFailureCode);
   * }
   * ```
   */
  async list(
    params: ListWebhookEventsParams = {},
    opts: RequestOverrides = {}
  ): Promise<Page<WebhookEventResource>> {
    const limit = params.limit ?? 25;
    // Normalise to a single comma-separated string up-front — the
    // HTTP query encoder's value type is primitive-only.
    const status: string | undefined =
      params.status === undefined
        ? undefined
        : Array.isArray(params.status)
          ? (params.status as readonly string[]).join(',')
          : (params.status as string);
    const fetchPage = async (
      cursor: string | undefined
    ): Promise<{ data: readonly WebhookEventResource[]; pagination: Pagination }> => {
      const result = await this.http.request({
        path: '/webhooks/events',
        method: 'GET',
        schema: ListWebhookEventsResponseSchema,
        query: { cursor, limit, status },
        ...opts,
      });
      return result;
    };
    return buildPage<WebhookEventResource>(fetchPage, params.cursor, { limit });
  }

  /**
   * Trigger asynchronous re-delivery of a previously-shipped webhook.
   * Returns the {@link RedeliverWebhookEvent} record describing the
   * queued replay (the event id, type, and last-delivery metadata).
   */
  async redeliver(eventId: string, opts: RequestOverrides = {}): Promise<RedeliverWebhookEvent> {
    const result = await this.http.request({
      path: `/webhooks/events/${encodeURIComponent(eventId)}/redeliver`,
      method: 'POST',
      schema: RedeliverWebhookResponseSchema,
      body: {},
      ...opts,
    });
    return result.event;
  }

  /**
   * Rotate the webhook signing secret for the authenticating API key.
   * The new plaintext secret is returned ONCE — capture it from the
   * result.
   */
  async rotateSecret(opts: RequestOverrides = {}): Promise<RotatedWebhookSecret> {
    const result = await this.http.request({
      path: '/auth/api-keys/me/webhook-secret/rotate',
      method: 'POST',
      schema: RotateWebhookSecretResponseSchema,
      body: {},
      ...opts,
    });
    return result.webhookSecret;
  }

  /**
   * Verify an `X-Kash-Signature` header against the raw request body.
   *
   * Algorithm (Stripe-compatible):
   *
   *   header = `t=<unix-ms-int>,v1=<hex-hmac-sha256>`
   *   expected = HMAC_SHA256(secret, `${ts}.${body}`)
   *
   * Returns a tagged result so the caller can distinguish replays
   * from malformed headers from secret mismatches in support flows.
   *
   * Multiple `vN=` entries are tolerated (forward-compat for a future
   * dual-signature rotation), but only `v1` is currently emitted by
   * the server.
   *
   * **Critical**: `body` MUST be the exact bytes the server signed.
   * If your framework parses JSON before this handler, re-serialising
   * the parsed object will not produce the same bytes (key order and
   * whitespace differ) and the signature will fail. Capture the raw
   * body — Express: `express.raw({ type: 'application/json' })`;
   * Fastify: `addContentTypeParser` retaining the raw buffer; Next.js
   * App Router: `await request.text()`.
   *
   * **Errors thrown** (vs. returned `{ valid: false }`):
   *   - Empty/whitespace-only `secret` — fails fast so a missing
   *     environment variable doesn't silently produce a "valid"
   *     signature against an empty key.
   *   - `crypto.subtle` unavailable — the SDK can't HMAC.
   *
   * Everything else (malformed header, replay, mismatched HMAC) is a
   * tagged `{ valid: false, reason }`.
   */
  async verifySignature(
    body: string,
    signatureHeader: string,
    secret: string,
    opts: VerifySignatureOptions = {}
  ): Promise<VerifySignatureResult> {
    if (typeof secret !== 'string' || secret.trim().length === 0) {
      // Programmer setup error — missing env var or empty config.
      // KashConfigurationError so consumers can branch via `instanceof
      // KashError` without a separate untyped path leaking through.
      throw new KashConfigurationError(
        '@kashdao/sdk: webhooks.verifySignature requires a non-empty `secret`. ' +
          'Check your KASH_WEBHOOK_SECRET environment variable.',
        { code: 'SDK_WEBHOOK_SECRET_MISSING' }
      );
    }
    if (typeof body !== 'string') {
      // Caller passed a parsed JSON object instead of the raw bytes —
      // signature would always fail. Surface as a validation error so
      // `constructEvent` can re-throw it without violating its
      // documented "throws KashValidationError" contract.
      throw new KashValidationError(
        '@kashdao/sdk: webhooks.verifySignature requires the raw request body as a string. ' +
          'Pass the bytes the server signed (not a parsed JSON object).',
        { code: 'SDK_WEBHOOK_BODY_NOT_STRING' }
      );
    }
    const toleranceMs = opts.toleranceMs ?? 5 * 60 * 1000;
    const nowMs = opts.nowMs ?? Date.now();

    const parsed = parseSignatureHeader(signatureHeader);
    if (!parsed) return { valid: false, reason: 'Signature header is malformed.' };

    if (Math.abs(nowMs - parsed.timestampMs) > toleranceMs) {
      return {
        valid: false,
        reason: `Signature timestamp outside the allowed tolerance of ${toleranceMs}ms.`,
      };
    }

    if (parsed.v1Values.length === 0) {
      return { valid: false, reason: 'Signature header missing the v1 scheme value.' };
    }

    const expectedHex = await hmacSha256Hex(secret, `${parsed.timestampMs}.${body}`);
    // The worker may emit multiple `v1=` entries during the secret
    // rotation overlap window (one for the current secret, one for the
    // previous — see `signWebhookPayloadDual` in @kashdao/webhook-delivery).
    // The verifier accepts if ANY of them matches the customer's secret.
    // Without this loop, a customer who has already pulled the rotated
    // secret would fail verification on every webhook during the 7-day
    // rotation window because the parser previously kept only the last
    // v1= value (which is the previous-secret entry by emit order).
    //
    // Each comparison is constant-time within itself; the overall loop
    // length is at most 2 and is a function of the header content, not
    // the secret — no timing-leak surface.
    let anyMatched = false;
    let anyLengthMatched = false;
    for (const v1 of parsed.v1Values) {
      if (v1.length !== expectedHex.length) continue;
      anyLengthMatched = true;
      if (constantTimeEqualHex(expectedHex, v1)) {
        anyMatched = true;
        break;
      }
    }
    if (!anyLengthMatched) {
      return { valid: false, reason: 'Signature length mismatch.' };
    }
    if (!anyMatched) {
      return { valid: false, reason: 'Signature does not match the expected HMAC.' };
    }
    return { valid: true };
  }

  /**
   * Verify the `X-Kash-Signature` header AND parse the JSON body into
   * a typed, narrowable {@link WebhookEvent} in one call. The Stripe
   * pattern.
   *
   * @example
   * ```ts
   * const event = await kash.webhooks.constructEvent(
   *   rawBody,
   *   request.headers['x-kash-signature'],
   *   process.env.KASH_WEBHOOK_SECRET!,
   * );
   * if (event.type === 'trade.completed') {
   *   await markOrderShipped(event.data.tradeId, event.data.txHash);
   * } else if (event.type === 'trade.failed') {
   *   await flagOrder(event.data.tradeId, event.data.errorCode);
   * }
   * ```
   *
   * Throws {@link KashWebhookSignatureError} when the signature fails
   * to verify (the same conditions `verifySignature` returns
   * `{ valid: false }` for) — short-circuit your handler with a
   * 400 response.
   *
   * Throws {@link KashValidationError} when the body verifies but
   * doesn't match a known event shape — the rare case of a server
   * version newer than the SDK pinned (re-throw to surface the drift
   * in your logs) — OR when the caller passed a non-string `body`
   * (a parsed object instead of the raw bytes).
   *
   * Throws {@link KashConfigurationError} when the `secret` is missing
   * or whitespace-only — typically a missing env var. Distinct class
   * because it represents programmer setup, not a delivery problem.
   *
   * @param body Raw request bytes — the same string the server signed.
   * @param signatureHeader Value of the `X-Kash-Signature` header.
   * @param secret The webhook signing secret.
   * @param opts Verification options (timestamp tolerance, clock override).
   */
  async constructEvent(
    body: string,
    signatureHeader: string,
    secret: string,
    opts: VerifySignatureOptions = {}
  ): Promise<WebhookEvent> {
    const result = await this.verifySignature(body, signatureHeader, secret, opts);
    if (!result.valid) {
      throw new KashWebhookSignatureError(result.reason, {
        code: 'WEBHOOK_SIGNATURE_INVALID',
      });
    }
    let parsed: unknown;
    try {
      parsed = JSON.parse(body);
    } catch (err) {
      throw new KashValidationError('Webhook body is not valid JSON.', {
        code: 'SDK_PARSE',
        cause: err,
      });
    }
    const eventResult = WebhookEventSchema.safeParse(parsed);
    if (!eventResult.success) {
      throw new KashValidationError(
        `Webhook body did not match any known event shape: ${eventResult.error.issues
          .map((i) => `${i.path.join('.')}: ${i.message}`)
          .join('; ')}`,
        { code: 'SDK_VALIDATION' }
      );
    }
    return eventResult.data;
  }
}

// -----------------------------------------------------------------
// Internals: header parsing + HMAC + constant-time compare.
// -----------------------------------------------------------------

type ParsedHeader = {
  readonly timestampMs: number;
  /**
   * Every `v1=` entry found in the header, in order. The worker emits
   * two during the 7-day secret rotation overlap window — verifier
   * accepts if any matches the customer's secret.
   */
  readonly v1Values: readonly string[];
};

function parseSignatureHeader(header: string): ParsedHeader | null {
  const segments = header
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean);
  let timestampMs: number | null = null;
  const v1Values: string[] = [];
  for (const segment of segments) {
    const eq = segment.indexOf('=');
    if (eq <= 0 || eq === segment.length - 1) continue;
    const key = segment.slice(0, eq);
    const value = segment.slice(eq + 1);
    if (key === 't') {
      const parsed = Number.parseInt(value, 10);
      if (Number.isFinite(parsed)) timestampMs = parsed;
    } else if (key === 'v1') {
      // Collect every v1= entry. The worker emits two during the
      // 7-day secret rotation overlap (current + previous); the
      // verifier must accept ANY that matches the customer's secret.
      v1Values.push(value);
    }
  }
  if (timestampMs === null) return null;
  return { timestampMs, v1Values };
}

async function hmacSha256Hex(secret: string, payload: string): Promise<string> {
  const subtle = globalThis.crypto?.subtle;
  if (!subtle) {
    // Runtime-environment misconfiguration. KashConfigurationError so
    // consumers branch via `instanceof KashError` consistently — never
    // a plain Error escapes verifySignature / constructEvent.
    throw new KashConfigurationError(
      '@kashdao/sdk: `crypto.subtle` is not available in this runtime. ' +
        'Webhook signature verification requires Web Crypto (Node 22+, browsers, Deno, Bun).',
      { code: 'SDK_WEB_CRYPTO_UNAVAILABLE' }
    );
  }
  const encoder = new TextEncoder();
  const key = await subtle.importKey(
    'raw',
    encoder.encode(secret),
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign']
  );
  const signature = await subtle.sign('HMAC', key, encoder.encode(payload));
  return bufferToHex(new Uint8Array(signature));
}

function bufferToHex(buf: Uint8Array): string {
  let out = '';
  for (let i = 0; i < buf.length; i++) {
    const v = buf[i] ?? 0;
    out += v.toString(16).padStart(2, '0');
  }
  return out;
}

/**
 * Constant-time hex comparison. Both inputs must already be the same
 * length (we check that at the call site before invoking this).
 */
function constantTimeEqualHex(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) {
    diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  }
  return diff === 0;
}
