/**
 * Redeem settled positions.
 *
 * When a market resolves (or is cancelled), winning tokens stay in your
 * wallet until you redeem them. This walks your open positions, and for every
 * market that has settled, requests a redemption. Positions that cannot be
 * redeemed — a losing outcome, an unresolved market, an already-redeemed
 * position — answer `POSITION_NOT_CLAIMABLE`, which is safe to skip. The same
 * code also means a previous redemption for that position FAILED and needs
 * support to clear it; the error message (the server's `detail`) says which.
 *
 * Works the same for Solana and Base markets. Requires `trades:write`.
 *
 * Run with:
 *   KASH_API_KEY=kash_test_… node --experimental-strip-types examples/08-redeem.ts
 */

import { KashClient, KashConflictError } from '@kashdao/sdk';

const apiKey = process.env['KASH_API_KEY'];
if (!apiKey) throw new Error('KASH_API_KEY not set');

const kash = new KashClient({ apiKey });

for (const position of await kash.portfolio.positions()) {
  const market = await kash.markets.get(position.marketId);
  if (market.resolutionState !== 'resolved' && market.resolutionState !== 'cancelled') continue;

  try {
    const redemption = await kash.redemptions.create({
      marketId: position.marketId,
      outcomeIndex: position.outcomeIndex,
    });
    console.log(
      `redeeming ${redemption.sharesWad} (${redemption.kind}) on ${market.chainRef}:`,
      redemption.status,
      redemption.idempotent ? '(already requested)' : ''
    );
  } catch (err) {
    if (err instanceof KashConflictError && err.code === 'POSITION_NOT_CLAIMABLE') {
      console.log(`skipping ${position.marketId}#${position.outcomeIndex}: ${err.message}`);
      continue;
    }
    throw err;
  }
}
