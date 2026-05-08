import { describe, expect, it, vi } from 'vitest';

import { buildPage, Page } from '../../src/internal/pagination.js';

import type { Pagination } from '../../src/schemas/common.js';

type Item = { readonly id: number };

function pageFromIds(
  ids: readonly number[],
  pagination: Pagination
): { data: readonly Item[]; pagination: Pagination } {
  return { data: ids.map((id) => ({ id })), pagination };
}

describe('Page', () => {
  it('exposes data, pagination, hasMore, nextCursor', async () => {
    const fetcher = vi.fn(async () =>
      pageFromIds([1, 2, 3], { cursor: 'c1', hasMore: true, limit: 3 })
    );
    const page = await buildPage<Item>(fetcher, undefined, { limit: 3 });
    expect(page.data.map((i) => i.id)).toEqual([1, 2, 3]);
    expect(page.hasMore).toBe(true);
    expect(page.nextCursor).toBe('c1');
    expect(page.limit).toBe(3);
  });

  it('getNextPage fetches with the cursor; returns null when terminal', async () => {
    let calls = 0;
    const fetcher = vi.fn(async (cursor: string | undefined) => {
      calls += 1;
      if (calls === 1) {
        expect(cursor).toBeUndefined();
        return pageFromIds([1, 2], { cursor: 'c1', hasMore: true, limit: 2 });
      }
      expect(cursor).toBe('c1');
      return pageFromIds([3, 4], { cursor: null, hasMore: false, limit: 2 });
    });
    const first = await buildPage<Item>(fetcher, undefined, { limit: 2 });
    const second = await first.getNextPage();
    expect(second).not.toBeNull();
    expect(second!.data.map((i) => i.id)).toEqual([3, 4]);
    expect(second!.nextCursor).toBeNull();
    expect(await second!.getNextPage()).toBeNull();
  });

  it('walks 5 pages via async iteration; cursor propagates each call', async () => {
    const pages = [
      [1, 2],
      [3, 4],
      [5, 6],
      [7, 8],
      [9, 10],
    ] as const;
    const seen: (string | undefined)[] = [];
    const fetcher = vi.fn(async (cursor: string | undefined) => {
      seen.push(cursor);
      const idx = cursor ? Number(cursor.replace('c', '')) : 0;
      const data = pages[idx]!;
      const next = idx + 1 < pages.length ? `c${idx + 1}` : null;
      return pageFromIds(data, { cursor: next, hasMore: next !== null, limit: 2 });
    });
    const first = await buildPage<Item>(fetcher, undefined, { limit: 2 });
    const ids: number[] = [];
    for await (const item of first) {
      ids.push(item.id);
    }
    expect(ids).toEqual([1, 2, 3, 4, 5, 6, 7, 8, 9, 10]);
    expect(seen).toEqual([undefined, 'c1', 'c2', 'c3', 'c4']);
  });

  it('terminates early on a short page even if cursor is non-null', async () => {
    const fetcher = vi.fn(async () =>
      pageFromIds([1], { cursor: 'still-there', hasMore: false, limit: 5 })
    );
    const first = await buildPage<Item>(fetcher, undefined, { limit: 5 });
    const collected: number[] = [];
    for await (const item of first) collected.push(item.id);
    expect(collected).toEqual([1]);
    expect(fetcher).toHaveBeenCalledOnce();
  });

  it('aborts after maxPages without termination', async () => {
    const fetcher = vi.fn(async () =>
      pageFromIds([1, 2], { cursor: 'always', hasMore: true, limit: 2 })
    );
    const first = await buildPage<Item>(fetcher, undefined, { limit: 2, maxPages: 2 });
    await expect(async () => {
      for await (const _ of first) {
        /* drain */
      }
    }).rejects.toThrow(/walked 2 pages without termination/);
  });

  it('supports early break — does not fetch the next page', async () => {
    const fetcher = vi.fn(async () =>
      pageFromIds([1, 2], { cursor: 'next', hasMore: true, limit: 2 })
    );
    const first = await buildPage<Item>(fetcher, undefined, { limit: 2 });
    for await (const item of first) {
      if (item.id === 1) break;
    }
    expect(fetcher).toHaveBeenCalledOnce();
  });

  it('Page is exported as a stable public type', () => {
    // Compile-time check: Page is a class, can be referenced as a type.
    const x: Page<Item> | undefined = undefined;
    expect(x).toBeUndefined();
  });
});
