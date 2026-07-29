#!/usr/bin/env bash
#
# Generate a CycloneDX SBOM for @kashdao/sdk.
#
# Why this is not just `npm sbom > sbom.cyclonedx.json`:
#
#   `npm sbom` cannot read this workspace. Dependencies here are declared with
#   pnpm's `workspace:*` protocol, which npm rejects outright:
#
#     npm error invalid: @kashdao/vitest-config@1.1.0, workspace:* required by ...
#
#   It then exits non-zero having written nothing — but the shell created the
#   redirect target first, so `> sbom.cyclonedx.json` leaves a **0-byte file**
#   behind. Nothing downstream noticed: the publish gate treated the empty file
#   as success, and the failure only surfaced at the very end as an opaque
#   GitHub upload error:
#
#     HTTP 400: Bad Content-Length (.../releases/361839145/assets?...)
#
#   That is exactly what happened on the v0.1.2 release (2026-07-29): the
#   package published fine, the release drafted fine, and the SBOM asset was
#   silently absent.
#
# What this does instead: pack the real tarball, install it into a scratch
# directory with plain npm — no workspace protocol in sight, because the packed
# manifest carries resolved registry versions — and generate the SBOM there.
# That also makes the SBOM describe what CONSUMERS actually install, which is
# the more honest artifact anyway.
#
# Fails loudly: non-zero exit and no file written unless the SBOM is valid,
# non-empty CycloneDX.
#
# Usage: bash packages/sdk/scripts/generate-sbom.sh [output-path]

set -euo pipefail

PKG_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
OUT="${1:-$PKG_DIR/sbom.cyclonedx.json}"

WORK="$(mktemp -d)"
cleanup() { rm -rf "$WORK"; }
trap cleanup EXIT

# `files` ships `dist`, so packing without a build yields a tarball missing the
# very code the SBOM should describe. The monorepo usually has dist/ lying
# around from the publish gate; a fresh mirror clone does not.
if [ ! -d "$PKG_DIR/dist" ]; then
  echo "▶ dist/ missing — building first"
  (cd "$PKG_DIR" && npm run build >/dev/null 2>&1) \
    || { echo "  ✗ build failed; run the build manually and retry" >&2; exit 1; }
fi

echo "▶ packing @kashdao/sdk"
TARBALL="$(cd "$PKG_DIR" && npm pack --pack-destination "$WORK" 2>/dev/null | tail -1)"
[ -s "$WORK/$TARBALL" ] || { echo "  ✗ npm pack produced no tarball" >&2; exit 1; }

echo "▶ installing it standalone"
cd "$WORK"
printf '{"name":"sbom-source","version":"1.0.0","private":true}\n' > package.json
npm install "$WORK/$TARBALL" --silent --no-audit --no-fund >/dev/null 2>&1 \
  || { echo "  ✗ standalone install failed" >&2; exit 1; }

echo "▶ generating CycloneDX SBOM"
# Write to a temp first: never leave a truncated/empty file at $OUT, which is
# the exact failure mode this script exists to prevent.
if ! npm sbom --sbom-format=cyclonedx > "$WORK/sbom.json" 2>"$WORK/sbom.err"; then
  echo "  ✗ npm sbom failed:" >&2
  tail -5 "$WORK/sbom.err" >&2
  exit 1
fi

[ -s "$WORK/sbom.json" ] || { echo "  ✗ SBOM is empty" >&2; exit 1; }

# Validate it really is CycloneDX with at least one component, so a malformed
# but non-empty file cannot slip through either.
node -e '
  const fs = require("fs");
  const d = JSON.parse(fs.readFileSync(process.argv[1], "utf8"));
  if (d.bomFormat !== "CycloneDX") throw new Error("not CycloneDX: " + d.bomFormat);
  if (!Array.isArray(d.components) || d.components.length === 0)
    throw new Error("SBOM lists no components");
  console.log(`  ✓ CycloneDX ${d.specVersion}, ${d.components.length} component(s)`);
' "$WORK/sbom.json"

cp "$WORK/sbom.json" "$OUT"
echo "  ✓ wrote $OUT ($(wc -c < "$OUT" | tr -d ' ') bytes)"
