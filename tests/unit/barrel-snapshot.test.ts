/**
 * Public-surface snapshot test.
 *
 * Imports the entire `@kashdao/sdk` barrel as a namespace and asserts
 * the set of exported names against a frozen, alphabetised list. The
 * goal is to catch accidental removals of public symbols (which would
 * silently break downstream consumers who pin against `0.x`) BEFORE
 * a release.
 *
 * ### How to react when this test fails
 *
 * - **You added a new export deliberately** — append the name(s) to
 *   `EXPECTED_EXPORTS`, alphabetise, and add a CHANGELOG entry under
 *   `### Added`.
 * - **You removed an export deliberately** — remove the name from
 *   `EXPECTED_EXPORTS`, add a CHANGELOG entry under `### Removed` (or
 *   `### Changed` for a rename), and bump the minor version (or major
 *   on / after 1.0).
 * - **The diff is unexpected** — investigate; you almost certainly
 *   broke a consumer.
 *
 * The list lives here (rather than auto-derived) so the diff in code
 * review tells reviewers exactly what changed about the public surface.
 */

import { describe, expect, it } from 'vitest';

import * as Sdk from '../../src/index.js';
import * as SdkPartner from '../../src/partner.js';
import * as SdkSchemas from '../../src/schemas/index.js';
import * as SdkWebhooks from '../../src/webhooks.js';

/**
 * Source of truth for the exported public surface of `@kashdao/sdk`.
 * Alphabetised, includes both runtime values and TypeScript types
 * (TS types disappear at runtime, so this list reflects what
 * `Object.keys(Sdk)` shows — value-only).
 */
const EXPECTED_VALUE_EXPORTS = [
  'API_KEY_SHAPE',
  'AccountClient',
  'KASH_ERROR_CODE',
  'KashAbortedError',
  'KashAuthenticationError',
  'KashAuthorizationError',
  'KashClient',
  'KashConfigurationError',
  'KashConflictError',
  'KashError',
  'KashMaintenanceError',
  'KashNetworkError',
  'KashNotFoundError',
  'KashRateLimitError',
  'KashServerError',
  'KashTimeoutError',
  'KashValidationError',
  'KashWebhookSignatureError',
  'MarketsClient',
  'PRODUCTION_BASE_URL',
  'Page',
  'PortfolioClient',
  'QuotesClient',
  'RedemptionsClient',
  'SDK_API_VERSION',
  'SDK_VERSION',
  'SOLANA_CLUSTERS',
  'STAGING_BASE_URL',
  'TERMINAL_TRADE_STATUSES',
  'TracesClient',
  'TradesClient',
  'USER_AGENT',
  'WATCH_POSITIONS_DEFAULTS',
  'WebhooksClient',
  'classifyHttpError',
  'formatChainRef',
  'inferBaseUrlFromApiKey',
  'isAwaitingConfirmation',
  'isCompletedTrade',
  'isFailedTrade',
  'isPendingTrade',
  'isRejectedTrade',
  'isTerminalTrade',
  'isUnknownWebhookEvent',
  'parseChainRef',
  'tryParseChainRef',
] as const;

describe('public barrel surface', () => {
  it('exports exactly the expected set of value names (no accidental additions or removals)', () => {
    const actual = Object.keys(Sdk).sort();
    const expected = [...EXPECTED_VALUE_EXPORTS].sort();
    expect(actual).toEqual(expected);
  });

  it('every expected export resolves to a defined value at runtime', () => {
    for (const name of EXPECTED_VALUE_EXPORTS) {
      // Bracket access to defeat the type-side checking — we want a
      // runtime presence assertion regardless of how the symbol is typed.
      const val = (Sdk as unknown as Record<string, unknown>)[name];
      expect(val, `missing export: ${name}`).toBeDefined();
    }
  });

  it('exports are alphabetised in the snapshot list (so diffs read cleanly)', () => {
    const sorted = [...EXPECTED_VALUE_EXPORTS].sort();
    expect(EXPECTED_VALUE_EXPORTS).toEqual(sorted);
  });
});

