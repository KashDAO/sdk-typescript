/**
 * `constructEvent` returns known events or an `UnknownWebhookEvent`. After
 * `isUnknownWebhookEvent`, `event.type` narrows over the known types: each
 * case reads its typed payload, and an exhaustive switch reaches `never`.
 */

import { describe, expectTypeOf, it } from 'vitest';

import {
  isUnknownWebhookEvent,
  type ConstructedWebhookEvent,
  type KashClient,
  type UnknownWebhookEvent,
  type WebhookEvent,
} from '../../src/index.js';

declare const kash: KashClient;

describe('constructEvent result', () => {
  it('is the known union or the unknown arm', () => {
    type Result = Awaited<ReturnType<KashClient['webhooks']['constructEvent']>>;
    expectTypeOf<Result>().toEqualTypeOf<ConstructedWebhookEvent>();
    expectTypeOf<ConstructedWebhookEvent>().toEqualTypeOf<WebhookEvent | UnknownWebhookEvent>();
    expectTypeOf<UnknownWebhookEvent['data']>().toBeUnknown();
  });

  it('narrows to the known union after the guard, and a switch on type is exhaustive', async () => {
    const event = await kash.webhooks.constructEvent('', '', '');
    if (isUnknownWebhookEvent(event)) {
      expectTypeOf(event.type).toBeString();
      return;
    }
    expectTypeOf(event).toEqualTypeOf<WebhookEvent>();
    switch (event.type) {
      case 'trade.completed':
        expectTypeOf(event.data.txHash).toBeString();
        break;
      case 'withdrawal.failed':
        expectTypeOf(event.data.withdrawalId).toBeString();
        break;
      case 'trade.confirmation-required':
      case 'trade.failed':
      case 'trade.rejected':
      case 'account.active':
      case 'account.provisioning_failed':
      case 'account.destination_changed':
      case 'account.released':
      case 'withdrawal.submitted':
      case 'withdrawal.completed':
      case 'payout.completed':
        break;
      default:
        expectTypeOf(event).toBeNever();
    }
  });
});
