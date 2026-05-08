/**
 * Webhook receiver as a Next.js Route Handler.
 *
 * `kash.webhooks.constructEvent()` (Stripe pattern) verifies the
 * `X-Kash-Signature` header AND parses the body into a typed,
 * narrowable `WebhookEvent`. Pass the raw body — `request.text()`
 * gives us the unparsed bytes. Don't `request.json()` first; the
 * signature is computed over the raw bytes and JSON re-stringification
 * doesn't preserve them.
 */

import { kash } from '@/lib/kash';
import { KashWebhookSignatureError } from '@kashdao/sdk';

export const runtime = 'nodejs'; // Web Crypto works on edge too — switch to 'edge' if preferred

export async function POST(request: Request): Promise<Response> {
  const body = await request.text();
  const sig = request.headers.get('x-kash-signature') ?? '';
  const secret = process.env.KASH_WEBHOOK_SECRET;
  if (!secret) {
    return new Response('Webhook secret not configured', { status: 500 });
  }

  let event;
  try {
    event = await kash.webhooks.constructEvent(body, sig, secret);
  } catch (err) {
    if (err instanceof KashWebhookSignatureError) {
      console.warn('Bad signature:', err.message);
      return new Response('Invalid signature', { status: 400 });
    }
    throw err;
  }

  // event.type narrows event.data per variant. Dedupe on event.id
  // (operator-triggered redeliveries reuse the same id) before
  // dispatching to your business logic.
  console.log(`webhook: ${event.type} (${event.id})`);

  return new Response(null, { status: 204 });
}
