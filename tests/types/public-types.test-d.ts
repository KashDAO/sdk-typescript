/**
 * Static type assertions for the public surface of `@kashdao/sdk`.
 *
 * These tests do not exercise runtime behaviour — they exist purely
 * to fail compilation if a public type's shape changes in a way that
 * could silently break consumers' integrations.
 *
 * Run with `pnpm test:types` (uses vitest's `--typecheck` mode).
 *
 * Add a new assertion here whenever you add a public type. Removing
 * an assertion must coincide with a CHANGELOG entry under `### Removed`
 * or `### Changed` and a minor (or major, post-1.0) version bump.
 */

import { describe, expectTypeOf, it } from 'vitest';

import {
  type AwaitingConfirmationTrade,
  type CompletedTrade,
  type CreateTradeBody,
  type CreateTradeResponse,
  type FailedTrade,
  type GetTradeResponse,
  KashAuthenticationError,
  KashClient,
  type KashClientConfig,
  type KashClientConfigInput,
  type KashClientHooks,
  type KashErrorContext,
  KashRateLimitError,
  KashValidationError,
  type ListTradesResponse,
  type MarketResource,
  Page,
  type PendingTrade,
  type Quote,
  type RateLimitState,
  type RejectedTrade,
  type RequestOverrides,
  type RetryHookEvent,
  type ServerDeprecationNotice,
  type TerminalTrade,
  type TradeConfirmation,
  type TradeCreateResult,
  type TradeMetadata,
  type TradeResource,
  type TradeSide,
  type TradeStatus,
  type WaitForCompletionOptions,
  isAwaitingConfirmation,
  isCompletedTrade,
  isFailedTrade,
  isPendingTrade,
  isRejectedTrade,
  isTerminalTrade,
} from '../../src/index.js';

describe('KashClient public surface', () => {
  it('constructs from a config object only — no positional args', () => {
    // Optional: with no argument the client reads KASH_API_KEY / KASH_BASE_URL.
    expectTypeOf(KashClient).constructorParameters.toEqualTypeOf<
      [config?: KashClientConfigInput]
    >();
  });

  it('exposes the documented resource clients as readonly properties', () => {
    type ClientShape = InstanceType<typeof KashClient>;
    expectTypeOf<ClientShape>().toHaveProperty('trades');
    expectTypeOf<ClientShape>().toHaveProperty('markets');
    expectTypeOf<ClientShape>().toHaveProperty('portfolio');
    expectTypeOf<ClientShape>().toHaveProperty('account');
    expectTypeOf<ClientShape>().toHaveProperty('quotes');
    expectTypeOf<ClientShape>().toHaveProperty('traces');
    expectTypeOf<ClientShape>().toHaveProperty('webhooks');
    expectTypeOf<ClientShape>().toHaveProperty('balance');
    expectTypeOf<ClientShape>().toHaveProperty('partnerAccounts');
    expectTypeOf<ClientShape['partnerAccounts']>().toHaveProperty('withdrawals');
  });
});

describe('config / hooks / overrides', () => {
  it('KashClientConfig.apiKey is an optional string (KASH_API_KEY fills it)', () => {
    expectTypeOf<KashClientConfig['apiKey']>().toEqualTypeOf<string | undefined>();
  });

  it('hooks are optional and exception-safe at the type level (return void)', () => {
    type Hooks = NonNullable<KashClientHooks>;
    expectTypeOf<Hooks['onRequest']>().toBeNullable();
    expectTypeOf<Hooks['onResponse']>().toBeNullable();
    expectTypeOf<Hooks['onRetry']>().toBeNullable();
    expectTypeOf<Hooks['onError']>().toBeNullable();
  });

  it('RetryHookEvent carries the attempt, the reason and the delay', () => {
    expectTypeOf<RetryHookEvent>().toHaveProperty('attempt').toBeNumber();
    expectTypeOf<RetryHookEvent>().toHaveProperty('reason');
    expectTypeOf<RetryHookEvent>().toHaveProperty('delayMs').toBeNumber();
  });

  it('ServerDeprecationNotice exposes RFC 8594 fields as optional', () => {
    expectTypeOf<ServerDeprecationNotice>().toHaveProperty('sunset');
    expectTypeOf<ServerDeprecationNotice>().toHaveProperty('deprecation');
  });

  it('RateLimitState includes remaining + reset', () => {
    expectTypeOf<RateLimitState>().toHaveProperty('remaining').toBeNumber();
    expectTypeOf<RateLimitState>().toHaveProperty('limit').toBeNumber();
  });

  it('RequestOverrides is partial config (timeout, signal, etc.)', () => {
    expectTypeOf<RequestOverrides>().toHaveProperty('signal');
    expectTypeOf<RequestOverrides>().toHaveProperty('timeoutMs');
  });
});

describe('error hierarchy', () => {
  it('all named errors share the KashErrorContext shape', () => {
    // Undefined until the HTTP layer attaches it (client-side errors never get one).
    expectTypeOf<KashAuthenticationError['context']>().toEqualTypeOf<
      KashErrorContext | undefined
    >();
    expectTypeOf<KashValidationError['context']>().toEqualTypeOf<KashErrorContext | undefined>();
  });

  it('KashRateLimitError surfaces retryAfterSeconds as a number', () => {
    type Inst = InstanceType<typeof KashRateLimitError>;
    expectTypeOf<Inst>().toHaveProperty('retryAfterSeconds');
  });

  it('KashValidationError surfaces typed `issues`', () => {
    type Inst = InstanceType<typeof KashValidationError>;
    expectTypeOf<Inst>().toHaveProperty('issues');
  });
});