/**
 * `@kashdao/sdk/webhooks`: the partner payload schemas and `trade.rejected`'s.
 * Same rules as the list above.
 */
const EXPECTED_WEBHOOKS_VALUE_EXPORTS = [
  'AccountActivePayloadSchema',
  'AccountDestinationChangedPayloadSchema',
  'AccountProvisioningFailedPayloadSchema',
  'AccountReleasedPayloadSchema',
  'PartnerAccountFailureReasonSchema',
  'PartnerDestinationNetworkSchema',
  'PartnerDestinationSchema',
  'PayoutCompletedPayloadSchema',
  'TradeRejectedPayloadSchema',
  'WithdrawalCompletedPayloadSchema',
  'WithdrawalFailedPayloadSchema',
  'WithdrawalFailedStatusSchema',
  'WithdrawalFailureCodeSchema',
  'WithdrawalSubmittedPayloadSchema',
];

describe('webhooks subpath surface', () => {
  it('exports exactly the expected set of value names', () => {
    expect(Object.keys(SdkWebhooks).sort()).toEqual([...EXPECTED_WEBHOOKS_VALUE_EXPORTS].sort());
  });

  it('every expected export resolves to a defined value at runtime', () => {
    for (const name of EXPECTED_WEBHOOKS_VALUE_EXPORTS) {
      expect((SdkWebhooks as unknown as Record<string, unknown>)[name]).toBeDefined();
    }
  });

  it('none of them is also served from the root entry', () => {
    const root = new Set(Object.keys(Sdk));
    expect(EXPECTED_WEBHOOKS_VALUE_EXPORTS.filter((name) => root.has(name))).toEqual([]);
  });

  it('each is the same object `@kashdao/sdk/schemas` exports', () => {
    for (const name of EXPECTED_WEBHOOKS_VALUE_EXPORTS) {
      expect((SdkWebhooks as Record<string, unknown>)[name]).toBe(
        (SdkSchemas as Record<string, unknown>)[name]
      );
    }
  });

  it('the snapshot list is alphabetised', () => {
    expect([...EXPECTED_WEBHOOKS_VALUE_EXPORTS]).toEqual(
      [...EXPECTED_WEBHOOKS_VALUE_EXPORTS].sort()
    );
  });
});

/**
 * `@kashdao/sdk/schemas`: every Zod schema, and the only entry the root's
 * schemas are served from (0.4.0 moved them, keeping the root within the
 * public-surface cap).
 */
