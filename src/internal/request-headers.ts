/**
 * The request headers the SDK manages itself, and the guard that keeps a
 * caller's header bag from shadowing them.
 */

/**
 * Strip SDK-controlled header names from the consumer's custom
 * header bag (case-insensitive). Belt-and-suspenders alongside the
 * "SDK headers overwrite custom headers" ordering in `request()`:
 * removing them here means the merged bag is small and
 * `Object.assign` can't accidentally re-promote them via key order.
 *
 * Every name the SDK itself sets in `request()` must be listed here, in lower
 * case, spelled exactly as it is sent. A name that differs only in case from
 * the one the SDK sets is NOT overwritten by the ordering above (the bag is a
 * plain object, so `x-kash-api-version` and `X-Kash-Api-Version` are two keys,
 * and `fetch` joins them into `"a, b"`); this set is what removes it.
 */
const SDK_RESERVED_HEADER_NAMES_LOWER = new Set([
  'accept',
  'user-agent',
  'x-api-key',
  'content-type',
  'idempotency-key',
  'x-kash-api-version',
  // Managed by the conditional-GET cache: a caller-supplied validator would
  // produce a 304 the SDK has no remembered body for.
  'if-none-match',
  // Set only from the typed `account` option, which only the methods of
  // routes that accept it take. Through `headers` it would reach routes that
  // refuse it (400 ACCOUNT_HEADER_NOT_ALLOWED).
  'kash-account',
]);

/**
 * The conditional-cache key for a GET: the URL, plus the account it acts
 * for. A newline cannot occur in a serialised URL, so the two parts cannot
 * run into each other.
 */
export function conditionalCacheKey(url: string, account: string | undefined): string {
  return account === undefined ? url : `${url}\nkash-account:${account.toLowerCase()}`;
}

export function sanitizeCustomHeaders(
  headers: Record<string, string> | undefined
): Readonly<Record<string, string>> {
  if (!headers) return Object.freeze({});
  const out: Record<string, string> = {};
  for (const [name, value] of Object.entries(headers)) {
    if (SDK_RESERVED_HEADER_NAMES_LOWER.has(name.toLowerCase())) continue;
    out[name] = value;
  }
  return Object.freeze(out);
}
