/**
 * SDK README internal anchor links ↔ heading slugs.
 *
 * The README has a substantial table of contents and many inline
 * cross-references using `[Title](#anchor)` markdown syntax. Each
 * anchor MUST correspond to a real heading slug; if anyone renames
 * a section heading without updating the anchor, the link 404s in
 * GitHub's rendered markdown.
 *
 * Slug rules (GitHub-flavoured markdown):
 *   - lowercase
 *   - non-alphanumeric → `-`
 *   - consecutive dashes collapsed
 *   - leading/trailing dashes stripped
 *
 * The README has ~43 internal anchor references — a refactor of even
 * one heading silently breaks N table-of-contents and cross-link
 * entries. Pinning these catches the rename before it ships.
 *
 * Same drift class as round BA (cross-link validity in error docs)
 * and BO (./examples/ links). Different surface (intra-README
 * anchors), same pattern.
 */

import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

import { describe, expect, it } from 'vitest';

const README_PATH = fileURLToPath(new URL('../../README.md', import.meta.url));
const README = readFileSync(README_PATH, 'utf8');

/**
 * Slugify a heading the way GitHub-flavoured markdown does:
 *   - lowercase
 *   - strip code-fence backticks
 *   - replace non-alphanumeric with `-`
 *   - collapse runs of `-`
 *   - trim leading/trailing `-`
 *
 * Matches GitHub's `jch/html-pipeline` / `slugger` algorithm closely
 * enough for our purposes (any edge cases will fail the per-anchor
 * test with an actionable message).
 */
function slugify(heading: string): string {
  return heading
    .toLowerCase()
    .replace(/`/g, '')
    .replace(/[^\w\s-]/g, '')
    .replace(/\s+/g, '-')
    .replace(/-+/g, '-')
    .replace(/^-+|-+$/g, '');
}

/**
 * Extract every heading-line slug from the README. Headings are
 * lines starting with `#`-prefixes (excluding code blocks). We
 * narrow to ATX-style headings (the only kind the README uses).
 */
function extractHeadingSlugs(text: string): readonly string[] {
  const slugs = new Set<string>();
  let inCodeFence = false;
  for (const rawLine of text.split('\n')) {
    // Toggle on triple-backtick fences so we don't misread a `#` in
    // code as a heading.
    if (/^```/.test(rawLine)) {
      inCodeFence = !inCodeFence;
      continue;
    }
    if (inCodeFence) continue;
    const m = /^(#{1,6})\s+(.+?)\s*$/.exec(rawLine);
    if (!m) continue;
    slugs.add(slugify(m[2]!));
  }
  return [...slugs];
}

/**
 * Extract every `(#anchor)` reference. Anchors live inside markdown
 * link parens. We deliberately exclude `(#L1234)` style line-number
 * refs from external sources (rare in this README, but safer to
 * filter out).
 */
function extractAnchorReferences(text: string): readonly string[] {
  const out = new Set<string>();
  for (const m of text.matchAll(/\]\(#([a-z][\w-]*)\)/g)) {
    out.add(m[1]!);
  }
  return [...out];
}

const HEADING_SLUGS = new Set(extractHeadingSlugs(README));
const ANCHOR_REFS = extractAnchorReferences(README);

describe('packages/sdk/README.md ↔ heading anchor links validity', () => {
  it('sanity floor: README has heading slugs and anchor references', () => {
    expect(HEADING_SLUGS.size).toBeGreaterThanOrEqual(10);
    expect(ANCHOR_REFS.length).toBeGreaterThanOrEqual(10);
    // Anchor a few canonical slugs every version of the README must
    // have — these are the load-bearing sections.
    for (const required of ['configuration', 'errors', 'recipes'] as const) {
      expect(
        HEADING_SLUGS.has(required),
        `README must have a heading slugged "${required}". ` +
          `Current slugs: ${[...HEADING_SLUGS].sort().join(', ')}.`
      ).toBe(true);
    }
  });

  it.each(ANCHOR_REFS.sort().map((a) => [a] as const))(
    'README anchor "#%s" resolves to a real heading slug',
    (anchor) => {
      // Each table-of-contents or inline `(#anchor)` reference must
      // correspond to an actual heading on the same page. GitHub
      // renders broken anchors as plain href-#missing — the link
      // looks live but does nothing when clicked.
      expect(
        HEADING_SLUGS.has(anchor),
        `README references "#${anchor}" but no heading on this page slugs to that anchor. ` +
          `Either rename the link to match an existing heading, or restore the heading. ` +
          `Available heading slugs: ${[...HEADING_SLUGS].sort().join(', ')}.`
      ).toBe(true);
    }
  );
});
