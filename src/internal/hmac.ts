/**
 * HMAC-SHA256 over Web Crypto, hex-encoded: the webhook signature primitive,
 * shared by signature verification and the testing entry's signing helper so
 * the two cannot compute it differently.
 */

import { KashConfigurationError } from '../errors.js';

export async function hmacSha256Hex(secret: string, payload: string): Promise<string> {
  const subtle = globalThis.crypto?.subtle;
  if (!subtle) {
    // Runtime-environment misconfiguration. KashConfigurationError so
    // consumers branch via `instanceof KashError` consistently — never
    // a plain Error escapes verifySignature / constructEvent.
    throw new KashConfigurationError(
      '@kashdao/sdk: `crypto.subtle` is not available in this runtime. ' +
        'Webhook signature verification requires Web Crypto (Node 22+, browsers, Deno, Bun).',
      { code: 'SDK_WEB_CRYPTO_UNAVAILABLE' }
    );
  }
  const encoder = new TextEncoder();
  const key = await subtle.importKey(
    'raw',
    encoder.encode(secret),
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign']
  );
  const signature = await subtle.sign('HMAC', key, encoder.encode(payload));
  return bufferToHex(new Uint8Array(signature));
}

function bufferToHex(buf: Uint8Array): string {
  let out = '';
  for (let i = 0; i < buf.length; i++) {
    const v = buf[i] ?? 0;
    out += v.toString(16).padStart(2, '0');
  }
  return out;
}
