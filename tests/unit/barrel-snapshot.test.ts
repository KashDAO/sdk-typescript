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

/**
 * Source of truth for the exported public surface of `@kashdao/sdk`.
 * Alphabetised, includes both runtime values and TypeScript types
 * (TS types disappear at runtime, so this list reflects what
 * `Object.keys(Sdk)` shows — value-only).
 */
const EXPECTED_VALUE_EXPORTS = [
  'API_KEY_SHAPE',
  'AccountClient',
  'AccountUsageResponseSchema',
  'AccountUsageSchema',
  'ClientRequestIdSchema',
  'ConfirmTradeBodySchema',
  'ConfirmTradeResponseSchema',
  'CreateTradeAcceptedResponseSchema',
  'CreateTradeBodySchema',
  'CreateTradeCreatedResponseSchema',
  'CreateTradeResponseSchema',
  'GetMarketResponseSchema',
  'GetTraceResponseSchema',
  'GetTradeResponseSchema',
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
  'ListMarketsResponseSchema',
  'ListPredictionsResponseSchema',
  'ListTradesResponseSchema',
  'ListWebhookEventsResponseSchema',
  'MarketOutcomeSchema',
  'MarketResourceSchema',
  'MarketStatusSchema',
  'MarketsClient',
  'MetaSchema',
  'PRODUCTION_BASE_URL',
  'Page',
  'PaginationSchema',
  'PortfolioClient',
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
  'QuotesClient',
  'RedeliverWebhookEventSchema',
  'RedeliverWebhookResponseSchema',
  'RotateWebhookSecretResponseSchema',
  'SDK_API_VERSION',
  'SDK_VERSION',
  'STAGING_BASE_URL',
  'TERMINAL_TRADE_STATUSES',
  'TraceEventDataSchema',
  'TraceEventSchema',
  'TraceResourceSchema',
  'TracesClient',
  'TradeCompletedPayloadSchema',
  'TradeConfirmationRequiredPayloadSchema',
  'TradeFailedPayloadSchema',
  'TradeMetadataSchema',
  'TradeResourceSchema',
  'TradeSideSchema',
  'TradeStatusSchema',
  'TradesClient',
  'USER_AGENT',
  'UsdcAmountSchema',
  'WebhookEventResourceSchema',
  'WebhookEventSchema',
  'WebhooksClient',
  'classifyHttpError',
  'inferBaseUrlFromApiKey',
  'isAwaitingConfirmation',
  'isCompletedTrade',
  'isFailedTrade',
  'isPendingTrade',
  'isRejectedTrade',
  'isTerminalTrade',
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
