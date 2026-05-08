import { createHmac } from 'node:crypto';

import { describe, expect, it, vi } from 'vitest';

import { KashClient } from '../../src/index.js';

function jsonResponse(body: unknown, init: ResponseInit = {}): Response {
  return new Response(JSON.stringify(body), {
    status: init.status ?? 200,
    headers: { 'content-type': 'application/json', ...(init.headers ?? {}) },
  });
}

describe('WebhooksClient', () => {
  it('redeliver — POSTs to /webhooks/events/{id}/redeliver', async () => {
    const eventId = '00000000-0000-0000-0000-000000000050';
    const ev = {
      id: eventId,
      eventType: 'trade.completed',
      apiKeyId: '00000000-0000-0000-0000-000000000060',
      tradeRequestId: '00000000-0000-0000-0000-000000000010',
      emittedAt: '2026-04-30T12:00:00.000Z',
      lastDeliveredAt: '2026-04-30T12:01:00.000Z',
      deliveryAttempts: 1,
    };
    const fetchSpy = vi.fn(async () =>
      jsonResponse(
        {
          event: ev,
          data: ev,
          _meta: {
            requestId: 'r1',
            timestamp: '2026-04-30T12:02:00.000Z',
            message: 'Replay queued.',
          },
        },
        { status: 202 }
      )
    );
    const kash = new KashClient({
      apiKey: 'kash_test_xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx',
      baseUrl: 'https://api.test.local/v1',
      fetch: fetchSpy as typeof fetch,
      maxRetries: 0,
    });
    const event = await kash.webhooks.redeliver(eventId);
    // Unwrapped — the SDK returns the event resource itself, not the
    // server's `{ event, _meta }` envelope.
    expect(event.id).toBe(eventId);
    expect(event.eventType).toBe('trade.completed');
    expect(event.deliveryAttempts).toBe(1);
    const url = fetchSpy.mock.calls[0]![0] as string;
    expect(url).toContain(`/webhooks/events/${eventId}/redeliver`);
  });

  it('rotateSecret — POSTs and returns the new secret', async () => {
    const newSecret = {
      secret: 'whsec_NEW',
      rotatedAt: '2026-04-30T12:00:00.000Z',
      previousRetainedUntil: '2026-05-07T12:00:00.000Z',
    };
    const fetchSpy = vi.fn(async () =>
      jsonResponse({
        webhookSecret: newSecret,
        data: newSecret,
        _meta: {
          requestId: 'r1',
          timestamp: '2026-04-30T12:00:00.000Z',
          message: 'Rotated.',
        },
      })
    );
    const kash = new KashClient({
      apiKey: 'kash_test_xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx',
      baseUrl: 'https://api.test.local/v1',
      fetch: fetchSpy as typeof fetch,
      maxRetries: 0,
    });
    const secret = await kash.webhooks.rotateSecret();
    // Unwrapped — flat triple of secret / rotatedAt / previousRetainedUntil.
    expect(secret.secret).toBe('whsec_NEW');
    expect(secret.rotatedAt).toBe('2026-04-30T12:00:00.000Z');
    expect(secret.previousRetainedUntil).toBe('2026-05-07T12:00:00.000Z');
  });

  it('list — returns a Page<WebhookEventResource> with cursor pagination', async () => {
    const event = {
      id: '00000000-0000-0000-0000-000000000020',
      eventType: 'trade.completed',
      tradeRequestId: '00000000-0000-0000-0000-000000000010',
      emittedAt: '2026-04-30T12:00:00.000Z',
      outboxEmittedAt: '2026-04-30T12:00:00.500Z',
      replayCount: 0,
      status: 'delivered' as const,
      delivery: {
        attempts: 1,
        lastAttemptedAt: '2026-04-30T12:00:01.000Z',
        lastDeliveredAt: '2026-04-30T12:00:01.000Z',
        lastStatusCode: 200,
        lastFailureCode: null,
        lastErrorMessage: null,
        terminalFailureAt: null,
      },
    };
    const fetchSpy = vi.fn(async () =>
      jsonResponse({
        data: [event],
        pagination: { cursor: 'cur-next', hasMore: true, limit: 25 },
        _meta: { requestId: 'r1', timestamp: '2026-04-30T12:02:00.000Z' },
      })
    );
    const kash = new KashClient({
      apiKey: 'kash_test_xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx',
      baseUrl: 'https://api.test.local/v1',
      fetch: fetchSpy as typeof fetch,
      maxRetries: 0,
    });

    const page = await kash.webhooks.list({ limit: 25 });
    expect(page.data).toHaveLength(1);
    expect(page.data[0]).toEqual(event);
    expect(page.hasMore).toBe(true);
    expect(page.nextCursor).toBe('cur-next');

    const url = fetchSpy.mock.calls[0]![0] as string;
    expect(url).toContain('/webhooks/events');
    expect(url).toContain('limit=25');
  });

  it('list — joins an array status filter into a comma-separated query param', async () => {
    const fetchSpy = vi.fn(async () =>
      jsonResponse({
        data: [],
        pagination: { cursor: null, hasMore: false, limit: 25 },
        _meta: { requestId: 'r1', timestamp: '2026-04-30T12:02:00.000Z' },
      })
    );
    const kash = new KashClient({
      apiKey: 'kash_test_xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx',
      fetch: fetchSpy as typeof fetch,
      maxRetries: 0,
    });
    await kash.webhooks.list({ status: ['failed', 'retrying'] });

    const url = fetchSpy.mock.calls[0]![0] as string;
    // The SDK joins the array → `failed,retrying` (URL-encoded comma).
    expect(url).toMatch(/status=failed%2Cretrying|status=failed,retrying/);
  });

  it('list — accepts a single status string', async () => {
    const fetchSpy = vi.fn(async () =>
      jsonResponse({
        data: [],
        pagination: { cursor: null, hasMore: false, limit: 25 },
        _meta: { requestId: 'r1', timestamp: '2026-04-30T12:02:00.000Z' },
      })
    );
    const kash = new KashClient({
      apiKey: 'kash_test_xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx',
      fetch: fetchSpy as typeof fetch,
      maxRetries: 0,
    });
    await kash.webhooks.list({ status: 'failed' });

    const url = fetchSpy.mock.calls[0]![0] as string;
    expect(url).toContain('status=failed');
  });

  it('verifySignature — accepts a valid signature produced by node:crypto', async () => {
    const secret = 'whsec_TEST';
    const body = JSON.stringify({ id: 'evt-1', type: 'trade.completed' });
    const ts = 1_700_000_000_000;
    const expected = createHmac('sha256', secret).update(`${ts}.${body}`).digest('hex');
    const header = `t=${ts},v1=${expected}`;

    const kash = new KashClient({ apiKey: 'kash_test_xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx' });
    const result = await kash.webhooks.verifySignature(body, header, secret, {
      nowMs: ts,
      toleranceMs: 60_000,
    });
    expect(result.valid).toBe(true);
  });

  it('verifySignature — rejects malformed header', async () => {
    const kash = new KashClient({ apiKey: 'kash_test_xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx' });
    const r = await kash.webhooks.verifySignature('body', 'no-equals-here', 'whsec_TEST');
    expect(r.valid).toBe(false);
  });

  it('verifySignature — rejects timestamp outside tolerance', async () => {
    const secret = 'whsec_TEST';
    const body = '{}';
    const ts = 1_700_000_000_000;
    const expected = createHmac('sha256', secret).update(`${ts}.${body}`).digest('hex');
    const header = `t=${ts},v1=${expected}`;

    const kash = new KashClient({ apiKey: 'kash_test_xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx' });
    const result = await kash.webhooks.verifySignature(body, header, secret, {
      nowMs: ts + 10 * 60 * 1000,
      toleranceMs: 60_000,
    });
    expect(result.valid).toBe(false);
    if (!result.valid) expect(result.reason).toContain('tolerance');
  });

  it('verifySignature — rejects mismatched HMAC', async () => {
    const secret = 'whsec_TEST';
    const body = '{}';
    const ts = 1_700_000_000_000;
    const wrong = createHmac('sha256', 'whsec_OTHER').update(`${ts}.${body}`).digest('hex');
    const header = `t=${ts},v1=${wrong}`;

    const kash = new KashClient({ apiKey: 'kash_test_xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx' });
    const result = await kash.webhooks.verifySignature(body, header, secret, {
      nowMs: ts,
      toleranceMs: 60_000,
    });
    expect(result.valid).toBe(false);
  });

  it('verifySignature — throws KashConfigurationError on empty secret', async () => {
    const { KashConfigurationError } = await import('../../src/errors.js');
    const kash = new KashClient({ apiKey: 'kash_test_xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx' });
    await expect(kash.webhooks.verifySignature('body', 't=1,v1=abc', '')).rejects.toBeInstanceOf(
      KashConfigurationError
    );
    await expect(kash.webhooks.verifySignature('body', 't=1,v1=abc', '   ')).rejects.toBeInstanceOf(
      KashConfigurationError
    );
  });

  it('verifySignature — throws KashValidationError on non-string body (caller bug guard)', async () => {
    const { KashValidationError } = await import('../../src/errors.js');
    const kash = new KashClient({ apiKey: 'kash_test_xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx' });
    await expect(
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      kash.webhooks.verifySignature({ id: 'evt-1' } as any, 't=1,v1=abc', 'whsec_TEST')
    ).rejects.toBeInstanceOf(KashValidationError);
  });

  it('constructEvent — propagates the KashConfigurationError from verifySignature on empty secret', async () => {
    const { KashConfigurationError } = await import('../../src/errors.js');
    const kash = new KashClient({ apiKey: 'kash_test_xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx' });
    // No plain Error leak — every path through constructEvent surfaces
    // a typed KashError subclass per the JSDoc contract.
    await expect(kash.webhooks.constructEvent('{}', 't=1,v1=abc', '')).rejects.toBeInstanceOf(
      KashConfigurationError
    );
  });

  it('constructEvent — propagates the KashValidationError from verifySignature on non-string body', async () => {
    const { KashValidationError } = await import('../../src/errors.js');
    const kash = new KashClient({ apiKey: 'kash_test_xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx' });
    await expect(
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      kash.webhooks.constructEvent({ id: 'evt-1' } as any, 't=1,v1=abc', 'whsec_TEST')
    ).rejects.toBeInstanceOf(KashValidationError);
  });

  it('verifySignature — tolerates extra unknown vN= entries', async () => {
    const secret = 'whsec_TEST';
    const body = 'payload';
    const ts = 1_700_000_000_000;
    const expected = createHmac('sha256', secret).update(`${ts}.${body}`).digest('hex');
    const header = `t=${ts},v1=${expected},v2=ignored-future-scheme`;

    const kash = new KashClient({ apiKey: 'kash_test_xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx' });
    const result = await kash.webhooks.verifySignature(body, header, secret, {
      nowMs: ts,
      toleranceMs: 60_000,
    });
    expect(result.valid).toBe(true);
  });

  it('constructEvent — verifies the signature AND parses into a typed event', async () => {
    const secret = 'whsec_TEST';
    const event = {
      id: '00000000-0000-0000-0000-000000000050',
      type: 'trade.completed' as const,
      apiVersion: '2026-05-02',
      createdAt: '2026-05-02T12:00:00.000Z',
      data: {
        tradeId: '00000000-0000-0000-0000-000000000010',
        marketId: '00000000-0000-0000-0000-000000000001',
        outcomeIndex: 0,
        amount: '100',
        side: 'buy' as const,
        metadata: { strategy: 'momentum-v2' },
        status: 'completed' as const,
        txHash: '0x' + 'a'.repeat(64),
        tokensOut: '149231587123456789012',
      },
    };
    const body = JSON.stringify(event);
    const ts = 1_700_000_000_000;
    const expected = createHmac('sha256', secret).update(`${ts}.${body}`).digest('hex');
    const header = `t=${ts},v1=${expected}`;

    const kash = new KashClient({ apiKey: 'kash_test_xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx' });
    const parsed = await kash.webhooks.constructEvent(body, header, secret, {
      nowMs: ts,
      toleranceMs: 60_000,
    });
    // Discriminated union narrows on `type`.
    if (parsed.type === 'trade.completed') {
      expect(parsed.data.txHash).toBe(event.data.txHash);
      expect(parsed.data.tokensOut).toBe(event.data.tokensOut);
    } else {
      throw new Error('expected narrowed trade.completed');
    }
  });

  it('constructEvent — throws KashWebhookSignatureError on bad signature', async () => {
    const { KashWebhookSignatureError } = await import('../../src/errors.js');
    const kash = new KashClient({ apiKey: 'kash_test_xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx' });
    const ts = 1_700_000_000_000;
    await expect(
      kash.webhooks.constructEvent('{}', `t=${ts},v1=deadbeef`, 'whsec_TEST', {
        nowMs: ts,
        toleranceMs: 60_000,
      })
    ).rejects.toBeInstanceOf(KashWebhookSignatureError);
  });

  it('constructEvent — throws KashValidationError on unknown event shape', async () => {
    const { KashValidationError } = await import('../../src/errors.js');
    const secret = 'whsec_TEST';
    const body = JSON.stringify({ id: 'not-a-uuid', type: 'unknown.event.v999', data: {} });
    const ts = 1_700_000_000_000;
    const expected = createHmac('sha256', secret).update(`${ts}.${body}`).digest('hex');
    const header = `t=${ts},v1=${expected}`;
    const kash = new KashClient({ apiKey: 'kash_test_xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx' });
    await expect(
      kash.webhooks.constructEvent(body, header, secret, { nowMs: ts, toleranceMs: 60_000 })
    ).rejects.toBeInstanceOf(KashValidationError);
  });
});
