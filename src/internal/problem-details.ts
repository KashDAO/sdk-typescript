/**
 * The error body of a non-2xx response, PARSED rather than cast to
 * {@link ProblemDetailsLike}.
 *
 * Tolerant by design, because the body may come from an upstream proxy rather
 * than the API: a standard member of the wrong type reads as absent (so a
 * numeric `code` cannot reach `startsWith`), RFC 7807 extension members pass
 * through unchanged, and a body that is not an object at all yields `{}` so the
 * status alone still selects the error subclass.
 *
 * @module internal/problem-details
 */

import { z } from 'zod';

import type { ProblemDetailsLike } from '../errors.js';

/**
 * A member kept only when it has its standard type; anything else reads as
 * absent. `.optional()` is what lets the key be missing: under zod 4 a key
 * whose schema ends in a transform is otherwise required.
 */
const optionalString = z
  .unknown()
  .transform((value) => (typeof value === 'string' ? value : undefined))
  .optional();

const ProblemDetailsBodySchema = z.looseObject({
  type: optionalString,
  title: optionalString,
  status: z
    .unknown()
    .transform((value) => (typeof value === 'number' ? value : undefined))
    .optional(),
  detail: optionalString,
  instance: optionalString,
  code: optionalString,
  requestId: optionalString,
});

/** Parse a decoded JSON error body; anything that is not an object reads as `{}`. */
export function parseProblemDetails(body: unknown): ProblemDetailsLike {
  const parsed = ProblemDetailsBodySchema.safeParse(body);
  return parsed.success ? parsed.data : {};
}
