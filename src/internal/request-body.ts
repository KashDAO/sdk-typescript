/**
 * Client-side request-body validation, shared by every sub-client that sends
 * a body. Each body schema mirrors the server's strict one, so a bad field
 * fails at the call site rather than after a `400` round trip.
 */

import { KashValidationError } from '../errors.js';

import { joinIssuePath } from './zod-issues.js';

import type { z } from 'zod';

/**
 * Parse `body` with `schema`, or throw `KashValidationError` (code
 * `VALIDATION_FAILED`, the code the server would answer) whose message leads
 * with `label` and the first issue, and whose `issues` carries them all.
 */
export function parseRequestBody<S extends z.ZodType>(
  schema: S,
  body: unknown,
  label: string
): z.output<S> {
  const parsed = schema.safeParse(body);
  if (parsed.success) return parsed.data as z.output<S>;
  const issues = parsed.error.issues.map((i) => ({
    path: joinIssuePath(i.path),
    message: i.message,
    code: i.code,
  }));
  const lead = issues[0];
  const summary = lead ? `${lead.path || '(root)'}: ${lead.message}` : 'invalid request body';
  throw new KashValidationError(`${label}: ${summary}`, { code: 'VALIDATION_FAILED', issues });
}

/**
 * Throw `KashValidationError` (code `SDK_VALIDATION`) unless `key` is a
 * non-empty string. For the calls whose idempotency key is required because
 * money moves: without one the SDK would generate a key per CALL, and a retry
 * of the call would act twice.
 */
export function requireIdempotencyKey(key: unknown, label: string): asserts key is string {
  if (typeof key !== 'string' || key.length === 0) {
    throw new KashValidationError(
      `${label}: idempotencyKey is required. Use one key per operation and reuse it for ` +
        'every retry, so a retry cannot act twice.',
      { code: 'SDK_VALIDATION', issues: [{ path: 'idempotencyKey', message: 'required' }] }
    );
  }
}
