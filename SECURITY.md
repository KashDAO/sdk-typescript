# Security policy

## Reporting a vulnerability

**Please do not file a public GitHub issue for security vulnerabilities.**

Email: `security@kash.bot`

Include:

- A clear description of the issue
- Reproduction steps or proof-of-concept
- The version of `@kashdao/sdk` (and any relevant runtime info: Node version,
  browser, etc.)
- Whether the issue affects the SDK, the public API, or both
- Your contact info if you'd like attribution in the disclosure

We aim to:

1. Acknowledge receipt within **2 business days**.
2. Confirm or reject the report within **7 business days**.
3. Ship a fix within **30 days** for accepted reports, faster for issues
   actively being exploited.

Once the fix has shipped and a reasonable upgrade window has elapsed, we
publish a coordinated disclosure crediting the reporter (with consent).

## Scope

In scope:

- Vulnerabilities in `@kashdao/sdk` itself (this package).
- Issues that allow bypassing the SDK's documented guarantees:
  - Webhook signature verification accepting an invalid signature
  - Constant-time-comparison weaknesses
  - API key leakage through error messages, logs, or hooks
  - SSRF or open-redirect via `baseUrl` validation gaps
  - HTTP smuggling / header injection via config inputs

Out of scope (please report to `security@kash.bot` separately if relevant):

- Vulnerabilities in the Kash public API itself
- Vulnerabilities in transitive dependencies (`zod`) — report upstream first;
  we'll respond to coordinated disclosures
- Theoretical timing attacks against `Date.now()` / `setTimeout` granularity
- Issues requiring physical access to the user's machine

## Supported versions

| Version | Supported            |
| ------- | -------------------- |
| 0.x     | ✅ Latest minor only |

While the package is `0.x`, only the latest published `0.x.y` receives
security fixes. After 1.0, we'll publish a long-term-support policy here.

## Disclosure

Acknowledged researchers are listed in `CHANGELOG.md` against the patched
release.
