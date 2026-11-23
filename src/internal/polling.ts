import { KashAbortedError, KashTimeoutError, KashValidationError } from '../errors.js';

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
  readonly timing: PollTiming;
  readonly onStatus?: (value: T) => void;
  readonly signal?: AbortSignal;
};

/**
 * A wait's timeout and cadence, checked by `pollTiming`. The brand means
 * `pollUntil` can only be handed values that went through the check, so no
 * caller can reach the loop with an interval that spins it.
 */
export type PollTiming = {
  readonly timeoutMs: number;
  readonly pollIntervalMs: number;
  readonly [checked]: true;
};

declare const checked: unique symbol;

/**
 * The longest delay a timer honours. Node and browsers run any longer delay
 * (and `Infinity`) after about 1 ms, so a larger interval would spin the loop.
 */
const MAX_TIMER_DELAY_MS = 2_147_483_647;

/**
 * Check a wait's timing before its first request. `timeoutMs` must be a
 * finite number of zero or more; `pollIntervalMs` a finite number from
 * `minPollIntervalMs` (default 1) to the longest delay a timer honours.
 * Anything else, NaN included, throws `KashValidationError`
 * (`SDK_VALIDATION`) naming the field, because each value outside that range
 * either never times out or polls without pause.
 */
export function pollTiming(
  operation: string,
  timing: { readonly timeoutMs: number; readonly pollIntervalMs: number },
  minPollIntervalMs = 1
): PollTiming {
  const { timeoutMs, pollIntervalMs } = timing;
  if (!Number.isFinite(timeoutMs) || timeoutMs < 0) {
    throw invalidTiming(operation, 'timeoutMs', 'must be a finite number of 0 or more', timeoutMs);
  }
  if (!Number.isFinite(pollIntervalMs) || pollIntervalMs < minPollIntervalMs) {
    throw invalidTiming(
      operation,
      'pollIntervalMs',
      `must be at least ${minPollIntervalMs}`,
      pollIntervalMs
    );
  }
  if (pollIntervalMs > MAX_TIMER_DELAY_MS) {
    throw invalidTiming(
      operation,
      'pollIntervalMs',
      `must be at most ${MAX_TIMER_DELAY_MS}`,
      pollIntervalMs
    );
  }
  return { timeoutMs, pollIntervalMs } as PollTiming;
}

function invalidTiming(
  operation: string,
  path: 'timeoutMs' | 'pollIntervalMs',
  rule: string,
  value: number
): KashValidationError {
  return new KashValidationError(`${operation}: ${path} ${rule} ms (got ${value}).`, {
    code: 'SDK_VALIDATION',
    issues: [{ path, message: rule }],
  });
}

export function pollUntil<T, D extends T>(
  fn: () => Promise<T>,
  isDone: (value: T) => value is D,
  opts: PollOptions<T>
): Promise<D>;
export function pollUntil<T>(
  fn: () => Promise<T>,
  isDone: (value: T) => boolean,
  opts: PollOptions<T>
): Promise<T>;
export async function pollUntil<T>(
  fn: () => Promise<T>,
  isDone: (value: T) => boolean,
  opts: PollOptions<T>
): Promise<T> {
  const { timeoutMs, pollIntervalMs } = opts.timing;
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
    if (elapsed >= timeoutMs) {
      throw new KashTimeoutError(
        `Polling timed out after ${timeoutMs}ms without a terminal value.`,
        { code: 'SDK_POLL_TIMEOUT' }
      );
    }
    // Don't oversleep past the deadline — clamp the wait so the
    // timeout error fires close to the requested timeoutMs. The sleep
    // is abort-aware (shared with the HTTP retry loop) so cancellation
    // wakes immediately and surfaces as KashAbortedError.
    const remaining = timeoutMs - elapsed;
    await sleepWithAbort(Math.min(pollIntervalMs, remaining), opts.signal);
  }
}
