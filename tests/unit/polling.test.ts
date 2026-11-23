import { describe, expect, it, vi } from 'vitest';

import { KashAbortedError, KashTimeoutError, KashValidationError } from '../../src/errors.js';
import { pollTiming, pollUntil } from '../../src/internal/polling.js';

describe('pollUntil', () => {
  it('returns immediately when first call satisfies isDone', async () => {
    const fn = vi.fn().mockResolvedValue({ status: 'completed' });
    const result = await pollUntil(fn, (v) => v.status === 'completed', {
      timing: pollTiming('test.wait', { timeoutMs: 1_000, pollIntervalMs: 50 }),
    });
    expect(result).toEqual({ status: 'completed' });
    expect(fn).toHaveBeenCalledOnce();
  });

  it('polls until terminal value', async () => {
    let calls = 0;
    const fn = vi.fn(async () => {
      calls += 1;
      return { status: calls >= 3 ? 'completed' : 'pending' };
    });
    const result = await pollUntil(fn, (v) => v.status === 'completed', {
      timing: pollTiming('test.wait', { timeoutMs: 1_000, pollIntervalMs: 1 }),
    });
    expect(result.status).toBe('completed');
    expect(calls).toBe(3);
  });

  it('invokes onStatus on every poll', async () => {
    let calls = 0;
    const fn = vi.fn(async () => {
      calls += 1;
      return { status: calls >= 2 ? 'done' : 'pending' };
    });
    const onStatus = vi.fn();
    await pollUntil(fn, (v) => v.status === 'done', {
      timing: pollTiming('test.wait', { timeoutMs: 1_000, pollIntervalMs: 1 }),
      onStatus,
    });
    expect(onStatus).toHaveBeenCalledTimes(2);
    expect(onStatus.mock.calls[0]![0]).toEqual({ status: 'pending' });
    expect(onStatus.mock.calls[1]![0]).toEqual({ status: 'done' });
  });

  it('throws KashTimeoutError when timeout elapses', async () => {
    const fn = vi.fn(async () => ({ status: 'pending' }));
    await expect(
      pollUntil(fn, (v) => v.status === 'done', {
        timing: pollTiming('test.wait', { timeoutMs: 30, pollIntervalMs: 5 }),
      })
    ).rejects.toBeInstanceOf(KashTimeoutError);
  });

  it('throws KashAbortedError when caller aborts between polls', async () => {
    const controller = new AbortController();
    const fn = vi.fn(async () => {
      controller.abort();
      return { status: 'pending' };
    });
    await expect(
      pollUntil(fn, (v) => v.status === 'done', {
        timing: pollTiming('test.wait', { timeoutMs: 1_000, pollIntervalMs: 5 }),
        signal: controller.signal,
      })
    ).rejects.toBeInstanceOf(KashAbortedError);
  });

  it('throws KashAbortedError when caller aborts during the inter-poll sleep', async () => {
    const controller = new AbortController();
    const fn = vi.fn(async () => ({ status: 'pending' }));
    // First poll returns pending, then we schedule an abort during the
    // inter-poll sleep. The shared abort-aware sleep should wake
    // immediately and surface KashAbortedError instead of waiting for
    // the next iteration's top-of-loop check.
    setTimeout(() => controller.abort(), 5);
    await expect(
      pollUntil(fn, (v) => v.status === 'done', {
        timing: pollTiming('test.wait', { timeoutMs: 1_000, pollIntervalMs: 500 }),
        signal: controller.signal,
      })
    ).rejects.toBeInstanceOf(KashAbortedError);
  });

  it('aborted signal already set throws KashAbortedError before first call', async () => {
    const controller = new AbortController();
    controller.abort();
    const fn = vi.fn(async () => ({ status: 'pending' }));
    await expect(
      pollUntil(fn, (v) => v.status === 'done', {
        timing: pollTiming('test.wait', { timeoutMs: 1_000, pollIntervalMs: 5 }),
        signal: controller.signal,
      })
    ).rejects.toBeInstanceOf(KashAbortedError);
    expect(fn).not.toHaveBeenCalled();
  });
});

describe('pollTiming', () => {
  const refusal = (timing: { timeoutMs: number; pollIntervalMs: number }, min?: number) => {
    try {
      pollTiming('test.wait', timing, min);
    } catch (e) {
      return e;
    }
    return undefined;
  };

  // Each of these either never times out (NaN, Infinity) or polls without
  // pause: a timer runs NaN, Infinity and any delay over 2^31 - 1 ms after
  // about 1 ms.
  it.each([Number.NaN, Number.POSITIVE_INFINITY, -1])(
    'refuses a timeoutMs of %s, naming the field',
    (timeoutMs) => {
      const err = refusal({ timeoutMs, pollIntervalMs: 1_000 });
      expect(err).toBeInstanceOf(KashValidationError);
      expect((err as KashValidationError).code).toBe('SDK_VALIDATION');
      expect((err as KashValidationError).message).toContain('test.wait: timeoutMs');
      expect((err as KashValidationError).issues).toEqual([
        { path: 'timeoutMs', message: 'must be a finite number of 0 or more' },
      ]);
    }
  );

  it.each([0, -5, Number.NaN, Number.POSITIVE_INFINITY])(
    'refuses a pollIntervalMs of %s below the default floor of 1 ms',
    (pollIntervalMs) => {
      const err = refusal({ timeoutMs: 1_000, pollIntervalMs });
      expect(err).toBeInstanceOf(KashValidationError);
      expect((err as KashValidationError).issues).toEqual([
        { path: 'pollIntervalMs', message: 'must be at least 1' },
      ]);
    }
  );

  it('refuses a pollIntervalMs longer than a timer honours', () => {
    const err = refusal({ timeoutMs: 1_000, pollIntervalMs: 2_147_483_648 });
    expect(err).toBeInstanceOf(KashValidationError);
    expect((err as KashValidationError).issues).toEqual([
      { path: 'pollIntervalMs', message: 'must be at most 2147483647' },
    ]);
  });

  it('honours a caller floor', () => {
    const err = refusal({ timeoutMs: 1_000, pollIntervalMs: 249 }, 250);
    expect((err as KashValidationError).issues).toEqual([
      { path: 'pollIntervalMs', message: 'must be at least 250' },
    ]);
    expect(refusal({ timeoutMs: 1_000, pollIntervalMs: 250 }, 250)).toBeUndefined();
  });

  it('accepts the bounds: a zero timeout and the longest timer delay', () => {
    expect(pollTiming('test.wait', { timeoutMs: 0, pollIntervalMs: 2_147_483_647 })).toEqual({
      timeoutMs: 0,
      pollIntervalMs: 2_147_483_647,
    });
  });
});
