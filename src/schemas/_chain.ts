/**
 * Chain identity at the SDK boundary.
 *
 * Numeric `chainId` fields carry real EVM chain ids only. Ids in the reserved
 * range below have no registry entry and cannot be resolved by an RPC or a
 * block explorer, so the SDK refuses them rather than surfacing them. Non-EVM
 * chains are identified by `chainRef` instead.
 */

import { z } from 'zod';

/**
 * Bounds (inclusive) of the reserved numeric range that is never a valid
 * public chain id.
 */
export const SURROGATE_CHAIN_ID_RANGE = { min: 9_000_000, max: 9_999_999 } as const;

/** Whether a numeric chain id falls in the reserved range. */
export function isSurrogateChainId(chainId: number): boolean {
  return chainId >= SURROGATE_CHAIN_ID_RANGE.min && chainId <= SURROGATE_CHAIN_ID_RANGE.max;
}

/**
 * A chain id that is safe to publish.
 *
 * Accepts real EVM chain ids and refuses ids in the reserved range. Use this in
 * place of `z.number().int().positive()` for every `chainId` the SDK surfaces.
 */
export const publicChainIdSchema = z
  .number()
  .int()
  .positive()
  .refine((id) => !isSurrogateChainId(id), {
    message:
      'Unsupported chain id. Numeric chain ids are EVM only; use chainRef for non-EVM chains.',
  });
