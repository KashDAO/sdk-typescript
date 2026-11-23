/**
 * The transcript page follows the API's `after` position: iteration stops on
 * `hasMore === false` even though the last page's `after` is not null, and
 * that last `after` is what a poller keeps.
 */

import { describe, expect, it, vi } from 'vitest';

import { KashValidationError } from '../../src/errors.js';
import { buildTranscriptPage } from '../../src/internal/transcript-page.js';

import type { TranscriptPagination } from '../../src/schemas/market-conversation.js';

type Turn = { readonly turnNumber: number; readonly revision: number };

function page(
  turns: readonly Turn[],
  pagination: TranscriptPagination
): { data: readonly Turn[]; pagination: TranscriptPagination } {
  return { data: turns, pagination };
}

const t = (turnNumber: number, revision = 1): Turn => ({ turnNumber, revision });

describe('TranscriptPage', () => {
  // The API answers this for a conversation with no turn and also for a read
  // from the start while the assistant is writing a turn (its horizon is
  // null): the page holds the position it was read from, which is none.
  it('an empty page read from the start: no data, after null, no more, iteration yields nothing', async () => {
    const fetcher = vi.fn(async () => page([], { after: null, hasMore: false, limit: 50 }));
    const first = await buildTranscriptPage<Turn>(fetcher, undefined);

    expect([first.data, first.after, first.hasMore, first.limit]).toEqual([[], null, false, 50]);
    const seen: Turn[] = [];
    for await (const turn of first) seen.push(turn);
    expect(seen).toEqual([]);
    expect(await first.getNextPage()).toBeNull();
    expect(fetcher).toHaveBeenCalledTimes(1);
  });

  it('the last page keeps a non-null after, stops iteration, and getNextPage resolves null', async () => {
    const fetcher = vi.fn(async (after: string | undefined) =>
      after === undefined
        ? page([t(0), t(1)], { after: 'p1', hasMore: true, limit: 2 })
        : page([t(2)], { after: 'p2', hasMore: false, limit: 2 })
    );
    const first = await buildTranscriptPage<Turn>(fetcher, undefined);

    const seen: number[] = [];
    for await (const turn of first) seen.push(turn.turnNumber);
    expect(seen).toEqual([0, 1, 2]);
    expect(fetcher.mock.calls.map(([after]) => after)).toEqual([undefined, 'p1']);

    const last = await first.getNextPage();
    expect(last?.after).toBe('p2');
    expect(last?.hasMore).toBe(false);
    expect(await last?.getNextPage()).toBeNull();
    expect(fetcher).toHaveBeenCalledTimes(2);
  });

  it('a full page with hasMore false is the end: it is not read as a short-page signal either way', async () => {
    const fetcher = vi.fn(async () =>
      page([t(0), t(1)], { after: 'p1', hasMore: false, limit: 2 })
    );
    const first = await buildTranscriptPage<Turn>(fetcher, 'p0');
    const seen: number[] = [];
    for await (const turn of first) seen.push(turn.turnNumber);
    expect(seen).toEqual([0, 1]);
    expect(fetcher.mock.calls).toEqual([['p0']]);
  });

  it('a short page with hasMore true is followed (the server, not the size, decides)', async () => {
    const fetcher = vi.fn(async (after: string | undefined) =>
      after === undefined
        ? page([t(0)], { after: 'p1', hasMore: true, limit: 50 })
        : page([t(1)], { after: 'p2', hasMore: false, limit: 50 })
    );
    const seen: number[] = [];
    for await (const turn of await buildTranscriptPage<Turn>(fetcher, undefined)) {
      seen.push(turn.turnNumber);
    }
    expect(seen).toEqual([0, 1]);
  });

  it('a rewritten turn after the cursor is yielded as returned, its higher revision included', async () => {
    const fetcher = vi.fn(async (after: string | undefined) =>
      after === undefined
        ? page([t(1, 1)], { after: 'p1', hasMore: true, limit: 1 })
        : page([t(1, 2)], { after: 'p2', hasMore: false, limit: 1 })
    );
    const seen: Turn[] = [];
    for await (const turn of await buildTranscriptPage<Turn>(fetcher, undefined)) seen.push(turn);
    expect(seen).toEqual([t(1, 1), t(1, 2)]);
  });

  it('getNextPage is memoised: two calls, and iteration after them, make one request', async () => {
    const fetcher = vi.fn(async (after: string | undefined) =>
      after === undefined
        ? page([t(0)], { after: 'p1', hasMore: true, limit: 1 })
        : page([t(1)], { after: 'p2', hasMore: false, limit: 1 })
    );
    const first = await buildTranscriptPage<Turn>(fetcher, undefined);
    const [a, b] = await Promise.all([first.getNextPage(), first.getNextPage()]);
    expect(a).toBe(b);
    for await (const _turn of first) {
      // walk both pages
    }
    expect(fetcher).toHaveBeenCalledTimes(2);
  });

  it('a server that reports more forever stops at maxPages with SDK_PAGINATION_RUNAWAY', async () => {
    let n = 0;
    const fetcher = vi.fn(async () => {
      n += 1;
      return page([t(n)], { after: `p${n}`, hasMore: true, limit: 1 });
    });
    const first = await buildTranscriptPage<Turn>(fetcher, undefined, { maxPages: 3 });
    const walk = async (): Promise<number> => {
      let count = 0;
      for await (const _turn of first) count += 1;
      return count;
    };
    const err = await walk().catch((e: unknown) => e);
    expect(err).toBeInstanceOf(KashValidationError);
    expect((err as KashValidationError).code).toBe('SDK_PAGINATION_RUNAWAY');
    expect(fetcher).toHaveBeenCalledTimes(3);
  });
});