const EXPECTED_SCHEMAS_VALUE_EXPORTS = [
  'AccountActivePayloadSchema',
  'AccountDestinationChangedPayloadSchema',
  'AccountProvisioningFailedPayloadSchema',
  'AccountReleasedPayloadSchema',
  'AccountUsageResponseSchema',
  'AccountUsageSchema',
  'AmbassadorTokenSchema',
  'BalanceResourceSchema',
  'ClientRequestIdSchema',
  'ConfirmTradeBodySchema',
  'ConfirmTradeResponseSchema',
  'CreatePartnerAccountBodySchema',
  'CreatePartnerWithdrawalBodySchema',
  'CreatePartnerWithdrawalResponseSchema',
  'CreateRedemptionBodySchema',
  'CreateRedemptionResponseSchema',
  'CreateTradeAcceptedResponseSchema',
  'CreateTradeBodySchema',
  'CreateTradeCreatedResponseSchema',
  'CreateTradeResponseSchema',
  'GetBalanceResponseSchema',
  'GetMarketResponseSchema',
  'GetPartnerAccountResponseSchema',
  'GetPartnerWithdrawalResponseSchema',
  'GetTraceResponseSchema',
  'GetTradeResponseSchema',
  'ListMarketsResponseSchema',
  'ListPartnerAccountsResponseSchema',
  'ListPartnerWithdrawalsResponseSchema',
  'ListPredictionsResponseSchema',
  'ListTradesResponseSchema',
  'ListWebhookEventsResponseSchema',
  'MarketNotTradeableReasonSchema',
  'MarketOutcomeSchema',
  'MarketResolutionStateSchema',
  'MarketResourceSchema',
  'MarketStatusSchema',
  'MetaSchema',
  'PaginationSchema',
  'PartnerAccountFailureReasonSchema',
  'PartnerAccountResourceSchema',
  'PartnerAccountStatusSchema',
  'PartnerDestinationInputSchema',
  'PartnerDestinationNetworkSchema',
  'PartnerDestinationSchema',
  'PartnerExternalIdSchema',
  'PartnerWithdrawalQuoteResponseSchema',
  'PartnerWithdrawalQuoteSchema',
  'PartnerWithdrawalResourceSchema',
  'PartnerWithdrawalStatusSchema',
  'PayoutCompletedPayloadSchema',
  'PortfolioSummaryResponseSchema',
  'PortfolioSummarySchema',
  'PositionResourceSchema',
  'PositionsResponseSchema',
  'PredictionResourceSchema',
  'ProblemDetailsSchema',
  'QuoteActionSchema',
  'QuoteBuyDetailSchema',
  'QuoteDetailSchema',
  'QuoteMarketSummarySchema',
  'QuoteResponseSchema',
  'QuoteSellDetailSchema',
  'RedeliverWebhookEventSchema',
  'RedeliverWebhookResponseSchema',
  'RedemptionKindSchema',
  'RedemptionResourceSchema',
  'RotateWebhookSecretResponseSchema',
  'TraceEventDataSchema',
  'TraceEventSchema',
  'TraceResourceSchema',
  'TraceRetentionSchema',
  'TradeCompletedPayloadSchema',
  'TradeConfirmationRequiredPayloadSchema',
  'TradeFailedPayloadSchema',
  'TradeMetadataSchema',
  'TradeRejectedPayloadSchema',
  'TradeResourceSchema',
  'TradeSideSchema',
  'TradeStatusSchema',
  'UpdatePartnerAccountBodySchema',
  'UsdcAmountSchema',
  'UsdcAtomicSchema',
  'WebhookEventResourceSchema',
  'WebhookEventSchema',
  'WithdrawalAmountAtomicSchema',
  'WithdrawalCompletedPayloadSchema',
  'WithdrawalFailedPayloadSchema',
  'WithdrawalFailedStatusSchema',
  'WithdrawalFailureCodeSchema',
  'WithdrawalSubmittedPayloadSchema',
  'WritePartnerAccountResponseSchema',
];

describe('schemas subpath surface', () => {
  it('exports exactly the expected set of value names, every one a schema', () => {
    expect(Object.keys(SdkSchemas).sort()).toEqual([...EXPECTED_SCHEMAS_VALUE_EXPORTS].sort());
    for (const [name, value] of Object.entries(SdkSchemas)) {
      expect(typeof (value as { safeParse?: unknown }).safeParse, name).toBe('function');
    }
  });

  it('the root entry exports no schema', () => {
    const rootSchemas = Object.entries(Sdk).filter(
      ([, value]) => typeof (value as { safeParse?: unknown } | null)?.safeParse === 'function'
    );
    expect(rootSchemas.map(([name]) => name)).toEqual([]);
  });

  it('the snapshot list is alphabetised', () => {
    expect([...EXPECTED_SCHEMAS_VALUE_EXPORTS]).toEqual([...EXPECTED_SCHEMAS_VALUE_EXPORTS].sort());
  });
});

describe('partner subpath surface', () => {
  it('is types only: it adds no runtime value, so no class is bundled twice', () => {
    expect(Object.keys(SdkPartner)).toEqual([]);
  });
});
