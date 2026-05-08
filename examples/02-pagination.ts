/**
 * Pagination — `kash.markets.list()` returns a `Page<MarketResource>`
 * that's both the first page (with `.data` and `.pagination`) and an
 * `AsyncIterable` walking every subsequent page on demand.
 */

import { KashClient } from '@kashdao/sdk';

const kash = new KashClient({ apiKey: process.env['KASH_API_KEY']! });

// === Pattern 1: just the first page ===
const firstPage = await kash.markets.list({ status: 'ACTIVE', limit: 50 });
console.log(`Got ${firstPage.data.length} markets`);
console.log('hasMore:', firstPage.hasMore, 'nextCursor:', firstPage.nextCursor);

// === Pattern 2: walk the next page explicitly ===
const next = await firstPage.getNextPage();
if (next) console.log(`Next page: ${next.data.length} more markets`);

// === Pattern 3: stream every market across pages ===
let total = 0;
for await (const market of await kash.markets.list({ status: 'ACTIVE' })) {
  total += 1;
  console.log(market.id, market.title);
  if (total >= 100) break; // early break is safe; no extra fetches
}
console.log(`Streamed ${total} markets`);
