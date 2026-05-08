/**
 * High-value trade flow — server returns a 202 with a one-time
 * confirmation token. The token is returned ONCE; capture it from
 * `trade.confirmation` and confirm before proceeding.
 */

import { KashClient } from '@kashdao/sdk';

const kash = new KashClient({ apiKey: process.env['KASH_API_KEY']! });

const trade = await kash.trades.create({
  marketId: '00000000-0000-0000-0000-000000000001',
  outcomeIndex: 0,
  amount: '50000', // 50,000 USDC — high-value
  side: 'buy',
});

if (trade.confirmation) {
  // Show the token to the user / require an additional confirmation step
  // in your application. This is your only chance to capture it.
  const { token, expiresAt } = trade.confirmation;
  console.log('Confirm by', expiresAt);

  // Once your application logic decides to proceed:
  await kash.trades.confirm(trade.id, { token });
} else {
  // Trade went through immediately (under the high-value threshold).
  console.log('No confirmation needed; trade entered the pipeline.');
}

const completed = await kash.trades.waitForCompletion(trade.id);
console.log('terminal status:', completed.status, completed.txHash);
