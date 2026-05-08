import { describe, expect, it, vi } from 'vitest';

import { KashAbortedError } from '../../src/errors.js';
import { sleepWithAbort } from '../../src/internal/sleep.js';

describe('sleepWithAbort', () => {
  it('resolves after ms when no signal is supplied', async () => {
    const start = Date.now();
    await sleepWithAbort(20, undefined);
    expect(Date.now() - start).toBeGreaterThanOrEqual(15);
  });

  it('resolves immediately when ms <= 0 and no signal is supplied', async () => {
    const start = Date.now();
    await sleepWithAbort(0, undefined);
    await sleepWithAbort(-1, undefined);
    expect(Date.now() - start).toBeLessThan(10);
  });

  it('throws KashAbortedError when ms <= 0 and signal is already aborted', async () => {
    const controller = new AbortController();
    controller.abort();
    await expect(sleepWithAbort(0, controller.signal)).rejects.toBeInstanceOf(KashAbortedError);
    await expect(sleepWithAbort(-1, controller.signal)).rejects.toBeInstanceOf(KashAbortedError);
  });

  it('returns when ms <= 0 and signal is supplied but not aborted', async () => {
    const controller = new AbortController();
    await expect(sleepWithAbort(0, controller.signal)).resolves.toBeUndefined();
  });

  it('throws KashAbortedError when signal is already aborted before sleep starts', async () => {
    const controller = new AbortController();
    controller.abort();
    await expect(sleepWithAbort(50, controller.signal)).rejects.toBeInstanceOf(KashAbortedError);
  });

  it('throws KashAbortedError when signal aborts during sleep', async () => {
    const controller = new AbortController();
    setTimeout(() => controller.abort(), 5);
    const start = Date.now();
    await expect(sleepWithAbort(500, controller.signal)).rejects.toBeInstanceOf(KashAbortedError);
    // Wakes promptly — well under the requested 500ms.
    expect(Date.now() - start).toBeLessThan(100);
  });

  it('preserves abort reason as KashAbortedError.cause', async () => {
    const reason = new Error('user cancelled');
    const controller = new AbortController();
    controller.abort(reason);
    try {
      await sleepWithAbort(50, controller.signal);
      expect.fail('expected throw');
    } catch (err) {
      expect(err).toBeInstanceOf(KashAbortedError);
      expect((err as KashAbortedError).cause).toBe(reason);
    }
  });

  it('removes the abort listener after the timer fires (no leak)', async () => {
    const controller = new AbortController();
    const removeSpy = vi.spyOn(controller.signal, 'removeEventListener');
    await sleepWithAbort(10, controller.signal);
    expect(removeSpy).toHaveBeenCalledWith('abort', expect.any(Function));
  });

  it('removes the abort listener after the signal aborts (no leak)', async () => {
    const controller = new AbortController();
    const removeSpy = vi.spyOn(controller.signal, 'removeEventListener');
    setTimeout(() => controller.abort(), 5);
    await expect(sleepWithAbort(500, controller.signal)).rejects.toBeInstanceOf(KashAbortedError);
    expect(removeSpy).toHaveBeenCalledWith('abort', expect.any(Function));
  });
});
