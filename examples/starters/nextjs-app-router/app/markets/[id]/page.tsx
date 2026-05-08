/**
 * Market detail server component. Fetches the market + recent trades
 * in parallel server-side. The interactive "Place buy" button is a
 * client component that calls a server action.
 */

import { kash } from '@/lib/kash';

import { PlaceOrderButton } from './place-order-button';

export default async function MarketPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const [market, predictions] = await Promise.all([
    kash.markets.get(id),
    kash.markets.predictions(id, { limit: 10 }),
  ]);

  return (
    <main>
      <h1>{market.title ?? market.id}</h1>
      <p>{market.description}</p>

      <h2>Outcomes</h2>
      <ul>
        {market.outcomes.map((o) => (
          <li key={o.index}>
            <strong>{o.label}</strong>: {(o.probability * 100).toFixed(1)}%{' '}
            <PlaceOrderButton marketId={market.id} outcomeIndex={o.index} amountUsdc="10" />
          </li>
        ))}
      </ul>

      <h2>Recent trades</h2>
      <ul>
        {predictions.data.map((t) => (
          <li key={t.id}>
            {t.side} #{t.outcomeIndex} @ {t.price} ({new Date(t.timestamp).toLocaleString()})
          </li>
        ))}
      </ul>
    </main>
  );
}
