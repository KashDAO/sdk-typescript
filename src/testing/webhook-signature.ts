/**
 * Sign a webhook body the way Kash does, for testing a receiver.
 */

import { hmacSha256Hex } from '../internal/hmac.js';

/** Input for {@link generateTestWebhookSignature}. */
export type GenerateTestWebhookSignatureInput = {
  /** The exact body your receiver will see, as a string (the raw bytes Kash signs). */
  readonly payload: string;
  /** The webhook signing secret your receiver verifies with. */
  readonly secret: string;
  /**
   * The signing time in Unix MILLISECONDS. Defaults to now. A value outside
   * the receiver's tolerance (5 minutes by default) fails verification, which
   * is how to test the replay check.
   */
  readonly timestampMs?: number;
};

/**
 * The `X-Kash-Signature` header value for `payload`: `t=<unix-ms>,v1=<hex>`,
 * where `v1` is HMAC-SHA256 of `<unix-ms>.<payload>` under `secret`. Pass it
 * with the same payload to `kash.webhooks.constructEvent` (or your own
 * verifier) to test a receiver end to end.
 *
 * @example
 * ```ts
 * import { generateTestWebhookSignature } from '@kashdao/sdk/testing';
 *
 * const payload = JSON.stringify(event);
 * const header = await generateTestWebhookSignature({ payload, secret: 'whsec_test' });
 * await request(app).post('/webhooks/kash').set('X-Kash-Signature', header).send(payload);
 * ```
 */
export async function generateTestWebhookSignature(
  input: GenerateTestWebhookSignatureInput
): Promise<string> {
  const timestampMs = input.timestampMs ?? Date.now();
  const v1 = await hmacSha256Hex(input.secret, `${timestampMs}.${input.payload}`);
  return `t=${timestampMs},v1=${v1}`;
}
