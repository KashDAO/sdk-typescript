/**
 * `quotes` sub-client — wraps `GET /v1/markets/{id}/quote`.
 *
 * Requires API key with `markets:quote` scope (granted by default on every
 * tier; split from `markets:read` because quotes are RPC-heavy and customers
 * may want to throttle quote traffic independently). The SDK exposes two
 * methods that map 1:1 to the AMM's `quoteBuyExactAssetsIn` and
 * `quoteSellExactTokensIn` view functions:
 *
 *   - `quotes.buy({ marketId, outcomeIndex, amountUsdcAtomic })`
 *   - `quotes.sell({ marketId, outcomeIndex, tokensInWad })`
 *
 * The two share the same wire shape but differ in input units —
 * `buy` takes USDC in atomic-6, `sell` takes outcome tokens in WAD-18.
 * Splitting them at the SDK level avoids the easy-to-make mistake of
 * passing the wrong unit to the wrong action.
 *
 * The result is the {@link Quote} — a flat object with all the
 * contract return values plus the embedded market summary.
 */

import { KashValidationError } from '../errors.js';
import {
  QuoteResponseSchema,
  type Quote,
  type QuoteBuyDetail,
  type QuoteMarketSummary,
  type QuoteSellDetail,
} from '../schemas/quote.js';

import type { KashHttpClient, RequestOverrides } from '../internal/http.js';

export type BuyQuoteParams = {
  /** Market UUID. */
  readonly marketId: string;
  /** Zero-based outcome index. Must be `< market.outcomeCount`. */
  readonly outcomeIndex: number;
  /**
   * USDC to spend, **in atomic units** (6 decimals). For 100 USDC
   * pass `'100000000'`. Use a string to preserve precision; the SDK
   * also accepts `bigint` and stringifies it for you.
   */
  readonly amountUsdcAtomic: string | bigint;
};

export type SellQuoteParams = {
  /** Market UUID. */
  readonly marketId: string;
  /** Zero-based outcome index. */
  readonly outcomeIndex: number;
  /**
   * Outcome tokens to sell, **in WAD** (18 decimals). For 1 token
   * pass `'1000000000000000000'`.
   */
  readonly tokensInWad: string | bigint;
};

export class QuotesClient {
  constructor(private readonly http: KashHttpClient) {}

  /**
   * Quote a buy of `amountUsdcAtomic` USDC into outcome `outcomeIndex`.
   *
   * @example
   * ```ts
   * // Buy quote for 100 USDC of outcome 0:
   * const quote = await kash.quotes.buy({
   *   marketId: 'market-uuid',
   *   outcomeIndex: 0,
   *   amountUsdcAtomic: '100000000', // 100 USDC * 1e6
   * });
   * console.log(`tokens out: ${quote.tokensOut} (WAD)`);
   * console.log(`implied prob: ${quote.impliedProbability}`);
   * ```
   */
  async buy(params: BuyQuoteParams, opts: RequestOverrides = {}): Promise<Quote & QuoteBuyDetail> {
    const result = await this.http.request({
      path: `/markets/${encodeURIComponent(params.marketId)}/quote`,
      method: 'GET',
      schema: QuoteResponseSchema,
      query: {
        action: 'buy',
        outcomeIndex: params.outcomeIndex,
        amount: stringifyAmount(params.amountUsdcAtomic),
      },
      ...opts,
    });
    return attachMarket(assertBuy(result.quote), result.market);
  }

  /**
   * Quote a sell of `tokensInWad` outcome tokens.
   *
   * @example
   * ```ts
   * // Sell quote for 1 outcome-0 token:
   * const quote = await kash.quotes.sell({
   *   marketId: 'market-uuid',
   *   outcomeIndex: 0,
   *   tokensInWad: '1000000000000000000',
   * });
   * console.log(`USDC out (atomic): ${quote.usdcOut}`);
   * ```
   */
  async sell(
    params: SellQuoteParams,
    opts: RequestOverrides = {}
  ): Promise<Quote & QuoteSellDetail> {
    const result = await this.http.request({
      path: `/markets/${encodeURIComponent(params.marketId)}/quote`,
      method: 'GET',
      schema: QuoteResponseSchema,
      query: {
        action: 'sell',
        outcomeIndex: params.outcomeIndex,
        amount: stringifyAmount(params.tokensInWad),
      },
      ...opts,
    });
    return attachMarket(assertSell(result.quote), result.market);
  }
}

function stringifyAmount(amount: string | bigint): string {
  if (typeof amount === 'bigint') return amount.toString();
  return amount;
}

function attachMarket<T extends object>(
  detail: T,
  market: QuoteMarketSummary
): T & { market: QuoteMarketSummary } {
  return { ...detail, market };
}

/**
 * Type guards. The discriminated-union schema already narrows at parse
 * time, but these guards let the SDK preserve the call-site type so a
 * `quotes.buy()` caller gets a `QuoteBuyDetail` (not the union) without
 * an unsafe cast.
 *
 * If the server somehow returned the wrong shape, we throw — this is
 * a 5xx-class server bug, not something the consumer can recover from.
 */
function assertBuy(detail: { action: string }): QuoteBuyDetail {
  if (detail.action !== 'buy') {
    // Server-side response-shape violation. KashValidationError keeps
    // the SDK's "every throw is a typed KashError" contract.
    throw new KashValidationError(
      `@kashdao/sdk: requested 'buy' quote but server returned action='${detail.action}'.`,
      { code: 'SDK_QUOTE_ACTION_MISMATCH' }
    );
  }
  return detail as QuoteBuyDetail;
}

function assertSell(detail: { action: string }): QuoteSellDetail {
  if (detail.action !== 'sell') {
    throw new KashValidationError(
      `@kashdao/sdk: requested 'sell' quote but server returned action='${detail.action}'.`,
      { code: 'SDK_QUOTE_ACTION_MISMATCH' }
    );
  }
  return detail as QuoteSellDetail;
}
