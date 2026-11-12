/**
 * Partner webhooks: `constructEvent` verifies and parses the account,
 * withdrawal and payout events a partner organisation receives.
 *
 * Until 0.4.0 the SDK's union held only the four trade types, so every
 * partner webhook threw `KashValidationError` inside the partner's handler
 * after its signature had verified. The canonical bodies come from
 * `wire-shape.test.ts`, which `api-drift.private.test.ts` also runs through
 * the API's own schemas, so these tests and the drift gate read one fixture.
 */

import { createHmac } from 'node:crypto';

import { describe, expect, it } from 'vitest';

import { KashClient } from '../../src/client.js';
import { KashValidationError, KashWebhookSignatureError } from '../../src/errors.js';
import {
  isUnknownWebhookEvent,
  WebhookEventSchema,
  type ConstructedWebhookEvent,
} from '../../src/schemas/webhook-event.js';
import {
  FIXTURE_PARTNER_WEBHOOK_PAYLOADS,
  PARTNER_WEBHOOK_FIXTURE_TYPES,
  partnerWebhookEnvelope,
} from '../contract/wire-shape.test.js';

const SECRET = 'whsec_PARTNER_TEST';
const TS = 1_700_000_000_000;

function sign(body: string): string {
  const v1 = createHmac('sha256', SECRET).update(`${TS}.${body}`).digest('hex');
  return `t=${TS},v1=${v1}`;
}

async function construct(body: unknown): Promise<ConstructedWebhookEvent> {
  const raw = JSON.stringify(body);
  const kash = new KashClient({ apiKey: 'kash_test_xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx' });
  return kash.webhooks.constructEvent(raw, sign(raw), SECRET, {
    nowMs: TS,
    toleranceMs: 60_000,
  });
}

function withData(
  type: (typeof PARTNER_WEBHOOK_FIXTURE_TYPES)[number],
  data: Record<string, unknown>
): unknown {
  const env = partnerWebhookEnvelope(type);
  return { ...env, data: { ...env.data, ...data } };
}

