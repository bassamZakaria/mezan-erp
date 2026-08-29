/**
 * Permission dependency resolution.
 *
 * The catalog encodes an enforced dependency graph (docs/archive/plan.md §5.2):
 * "granting `.confirm` implies `.view_own`". A role stores only the raw set of
 * checkboxes an admin ticked; the effective set is that raw set closed over all
 * transitive prerequisites. Resolving once, up front, keeps `can()` a plain set
 * membership test.
 */

import { getPermission, WILDCARD_PERMISSION } from "./catalog.js";

/**
 * Expands a granted permission set to include every transitive dependency.
 *
 * The wildcard `"*"` (tenant admin) is preserved as-is and short-circuits: an
 * admin already holds everything, so there is nothing to expand. Unknown codes
 * are kept verbatim (forward-compatibility with catalog additions) but
 * contribute no dependencies.
 */
export function resolvePermissions(
  granted: Iterable<string>,
): ReadonlySet<string> {
  const resolved = new Set<string>();
  const stack: string[] = [];

  for (const code of granted) {
    if (!resolved.has(code)) {
      resolved.add(code);
      stack.push(code);
    }
  }

  while (stack.length > 0) {
    const code = stack.pop() as string;
    if (code === WILDCARD_PERMISSION) continue;
    const def = getPermission(code);
    if (!def) continue;
    for (const dep of def.deps) {
      if (!resolved.has(dep)) {
        resolved.add(dep);
        stack.push(dep);
      }
    }
  }

  return resolved;
}

/**
 * The prerequisites a single permission pulls in, transitively — the additional
 * codes that granting `code` implies. Excludes `code` itself. Useful for the
 * role editor's "depends on" affordance.
 */
export function dependenciesOf(code: string): ReadonlySet<string> {
  const full = resolvePermissions([code]);
  const deps = new Set(full);
  deps.delete(code);
  return deps;
}
