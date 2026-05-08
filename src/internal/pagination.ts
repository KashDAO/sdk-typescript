/**
 * Cursor-pagination primitive shared across list endpoints.
 *
 * The {@link Page} class wraps one HTTP response (`data`,
 * `pagination`) and is itself an `AsyncIterable<T>` that walks every
 * subsequent page on demand. This is the OpenAI-SDK shape — one
 * object that's both "the page you asked for" and "an iterator over
 * the entire result set" — without the `Object.assign` hackery the
 * earlier implementation relied on.
 *
 * Termination — iteration stops when any of these is true:
 *   - `pagination.cursor === null`, OR
 *   - the fetched page returned fewer than `limit` items (short page),
 *   - OR the walked-page count hits `maxPages` (default 1000 — guards
 *     against an upstream bug that returns the same cursor forever).
 *
 * The async iterator yields one element at a time so consumers can
 * `break` without paying for the rest of the result set.
 */

import { KashValidationError } from '../errors.js';

import type { Pagination } from '../schemas/common.js';

export type PageFetcher<T> = (cursor: string | undefined) => Promise<{
  readonly data: readonly T[];
  readonly pagination: Pagination;
}>;

export type PageOptions = {
  readonly limit: number;
  /** Maximum pages to walk during iteration. Default 1000. */
  readonly maxPages?: number;
};

/**
 * One page of a list response, plus a lazy iterator that walks the
 * remaining pages.
 *
 * @example
 * ```ts
 * // Page-at-a-time:
 * const page = await kash.markets.list({ limit: 50 });
 * console.log(page.data);
 * if (page.hasMore) console.log('next:', page.nextCursor);
 *
 * // Full iteration:
 * for await (const market of await kash.markets.list({ status: 'ACTIVE' })) {
 *   console.log(market.id);
 * }
 * ```
 */
export class Page<T> implements AsyncIterable<T> {
  /** Items in *this* page. */
  readonly data: readonly T[];
  /** The full pagination envelope returned by the API. */
  readonly pagination: Pagination;
  /** Page size used to fetch this page. */
  readonly limit: number;

  private readonly fetcher: PageFetcher<T>;
  private readonly maxPages: number;
  /**
   * Memoised promise for the next page. Calling `getNextPage()` twice
   * returns the same in-flight promise (and the same resolved page) —
   * no double network fetch. Iteration via `for await` reuses this
   * cache so `await page.getNextPage()` AFTER iteration started
   * doesn't refetch what the iterator already pulled.
   */
  private nextPagePromise: Promise<Page<T> | null> | undefined;

  constructor(
    page: { readonly data: readonly T[]; readonly pagination: Pagination },
    fetcher: PageFetcher<T>,
    options: PageOptions
  ) {
    this.data = page.data;
    this.pagination = page.pagination;
    this.limit = options.limit;
    this.fetcher = fetcher;
    this.maxPages = options.maxPages ?? 1_000;
  }

  /** Convenience flag — `pagination.hasMore`. */
  get hasMore(): boolean {
    return this.pagination.hasMore;
  }

  /** Convenience accessor — `pagination.cursor`. */
  get nextCursor(): string | null {
    return this.pagination.cursor;
  }

  /**
   * Fetch the next page (or `null` if this is the last). Memoised —
   * calling twice returns the same `Page` instance from a single
   * underlying fetch. The same memoisation backs the async-iterator
   * walk, so `getNextPage()` after iterating returns whatever the
   * iterator advanced to.
   */
  getNextPage(): Promise<Page<T> | null> {
    if (this.nextPagePromise) return this.nextPagePromise;
    if (!this.pagination.cursor) {
      this.nextPagePromise = Promise.resolve(null);
      return this.nextPagePromise;
    }
    const cursor = this.pagination.cursor;
    this.nextPagePromise = (async () => {
      const next = await this.fetcher(cursor);
      return new Page<T>(next, this.fetcher, { limit: this.limit, maxPages: this.maxPages });
    })();
    return this.nextPagePromise;
  }

  [Symbol.asyncIterator](): AsyncGenerator<T, void, void> {
    return walk(this, this.maxPages, this.limit);
  }
}

/**
 * Pulled out of the class so the generator function doesn't alias
 * `this` to a local — keeping ESLint's `no-this-alias` rule happy
 * without sprinkling overrides through the file.
 */
async function* walk<T>(
  start: Page<T>,
  maxPages: number,
  limit: number
): AsyncGenerator<T, void, void> {
  let current: Page<T> | null = start;
  let pages = 0;
  while (current !== null) {
    pages += 1;
    if (pages > maxPages) {
      // Upstream cursor never settled to null — pathological server
      // bug. Surface as a typed KashError so consumers branch on
      // `instanceof KashError` consistently rather than catching a
      // bare `Error` and losing class identity.
      throw new KashValidationError(
        `Page iterator: walked ${maxPages} pages without termination — ` +
          'aborting to prevent an infinite loop. Inspect the upstream cursor.',
        { code: 'SDK_PAGINATION_RUNAWAY' }
      );
    }
    for (const item of current.data) {
      yield item;
    }
    // A short page is also a termination signal — some servers leave
    // the cursor non-null on the final page even when `data.length
    // < limit`. We treat both as "we're done."
    if (!current.pagination.cursor || current.data.length < limit) return;
    current = await current.getNextPage();
  }
}

/**
 * Helper used by sub-clients to resolve their `list()` method —
 * fetches the first page and wraps it in a {@link Page}. Centralises
 * the "first fetch + return iterator" pattern so individual sub-
 * clients stay one-liner thin.
 */
export async function buildPage<T>(
  fetcher: PageFetcher<T>,
  initialCursor: string | undefined,
  options: PageOptions
): Promise<Page<T>> {
  const first = await fetcher(initialCursor);
  return new Page<T>(first, fetcher, options);
}
