/**
 * `position.claimable`: `constructEvent` verifies and parses the webhook any
 * key receives when a market's winnings or refunds open for claiming. A
 * partner key's delivery names the account; a user key's does not.
 */

import { createHmac } from 'node:crypto';

import { describe, expect, it } from 'vitest';

import { KashClient } from '../../src/client.js';
import { KashValidationError } from '../../src/errors.js';
import {
  isUnknownWebhookEvent,
  type ConstructedWebhookEvent,
} from '../../src/schemas/webhook-event.js';

const SECRET = 'whsec_CLAIMABLE_TEST';
const TS = 1_700_000_000_000;
const MARKET_ID = '00000000-0000-0000-0000-000000000001';

function sign(body: string): string {
  const v1 = createHmac('sha256', SECRET).update(`${TS}.${body}`).digest('hex');
  return `t=${TS},v1=${v1}`;
}

async function construct(data: Record<string, unknown>): Promise<ConstructedWebhookEvent> {
  const raw = JSON.stringify({
    id: '00000000-0000-0000-0000-0000000000c1',
    type: 'position.claimable',
    apiVersion: '2026-08-19',
    createdAt: '2026-11-13T10:00:00.000Z',
    data,
  });
  const kash = new KashClient({ apiKey: 'kash_test_xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx' });
  return kash.webhooks.constructEvent(raw, sign(raw), SECRET, {
    nowMs: TS,
    toleranceMs: 60_000,
  });
}

const OUTCOMES = [
  { outcomeIndex: 0, shares: '1817600000000000000' },
  { outcomeIndex: 2, shares: '500000000000000000' },
];

describe('constructEvent: position.claimable', () => {
  it("parses a partner key's delivery, which names the account", async () => {
    const data = {
      accountId: '7a1c2e3d-4b5f-4a6e-8d7c-1b2a3c4d5e6f',
      externalId: 'user-8841',
      marketId: MARKET_ID,
      kind: 'resolved',
      outcomes: OUTCOMES,
    };

    const event = await construct(data);

    expect(isUnknownWebhookEvent(event)).toBe(false);
    expect(event.type).toBe('position.claimable');
    expect(event.data).toEqual(data);
  });

  it("parses a user key's delivery, which names no account", async () => {
    const data = { marketId: MARKET_ID, kind: 'cancelled', outcomes: OUTCOMES };

    const event = await construct(data);

    expect(event.type).toBe('position.claimable');
    expect(event.data).toEqual(data);
  });

  it('refuses a delivery with no outcome', async () => {
    await expect(
      construct({ marketId: MARKET_ID, kind: 'resolved', outcomes: [] })
    ).rejects.toThrow(KashValidationError);
  });

  it('refuses a fractional share count', async () => {
    await expect(
      construct({
        marketId: MARKET_ID,
        kind: 'resolved',
        outcomes: [{ outcomeIndex: 0, shares: '1.5' }],
      })
    ).rejects.toThrow(KashValidationError);
  });

  it.each([
    ['accountId without externalId', { accountId: '7a1c2e3d-4b5f-4a6e-8d7c-1b2a3c4d5e6f' }],
    ['externalId without accountId', { externalId: 'user-8841' }],
  ])('refuses %s: it is neither key shape', async (_label, account) => {
    await expect(
      construct({ ...account, marketId: MARKET_ID, kind: 'resolved', outcomes: OUTCOMES })
    ).rejects.toThrow(KashValidationError);
  });
});
