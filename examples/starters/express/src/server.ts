/**
 * Minimal Express server using @kashdao/sdk.
 *
 * - GET /markets               → server-authenticated read (requires markets:read scope)
 * - GET /markets/:id           → server-authenticated read (requires markets:read scope)
 * - POST /trades               → places a trade using the SDK (server-side key)
 * - POST /webhooks/kash        → verifies signature; processes the event
 * - GET /health                → SDK connectivity probe
 *
 * The KashClient is constructed once at boot. The API key never
 * leaves this process — the API surface this server exposes is
 * what the customer's frontend would call instead.
 */

import {
  isAwaitingConfirmation,
  isTerminalTrade,
  KashClient,
  KashError,
  KashWebhookSignatureError,
} from '@kashdao/sdk';
import express from 'express';

const PORT = Number(process.env.PORT ?? 3000);

const kash = new KashClient({
  apiKey: requireEnv('KASH_API_KEY'),
  // baseUrl is auto-routed from the key prefix.
  userAgentSuffix: 'kash-sdk-starter-express/0.1.0',
});

const webhookSecret = requireEnv('KASH_WEBHOOK_SECRET');

const app = express();

// Authenticated reads — the server-side `KashClient` carries the API
// key. The Express layer can apply its own rate limit / caching here.
app.get('/markets', async (_req, res, next) => {
  try {
    const page = await kash.markets.list({ status: 'ACTIVE', limit: 50 });
    res.json({ data: page.data, hasMore: page.hasMore });
  } catch (err) {
    next(err);
  }
});

app.get('/markets/:id', async (req, res, next) => {
  try {
    const market = await kash.markets.get(req.params.id);
    res.json(market);
  } catch (err) {
    next(err);
  }
});

// Authenticated mutation — the SDK uses the server's API key.
app.post('/trades', express.json(), async (req, res, next) => {
  try {
    const trade = await kash.trades.create(req.body, {
      // Strongly recommended: forward an idempotency key from the
      // customer to make replays safe end-to-end.
      idempotencyKey: req.header('Idempotency-Key') ?? crypto.randomUUID(),
    });

    if (isAwaitingConfirmation(trade)) {
      // Surface the confirmation token — the customer must confirm
      // before the trade enters the pipeline.
      return res.status(202).json({
        trade,
        confirmation: trade.confirmation,
      });
    }

    return res.status(201).json({ trade });
  } catch (err) {
    next(err);
  }
});

// Webhook receiver. Use express.raw to access the unparsed body —
// the signature is computed over the raw bytes.
app.post('/webhooks/kash', express.raw({ type: 'application/json' }), async (req, res) => {
  const body = (req.body as Buffer).toString('utf8');
  const sig = req.header('x-kash-signature') ?? '';

  let event;
  try {
    // Stripe-pattern one-call helper: verifies the signature AND
    // parses into a typed, narrowable WebhookEvent.
    event = await kash.webhooks.constructEvent(body, sig, webhookSecret);
  } catch (err) {
    if (err instanceof KashWebhookSignatureError) {
      console.warn('Bad signature:', err.message);
      return res.status(400).end();
    }
    throw err; // → centralised error handler below
  }

  // event.type narrows event.data per variant. Dedupe on event.id
  // (operator-triggered redeliveries reuse the same id) before
  // dispatching your business logic.
  console.log(`webhook: ${event.type} (${event.id})`);

  return res.status(204).end();
});

app.get('/health', async (_req, res) => {
  const result = await kash.healthCheck();
  res.status(result.ok ? 200 : 503).json(result);
});

// Centralised error handler — translate KashError subclasses into
// HTTP responses your customers can branch on.
app.use(
  (err: unknown, _req: express.Request, res: express.Response, _next: express.NextFunction) => {
    if (KashError.isKashError(err)) {
      return res.status(err.statusCode ?? 500).json({
        code: err.code,
        message: err.message,
        requestId: err.requestId,
        retryable: err.isRetryable,
      });
    }
    console.error(err);
    return res.status(500).json({ error: 'Internal server error' });
  }
);

app.listen(PORT, () => {
  console.log(`▶ Listening on http://localhost:${PORT}`);
  console.log('  GET  /markets');
  console.log('  GET  /markets/:id');
  console.log('  POST /trades');
  console.log('  POST /webhooks/kash');
  console.log('  GET  /health');
});

// Subsequent terminal-trade processing example: subscribe a poller
// somewhere in your pipeline and use the typed guards to branch.
async function pollUntilSettled(tradeId: string) {
  const trade = await kash.trades.waitForCompletion(tradeId, { timeoutMs: 60_000 });
  if (isTerminalTrade(trade)) {
    console.log(`trade ${tradeId} settled: status=${trade.status}, txHash=${trade.txHash ?? '-'}`);
  }
}
void pollUntilSettled; // not wired into a route — illustrative only

function requireEnv(name: string): string {
  const value = process.env[name];
  if (!value) throw new Error(`Missing required env var: ${name}`);
  return value;
}
