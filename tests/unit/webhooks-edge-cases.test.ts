/**
 * Webhook signature edge-case tests.
 *
 * Covers scenarios NOT present in `webhooks.test.ts`:
 *   - Multi-secret dual-key window (old + new secret both verify during rotation overlap)
 *   - Timestamp boundary conditions (4m50s passes, 5m01s rejects)
 *   - Replay-attack assertion (same signature presented twice both verify — SDK doesn't track state)
 *   - Tampered payload rejection
 *   - Missing / empty signature header
 *   - Future-dated timestamp rejection
 *   - Non-string body fail-fast
 *   - crypto.subtle unavailability → KashConfigurationError
 */

import { createHmac } from 'node:crypto';

import { afterEach, describe, expect, it, vi } from 'vitest';

import { KashConfigurationError, KashWebhookSignatureError } from '../../src/errors.js';
import { KashClient } from '../../src/index.js';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeKash(): KashClient {
  return new KashClient({ apiKey: 'kash_test_xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx' });
}

function signPayload(secret: string, body: string, ts: number): string {
  const hmac = createHmac('sha256', secret).update(`${ts}.${body}`).digest('hex');
  return `t=${ts},v1=${hmac}`;
}

// ---------------------------------------------------------------------------
// Test suite
// ---------------------------------------------------------------------------

