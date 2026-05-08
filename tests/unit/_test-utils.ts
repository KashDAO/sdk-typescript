/**
 * Shared test helpers. Kept tiny so individual tests stay readable.
 *
 * The single most-reused piece is `META` — every public-API response
 * carries a `_meta: { requestId, timestamp }` envelope. Inline that
 * once here so test fixtures don't repeat it 50 times.
 */

export const META = {
  requestId: '01HQGY8K2N3X4Z5C6D7E8F9G0H',
  timestamp: '2026-04-30T12:00:00.000Z',
} as const;

export const WRITE_META = {
  ...META,
  idempotent: false,
} as const;

export function withMeta<T extends Record<string, unknown>>(body: T): T & { _meta: typeof META } {
  return { ...body, _meta: META };
}
