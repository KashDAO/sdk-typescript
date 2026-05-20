# Security policy

## Non-custodial design

`@kashdao/sdk`, every other Kash SDK and CLI package, and the Kash
public API are **non-custodial software**. The following invariants
hold:

- **Kash never holds or controls user funds.** Customer USDC, outcome
  tokens, ETH for gas, and any other on-chain assets always sit at an
  on-chain address that the customer controls. Kash holds zero
  balances on the customer's behalf at any time.
- **Kash never has access to user signing keys.** Smart-account keys
  are split via Privy's MPC; key shares are distributed across the
  user's device and Privy's HSM-backed enclave. Kash operates no key
  share and cannot reconstruct a signing key under any circumstance.
- **Kash never signs transactions or UserOps on the user's behalf.**
  Every state-changing on-chain action is signed inside the user's
  Privy MPC enclave (or, when using `@kashdao/protocol-sdk` directly,
  by whatever signer the consumer brings). No signature ever
  originates on a Kash server.
- **Kash never moves user funds.** Settlement is on-chain via
  open-source protocol contracts; there is no Kash-controlled pool
  of funds in the path, no Kash-controlled balance ledger, and no
  Kash-controlled relay that can re-route value.
- **The API-key delegation is scoped and revocable.** A `kash_live_*`
  / `kash_test_*` key carries narrowly-scoped limits (per-trade caps,
  daily caps, allowed operations, allowlisted IPs) the customer sets
  themselves. The customer can revoke the delegation at any time from
  the Kash dashboard or via `POST /v1/auth/api-keys/<id>/revoke`;
  revocation takes effect on the next request.
- **Kash is not a money-services business, custodian, exchange, or
  broker-dealer.** Kash publishes software and protocol contracts;
  customers run the software and interact with the protocol from
  accounts they control.

Equivalent statements hold for `@kashdao/protocol-sdk`, `@kashdao/cli`,
and `kashdao-protocol-sdk` (Python).

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
