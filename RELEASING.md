# Releasing `@kashdao/sdk`

The SDK ships from the private monorepo to the public mirror at
`KashDAO/sdk-typescript` and from there to npm. This document is the
runbook.

> **Audience**: maintainers inside the Kash monorepo. The mirror repo
> has its own `CONTRIBUTING.md` for external contributors.

## Pattern: public client, private server, manual publish

We follow the same model Stripe (`stripe-node`), OpenAI (`openai-node`),
Resend (`resend-node`), and AWS use:

- **Canonical source**: the SDK lives at `packages/sdk/` inside the
  private Kash monorepo. All development happens there.
- **Public mirror**: `github.com/KashDAO/sdk-typescript` is a one-way
  mirror of the SDK package directory. External contributors open PRs
  against the mirror; accepted PRs are re-imported into the monorepo
  by hand (or by an automated importer when traffic warrants it).
- **npm artifact**: published manually as `@kashdao/sdk` via
  `scripts/publish.sh` — no CI/CD on the SDK side for v0.x to keep the
  publish path simple and predictable while the team gets comfortable
  with the flow.

Future tightening (post-1.0 candidate): npm trusted publishing via
OIDC + JSR auto-publish. Out of scope for now.

## Branches and tags

- `main` on the **mirror** is the source of truth for what's published.
  Every commit on `main` is a state the SDK was, is, or will be in.
- Tags `v0.1.0`, `v0.2.0`, etc. on the mirror mark released versions.
  Tags don't trigger any automation today — they're manual markers
  for what's on npm at any point.
- Tags inside the **monorepo** are NOT published. The monorepo doesn't
  publish anything to npm.

## Release workflow

### 1. Land changes inside the monorepo

Normal monorepo PR workflow against `packages/sdk/`. Internal CI runs:

- `pnpm --filter @kashdao/sdk typecheck`
- `pnpm --filter @kashdao/sdk lint`
- `pnpm --filter @kashdao/sdk test` — includes `tests/contract/api-drift.private.test.ts`
  which catches API-side schema drift

### 2. Bump the version

Inside the monorepo, edit two files in lockstep:

- `packages/sdk/package.json#version`
- `packages/sdk/src/internal/version.ts` (`SDK_VERSION`)

The unit test in `tests/unit/user-agent.test.ts` asserts the two stay
in sync — the test fails if you forget one.

Update `packages/sdk/CHANGELOG.md`: rename `[Unreleased]` to the new
version + date, leave a fresh empty `[Unreleased]` heading on top.

Land on monorepo `main`.

> **Independence from `@kashdao/protocol-sdk`**: this package has no
> runtime dependency on `@kashdao/protocol-sdk`. The two SDKs release
> on independent versions and cadences — see
> `packages/protocol-sdk/RELEASING.md` for that package's runbook.

### 3. Sync to the mirror

```sh
pnpm tsx packages/sdk/scripts/sync-to-public-mirror.ts \
  --mirror-url=git@github.com:KashDAO/sdk-typescript.git
```

> The script is also directly executable via its shebang
> (`#!/usr/bin/env -S node --experimental-strip-types`) on Node 23+:
> `./packages/sdk/scripts/sync-to-public-mirror.ts --mirror-url=...`.
> Both forms run the same code; pick whichever matches your shell habits.

What the script does:

1. Clones the mirror into a temp dir.
2. Wipes the mirror working tree (preserving `.git`).
3. Copies `src/`, `tests/`, `examples/`, `.github/` (issue templates only),
   README.md, CHANGELOG.md, CONTRIBUTING.md, SECURITY.md, LICENSE,
   tsup.config.ts, and `.gitignore`.
4. Drops monorepo-only test files (`*.private.test.ts`).
5. Writes a standalone `tsconfig.json`, `vitest.config.ts`, and
   `package.json` (workspace devDeps replaced with registry pins; no
   workspace runtime deps exist for this package).
6. Commits with message `release: v<version>` and tags `v<version>`.
7. Pushes `main` + the tag to the mirror.

`--dry-run` prepares the mirror tree without committing or pushing.
`--skip-push` commits + tags locally but doesn't push.
`--local-output=<path>` skips the clone entirely and just writes the
prepared mirror tree to a local directory — best for inspection.

### 4. Publish to npm (manual)

#### Before the FIRST publish (one-time setup)

If this is the first publish for this package — i.e., the public
mirror at `github.com/KashDAO/sdk-typescript` has never had a tag
or `npm view @kashdao/sdk` returns 404 — do these one-time checks
before the dry-run:

1. **Mirror exists and is public.** Visit
   `https://github.com/KashDAO/sdk-typescript`. The repo must exist
   and be public (or you flipped it from private earlier). The sync
   script needs push access; verify with `git ls-remote
git@github.com:KashDAO/sdk-typescript.git`.
2. **npm scope reservation.** Verify `@kashdao` is reserved on npm
   and you're a member with publish access:
   `npm access list packages @kashdao` should list this package
   (or be empty if it's the first one in the scope) and not error.
3. **`gh` authenticated against the public org.** Run `gh auth
status` and confirm it shows `KashDAO/...` repos in your token's
   scope. If not, `gh auth login` and grant `repo` + `read:org`
   scopes.
4. **Squash initial commit on the mirror.** The normal sync flow
   commits a fresh release on top of whatever history the mirror
   already has. For the _first_ publish you want the mirror's
   history to start with a single, clean `initial public release`
   commit — not a trail of internal cleanup. One-shot recipe:

   ```sh
   # Materialise a clean mirror tree locally (no clone, no commit)
   pnpm tsx packages/sdk/scripts/sync-to-public-mirror.ts \
     --local-output=/tmp/sdk-typescript-init

   cd /tmp/sdk-typescript-init
   git init -b main
   git add -A
   git commit -m "chore: initial public release of @kashdao/sdk"
   git remote add origin git@github.com:KashDAO/sdk-typescript.git

   # Mirror has no external consumers yet — force-push is safe here
   # and only here. Every subsequent release goes through the normal
   # sync-to-public-mirror.ts flow (clone + copy + commit + tag + push).
   git push --force origin main
   ```

5. **Dry-run from the monorepo:**
   `bash packages/sdk/scripts/publish.sh --dry-run`. This catches
   any first-time-only friction (missing devDeps, broken size-limit
   config, awk slice extracting empty body) before you touch a real
   publish path.

After all five pass, proceed below.

#### Dry-run first

Always dry-run before the real publish. The same script with
`--dry-run` runs every gate (typecheck, lint, test, build,
bundle-size cap, SBOM, runtime smoke under Node + Bun + Deno) plus
the CHANGELOG-slice extraction for the GitHub Release — but stops
short of `npm publish` and `gh release create`. Use it to verify
end-to-end that:

- Every pre-publish check passes.
- The dist tarball builds and the bundled exports resolve.
- The `awk` slice produces the right CHANGELOG body for this
  version (the script shows the first 20 lines and the line count).
- The exact `gh release create` argv is what you intended (asset
  paths, draft mode, tag).

```sh
bash packages/sdk/scripts/publish.sh --dry-run
```

The dry-run is non-interactive (no confirmation prompt) and tolerates
"version already published" + "not logged in to npm" — it warns and
keeps going. It's safe to run repeatedly.

#### Real publish

```sh
bash packages/sdk/scripts/publish.sh
```

The script:

1. Verifies you're logged in to npm (`npm whoami`).
2. Confirms the version isn't already published.
3. Re-runs the pre-publish gate (typecheck, lint, test, build, bundle-size cap, SBOM, runtime smoke).
4. Asks for an interactive `yes` confirmation.
5. Runs `npm publish --access public --ignore-scripts`.
6. Best-effort drafts a GitHub Release on the public mirror via
   `gh release create --draft` (requires `gh` on PATH, authenticated).
   Attaches `sbom.cyclonedx.json` if present. Non-fatal if `gh` is
   missing; the script prints the manual-create URL.

### 5. Review the GitHub Release draft

The publish script drafts the Release; you still need to:

1. Visit `https://github.com/KashDAO/sdk-typescript/releases`.
2. Open the **draft** for the version you just published.
3. Verify the body, the SBOM asset, and the tag.
4. Click **Publish release**.

If `gh` wasn't on your PATH at publish time and the script printed the
manual-create URL, follow it: open the URL, paste the relevant
`CHANGELOG.md` slice, attach the SBOM if you generated one locally,
and publish.

### 6. Smoke-test

```sh
mkdir /tmp/kash-smoke && cd /tmp/kash-smoke
echo '{"name":"smoke","type":"module"}' > package.json
npm install @kashdao/sdk@<version>
node -e 'import("@kashdao/sdk").then(s => console.log(s.USER_AGENT))'
# Expect: @kashdao/sdk/0.1.0 (node/22.…)
```

If that prints the expected user-agent line, the release is real.

## Hotfix process

Same flow, but tag a patch version (`v0.1.1`) from a hotfix branch in
the monorepo. Sync to mirror, run the publish scripts in the same
order. No special handling — patch releases go through the same gates.

## Backporting external PRs

The mirror accepts PRs from external contributors. Once merged into
mirror `main`:

1. Cherry-pick the commit into `packages/sdk/` in the monorepo.
2. Adjust paths if needed (the mirror has no `packages/sdk/` prefix).
3. Re-run the monorepo tests (including the private drift test).
4. Land normally.

The next release sync will pick it up.

## Required access

| Resource                             | Who needs access                |
| ------------------------------------ | ------------------------------- |
| npm `@kashdao` scope (publish)       | Whoever runs the publish script |
| `KashDAO/sdk-typescript` repo (push) | Whoever runs the sync script    |

For a team, hand the publish credentials to a single release captain to
keep the audit trail clean.

## Rollback

If a published version is broken:

1. Deprecate it: `npm deprecate @kashdao/sdk@<version> 'Broken — use <newer>'`.
2. **Do not** `npm unpublish` — semver-major versions are unpublishable
   after 24h regardless, and unpublishing breaks consumers' lockfiles.
3. Ship a patch release with the fix following the normal flow.

## SemVer policy

While `0.x.y`:

- Minor bumps may include breaking changes — documented in CHANGELOG.
- Patch bumps are bug fixes only.

After 1.0:

- Major: breaking change to public types or runtime behaviour.
- Minor: new methods, new error subclasses, new config options.
- Patch: bug fixes, doc improvements, internal refactors.

## When to start a new SDK package

The current package is `@kashdao/sdk` (TypeScript / JavaScript). Future
language SDKs each get their own public mirror repo and their own
publish script:

- `KashDAO/sdk-typescript` (this one)
- `KashDAO/sdk-python` (future)
- `KashDAO/sdk-go` (future)
- etc.

Each is published independently with its own version, runbook, and
publish script. The monorepo holds canonical source for every
language SDK side-by-side.

## Future: when CI lands

Once we're comfortable with the manual flow, candidates for automation:

- **npm trusted publishing** via OIDC (currently supported by GitHub
  Actions, GitLab CI, CircleCI). Adds the npm signed-attestation badge.
- **JSR auto-publish** alongside npm.
- **TypeDoc → GitHub Pages** for the API reference site.
- **CodeQL + Dependabot** for security scanning + auto-update PRs.

These are deferred until the manual flow has been exercised a few
times and we have confidence in the moving parts.
