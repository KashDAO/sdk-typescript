/**
 * Parsers for the response headers the SDK surfaces on hooks and errors:
 * rate-limit state, `Idempotent-Replay`, and deprecation/sunset advisories.
 */

import type { RateLimitState } from './config.js';

/**
 * Parse the rate-limit response headers (`X-RateLimit-Limit`,
 * `X-RateLimit-Remaining`, `X-RateLimit-Reset`) into a typed object.
 * Returns `null` when any header is missing or non-numeric — we don't
 * surface partial state because partial state is a footgun (a
 * `remaining: 0` without context could be misread as "I'm rate-limited").
 *
 * The Kash API attaches all three on every response from a rate-limited
 * route.
 *
 * **Header lookup case**: lowercase keys are intentional and match the
 * Fetch spec — `Headers.prototype.get` is case-insensitive (see
 * https://fetch.spec.whatwg.org/#dom-headers-get). Using one canonical
 * casing here keeps maintenance straightforward; future maintainers
 * should NOT add uppercase variants for the same logical header.
 */
export function parseRateLimitHeaders(response: Response): RateLimitState | null {
  const limit = response.headers.get('x-ratelimit-limit');
  const remaining = response.headers.get('x-ratelimit-remaining');
  const reset = response.headers.get('x-ratelimit-reset');
  if (!limit || !remaining || !reset) return null;
  const limitN = Number(limit);
  const remainingN = Number(remaining);
  const resetN = Number(reset);
  if (!Number.isFinite(limitN) || !Number.isFinite(remainingN) || !Number.isFinite(resetN)) {
    return null;
  }
  return {
    limit: Math.trunc(limitN),
    remaining: Math.max(0, Math.trunc(remainingN)),
    resetSeconds: Math.max(0, Math.trunc(resetN)),
  };
}

/**
 * Parse the `Idempotent-Replay` response header. The server emits
 * `Idempotent-Replay: true` only when the response is a cached replay
 * of an earlier idempotent request; absence (or any other value)
 * means a fresh execution.
 */
export function parseIdempotentReplayHeader(response: Response): boolean {
  return response.headers.get('idempotent-replay') === 'true';
}

/**
 * Parse the `Sunset` (RFC 8594), `Deprecation`
 * (draft-ietf-httpapi-deprecation-header), and `Link rel="sunset"`
 * response headers into a structured advisory. Returns `null` when
 * none of the three headers are present (the steady-state case).
 *
 * The `Link` header may contain multiple semicolon-separated relations;
 * only the first match with `rel="sunset"` is surfaced. The bare URL
 * is extracted from `<URL>` per RFC 8288.
 */
export function parseDeprecationHeaders(response: Response): {
  sunset: string | undefined;
  deprecation: string | undefined;
  link: string | undefined;
} | null {
  const sunset = response.headers.get('sunset') ?? undefined;
  const deprecation = response.headers.get('deprecation') ?? undefined;
  const linkHeader = response.headers.get('link');
  let link: string | undefined;
  if (linkHeader) {
    // Split on commas not inside angle brackets — RFC 8288 allows
    // multiple Link values in one header. For each value, parse the
    // `<URL>` then look up the `rel` parameter (quoted or not). Per
    // RFC 8288 §3.3 `rel` is a space-separated set of relation
    // types — `rel="preload sunset"` is valid and refers to the same
    // target — so we tokenise the value and look for `sunset`.
    for (const candidate of linkHeader.split(/,(?=\s*<)/)) {
      const m = candidate.match(/<([^>]+)>[^,]*\brel\s*=\s*(?:"([^"]*)"|(\S+))/i);
      if (!m || !m[1]) continue;
      const relValue = m[2] ?? m[3] ?? '';
      if (relValue.split(/\s+/).includes('sunset')) {
        link = m[1].trim();
        break;
      }
    }
  }
  if (!sunset && !deprecation && !link) return null;
  return { sunset, deprecation, link };
}
