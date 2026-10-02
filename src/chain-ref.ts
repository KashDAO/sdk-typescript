/**
 * Typed chain references.
 *
 * From API version `2026-08-19` every market, quote, trade and trade webhook
 * names its chain with a `chainRef` string — `"solana:mainnet-beta"`,
 * `"evm:8453"`. The wire field stays a plain `string` in the response schemas,
 * so a chain the server adds later never makes a response fail to parse. These
 * helpers are the opt-in typed view of that string.
 *
 * Two families, and the namespace says which:
 *
 *   - `solana:<cluster>` — `mainnet-beta` (Kash's canonical chain since
 *     2026-10-01), `devnet` (staging), `localnet`.
 *   - `evm:<chainId>` — the form the API sends. `eip155:<chainId>`, the CAIP-2
 *     namespace for EVM chains, is accepted as an alias on input and parses to
 *     the same reference.
 *
 * @example
 * ```ts
 * import { formatChainRef, parseChainRef } from '@kashdao/sdk';
 *
 * const market = await kash.markets.get(id);
 * const chain = market.chainRef ? parseChainRef(market.chainRef) : undefined;
 * if (chain?.type === 'solana') console.log('cluster', chain.cluster);
 *
 * formatChainRef({ type: 'evm', chainId: 8453 }); // 'evm:8453'
 * ```
 */

import { KashValidationError } from './errors.js';
import { isSurrogateChainId } from './schemas/_chain.js';

/**
 * Solana clusters a `solana:` reference may name. Spelled exactly as Solana
 * tooling spells them — `mainnet-beta`, not `mainnet`.
 */
export const SOLANA_CLUSTERS = ['mainnet-beta', 'devnet', 'localnet'] as const;

export type SolanaCluster = (typeof SOLANA_CLUSTERS)[number];

/** A parsed chain reference. Narrow on `type`. */
export type ChainRef =
  | { readonly type: 'evm'; readonly chainId: number }
  | { readonly type: 'solana'; readonly cluster: SolanaCluster };

/** Namespaces that parse to an EVM reference. `evm` is the wire form. */
const EVM_NAMESPACES: ReadonlySet<string> = new Set(['evm', 'eip155']);

/**
 * Digits only, no leading zero. `Number('8453 ')` and `Number('0x2105')` both
 * succeed, and a chain id spelled with whitespace or hex is not one the caller
 * meant to name.
 */
const DECIMAL_CHAIN_ID = /^[1-9]\d*$/;

/**
 * Parse a chain reference, or return `undefined` when the string is not one.
 * Use this on values you do not control; use {@link parseChainRef} where a
 * malformed value is a caller error.
 */
export function tryParseChainRef(value: string): ChainRef | undefined {
  const separator = value.indexOf(':');
  if (separator === -1) return undefined;
  const namespace = value.slice(0, separator);
  const reference = value.slice(separator + 1);

  if (EVM_NAMESPACES.has(namespace)) {
    if (!DECIMAL_CHAIN_ID.test(reference)) return undefined;
    const chainId = Number(reference);
    // A surrogate id is Kash's internal encoding of a Solana cluster, not an
    // EVM chain; `evm:9000001` must not parse as a real chain.
    if (!Number.isSafeInteger(chainId) || isSurrogateChainId(chainId)) return undefined;
    return { type: 'evm', chainId };
  }

  if (namespace === 'solana') {
    const cluster = SOLANA_CLUSTERS.find((c) => c === reference);
    return cluster === undefined ? undefined : { type: 'solana', cluster };
  }

  return undefined;
}

/**
 * Parse a chain reference.
 *
 * @throws {KashValidationError} `VALIDATION_FAILED` when `value` is not
 *   `solana:<cluster>`, `evm:<chainId>` or `eip155:<chainId>`.
 */
export function parseChainRef(value: string): ChainRef {
  const parsed = tryParseChainRef(value);
  if (parsed === undefined) {
    throw new KashValidationError(
      `Invalid chain reference "${value}": expected solana:<${SOLANA_CLUSTERS.join('|')}>, evm:<chainId> or eip155:<chainId>`,
      {
        code: 'VALIDATION_FAILED',
        issues: [{ path: 'chainRef', message: 'not a chain reference', code: 'custom' }],
      }
    );
  }
  return parsed;
}

/** Render a chain reference in the form the API sends (`evm:8453`, `solana:mainnet-beta`). */
export function formatChainRef(ref: ChainRef): string {
  return ref.type === 'evm' ? `evm:${ref.chainId}` : `solana:${ref.cluster}`;
}
