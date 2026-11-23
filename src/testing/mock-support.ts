/**
 * What every resource of the mock client shares: the list-result shapes a
 * handler may return, their wrapping in a single-page {@link Page}, and the
 * real client's option checks. Re-exported by name from `./index.ts`, which
 * is the `@kashdao/sdk/testing` surface.
 */

import { validateIdempotencyKey } from '../internal/idempotency-key.js';
import { Page } from '../internal/pagination.js';
import { validateUuid } from '../internal/request-options.js';

/**
 * Convenience shape for list-method overrides — the override returns
 * either a flat array of items (which the factory wraps in a single-
 * page {@link Page}) or a `{ data, hasMore?, nextCursor? }` object.
 */
export type MockListResult<T> =
  | readonly T[]
  | Promise<readonly T[]>
  | MockPageShape<T>
  | Promise<MockPageShape<T>>;

export type MockPageShape<T> = {
  readonly data: readonly T[];
  readonly hasMore?: boolean;
  readonly nextCursor?: string | null;
};

/** The real client's option checks: a UUID `account`, a well-formed `Idempotency-Key`. */
export function checkOptions(opts?: {
  readonly account?: string | undefined;
  readonly idempotencyKey?: string | undefined;
}): void {
  if (opts?.account !== undefined) validateUuid(opts.account, 'account');
  if (opts?.idempotencyKey !== undefined) validateIdempotencyKey(opts.idempotencyKey);
}

/**
 * Wrap an array (or a `{ data, hasMore?, nextCursor? }` shape) in a
 * {@link Page} whose iterator terminates at the end of the supplied
 * data. The fetcher is a no-op — mock clients don't paginate.
 */
export function toMockPage<T>(result: readonly T[] | MockPageShape<T>, limit: number): Page<T> {
  const isArray = Array.isArray(result);
  const data = (isArray ? (result as readonly T[]) : (result as MockPageShape<T>).data) ?? [];
  const hasMore = !isArray ? ((result as MockPageShape<T>).hasMore ?? false) : false;
  const cursor = !isArray ? ((result as MockPageShape<T>).nextCursor ?? null) : null;
  return new Page<T>(
    {
      data,
      pagination: { cursor, hasMore, limit },
    },
    // No-op fetcher — if the iterator advances past this page, return
    // an empty terminal page.
    () => Promise.resolve({ data: [], pagination: { cursor: null, hasMore: false, limit } }),
    { limit }
  );
}