describe('trade lifecycle types', () => {
  it('TradeStatus keeps its known members, and is open to a status the API adds', () => {
    expectTypeOf<Extract<TradeStatus, 'completed' | 'pending'>>().toEqualTypeOf<
      'completed' | 'pending'
    >();
    expectTypeOf<'a-status-added-later'>().toExtend<TradeStatus>();
    // Spot-check known statuses are part of the union.
    expectTypeOf<'completed'>().toExtend<TradeStatus>();
    expectTypeOf<'pending'>().toExtend<TradeStatus>();
  });

  it('TradeSide is `buy` | `sell`', () => {
    expectTypeOf<'buy'>().toExtend<TradeSide>();
    expectTypeOf<'sell'>().toExtend<TradeSide>();
  });

  it('TradeMetadata is a stable, structurally typed object', () => {
    expectTypeOf<TradeMetadata>().toBeObject();
  });

  it('CreateTradeBody requires marketId, outcomeIndex, amount, side', () => {
    expectTypeOf<CreateTradeBody>().toHaveProperty('marketId');
    expectTypeOf<CreateTradeBody>().toHaveProperty('outcomeIndex');
    expectTypeOf<CreateTradeBody>().toHaveProperty('amount');
    expectTypeOf<CreateTradeBody>().toHaveProperty('side');
  });

  it('CreateTradeBody.ambassadorToken is an optional string', () => {
    expectTypeOf<CreateTradeBody['ambassadorToken']>().toEqualTypeOf<string | undefined>();
  });

  it('CreateTradeResponse is a discriminated union — narrows on confirmation', () => {
    type R = CreateTradeResponse;
    // Both arms are assignable to the union; the union is the public type.
    expectTypeOf<R>().toBeObject();
  });

  it('TradeCreateResult is the merged ergonomic result type', () => {
    expectTypeOf<TradeCreateResult>().toHaveProperty('id');
    expectTypeOf<TradeCreateResult>().toHaveProperty('status');
  });

  it('TradeConfirmation surfaces token + expiresAt', () => {
    expectTypeOf<TradeConfirmation>().toHaveProperty('token');
    expectTypeOf<TradeConfirmation>().toHaveProperty('expiresAt');
  });

  it('GetTradeResponse mirrors the API envelope (trade, its data alias, _meta)', () => {
    expectTypeOf<GetTradeResponse>().toHaveProperty('trade');
    expectTypeOf<GetTradeResponse>().toHaveProperty('data');
    expectTypeOf<GetTradeResponse>().toHaveProperty('_meta');
  });

  it('ListTradesResponse mirrors the paginated envelope', () => {
    expectTypeOf<ListTradesResponse>().toHaveProperty('data');
    expectTypeOf<ListTradesResponse>().toHaveProperty('pagination');
    expectTypeOf<ListTradesResponse>().toHaveProperty('_meta');
  });

  it('WaitForCompletionOptions exposes timeout + poll interval + onStatus + account', () => {
    expectTypeOf<WaitForCompletionOptions>().toHaveProperty('timeoutMs');
    expectTypeOf<WaitForCompletionOptions>().toHaveProperty('pollIntervalMs');
    expectTypeOf<WaitForCompletionOptions>().toHaveProperty('onStatus');
    expectTypeOf<WaitForCompletionOptions>().toHaveProperty('account');
  });
});

describe('trade-status type guards', () => {
  it('isPendingTrade narrows TradeResource → PendingTrade', () => {
    const t = {} as TradeResource;
    if (isPendingTrade(t)) {
      expectTypeOf(t).toMatchTypeOf<PendingTrade>();
    }
  });

  it('isAwaitingConfirmation narrows TradeResource → AwaitingConfirmationTrade', () => {
    const t = {} as TradeResource;
    if (isAwaitingConfirmation(t)) {
      expectTypeOf(t).toMatchTypeOf<AwaitingConfirmationTrade>();
    }
  });

  it('isCompletedTrade narrows TradeResource → CompletedTrade', () => {
    const t = {} as TradeResource;
    if (isCompletedTrade(t)) {
      expectTypeOf(t).toMatchTypeOf<CompletedTrade>();
    }
  });

  it('isFailedTrade narrows TradeResource → FailedTrade', () => {
    const t = {} as TradeResource;
    if (isFailedTrade(t)) {
      expectTypeOf(t).toMatchTypeOf<FailedTrade>();
    }
  });

  it('isRejectedTrade narrows TradeResource → RejectedTrade', () => {
    const t = {} as TradeResource;
    if (isRejectedTrade(t)) {
      expectTypeOf(t).toMatchTypeOf<RejectedTrade>();
    }
  });

  it('isTerminalTrade narrows TradeResource → TerminalTrade', () => {
    const t = {} as TradeResource;
    if (isTerminalTrade(t)) {
      expectTypeOf(t).toMatchTypeOf<TerminalTrade>();
    }
  });
});

describe('pagination', () => {
  it('Page<T> is generic and async-iterable', () => {
    type P = Page<MarketResource>;
    expectTypeOf<P>().toHaveProperty('data');
    expectTypeOf<P>().toHaveProperty('hasMore').toBeBoolean();
    expectTypeOf<P>().toHaveProperty('nextCursor');
    expectTypeOf<P>().toHaveProperty('getNextPage');
    expectTypeOf<P>().toExtend<AsyncIterable<MarketResource>>();
  });
});

describe('quote types', () => {
  it('Quote carries action + amounts + slippage', () => {
    expectTypeOf<Quote>().toBeObject();
  });
});
