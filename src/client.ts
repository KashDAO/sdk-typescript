/**
 * `KashClient` — the entry point. Constructing it with a config
 * validates everything via Zod up front (so misconfiguration fails
 * loudly) and then exposes resource-oriented sub-clients.
 *
 * Usage:
 *
 * ```ts
 * import { KashClient } from '@kashdao/sdk';
 *
 * // Explicit:
 * const kash = new KashClient({ apiKey: process.env.KASH_API_KEY });
 *
 * // Or auto-discovery (reads KASH_API_KEY + KASH_BASE_URL from env):
 * const kash = new KashClient();
 * ```
 *
 * Construction failures throw {@link KashConfigurationError} (NOT
 * the underlying `ZodError`) so consumers can branch consistently
 * on `KashError`.
 */

import { z } from 'zod';

import { AccountClient } from './clients/account.js';
import { MarketsClient } from './clients/markets.js';
import { PortfolioClient } from './clients/portfolio.js';
import { QuotesClient } from './clients/quotes.js';
import { RedemptionsClient } from './clients/redemptions.js';
import { TracesClient } from './clients/traces.js';
import { TradesClient } from './clients/trades.js';
import { WebhooksClient } from './clients/webhooks.js';
import { KashConfigurationError } from './errors.js';
import {
  inferBaseUrlFromApiKey,
  kashClientConfigSchema,
  type KashClientConfig,
  type KashClientConfigInput,
} from './internal/config.js';
import { KashHttpClient } from './internal/http.js';

const healthCheckResponseSchema = z.object({
  status: z.enum(['ok', 'degraded', 'down']).optional(),
  service: z.string().optional(),
  version: z.string().optional(),
});

export type HealthCheckResult = {
  /** True when the server returned 2xx within the timeout. */
  readonly ok: boolean;
  /** Wall-clock latency in milliseconds, including DNS + TLS + body. */
  readonly latencyMs: number;
  /** Server-reported status string when present. */
  readonly status?: string;
  /** Server-reported version, when present. Useful for support tickets. */
  readonly version?: string;
  /** `X-Request-ID` from the server (echo this when filing bugs). */
  readonly requestId?: string;
};

export class KashClient {
  readonly markets: MarketsClient;
  readonly trades: TradesClient;
  readonly redemptions: RedemptionsClient;
  readonly traces: TracesClient;
  readonly quotes: QuotesClient;
  readonly portfolio: PortfolioClient;
  readonly webhooks: WebhooksClient;
  readonly account: AccountClient;

  /**
   * The validated, normalised config — exposed read-only for
   * diagnostics. Frozen at construction so accidental mutation
   * (`kash.config.timeoutMs = 0`) throws in strict mode rather than
   * silently changing future requests.
   */
  readonly config: Readonly<KashClientConfig>;

  /** Stored input (post-validation) — used by {@link withConfig}. */
  private readonly inputConfig: KashClientConfig;
  private readonly http: KashHttpClient;

  constructor(config: KashClientConfigInput = {}) {
    const merged = applyEnvDefaults(config);
    const parsed = kashClientConfigSchema.safeParse(merged);
    if (!parsed.success) {
      throw configurationErrorFromZod(parsed.error);
    }
    this.inputConfig = parsed.data;
    this.config = Object.freeze({ ...parsed.data });
    this.http = new KashHttpClient(parsed.data);
    this.markets = new MarketsClient(this.http);
    this.trades = new TradesClient(this.http);
    this.redemptions = new RedemptionsClient(this.http);
    this.traces = new TracesClient(this.http);
    this.quotes = new QuotesClient(this.http);
    this.portfolio = new PortfolioClient(this.http);
    this.webhooks = new WebhooksClient(this.http);
    this.account = new AccountClient(this.http);
  }

  /**
   * Return a NEW client with the given fields overridden. The original
   * client is untouched. Useful for per-tenant overrides (different
   * API key per request scope), per-environment selection, or
   * temporarily overriding timeouts:
   *
   * @example
   * ```ts
   * const tenantA = kash.withConfig({ apiKey: tenantAKey });
   * const slow = kash.withConfig({ timeoutMs: 120_000 });
   * ```
   *
   * Validation runs again — invalid overrides throw
   * {@link KashConfigurationError}.
   */
  withConfig(overrides: Partial<KashClientConfigInput>): KashClient {
    return new KashClient({ ...this.inputConfig, ...overrides });
  }

