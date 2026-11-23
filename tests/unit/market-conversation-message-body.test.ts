/**
 * `sendMessage` checks its body client-side with the API's runtime-independent
 * rules. The case table is shared with the private drift test, which runs the
 * same bodies through the API's schema.
 */

import { describe, expect, it } from 'vitest';

import { SendMarketConversationMessageBodySchema } from '../../src/schemas/market-conversation.js';

import { MESSAGE_BODY_CASES } from './_market-conversation-message-cases.js';

describe('SendMarketConversationMessageBody', () => {
  it.each(MESSAGE_BODY_CASES.map((c) => [c.label, c] as const))('%s', (_label, c) => {
    expect(SendMarketConversationMessageBodySchema.safeParse(c.body).success).toBe(c.sdk);
  });

  it('calibration: the table holds accepted and refused bodies on both sides', () => {
    expect(MESSAGE_BODY_CASES.some((c) => c.sdk && c.api)).toBe(true);
    expect(MESSAGE_BODY_CASES.some((c) => !c.sdk && !c.api)).toBe(true);
    expect(MESSAGE_BODY_CASES.some((c) => c.sdk && !c.api)).toBe(true);
  });

  it('sends the time zone unchanged: canonicalising is the API`s', () => {
    const parsed = SendMarketConversationMessageBodySchema.parse({
      content: 'hi',
      timezone: 'US/Mountain',
    });
    expect(parsed.timezone).toBe('US/Mountain');
  });

  it('fuzz: random UTF-16 strings agree with a reference well-formedness rule', () => {
    let x = 0x2f6b1a3d;
    const next = (): number => {
      x ^= x << 13;
      x ^= x >>> 17;
      x ^= x << 5;
      return x >>> 0;
    };
    // Bias toward surrogates, NUL and spaces so every refusal path is reached.
    const pool = [0xd83d, 0xde00, 0xdbff, 0xdc00, 0x0000, 0x0020, 0x0061, 0x00e9];
    for (let i = 0; i < 2000; i++) {
      const len = 1 + (next() % 12);
      let s = '';
      for (let j = 0; j < len; j++) s += String.fromCharCode(pool[next() % pool.length]!);
      const expected =
        s.trim().length > 0 && !s.includes('\u0000') && isWellFormedUtf16(s) && s.length <= 2000;
      expect(SendMarketConversationMessageBodySchema.safeParse({ content: s }).success, s).toBe(
        expected
      );
    }
  });
});

/** Reference: walk the code units and pair surrogates by hand. */
function isWellFormedUtf16(s: string): boolean {
  for (let i = 0; i < s.length; i++) {
    const c = s.charCodeAt(i);
    if (c >= 0xd800 && c <= 0xdbff) {
      const d = s.charCodeAt(i + 1);
      if (!(d >= 0xdc00 && d <= 0xdfff)) return false;
      i += 1;
    } else if (c >= 0xdc00 && c <= 0xdfff) {
      return false;
    }
  }
  return true;
}
