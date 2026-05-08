/**
 * Webhook handler — Express, Stripe-pattern.
 *
 * `kash.webhooks.constructEvent(body, header, secret)` verifies the
 * `X-Kash-Signature` header AND parses the body into a typed,
 * narrowable {@link WebhookEvent}. The signing algorithm requires
 * the *raw* request body — use `express.raw()` so the body is a
 * Buffer; `JSON.stringify`-ing the parsed object will not round-trip
 * to the same bytes.
 */

import express from 'express';

import { KashClient, KashWebhookSignatureError } from '@kashdao/sdk';

const app = express();
const kash = new KashClient({ apiKey: process.env['KASH_API_KEY']! });

const WEBHOOK_SECRET = process.env['KASH_WEBHOOK_SECRET'];
if (!WEBHOOK_SECRET) throw new Error('KASH_WEBHOOK_SECRET not set');

app.post('/webhooks/kash', express.raw({ type: 'application/json' }), async (req, res) => {
  const rawBody = req.body.toString('utf8');
  const header = req.headers['x-kash-signature'];
  if (typeof header !== 'string') return res.status(400).json({ error: 'missing signature' });

  let event;
  try {
    event = await kash.webhooks.constructEvent(rawBody, header, WEBHOOK_SECRET);
  } catch (err) {
    if (err instanceof KashWebhookSignatureError) {
      console.warn('rejected webhook:', err.message);
      return res.status(400).json({ error: err.message });
    }
    throw err;
  }

  // event.type narrows event.data to the matching payload shape.
  // Dedupe on event.id (also returned in X-Kash-Event-Id header) to
  // make repeated deliveries safe.
  switch (event.type) {
    case 'trade.completed':
      console.log(`[${event.id}] trade ${event.data.tradeId} executed; tx=${event.data.txHash}`);
      break;
    case 'trade.failed':
      console.log(
        `[${event.id}] trade ${event.data.tradeId} failed; ` +
          `code=${event.data.errorCode} message=${event.data.errorMessage}`
      );
      break;
    case 'trade.confirmation-required':
      console.log(
        `[${event.id}] trade ${event.data.tradeId} awaiting confirmation; ` +
          `expires=${event.data.confirmationExpiresAt}`
      );
      break;
  }

  return res.status(204).end();
});

app.listen(3000);
