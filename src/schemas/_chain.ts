/**
 * Chain identity at the SDK boundary.
 *
 * The mirror of `apps/public-api/src/schemas/_chain.ts`, which states the rule
 * this file enforces: use it "for EVERY `chainId` that crosses the public
 * boundary — response schemas, webhook payloads and SDK output alike". The
 * SDK is that third surface, and until this file existed it was the one the
 * rule named and nothing applied it to.
 *
 * Solana clusters are stored internally as surrogate numeric chain ids
 * (9000001/2/3). They are invented, they have no registry entry, and no
 * external consumer can resolve them — a caller receiving `"chainId": 9000002`
 * would reasonably pass it to an RPC or a block explorer and get nothing.
 * `z.number().int().positive()` accepts them silently, which is exactly how
 * `market`, `quote` and `trace` were written.
 *
 * ── WHY THE RANGE IS RESTATED HERE ──
 *
 * `@kashdao/sdk` has exactly ONE runtime dependency, `zod`. Importing
 * `@kashdao/constants` for `isSurrogateChainId` would change what a customer
 * installs, which is not a trade this package gets to make on their behalf.
 *
 * So the bound is restated — once, here, never at a call site — and pinned to
 * the source of truth by `tests/architecture/public-api-surrogate-leak.test.ts`,
 * which fails if `SOLANA_SURROGATE_CHAIN_ID` ever moves outside it. A duplicate
 * a test proves equal is a different thing from a duplicate nobody checks; the
 * packaging constraint forces the first, and the guard is what keeps it from
 * decaying into the second.
 *
 * A RANGE rather than three literals, deliberately: a fourth cluster added to
 * `@kashdao/constants` would be caught by the drift guard either way, but a
 * range means the SDK refuses it correctly in the window before anyone reruns
 * the guard.
 *
 * @see packages/constants/src/chain-ref.ts — the surrogate definition
 * @see tests/architecture/public-api-surrogate-leak.test.ts — the drift guard
 */

import { z } from 'zod';

/**
 * Bounds of the private surrogate range reserved for non-EVM clusters.
 *
 * Inclusive. Kept in sync with `SOLANA_SURROGATE_CHAIN_ID` by the drift guard
 * — do not edit one without the other.
 */
export const SURROGATE_CHAIN_ID_RANGE = { min: 9_000_000, max: 9_999_999 } as const;

/** Whether a numeric chain id falls in the internal surrogate range. */
export function isSurrogateChainId(chainId: number): boolean {
  return chainId >= SURROGATE_CHAIN_ID_RANGE.min && chainId <= SURROGATE_CHAIN_ID_RANGE.max;
}

/**
 * A chain id that is safe to publish.
 *
 * Accepts real EVM chain ids and refuses the internal surrogates. Use this in
 * place of `z.number().int().positive()` for every `chainId` the SDK surfaces.
 */
export const publicChainIdSchema = z
  .number()
  .int()
  .positive()
  .refine((id) => !isSurrogateChainId(id), {
    message:
      'Internal surrogate chain id must not be published. API v1 serves EVM markets only; use v2 chainRef for non-EVM chains.',
  });
