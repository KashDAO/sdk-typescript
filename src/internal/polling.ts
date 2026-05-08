import { KashAbortedError, KashTimeoutError } from '../errors.js';

import { sleepWithAbort } from './sleep.js';

/**
 * Generic poll helper. Used by `trades.waitForCompletion` (and any
 * future "wait for terminal status" sub-client method). Pulled out so
 * the polling semantics — timeout, cadence, abort — are tested in one
 * place rather than per-call site.
 *
 *   - Calls `fn()` immediately, before the first `pollIntervalMs`.
 *   - Returns the latest value once `isDone(value)` is true.
 *   - Throws `KashTimeoutError` once `timeoutMs` elapses without
 *     reaching a terminal value.
 *   - Throws `KashAbortedError` when the caller aborts via the
 *     optional `signal` — including during the inter-poll sleep, so
 *     aborts wake the loop immediately instead of waiting for the
 *     next iteration's top-of-loop check.
 */
export type PollOptions<T> = {
  readonly timeoutMs: number;
  readonly pollIntervalMs: number;
  readonly onStatus?: (value: T) => void;
  readonly signal?: AbortSignal;
};

export async function pollUntil<T>(
  fn: () => Promise<T>,
  isDone: (value: T) => boolean,
  opts: PollOptions<T>
): Promise<T> {
  const start = Date.now();
  // First fetch fires immediately so callers don't pay one whole
  // interval before learning the operation already terminated.
  while (true) {
    if (opts.signal?.aborted) {
      throw new KashAbortedError('Polling was aborted by the caller.', {
        code: 'SDK_ABORTED',
        cause: opts.signal.reason,
      });
    }
    const value = await fn();
    opts.onStatus?.(value);
    if (isDone(value)) return value;
    const elapsed = Date.now() - start;
    if (elapsed >= opts.timeoutMs) {
      throw new KashTimeoutError(
        `Polling timed out after ${opts.timeoutMs}ms without a terminal value.`,
        { code: 'SDK_POLL_TIMEOUT' }
      );
    }
    // Don't oversleep past the deadline — clamp the wait so the
    // timeout error fires close to the requested timeoutMs. The sleep
    // is abort-aware (shared with the HTTP retry loop) so cancellation
    // wakes immediately and surfaces as KashAbortedError.
    const remaining = opts.timeoutMs - elapsed;
    await sleepWithAbort(Math.min(opts.pollIntervalMs, remaining), opts.signal);
  }
}
