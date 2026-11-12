/**
 * Rendering Zod issues the way the SDK reports them. Zod 4 issue paths are
 * `PropertyKey[]` (a symbol key is possible), so every path segment goes
 * through `String` before it is joined or exposed.
 */

/** A path segment as the SDK exposes it: a symbol becomes its description string. */
export function pathSegment(segment: PropertyKey): string | number {
  return typeof segment === 'symbol' ? String(segment) : segment;
}

/** `a.b.0`, or `''` for the root. */
export function joinIssuePath(path: readonly PropertyKey[]): string {
  return path.map((segment) => String(pathSegment(segment))).join('.');
}
