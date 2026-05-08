# Contributing to `@kashdao/sdk`

Thanks for considering a contribution. The SDK is the customer-facing surface
of the Kash API — any change here ripples to every integration, so we hold
the bar high.

## How development works

This repo (`KashDAO/sdk-typescript`) is the **public mirror** of the SDK.
The canonical source lives inside Kash's private monorepo, and is synced to
this repo on every release. Pull requests land here in the public mirror,
get reviewed, and once accepted are re-imported into the monorepo by the
release pipeline.

That's the same model Stripe (`stripe/stripe-node`), OpenAI (`openai/openai-node`),
Resend (`resend/resend-node`), and AWS use for their language SDKs — public
client, private server.

What that means in practice:

- ✅ Open issues and PRs in this repo.
- ✅ Comment on PRs, request changes, propose alternatives.
- ❌ The full Kash backend isn't visible from this repo. The SDK speaks to
  `https://api.kash.bot/v1` like any other consumer.

## Quick start

```sh
git clone https://github.com/KashDAO/sdk-typescript.git
cd sdk-typescript
pnpm install
pnpm test
```

Requires Node 22+ and pnpm 9+.

## What's in scope

✅ Welcome:

- Bug fixes — especially correctness in retry/abort/timeout paths.
- New error subclasses for HTTP codes the API has started emitting.
- Better JSDoc and README clarifications.
- Test coverage for edge cases (timezones, malformed servers, runtime
  differences).
- Performance optimisations that keep the bundle under 24 KB gzipped.

🟡 Discuss first (open an issue):

- New top-level methods on resource clients.
- New configuration options.
- Changes to public types — even additive ones.
- Bumping the minimum Node version.

❌ Out of scope:

- Auto-generated SDKs from the OpenAPI spec — we ship a hand-written client
  by deliberate choice. (See the architecture rationale in our public docs.)
- `axios` / `node-fetch` / `undici` runtime imports — native `fetch` only.
- Internal-package imports — the SDK ships to customers; bloat their bundle.

## Standards

- **Native fetch only.** No HTTP libraries. The SDK works in Node 22+,
  modern browsers, Deno, and Bun without polyfills.
- **`zod` is the only runtime dependency.** No `dayjs`, no `lodash`, no
  small utilities. If you need 5 lines of helpers, write them inline.
- **Types are exported deliberately.** Every `export type` is a SemVer
  commitment. Internal types stay un-exported.
- **JSDoc on every public method and config option.** The TypeScript hover
  experience is part of the SDK.
- **Tests cover both happy path AND error paths.** Mock the boundary
  (`fetch`); never mock the SDK's own internals.
- **Lifecycle hooks must be exception-safe.** A throwing logger must not
  break the request path — see `safeFire` in `src/internal/http.ts`.

## Workflow

1. **Fork** this repo and create a feature branch:
   `git checkout -b feat/add-xyz`.
2. **Make the change.** Run `pnpm typecheck`, `pnpm lint`, and `pnpm test`
   after each substantial edit.
3. **Add tests.** Aim to cover happy path + at least one failure mode.
   Update `tests/contract/wire-shape.test.ts` if you touch a schema —
   that's the public-facing contract test that runs in CI.
4. **Document.** Update the README, the JSDoc, and `CHANGELOG.md` under
   the `[Unreleased]` heading.
5. **Open a PR** with a short summary explaining the _why_, not just the
   _what_. Link any related issue.

There is **no automated CI on this public mirror** for v0.x — the
maintainers run typecheck, lint, the unit suite, the wire-shape
contract test, and the bundle-size gate locally before merging your
PR. We may add CI in a future release; for now the workflow is human-
checked.

The bundle-size cap is **≤ 24 KB gzipped ESM**. Run the check yourself:

```sh
pnpm build && gzip -9 -c dist/index.js | wc -c
# expect ≤ 24576
```

> 💡 **Note on the contract test split**: this repo runs
> `tests/contract/wire-shape.test.ts` (public-safe). The monorepo CI
> additionally runs `tests/contract/api-drift.private.test.ts` which imports
> the live API schemas and catches drift between the SDK's canonical
> fixtures and the server-side Zod definitions. PRs to this repo only need
> the public test to pass; the drift test runs internally before each
> release sync.

## Commit messages

Conventional commits:

```
feat: add KashWebhookSecretError
fix: honour Retry-After on 503
docs: clarify Idempotency-Key vs clientRequestId
test: cover the early-break async iterator path
```

(No `(sdk)` scope needed in this repo — everything here is the SDK.)

## Bundle size

The SDK targets **≤ 24 KB gzipped ESM**. CI fails PRs that push the bundle
over the cap. If your change pushes it over, justify it in the PR description
or find offsetting savings elsewhere.

The cap was raised once (22 KB → 24 KB in CHANGELOG) to accommodate
RFC 7807 extension parsing and SDK↔API alignment work; further raises
should be deliberate and justified in CHANGELOG. When bundle headroom
drops below ~500 bytes, prefer trimming over a cap raise unless the
addition is a documented alignment fix.

## Questions

- General product questions: [GitHub Discussions](https://github.com/KashDAO/sdk-typescript/discussions)
- Security vulnerabilities: see [SECURITY.md](./SECURITY.md) — please don't
  open public issues for security findings
- Anything else: open an issue and we'll route it.
