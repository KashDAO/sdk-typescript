# Changelog

All notable changes to `@kashdao/sdk` will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

While the package is `0.x`, minor versions may include breaking changes —
breaking changes are explicitly called out in the entry.

## [Unreleased]

### Server-side behavior (no SDK code changes; documented for awareness)

- The public API now returns `503 RATE_LIMIT_UNAVAILABLE` when the
  rate-limit subsystem (Redis-backed) is momentarily unreachable
  AND the per-task circuit breaker is still closed. SDK consumers
  see this as a regular `KashServerError` with `err.code ===
'RATE_LIMIT_UNAVAILABLE'`, `err.statusCode === 503`, and
  `err.retryAfterSeconds === 1`. The default retry policy
  (`maxRetries: 3`, honours `Retry-After`) auto-retries these so
  most transient blips are invisible to application code.
  Distinct from `RATE_LIMIT_EXCEEDED` (429, you went over your
  quota) and `DEPENDENCY_UNAVAILABLE` (503, sustained infra
  outage). Consumers building dashboards / metrics that want to
  count rate-limit-subsystem failures separately can branch on
  `err.code === 'RATE_LIMIT_UNAVAILABLE'`. See
  https://docs.kash.bot/developer-docs/api-errors/RATE_LIMIT_UNAVAILABLE
  for the full contract.
