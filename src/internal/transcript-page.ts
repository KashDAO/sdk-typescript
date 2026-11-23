/**
 * The page type of a market conversation transcript, which pages by an
 * `after` position rather than the `cursor` {@link Page} follows.
 *
 * The two contracts differ where it matters to a poller. `Page` stops on a
 * null cursor or a short page. The transcript's `after` stays set on the last
 * page, because it is the position to resume reading from later; `hasMore`
 * alone says whether more is there now. Iteration therefore stops on
 * `hasMore === false`, and the last page's `after` is what a caller keeps for
 * its next read.
 *
 * A page that serves no turn holds the position it was read from, so a read
 * from the start that finds nothing answers an empty page with `after` null.
 * That happens before the conversation's first turn and also while the
 * assistant is writing a turn, which the API serves once it is written. Null
 * means "read from the start next time", never "the transcript is empty".
 */

import { KashValidationError } from '../errors.js';

import type { TranscriptPagination } from '../schemas/market-conversation.js';

export type TranscriptPageFetcher<T> = (after: string | undefined) => Promise<{
  readonly data: readonly T[];
  readonly pagination: TranscriptPagination;
}>;

export type TranscriptPageOptions = {
  /** Maximum pages to walk during iteration. Default 1000. */
  readonly maxPages?: number;
};

/**
 * One page of a transcript, plus a lazy iterator over the pages after it.
 *
 * A turn the assistant rewrites while you read comes back after your
 * position with a higher `revision`, so one walk can yield the same
 * `turnNumber` twice: keep the highest `revision`.
 *
 * @example
 * ```ts
 * let page = await kash.marketConversations.messages(conversationId);
 * for await (const turn of page) console.log(turn.role, turn.content);
 * // Later, read only what is new:
 * page = await kash.marketConversations.messages(conversationId, { after: lastPage.after });
 * ```
 */
export class TranscriptPage<T> implements AsyncIterable<T> {
  /** Turns in this page, oldest change first. */
  readonly data: readonly T[];
  /** The paging envelope the API returned. */
  readonly pagination: TranscriptPagination;

  private readonly fetcher: TranscriptPageFetcher<T>;
  private readonly maxPages: number;
  /** Memoised next page: two calls of `getNextPage()` make one request. */
  private nextPagePromise: Promise<TranscriptPage<T> | null> | undefined;

  constructor(
    page: { readonly data: readonly T[]; readonly pagination: TranscriptPagination },
    fetcher: TranscriptPageFetcher<T>,
    options: TranscriptPageOptions = {}
  ) {
    this.data = page.data;
    this.pagination = page.pagination;
    this.fetcher = fetcher;
    this.maxPages = options.maxPages ?? 1_000;
  }

  /** Whether more turns are there to read now (`pagination.hasMore`). */
  get hasMore(): boolean {
    return this.pagination.hasMore;
  }

  /**
   * Where the next read starts (`pagination.after`): keep it and pass it as
   * `after` to read only what follows. A page that served no turn keeps the
   * position it was read from, so a read from the start answers null when it
   * finds nothing: before the first turn, or while the assistant is writing
   * one. Null means read from the start next time.
   */
  get after(): string | null {
    return this.pagination.after;
  }

  /** Page size the API applied. */
  get limit(): number {
    return this.pagination.limit;
  }

  /**
   * The next page, or `null` when `hasMore` is false. Memoised: calling it
   * twice, or after iterating, makes no second request.
   */
  getNextPage(): Promise<TranscriptPage<T> | null> {
    if (this.nextPagePromise) return this.nextPagePromise;
    const after = this.pagination.after;
    if (!this.pagination.hasMore || after === null) {
      this.nextPagePromise = Promise.resolve(null);
      return this.nextPagePromise;
    }
    this.nextPagePromise = (async () => {
      const next = await this.fetcher(after);
      return new TranscriptPage<T>(next, this.fetcher, { maxPages: this.maxPages });
    })();
    return this.nextPagePromise;
  }

  /**
   * This page and every page after it, fetched on demand. Use it rather than
   * iterating turns when you need the last page's `after` to resume from.
   *
   * @example
   * ```ts
   * let after: string | null = null;
   * for await (const page of (await kash.marketConversations.messages(id)).pages()) {
   *   render(page.data);
   *   after = page.after ?? after;
   * }
   * ```
   */
  pages(): AsyncGenerator<TranscriptPage<T>, void, void> {
    return walkPages(this, this.maxPages);
  }

  /** Every turn of this page and the pages after it. */
  async *[Symbol.asyncIterator](): AsyncGenerator<T, void, void> {
    for await (const page of this.pages()) yield* page.data;
  }
}

/** Outside the class so the generator does not alias `this`. */
async function* walkPages<T>(
  start: TranscriptPage<T>,
  maxPages: number
): AsyncGenerator<TranscriptPage<T>, void, void> {
  let current: TranscriptPage<T> | null = start;
  let pages = 0;
  while (current !== null) {
    pages += 1;
    yield current;
    // Checked before fetching, so the guard never requests a page it refuses.
    if (current.hasMore && pages >= maxPages) {
      throw new KashValidationError(
        `TranscriptPage iterator: walked ${maxPages} pages and the API still reports more. ` +
          'Aborting to prevent an infinite loop.',
        { code: 'SDK_PAGINATION_RUNAWAY' }
      );
    }
    current = await current.getNextPage();
  }
}

/** Fetch the first page and wrap it. */
export async function buildTranscriptPage<T>(
  fetcher: TranscriptPageFetcher<T>,
  initialAfter: string | undefined,
  options: TranscriptPageOptions = {}
): Promise<TranscriptPage<T>> {
  return new TranscriptPage<T>(await fetcher(initialAfter), fetcher, options);
}
