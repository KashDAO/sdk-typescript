/**
 * `generateTestWebhookSignature` (testing entry): the header it produces is
 * what Kash sends, so `constructEvent` accepts it for the same payload and
 * secret, and refuses it for any other.
 */

import { createHmac } from 'node:crypto';

import { describe, expect, it } from 'vitest';

import { KashWebhookSignatureError } from '../../src/errors.js';
import { KashClient } from '../../src/index.js';
import { generateTestWebhookSignature } from '../../src/testing/index.js';
import { partnerWebhookEnvelope } from '../contract/wire-shape.test.js';

const SECRET = 'whsec_SIGNING_HELPER';
const TS = 1_700_000_000_000;
const payload = JSON.stringify(partnerWebhookEnvelope('withdrawal.completed'));
const kash = new KashClient({ apiKey: 'kash_test_xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx' });

describe('generateTestWebhookSignature', () => {
  it('produces t=<ms>,v1=<HMAC-SHA256 of "<ms>.<payload>">', async () => {
    const header = await generateTestWebhookSignature({ payload, secret: SECRET, timestampMs: TS });
    const expected = createHmac('sha256', SECRET).update(`${TS}.${payload}`).digest('hex');

    expect(header).toBe(`t=${TS},v1=${expected}`);
  });

  it('constructEvent accepts it for the same payload and secret', async () => {
    const header = await generateTestWebhookSignature({ payload, secret: SECRET, timestampMs: TS });

    const event = await kash.webhooks.constructEvent(payload, header, SECRET, { nowMs: TS });

    expect(event.type).toBe('withdrawal.completed');
  });

  it('defaults the timestamp to now, inside the default tolerance', async () => {
    const header = await generateTestWebhookSignature({ payload, secret: SECRET });

    await expect(kash.webhooks.constructEvent(payload, header, SECRET)).resolves.toMatchObject({
      type: 'withdrawal.completed',
    });
  });

  it('is refused for another secret, a changed body, or a stale timestamp', async () => {
    const header = await generateTestWebhookSignature({ payload, secret: SECRET, timestampMs: TS });

    await expect(
      kash.webhooks.constructEvent(payload, header, 'whsec_OTHER', { nowMs: TS })
    ).rejects.toBeInstanceOf(KashWebhookSignatureError);
    await expect(
      kash.webhooks.constructEvent(`${payload} `, header, SECRET, { nowMs: TS })
    ).rejects.toBeInstanceOf(KashWebhookSignatureError);
    await expect(
      kash.webhooks.constructEvent(payload, header, SECRET, { nowMs: TS + 10 * 60_000 })
    ).rejects.toBeInstanceOf(KashWebhookSignatureError);
  });
});
