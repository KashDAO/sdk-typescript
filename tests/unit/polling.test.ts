import { describe, expect, it, vi } from 'vitest';

import { KashAbortedError, KashTimeoutError } from '../../src/errors.js';
import { pollUntil } from '../../src/internal/polling.js';

describe('pollUntil', () => {
  it('returns immediately when first call satisfies isDone', async () => {
    const fn = vi.fn().mockResolvedValue({ status: 'completed' });
    const result = await pollUntil(fn, (v) => v.status === 'completed', {
      timeoutMs: 1_000,
      pollIntervalMs: 50,
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
      timeoutMs: 1_000,
      pollIntervalMs: 1,
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
      timeoutMs: 1_000,
      pollIntervalMs: 1,
      onStatus,
    });
    expect(onStatus).toHaveBeenCalledTimes(2);
    expect(onStatus.mock.calls[0]![0]).toEqual({ status: 'pending' });
    expect(onStatus.mock.calls[1]![0]).toEqual({ status: 'done' });
  });

  it('throws KashTimeoutError when timeout elapses', async () => {
    const fn = vi.fn(async () => ({ status: 'pending' }));
    await expect(
      pollUntil(fn, (v) => v.status === 'done', { timeoutMs: 30, pollIntervalMs: 5 })
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
        timeoutMs: 1_000,
        pollIntervalMs: 5,
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
        timeoutMs: 1_000,
        pollIntervalMs: 500,
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
        timeoutMs: 1_000,
        pollIntervalMs: 5,
        signal: controller.signal,
      })
    ).rejects.toBeInstanceOf(KashAbortedError);
    expect(fn).not.toHaveBeenCalled();
  });
});
