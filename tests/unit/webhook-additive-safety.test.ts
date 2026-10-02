/**
 * A published webhook schema must tolerate fields it has never heard of.
 *
 * # Why this is a test and not a convention
 *
 * The server adds fields to webhook payloads; a customer's installed SDK is
 * whatever version they last upgraded to. Those two facts guarantee that a
 * payload will eventually carry a key the schema does not declare, and the
 * whole channel's forward-compatibility rests on what zod does next.
 *
 * By default zod STRIPS an unknown key. `.strict()` REJECTS it. The difference
 * is invisible in review and total at runtime: this schema is parsed inside
 * `verifyWebhookSignature`, so a strict schema turns every additive server
 * change into a verification failure for every customer who has not upgraded —
 * and the failure surfaces as a signature problem, which is the wrong place to
 * go looking.
 *
 * Measured 2026-08-26, when the server began emitting `chainRef` on every trade
 * webhook: the schemas were already non-strict and the envelope parsed clean.
 * That was luck rather than design — nothing said it had to stay that way, and
 * two request-body schemas in this package ARE `.strict()`, correctly, so the
 * idiom is present and could spread here by imitation.
 *
 * The two request bodies are the contrast worth keeping in mind. Strict is
 * right for something the CUSTOMER sends us, where an unrecognised key is
 * probably their typo and silence would hide it. It is wrong for something WE
 * send THEM, where an unrecognised key is our newer server talking to their
 * older client.
 *
 * @module sdk/tests/webhook-additive-safety
 */

import { describe, expect, it } from 'vitest';
import { z } from 'zod';

import {
  TradeCompletedPayloadSchema,
  WebhookEventSchema,
} from '../../src/schemas/webhook-event.js';

/** A `trade.completed` envelope in the shape the server sends today. */
function envelope(extra: Record<string, unknown> = {}): unknown {
  return {
    id: '11111111-1111-1111-1111-111111111111',
    type: 'trade.completed',
    apiVersion: '2026-08-19',
    createdAt: '2026-08-26T12:00:00.000Z',
    data: {
      tradeId: '22222222-2222-2222-2222-222222222222',
      marketId: '33333333-3333-3333-3333-333333333333',
      outcomeIndex: 0,
      amount: '100',
      side: 'buy',
      status: 'completed',
      txHash: `0x${'a'.repeat(64)}`,
      tokensOut: '125000000000000000000',
      metadata: {},
      ...extra,
    },
  };
}

describe('an installed SDK survives a newer server', () => {
  it('calibration: the baseline envelope parses, so a failure below means the EXTRA key', () => {
    // Without this, every assertion here could pass or fail for reasons that
    // have nothing to do with unknown keys.
    expect(WebhookEventSchema.safeParse(envelope()).success).toBe(true);
  });

  it('accepts chainRef, which the server now sends on every trade webhook', () => {
    expect(WebhookEventSchema.safeParse(envelope({ chainRef: 'evm:8453' })).success).toBe(true);
  });

  it('accepts a field nobody has invented yet', () => {
    // The real property is not "chainRef specifically" — it is that the schema
    // does not police the server's vocabulary.
    expect(
      WebhookEventSchema.safeParse(envelope({ someFutureField: { nested: true } })).success
    ).toBe(true);
  });

  it('strips the unknown key rather than passing it through', () => {
    // Worth pinning both halves: tolerated on the way in, absent on the way
    // out. A consumer reading an undeclared key off the PARSED object gets
    // undefined, which is the correct answer for a schema that does not
    // declare it.
    const parsed = WebhookEventSchema.parse(envelope({ someFutureField: 'x' }));

    expect(parsed).not.toHaveProperty('data.someFutureField');
  });

  it('keeps chainRef on the parsed event now that the schema declares it', () => {
    // Until 0.1.5 chainRef was tolerated and then STRIPPED, so a handler
    // reading `event.data.chainRef` got undefined for a field the server sent
    // on every delivery. Declaring it is the change; this pins the outcome.
    const parsed = WebhookEventSchema.parse(envelope({ chainRef: 'solana:mainnet-beta' }));

    expect(parsed).toHaveProperty('data.chainRef', 'solana:mainnet-beta');
  });

  it('accepts a base58 Solana signature, not only an EVM hash', () => {
    // The discriminating case for the 2026-09-13 widening. This exact
    // signature settled a real staging payout; before the change it would have
    // thrown inside a customer's webhook handler.
    const solana =
      '3C7V6ugFiyv4Kq7VRWQHAA9qHcfGRosKP8WEyM9Lv2Uqa3SJkuT26t9YjhPzTKnvqZguVG3jjuUg2UHfqRKoLP97';

    expect(WebhookEventSchema.safeParse(envelope({ txHash: solana })).success).toBe(true);
  });

  it('revert-check: the same envelope FAILS under the EVM-only pattern 0.1.3 shipped', () => {
    // Proves the acceptance test above discriminates. Rebuild the payload
    // schema with the published 0.1.3 regex and the identical signature must
    // be refused; if it were accepted, the test above would pass whether or
    // not the widening existed.
    const solana =
      '3C7V6ugFiyv4Kq7VRWQHAA9qHcfGRosKP8WEyM9Lv2Uqa3SJkuT26t9YjhPzTKnvqZguVG3jjuUg2UHfqRKoLP97';
    const published013 = TradeCompletedPayloadSchema.extend({
      txHash: z.string().regex(/^0x[a-fA-F0-9]{64}$/),
    });
    const data = (envelope({ txHash: solana }) as { data: unknown }).data;

    expect(published013.safeParse(data).success).toBe(false);
    expect(TradeCompletedPayloadSchema.safeParse(data).success).toBe(true);
  });

  it('still accepts the EVM form it always did', () => {
    const evm = `0x${'a'.repeat(64)}`;

    expect(WebhookEventSchema.safeParse(envelope({ txHash: evm })).success).toBe(true);
  });

  it('still rejects a payload that is genuinely malformed', () => {
    // Calibration in the other direction: tolerance of unknown keys must not
    // be tolerance of everything. If this passed, the tests above would prove
    // nothing about the schema at all.
    expect(WebhookEventSchema.safeParse(envelope({ txHash: 'not-a-hash' })).success).toBe(false);
  });
});
