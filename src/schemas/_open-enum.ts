/**
 * Open enums: a response field whose known values are typed, but which still
 * accepts a value this SDK version has not heard of.
 *
 * A closed `z.enum` on a RESPONSE field makes every new server value a parse
 * failure in the customer's process: `constructEvent` throws inside their
 * webhook handler and a resource read throws `KashValidationError`, so adding
 * a value on the server would force every integrator onto a new SDK release.
 * An open enum keeps the known members in the TypeScript type (editors still
 * complete them, and `switch` cases on them type-check) while letting an
 * unknown string through unchanged, so a handler can log it or fall through
 * to a `default` branch.
 *
 * Request bodies stay closed: there a wrong value is the caller's bug, and it
 * should fail before the round trip.
 *
 * Deliberately CLOSED, and why:
 *   - Request values: `TradeSideSchema` (trade body side), `QuoteActionSchema`,
 *     the `ListMarketsParams` status and chain filters, every `.strict()` body.
 *   - Discriminators the SDK chose: a quote's `action` literal (the SDK asked
 *     for a buy or a sell; the other is a wrong answer, not a newer one), a
 *     webhook's `type` literal, and the per-type `status` literal of each
 *     webhook payload (a `trade.completed` whose status is not `completed`
 *     is a broken event).
 *   - Units: a quote's `units` literals (`atomic-6`, `wad-18`). A different
 *     unit would silently mis-scale every amount, so refusing it is the
 *     money-safe answer.
 *   - `publicChainIdSchema`: refusing internal surrogate chain ids is its
 *     purpose.
 */

import { z } from 'zod';

/**
 * A known member, or any other string. The `string & {}` arm stops TypeScript
 * from collapsing the union to plain `string`, so the known members stay
 * visible to autocompletion and narrowing.
 */
export type OpenEnum<T extends string> = T | (string & {});

/** A response schema over an {@link OpenEnum}, with its known members on `options`. */
export type OpenEnumSchema<T extends readonly [string, ...string[]]> = z.ZodType<
  OpenEnum<T[number]>,
  string
> & {
  /** The members this SDK version knows, in the order the server documents them. */
  readonly options: T;
};

/**
 * Build an open enum over `options`. Any non-empty string parses; the known
 * members are typed and listed on `.options`.
 */
export function openEnum<const T extends readonly [string, ...string[]]>(
  options: T
): OpenEnumSchema<T> {
  // A non-empty string is the whole runtime rule. The cast only narrows the
  // OUTPUT type from `string` to `OpenEnum<...>`, which every string inhabits.
  const schema = z.string().min(1) as unknown as z.ZodType<OpenEnum<T[number]>, string>;
  return Object.assign(schema, { options });
}
