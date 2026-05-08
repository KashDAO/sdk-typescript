/**
 * Cloudflare Worker using @kashdao/sdk on the edge runtime.
 *
 * The SDK is built on native fetch + Web Crypto, so it works in
 * Workers without polyfills. The worker constructs a fresh
 * KashClient per invocation — Workers don't have long-lived process
 * state, so there's no benefit to caching the client.
 *
 * Routes:
 *   GET  /markets               → market list (auth via KASH_API_KEY env)
 *   GET  /markets/:id           → market detail
 *   POST /webhooks/kash         → signed-webhook receiver (verifies)
 *   GET  /health                → SDK connectivity probe
 *
 * The KASH_API_KEY lives in Cloudflare secrets and never leaves the
 * Worker — the browser sees only this Worker's responses, not the
 * upstream API or its key. Authenticated mutations (e.g. POST /trades)
 * are intentionally NOT exposed here — Workers are typically the
 * public-facing edge. Place them behind your own auth (a session JWT,
 * a custom header) before forwarding to the SDK. For server-to-server
 * work without an edge-facing layer, use the Express starter instead.
 */

import { KashClient, KashError, KashWebhookSignatureError } from '@kashdao/sdk';

interface Env {
  KASH_API_KEY: string;
  KASH_WEBHOOK_SECRET: string;
}

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    const kash = new KashClient({
      apiKey: env.KASH_API_KEY,
      userAgentSuffix: 'kash-sdk-starter-cf-worker/0.1.0',
    });

    try {
      const url = new URL(request.url);

      if (request.method === 'GET' && url.pathname === '/markets') {
        const status = (url.searchParams.get('status') ?? 'ACTIVE') as
          | 'ACTIVE'
          | 'UNSEEDED'
          | 'RESOLVED';
        const page = await kash.markets.list({ status, limit: 50 });
        return json({ data: page.data, hasMore: page.hasMore });
      }

      const marketDetailMatch = url.pathname.match(/^\/markets\/([^/]+)$/);
      if (request.method === 'GET' && marketDetailMatch) {
        const market = await kash.markets.get(marketDetailMatch[1]!);
        return json(market);
      }

      if (request.method === 'POST' && url.pathname === '/webhooks/kash') {
        const body = await request.text();
        const sig = request.headers.get('x-kash-signature') ?? '';
        let event;
        try {
          // Stripe-pattern one-call helper: verifies the signature AND
          // parses into a typed, narrowable WebhookEvent.
          event = await kash.webhooks.constructEvent(body, sig, env.KASH_WEBHOOK_SECRET);
        } catch (err) {
          if (err instanceof KashWebhookSignatureError) {
            return new Response(err.message, { status: 400 });
          }
          throw err;
        }
        // event.type narrows event.data per variant. Dispatch your
        // business logic here. Dedupe on event.id.
        console.log(`webhook: ${event.type} (${event.id})`);
        return new Response(null, { status: 204 });
      }

      if (request.method === 'GET' && url.pathname === '/health') {
        const result = await kash.healthCheck();
        return json(result, { status: result.ok ? 200 : 503 });
      }

      return new Response('Not found', { status: 404 });
    } catch (err) {
      if (KashError.isKashError(err)) {
        return json(
          {
            code: err.code,
            message: err.message,
            requestId: err.requestId,
            retryable: err.isRetryable,
          },
          { status: err.statusCode ?? 500 }
        );
      }
      console.error(err);
      return json({ error: 'Internal server error' }, { status: 500 });
    }
  },
} satisfies ExportedHandler<Env>;

function json(body: unknown, init?: ResponseInit): Response {
  return new Response(JSON.stringify(body), {
    ...init,
    headers: {
      ...(init?.headers as Record<string, string> | undefined),
      'content-type': 'application/json',
    },
  });
}
