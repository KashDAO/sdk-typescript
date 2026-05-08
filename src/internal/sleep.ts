/**
 * Abort-aware sleep used across the HTTP retry loop and the polling
 * helper. Resolves after `ms` elapses or rejects with
 * {@link KashAbortedError} when the optional `signal` is aborted —
 * whichever happens first. Lifting this into a shared module keeps
 * the abort semantics identical between retry backoff and inter-poll
 * waits, so consumers see the same error class regardless of where
 * the cancellation interrupted the SDK.
 */

import { KashAbortedError } from '../errors.js';

export async function sleepWithAbort(ms: number, signal: AbortSignal | undefined): Promise<void> {
  if (ms <= 0) {
    if (signal?.aborted) {
      throw new KashAbortedError('Aborted by caller.', {
        code: 'SDK_ABORTED',
        cause: signal.reason,
      });
    }
    return;
  }
  await new Promise<void>((resolve, reject) => {
    const timer = setTimeout(() => {
      cleanup();
      resolve();
    }, ms);
    const onAbort = (): void => {
      cleanup();
      reject(
        new KashAbortedError('Aborted by caller.', {
          code: 'SDK_ABORTED',
          cause: signal?.reason,
        })
      );
    };
    function cleanup(): void {
      clearTimeout(timer);
      signal?.removeEventListener('abort', onAbort);
    }
    if (signal) {
      if (signal.aborted) {
        onAbort();
        return;
      }
      signal.addEventListener('abort', onAbort);
    }
  });
}
