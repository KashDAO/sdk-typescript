<!--
  Thanks for contributing! Please fill in the sections below.
  See CONTRIBUTING.md for the full standards we hold PRs to.
-->

## What

<!-- One-sentence description of the change. -->

## Why

<!-- The user-visible problem this solves. NOT "what the code does" — that's "What" above. -->

## Risk / blast radius

<!--
  Be honest. Examples:
  - "Internal refactor; no behaviour change"
  - "Adds a new public method; backwards compatible"
  - "Changes the shape of an existing public type — breaking"
-->

## Checklist

- [ ] Typecheck passes (`pnpm typecheck`)
- [ ] Lint passes (`pnpm lint`)
- [ ] Tests pass and cover both happy path AND at least one failure mode (`pnpm test`)
- [ ] CHANGELOG.md updated under `[Unreleased]`
- [ ] If touching a schema: contract test (`tests/contract/wire-shape.test.ts`) updated
- [ ] If adding a public method or type: README + JSDoc updated
- [ ] Bundle size remains ≤ 24 KB gzipped (`pnpm build && gzip -9 -c dist/index.js | wc -c`)