describe('constructEvent: partner webhooks', () => {
  it('calibration: the fixture set covers all eight partner types', () => {
    expect([...PARTNER_WEBHOOK_FIXTURE_TYPES].sort()).toEqual([
      'account.active',
      'account.destination_changed',
      'account.provisioning_failed',
      'account.released',
      'payout.completed',
      'withdrawal.completed',
      'withdrawal.failed',
      'withdrawal.submitted',
    ]);
  });

  it.each(PARTNER_WEBHOOK_FIXTURE_TYPES)(
    '%s verifies and parses with its data intact',
    async (type) => {
      const event = await construct(partnerWebhookEnvelope(type));

      expect(event.type).toBe(type);
      expect(event.data).toEqual(FIXTURE_PARTNER_WEBHOOK_PAYLOADS[type]);
    }
  );

  it('narrows data by type, so a handler reads the fields without a cast', async () => {
    const event = await construct(partnerWebhookEnvelope('withdrawal.completed'));

    if (event.type !== 'withdrawal.completed') return expect.unreachable(event.type);
    expect(event.data.destinationTransactionHash).toBe('0x' + 'b'.repeat(64));
    expect(event.data.destination.network).toBe('arc');
  });

  it('accepts a withdrawal.completed whose sending transaction was not recorded', async () => {
    const event = await construct(withData('withdrawal.completed', { transactionHash: null }));

    expect(event.type === 'withdrawal.completed' && event.data.transactionHash).toBeNull();
  });

  it('accepts a timestamp carrying a UTC offset, which the server allows', async () => {
    const event = await construct(
      withData('account.active', { activatedAt: '2026-11-07T09:59:00.000+00:00' })
    );

    expect(event.type === 'account.active' && event.data.activatedAt).toBe(
      '2026-11-07T09:59:00.000+00:00'
    );
  });

  it('accepts every withdrawal.failed status and error code the server sends', async () => {
    const failed = await construct(
      withData('withdrawal.failed', { status: 'failed', errorCode: 'withdrawal_failed' })
    );
    const lost = await construct(withData('withdrawal.failed', { errorCode: 'bridge_failed' }));

    expect(failed.type === 'withdrawal.failed' && failed.data.status).toBe('failed');
    expect(lost.type === 'withdrawal.failed' && lost.data.errorCode).toBe('bridge_failed');
  });

  it('strips a field the SDK does not declare rather than refusing the delivery', async () => {
    const event = await construct(withData('payout.completed', { someFutureField: 'x' }));

    expect(event.data).not.toHaveProperty('someFutureField');
  });

  // Value sets the server may grow are open: a value this SDK version does
  // not know parses and is kept, so a new server value never throws inside a
  // partner's webhook handler. Each case below is one of the four open sets.
  it('keeps a provisioning failure reason this SDK does not know', async () => {
    const event = await construct(
      withData('account.provisioning_failed', { reason: 'kyc_declined' })
    );

    expect(event.type === 'account.provisioning_failed' && event.data.reason).toBe('kyc_declined');
  });

  it('keeps a destination network this SDK does not know', async () => {
    const event = await construct(
      withData('account.destination_changed', {
        destination: { network: 'base', address: '0x' + 'c'.repeat(40) },
      })
    );

    expect(event.type === 'account.destination_changed' && event.data.destination.network).toBe(
      'base'
    );
  });

  it('keeps a withdrawal failure code and status this SDK does not know', async () => {
    const event = await construct(
      withData('withdrawal.failed', { status: 'expired', errorCode: 'destination_frozen' })
    );

    if (event.type !== 'withdrawal.failed') return expect.unreachable(event.type);
    expect(event.data.status).toBe('expired');
    expect(event.data.errorCode).toBe('destination_frozen');
  });

  it('still refuses an empty value in an open set: absent is not a new value', async () => {
    await expect(
      construct(withData('account.provisioning_failed', { reason: '' }))
    ).rejects.toThrow(/reason/);
  });

  it('still refuses a forged or broken envelope: a bad signature throws before parsing', async () => {
    const raw = JSON.stringify(withData('withdrawal.failed', { errorCode: 'destination_frozen' }));
    const kash = new KashClient({ apiKey: 'kash_test_xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx' });
    const forged = `t=${TS},v1=${'0'.repeat(64)}`;

    await expect(
      kash.webhooks.constructEvent(raw, forged, SECRET, { nowMs: TS, toleranceMs: 60_000 })
    ).rejects.toBeInstanceOf(KashWebhookSignatureError);
  });

  it('still refuses an account id that is not a uuid', async () => {
    await expect(
      construct(withData('account.active', { accountId: 'not-a-uuid' }))
    ).rejects.toThrow(/accountId/);
  });

  it('refuses a body whose status does not match its type', async () => {
    await expect(
      construct(withData('account.released', { status: 'active' }))
    ).rejects.toBeInstanceOf(KashValidationError);
  });

  it('refuses an amount that is not an atomic integer string', async () => {
    await expect(
      construct(withData('withdrawal.submitted', { amountAtomic: '2.5' }))
    ).rejects.toThrow(/amountAtomic/);
  });

  it('returns a type the SDK does not know as an unknown event, data unparsed', async () => {
    const env = partnerWebhookEnvelope('account.active');

    const event = await construct({ ...env, type: 'account.suspended' });

    expect(isUnknownWebhookEvent(event)).toBe(true);
    expect(event).toEqual({ known: false, ...env, type: 'account.suspended' });
  });

  it('revert-check: the four-type union the SDK shipped before refuses a partner type', () => {
    // Proves the acceptance tests above discriminate: rebuilt from the trade
    // members alone, the same body is refused.
    const tradeOnly = WebhookEventSchema.options.filter((o) =>
      o.shape.type.value.startsWith('trade.')
    );

    expect(tradeOnly).toHaveLength(4);
    const body = partnerWebhookEnvelope('account.active');
    expect(tradeOnly.some((o) => o.safeParse(body).success)).toBe(false);
    expect(WebhookEventSchema.safeParse(body).success).toBe(true);
  });
});
