/**
 * Draft a market with the market creation assistant (preview).
 *
 * Starts a conversation, sends the user's message, waits for the
 * assistant's reply and prints it. Keep `after` between turns so each read
 * returns only what is new. The routes answer `503 ROUTE_DISABLED`
 * (`KashMaintenanceError`) until the market creation API launches.
 *
 * Pass your own `Idempotency-Key` for each start and each message (here
 * derived from a job id), so a retry of the whole script after a crash
 * returns the stored answer instead of starting a second conversation or
 * sending the message twice.
 *
 * Requires `markets:write`. A partner key also passes `{ account }`.
 *
 * Run with:
 *   KASH_API_KEY=kash_test_… node --experimental-strip-types examples/09-market-conversation.ts
 */

import { KashClient } from '@kashdao/sdk';
import { isMarketContentRefusal } from '@kashdao/sdk/market-conversations';

const apiKey = process.env['KASH_API_KEY'];
if (!apiKey) throw new Error('KASH_API_KEY not set');

const kash = new KashClient({ apiKey });
const jobId = 'calgary-snow-2026-12';

const { conversation } = await kash.marketConversations.start({ idempotencyKey: `${jobId}:start` });
let after: string | null = null;

try {
  const { message } = await kash.marketConversations.sendMessage(
    conversation.id,
    {
      content: 'Will Calgary get more than 10 cm of snow on 1 December 2026?',
      timezone: 'America/Edmonton',
    },
    { idempotencyKey: `${jobId}:message-1` }
  );

  const reply = await kash.marketConversations.waitForReply(conversation.id, {
    message,
    after,
    onStatus: (state) => console.log('status:', state.status, state.queuePosition ?? ''),
  });
  after = reply.after;

  if (reply.outcome === 'failed') {
    console.log('The message could not be delivered. Send it again with a new key.');
  } else {
    for (const turn of reply.turns) {
      if (turn.role === 'assistant') console.log('assistant:', turn.content);
    }
    if (reply.state.readyToPublish)
      console.log('The draft is ready to submit as a market request.');
  }
} catch (err) {
  if (isMarketContentRefusal(err)) {
    console.log(`Refused (${err.extensions.reason}): ${err.message}`);
  } else {
    throw err;
  }
}

console.log('resume the transcript from:', after);
