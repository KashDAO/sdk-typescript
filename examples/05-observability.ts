/**
 * Observability — wire the lifecycle hooks to a structured logger.
 *
 * The SDK never logs by itself. Instead, it fires four lifecycle hooks
 * that you wire to whatever logger / tracer / metrics library your app
 * already uses. Hooks that throw cannot break the request path.
 */

import { KashClient } from '@kashdao/sdk';

const kash = new KashClient({
  apiKey: process.env['KASH_API_KEY']!,
  hooks: {
    onRequest: (e) => {
      console.log(JSON.stringify({ kind: 'kash.request', ...e }));
    },
    onResponse: (e) => {
      console.log(
        JSON.stringify({
          kind: 'kash.response',
          method: e.method,
          url: e.url,
          status: e.status,
          ms: Math.round(e.durationMs),
          requestId: e.requestId,
          attempt: e.attempt,
          // Server-reported rate-limit state. `null` if the response
          // didn't carry the X-RateLimit-* headers (rare). Use
          // `e.rateLimit?.remaining` to throttle from your own side
          // before the next call.
          rateLimit: e.rateLimit,
          // Dated server API version from the X-API-Version response
          // header. Compare against SDK_API_VERSION to detect
          // server-side rollouts in your logs.
          apiVersion: e.apiVersion,
          // True when the response is a cached idempotent replay
          // (`Idempotent-Replay: true`). For routes whose body
          // already carries `_meta.idempotent` this is the same
          // signal at the transport layer.
          idempotentReplay: e.idempotentReplay,
          // RFC 8594 sunset advisory. `null` while the version is
          // current; populated once the server starts winding down.
          // Wire a one-shot warn-once here to give your fleet 12-month
          // heads-up before traffic breaks.
          deprecation: e.deprecation,
        })
      );
    },
    onRetry: (e) => {
      console.warn(
        JSON.stringify({
          kind: 'kash.retry',
          method: e.method,
          url: e.url,
          attempt: e.attempt,
          reason: e.reason,
          nextDelayMs: e.delayMs,
        })
      );
    },
    onError: (e) => {
      console.error(
        JSON.stringify({
          kind: 'kash.error',
          method: e.method,
          url: e.url,
          status: e.status,
          code: e.code,
          attempt: e.attempt,
          ms: Math.round(e.durationMs),
        })
      );
    },
  },
});

await kash.markets.list({ status: 'ACTIVE', limit: 5 });
