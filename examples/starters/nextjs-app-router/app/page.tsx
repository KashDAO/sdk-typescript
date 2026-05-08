/**
 * Server component — fetches markets server-side via the SDK and
 * renders a list. The SDK call happens on the server; the page is
 * streamed to the browser as HTML. No API key reaches the client.
 */

import Link from 'next/link';

import { kash } from '@/lib/kash';

export default async function HomePage() {
  const page = await kash.markets.list({ status: 'ACTIVE', limit: 20 });

  return (
    <main>
      <h1>Active markets</h1>
      <ul>
        {page.data.map((m) => (
          <li key={m.id}>
            <Link href={`/markets/${m.id}`}>{m.title ?? m.id}</Link>
          </li>
        ))}
      </ul>
      {page.hasMore && <p>(showing first {page.data.length})</p>}
    </main>
  );
}
