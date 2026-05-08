/**
 * Basic trade lifecycle: create → wait for terminal status → log result.
 *
 * Run with:
 *   KASH_API_KEY=kash_test_… node --experimental-strip-types examples/01-basic-trade.ts
 */

import { KashClient } from '@kashdao/sdk';

const apiKey = process.env['KASH_API_KEY'];
if (!apiKey) throw new Error('KASH_API_KEY not set');

const kash = new KashClient({ apiKey });

const trade = await kash.trades.create({
  marketId: '00000000-0000-0000-0000-000000000001', // your market id
  outcomeIndex: 0,
  amount: '100', // 100 USDC
  side: 'buy',
});

if (trade.confirmation) {
  // High-value trade — needs confirmation. The token is returned ONCE.
  console.log('Confirmation required; token:', trade.confirmation.token);
  await kash.trades.confirm(trade.id, { token: trade.confirmation.token });
}

const completed = await kash.trades.waitForCompletion(trade.id, {
  timeoutMs: 60_000,
  onStatus: (t) => console.log('status:', t.status),
});

if (completed.status === 'completed') {
  console.log('done:', completed.txHash);
} else {
  console.error('trade failed:', completed.errorCode, completed.errorMessage);
  process.exit(1);
}
