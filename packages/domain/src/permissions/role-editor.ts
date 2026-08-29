/**
 * Role-editor selection helpers — the dependency-aware checkbox behaviour the
 * permission matrix needs (docs/archive/catalog/09 §"تعتمد على"): checking a
 * permission auto-checks every prerequisite it transitively depends on;
 * unchecking one cascades to un-check anything currently selected that
 * depends on it (directly or transitively), so the selection never drifts
 * into an invalid state. Pure set algebra over the existing catalog +
 * `resolve.ts` — no new dependency data.
 */

import { dependenciesOf, resolvePermissions } from "./resolve.js";

/**
 * Toggles `code` in `selected`, cascading the dependency graph:
 *   - turning ON adds `code` plus every transitive prerequisite it implies.
 *   - turning OFF removes `code` plus every currently-selected permission
 *     that (directly or transitively) depends on it.
 */
export function togglePermission(
  selected: ReadonlySet<string>,
  code: string,
): ReadonlySet<string> {
  const next = new Set(selected);

  if (next.has(code)) {
    for (const other of next) {
      if (other !== code && dependenciesOf(other).has(code)) {
        next.delete(other);
      }
    }
    next.delete(code);
    return next;
  }

  for (const dep of resolvePermissions([code])) {
    next.add(dep);
  }
  return next;
}

/**
 * Bulk select/deselect: used by a module header's "select all" checkbox.
 * Selecting adds every code in `codes` (deps-closed); deselecting removes
 * every code in `codes` that has no surviving dependent outside that set.
 */
export function toggleAll(
  selected: ReadonlySet<string>,
  codes: readonly string[],
  select: boolean,
): ReadonlySet<string> {
  const next = new Set(selected);
  const codeSet = new Set(codes);

  if (select) {
    for (const dep of resolvePermissions(codes)) {
      next.add(dep);
    }
    return next;
  }

  for (const code of codeSet) {
    next.delete(code);
  }
  // Cascade: anything left selected that depends on a now-removed code must go too.
  let changed = true;
  while (changed) {
    changed = false;
    for (const kept of next) {
      for (const dep of dependenciesOf(kept)) {
        if (!next.has(dep)) {
          next.delete(kept);
          changed = true;
          break;
        }
      }
    }
  }
  return next;
}