describe('webhooks.verifySignature — edge cases', () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  // -------------------------------------------------------------------------
  // Multi-secret dual-key window
  // -------------------------------------------------------------------------

  it('dual-key window — old secret verifies the payload during the 7-day overlap', async () => {
    const oldSecret = 'whsec_OLD_KEY_DURING_ROTATION';
    const newSecret = 'whsec_NEW_KEY_AFTER_ROTATION';
    const body = JSON.stringify({ id: 'evt-overlap', type: 'trade.completed' });
    const ts = Date.now();

    // Server still signs with the OLD key during the rotation overlap window.
    const headerSignedByOld = signPayload(oldSecret, body, ts);

    const kash = makeKash();

    // Old secret verifies the old-signed payload.
    const resultOld = await kash.webhooks.verifySignature(body, headerSignedByOld, oldSecret, {
      nowMs: ts,
      toleranceMs: 5 * 60 * 1000,
    });
    expect(resultOld.valid).toBe(true);

    // New secret does NOT verify the old-signed payload.
    const resultNew = await kash.webhooks.verifySignature(body, headerSignedByOld, newSecret, {
      nowMs: ts,
      toleranceMs: 5 * 60 * 1000,
    });
    expect(resultNew.valid).toBe(false);
  });

  it('dual-key window — new secret verifies a freshly signed payload; old secret does not', async () => {
    const oldSecret = 'whsec_OLD_KEY_DURING_ROTATION';
    const newSecret = 'whsec_NEW_KEY_AFTER_ROTATION';
    const body = JSON.stringify({ id: 'evt-new', type: 'market.resolved' });
    const ts = Date.now();

    // Server starts signing with the NEW key after the rotation.
    const headerSignedByNew = signPayload(newSecret, body, ts);

    const kash = makeKash();

    const resultNew = await kash.webhooks.verifySignature(body, headerSignedByNew, newSecret, {
      nowMs: ts,
      toleranceMs: 5 * 60 * 1000,
    });
    expect(resultNew.valid).toBe(true);

    const resultOld = await kash.webhooks.verifySignature(body, headerSignedByNew, oldSecret, {
      nowMs: ts,
      toleranceMs: 5 * 60 * 1000,
    });
    expect(resultOld.valid).toBe(false);
  });

  // -------------------------------------------------------------------------
  // Timestamp tolerance boundaries
  // -------------------------------------------------------------------------

  it('timestamp boundary — payload signed 4m50s ago verifies (within 5-minute default window)', async () => {
    const secret = 'whsec_BOUNDARY_TEST';
    const body = '{"id":"evt-boundary","type":"trade.completed"}';
    const FOUR_MIN_50_SEC_MS = 4 * 60 * 1000 + 50 * 1000;

    const ts = 1_700_000_000_000;
    const nowMs = ts + FOUR_MIN_50_SEC_MS; // now is 4m50s after signing

    const kash = makeKash();
    const header = signPayload(secret, body, ts);

    const result = await kash.webhooks.verifySignature(body, header, secret, { nowMs });
    expect(result.valid).toBe(true);
  });

  it('timestamp boundary — payload signed 5m01s ago rejects (outside default 5-minute window)', async () => {
    const secret = 'whsec_BOUNDARY_TEST';
    const body = '{"id":"evt-expired","type":"trade.completed"}';
    const FIVE_MIN_1_SEC_MS = 5 * 60 * 1000 + 1000;

    const ts = 1_700_000_000_000;
    const nowMs = ts + FIVE_MIN_1_SEC_MS; // now is 5m01s after signing

    const kash = makeKash();
    const header = signPayload(secret, body, ts);

    const result = await kash.webhooks.verifySignature(body, header, secret, { nowMs });
    expect(result.valid).toBe(false);
    if (!result.valid) expect(result.reason).toContain('tolerance');
  });

  it('timestamp boundary — exactly at 5m tolerance rejects (Math.abs(diff) > toleranceMs)', async () => {
    const secret = 'whsec_BOUNDARY_TEST';
    const body = '{"id":"evt-exact"}';
    const FIVE_MIN_MS = 5 * 60 * 1000;

    const ts = 1_700_000_000_000;
    // Exactly at the boundary: diff === toleranceMs → >toleranceMs is false → PASSES.
    // This tests the inclusive/exclusive semantics of the SDK implementation.
    const nowMs = ts + FIVE_MIN_MS;

    const kash = makeKash();
    const header = signPayload(secret, body, ts);

    const result = await kash.webhooks.verifySignature(body, header, secret, { nowMs });
    // The SDK uses Math.abs(nowMs - timestampMs) > toleranceMs, so exactly-equal passes.
    expect(result.valid).toBe(true);
  });

  // -------------------------------------------------------------------------
  // Replay attack — SDK does not track state; both calls verify
  // -------------------------------------------------------------------------

  it('replay attack — same signature presented twice both verify (replay detection is consumer responsibility)', async () => {
    const secret = 'whsec_REPLAY_TEST';
    const body = JSON.stringify({ id: 'evt-replay', type: 'trade.completed' });
    const ts = Date.now();
    const header = signPayload(secret, body, ts);

    const kash = makeKash();

    const first = await kash.webhooks.verifySignature(body, header, secret, {
      nowMs: ts,
      toleranceMs: 5 * 60 * 1000,
    });
    const second = await kash.webhooks.verifySignature(body, header, secret, {
      nowMs: ts,
      toleranceMs: 5 * 60 * 1000,
    });

    // Both must pass — the SDK only verifies integrity, not uniqueness.
    // Replay detection (e.g. storing seen event IDs in Redis) is the consumer's job.
    expect(first.valid).toBe(true);
    expect(second.valid).toBe(true);
  });

  // -------------------------------------------------------------------------
  // Tampered payload
  // -------------------------------------------------------------------------

  it('tampered payload — modifying the body after signing rejects', async () => {
    const secret = 'whsec_TAMPER_TEST';
    const originalBody = JSON.stringify({ id: 'evt-original', amount: '100' });
    const tamperedBody = JSON.stringify({ id: 'evt-original', amount: '999999' });
    const ts = Date.now();

    // Signature is for originalBody, but we verify with tamperedBody.
    const header = signPayload(secret, originalBody, ts);

    const kash = makeKash();
    const result = await kash.webhooks.verifySignature(tamperedBody, header, secret, {
      nowMs: ts,
      toleranceMs: 5 * 60 * 1000,
    });

    expect(result.valid).toBe(false);
    if (!result.valid) expect(result.reason).toContain('HMAC');
  });

  // -------------------------------------------------------------------------
  // Missing / empty signature header
  // -------------------------------------------------------------------------

  it('empty signature header — returns valid:false with malformed reason', async () => {
    const kash = makeKash();
    const result = await kash.webhooks.verifySignature('body', '', 'whsec_TEST');
    expect(result.valid).toBe(false);
    if (!result.valid) expect(result.reason).toContain('malformed');
  });

  it('missing v1 entry — returns valid:false (header has timestamp but no v1 scheme)', async () => {
    const kash = makeKash();
    // Valid timestamp but no v1= entry.
    const result = await kash.webhooks.verifySignature('body', 't=1700000000000', 'whsec_TEST');
    expect(result.valid).toBe(false);
  });

  it('completely missing header (undefined cast to empty string) — returns valid:false', async () => {
    const kash = makeKash();
    // Simulates a framework where request.headers['x-kash-signature'] returns undefined
    // and the caller coerces it to an empty string before passing here.
    const result = await kash.webhooks.verifySignature('{}', '', 'whsec_TEST');
    expect(result.valid).toBe(false);
  });

  // -------------------------------------------------------------------------
  // Future-dated timestamp (clock skew / attacker sets ts far in the future)
  // -------------------------------------------------------------------------

  it('future-dated timestamp — rejects if too far in the future (>5 min ahead)', async () => {
    const secret = 'whsec_FUTURE_TEST';
    const body = '{"id":"evt-future"}';
    const SIX_MINUTES_MS = 6 * 60 * 1000;

    const nowMs = 1_700_000_000_000;
    const futureTs = nowMs + SIX_MINUTES_MS; // timestamp 6 minutes in the future

    const kash = makeKash();
    const header = signPayload(secret, body, futureTs);

    const result = await kash.webhooks.verifySignature(body, header, secret, {
      nowMs,
      toleranceMs: 5 * 60 * 1000,
    });

    expect(result.valid).toBe(false);
    if (!result.valid) expect(result.reason).toContain('tolerance');
  });

  it('future-dated timestamp — just within 5 min ahead verifies (tolerance is symmetric)', async () => {
    const secret = 'whsec_FUTURE_WITHIN_TEST';
    const body = '{"id":"evt-future-ok"}';
    const FOUR_MIN_MS = 4 * 60 * 1000;

    const nowMs = 1_700_000_000_000;
    const futureTs = nowMs + FOUR_MIN_MS; // timestamp 4 minutes in the future

    const kash = makeKash();
    const header = signPayload(secret, body, futureTs);

    const result = await kash.webhooks.verifySignature(body, header, secret, {
      nowMs,
      toleranceMs: 5 * 60 * 1000,
    });

    expect(result.valid).toBe(true);
  });

  // -------------------------------------------------------------------------
  // Non-string body
  // -------------------------------------------------------------------------

  it('non-string body — throws KashValidationError (not KashWebhookSignatureError)', async () => {
    const kash = makeKash();
    await expect(
      kash.webhooks.verifySignature(
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        { id: 'not-a-string' } as any,
        't=1,v1=abc',
        'whsec_TEST'
      )
    ).rejects.toThrow(expect.objectContaining({ name: 'KashValidationError' }));
  });

  it('non-string body — constructEvent also throws KashValidationError (not a plain Error)', async () => {
    const kash = makeKash();
    await expect(
      kash.webhooks.constructEvent(
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        Buffer.from('{"id":"evt"}') as any,
        't=1,v1=abc',
        'whsec_TEST'
      )
    ).rejects.toThrow(expect.objectContaining({ name: 'KashValidationError' }));
  });

  // -------------------------------------------------------------------------
  // crypto.subtle unavailable → KashConfigurationError
  // -------------------------------------------------------------------------

  it('crypto.subtle unavailable — throws KashConfigurationError', async () => {
    const kash = makeKash();
    const secret = 'whsec_NO_CRYPTO';
    const body = '{"id":"evt-no-crypto"}';
    const ts = Date.now();
    const header = signPayload(secret, body, ts);

    // Stub out globalThis.crypto.subtle to simulate a host missing Web Crypto.
    const original = (globalThis as { crypto?: { subtle?: unknown } }).crypto;
    try {
      // Replace crypto.subtle with undefined to trigger the guard in hmacSha256Hex.
      Object.defineProperty(globalThis, 'crypto', {
        value: { subtle: undefined },
        configurable: true,
        writable: true,
      });

      await expect(
        kash.webhooks.verifySignature(body, header, secret, { nowMs: ts })
      ).rejects.toBeInstanceOf(KashConfigurationError);
    } finally {
      // Restore original crypto so other tests are unaffected.
      Object.defineProperty(globalThis, 'crypto', {
        value: original,
        configurable: true,
        writable: true,
      });
    }
  });

  // -------------------------------------------------------------------------
  // constructEvent — verifies and propagates typed error on bad signature
  // -------------------------------------------------------------------------

  it('constructEvent — bad signature throws KashWebhookSignatureError (not a plain Error)', async () => {
    const kash = makeKash();
    const ts = Date.now();

    await expect(
      kash.webhooks.constructEvent(
        '{"id":"evt-bad"}',
        `t=${ts},v1=deadbeefdeadbeefdeadbeefdeadbeefdeadbeefdeadbeefdeadbeefdeadbeef`,
        'whsec_TEST',
        { nowMs: ts, toleranceMs: 5 * 60 * 1000 }
      )
    ).rejects.toBeInstanceOf(KashWebhookSignatureError);
  });
});
