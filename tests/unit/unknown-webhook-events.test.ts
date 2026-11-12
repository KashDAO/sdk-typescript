/**
 * A verified delivery whose `type` this SDK version does not know comes back
 * as an `UnknownWebhookEvent` instead of throwing, so a webhook type the API
 * adds never breaks a working handler. The signature is still checked first,
 * the envelope is still checked, and a KNOWN type is still parsed strictly.
 */

import { createHmac } from 'node:crypto';

import { describe, expect, it } from 'vitest';

import { KashValidationError, KashWebhookSignatureError } from '../../src/errors.js';
import { isUnknownWebhookEvent, KashClient } from '../../src/index.js';
import { createMockKashClient } from '../../src/testing/index.js';
import { FIXTURE_WEBHOOK_EVENT_TRADE_COMPLETED } from '../contract/wire-shape.test.js';

const SECRET = 'whsec_UNKNOWN_TEST';
const TS = 1_700_000_000_000;
const UNKNOWN = {
  id: '00000000-0000-0000-0000-000000000077',
  type: 'account.suspended',
  apiVersion: '2026-08-19',
  createdAt: '2026-11-07T12:00:00.000Z',
  data: { accountId: '00000000-0000-0000-0000-000000000070', reason: 'partner_request' },
};

function sign(body: string): string {
  return `t=${TS},v1=${createHmac('sha256', SECRET).update(`${TS}.${body}`).digest('hex')}`;
}

const kash = new KashClient({ apiKey: 'kash_test_xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx' });
const construct = (body: string, header = sign(body)) =>
  kash.webhooks.constructEvent(body, header, SECRET, { nowMs: TS, toleranceMs: 60_000 });

describe('constructEvent: event types this SDK does not know', () => {
  it('a verified unknown type is returned as an UnknownWebhookEvent with data unparsed', async () => {
    const event = await construct(JSON.stringify(UNKNOWN));

    expect(isUnknownWebhookEvent(event)).toBe(true);
    expect(event).toEqual({ known: false, ...UNKNOWN });
  });

  it('an unknown type with a bad signature still throws before anything is parsed', async () => {
    const body = JSON.stringify(UNKNOWN);

    await expect(construct(body, `t=${TS},v1=${'0'.repeat(64)}`)).rejects.toBeInstanceOf(
      KashWebhookSignatureError
    );
  });

  it('an unknown type with a malformed envelope is refused', async () => {
    await expect(construct(JSON.stringify({ ...UNKNOWN, id: 'not-a-uuid' }))).rejects.toThrow(
      /not a webhook envelope: id/
    );
    await expect(construct(JSON.stringify({ ...UNKNOWN, type: '' }))).rejects.toBeInstanceOf(
      KashValidationError
    );
  });

  it('a known type that breaks its own schema is refused, never downgraded to unknown', async () => {
    const broken = {
      ...FIXTURE_WEBHOOK_EVENT_TRADE_COMPLETED,
      data: { ...FIXTURE_WEBHOOK_EVENT_TRADE_COMPLETED.data, tradeId: 'nope' },
    };

    await expect(construct(JSON.stringify(broken))).rejects.toThrow(/a trade.completed event/);
  });

  it('a known type parses typed, and is not an unknown event', async () => {
    const event = await construct(JSON.stringify(FIXTURE_WEBHOOK_EVENT_TRADE_COMPLETED));

    expect(isUnknownWebhookEvent(event)).toBe(false);
    if (isUnknownWebhookEvent(event)) return expect.unreachable();
    expect(event.type).toBe('trade.completed');
    expect('known' in event).toBe(false);
  });

  it('the testing mock parses unknown types the same way', async () => {
    const event = await createMockKashClient().webhooks.constructEvent(
      JSON.stringify(UNKNOWN),
      'any',
      SECRET
    );

    expect(event).toEqual({ known: false, ...UNKNOWN });
  });
});
