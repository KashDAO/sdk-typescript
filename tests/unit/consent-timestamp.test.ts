/**
 * `consent.acceptedAt` accepts exactly what the API accepts (zod 3's
 * `datetime({ offset: true })`): seconds optional, `Z` or an offset with or
 * without the colon, real calendar dates. Zod 4's own `z.iso.datetime` is
 * narrower, which is why the SDK spells the rule out.
 */

import { describe, expect, it } from 'vitest';

import { CreatePartnerAccountBodySchema } from '../../src/schemas/partner-account.js';
import { FIXTURE_CREATE_PARTNER_ACCOUNT_BODY } from '../contract/wire-shape.test.js';

import { CONSENT_TIMESTAMP_CASES } from './_consent-timestamp-cases.js';

describe('consent.acceptedAt', () => {
  it.each(CONSENT_TIMESTAMP_CASES)('%j is accepted: %s', (acceptedAt, accepted) => {
    const result = CreatePartnerAccountBodySchema.safeParse({
      ...FIXTURE_CREATE_PARTNER_ACCOUNT_BODY,
      consent: { ...FIXTURE_CREATE_PARTNER_ACCOUNT_BODY.consent, acceptedAt },
    });

    expect(result.success).toBe(accepted);
  });

  it('calibration: the list holds the two forms zod 4 alone would refuse', () => {
    const accepted = CONSENT_TIMESTAMP_CASES.filter(([, ok]) => ok).map(([v]) => v);
    expect(accepted).toContain('2026-11-07T09:57Z');
    expect(accepted).toContain('2026-11-07T09:57:00+0100');
  });
});
