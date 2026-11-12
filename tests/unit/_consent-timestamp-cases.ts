/**
 * `consent.acceptedAt` forms and whether the API accepts each. Shared by the
 * SDK unit test and the private drift test, which runs the same list through
 * the API's own schema, so the two cannot disagree unnoticed.
 */
export const CONSENT_TIMESTAMP_CASES: ReadonlyArray<readonly [value: string, accepted: boolean]> = [
  ['2026-11-07T09:57:00Z', true],
  ['2026-11-07T09:57:00.123Z', true],
  ['2026-11-07T09:57:00.123456789Z', true],
  ['2026-11-07T09:57Z', true],
  ['2026-11-07T09:57:00+01:00', true],
  ['2026-11-07T09:57:00+0100', true],
  ['2026-11-07T09:57-05:30', true],
  ['2028-02-29T00:00:00Z', true],
  ['2026-11-07T09:57:00', false],
  ['2026-11-07 09:57:00Z', false],
  ['2026-02-29T00:00:00Z', false],
  ['2026-11-07T24:00:00Z', false],
  ['2026-11-07T09:57:60Z', false],
  ['2026-11-07T09:57:00+1', false],
  ['2026-11-07', false],
  ['', false],
];
