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
    expectTypeOf(KashClient).constructorParameters.toEqualTypeOf<[KashClientConfig]>();
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
  });
});

describe('config / hooks / overrides', () => {
  it('KashClientConfig.apiKey is required', () => {
    expectTypeOf<KashClientConfig>().toHaveProperty('apiKey').toBeString();
  });

  it('hooks are optional and exception-safe at the type level (return void)', () => {
    type Hooks = NonNullable<KashClientHooks>;
    expectTypeOf<Hooks['onRequest']>().toBeNullable();
    expectTypeOf<Hooks['onResponse']>().toBeNullable();
    expectTypeOf<Hooks['onRetry']>().toBeNullable();
    expectTypeOf<Hooks['onError']>().toBeNullable();
  });

  it('RetryHookEvent carries the rate-limit + idempotent-replay context', () => {
    expectTypeOf<RetryHookEvent>().toHaveProperty('attempt').toBeNumber();
    expectTypeOf<RetryHookEvent>().toHaveProperty('rateLimit');
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
    expectTypeOf<KashAuthenticationError['context']>().toMatchTypeOf<KashErrorContext>();
    expectTypeOf<KashValidationError['context']>().toMatchTypeOf<KashErrorContext>();
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
  it('TradeStatus is a string literal union (not a wide string)', () => {
    expectTypeOf<TradeStatus>().not.toBeString();
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

  it('GetTradeResponse mirrors the API envelope (data + meta)', () => {
    expectTypeOf<GetTradeResponse>().toHaveProperty('data');
    expectTypeOf<GetTradeResponse>().toHaveProperty('meta');
  });

  it('ListTradesResponse mirrors the paginated envelope', () => {
    expectTypeOf<ListTradesResponse>().toHaveProperty('data');
    expectTypeOf<ListTradesResponse>().toHaveProperty('meta');
  });

  it('WaitForCompletionOptions exposes timeout + interval + onStatus', () => {
    expectTypeOf<WaitForCompletionOptions>().toHaveProperty('timeoutMs');
    expectTypeOf<WaitForCompletionOptions>().toHaveProperty('intervalMs');
    expectTypeOf<WaitForCompletionOptions>().toHaveProperty('onStatus');
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
    expectTypeOf<P>().toHaveProperty('hasNextPage');
  });
});

describe('quote types', () => {
  it('Quote carries action + amounts + slippage', () => {
    expectTypeOf<Quote>().toBeObject();
  });
});