  /**
   * Verify connectivity + key validity. Calls `GET /v1/health` with a
   * tight timeout and returns a structured result. Handy as the first
   * thing to run when debugging an integration:
   *
   * @example
   * ```ts
   * const health = await kash.healthCheck();
   * if (!health.ok) console.error('Cannot reach Kash:', health);
   * else console.log(`Kash ${health.version} OK in ${health.latencyMs}ms`);
   * ```
   *
   * Failures DO NOT throw — the result always has `ok: boolean` so
   * the caller can branch without try/catch. (The exception: caller
   * aborts via `signal` propagate as `KashAbortedError` like every
   * other SDK method.)
   */
  async healthCheck(
    opts: { readonly signal?: AbortSignal; readonly timeoutMs?: number } = {}
  ): Promise<HealthCheckResult> {
    const startedAt = Date.now();
    try {
      const result = await this.http.request({
        path: '/health',
        method: 'GET',
        schema: healthCheckResponseSchema,
        timeoutMs: opts.timeoutMs ?? 5_000,
        // Health check shouldn't retry — fail fast so the caller
        // hears about issues quickly.
        maxRetries: 0,
        ...(opts.signal === undefined ? {} : { signal: opts.signal }),
      });
      const out: HealthCheckResult = {
        ok: true,
        latencyMs: Date.now() - startedAt,
      };
      if (result.status !== undefined) (out as { status?: string }).status = result.status;
      if (result.version !== undefined) (out as { version?: string }).version = result.version;
      return out;
    } catch (err) {
      // Non-throwing surface — the failure mode is data, not exception.
      // Caller-driven aborts still propagate (they signal "stop now").
      if (err instanceof Error && err.name === 'KashAbortedError') throw err;
      const out: HealthCheckResult = {
        ok: false,
        latencyMs: Date.now() - startedAt,
      };
      // Best-effort: pull the request id off the error if it came from
      // the HTTP layer.
      const maybeKashError = err as { requestId?: string };
      if (maybeKashError.requestId)
        (out as { requestId?: string }).requestId = maybeKashError.requestId;
      return out;
    }
  }
}

/**
 * Map a Zod issue list to a {@link KashConfigurationError}. Picks the
 * first issue for the human-facing message but exposes all of them
 * via `.issues` so structured loggers can render the full list.
 */
function configurationErrorFromZod(error: z.ZodError): KashConfigurationError {
  const issues = error.issues.map((i) => ({
    path: [...i.path],
    message: i.message,
  }));
  const first = issues[0];
  const summary = first
    ? `Invalid KashClient configuration — ${pathToString(first.path)}: ${first.message}`
    : 'Invalid KashClient configuration.';
  return new KashConfigurationError(summary, {
    code: 'SDK_CONFIGURATION_INVALID',
    issues,
  });
}

function pathToString(path: ReadonlyArray<string | number>): string {
  return path.length > 0 ? path.join('.') : '(root)';
}

/**
 * Layer environment-variable defaults under the explicit config. The
 * caller's input always wins; we only fill in fields they didn't pass.
 *
 * Recognised env vars (Stripe-style — explicit > env > schema default):
 *
 *   - `KASH_API_KEY`   → `apiKey`
 *   - `KASH_BASE_URL`  → `baseUrl`   (e.g. `https://api-staging.kash.bot/v1`)
 *
 * Browsers, edge runtimes, or any host without a `process.env` go
 * through this function unchanged — `getEnv` returns undefined and
 * the caller's explicit values stay authoritative.
 */
function applyEnvDefaults(input: KashClientConfigInput): KashClientConfigInput {
  const out: Record<string, unknown> = { ...input };
  if (out['apiKey'] === undefined) {
    const fromEnv = getEnv('KASH_API_KEY');
    if (fromEnv) out['apiKey'] = fromEnv;
  }
  // Resolution order for `baseUrl`:
  //   1. explicit config value (consumer code)         — already in `out`
  //   2. `KASH_BASE_URL` environment variable          — set here
  //   3. inferred from `apiKey` prefix (test → staging) — set here
  //   4. schema default (production)                   — applied by Zod
  //
  // The auto-route in step 3 is the DX win: a consumer with
  // `KASH_API_KEY=kash_test_…` set hits staging without remembering
  // to also set `KASH_BASE_URL`. Explicit config (step 1) and
  // explicit env (step 2) always win.
  if (out['baseUrl'] === undefined) {
    const fromEnv = getEnv('KASH_BASE_URL');
    if (fromEnv) {
      out['baseUrl'] = fromEnv;
    } else {
      const inferred = inferBaseUrlFromApiKey(out['apiKey'] as string | undefined);
      if (inferred) out['baseUrl'] = inferred;
    }
  }
  return out as KashClientConfigInput;
}

function getEnv(name: string): string | undefined {
  // Type-erased lookup so this file compiles cleanly without
  // `@types/node` and works in browsers / Deno / Bun (where `process`
  // may be missing or partially shimmed).
  const proc = (globalThis as { process?: { env?: Record<string, string | undefined> } }).process;
  const value = proc?.env?.[name];
  return typeof value === 'string' && value.length > 0 ? value : undefined;
}
