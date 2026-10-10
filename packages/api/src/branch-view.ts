import type { Context } from "hono";
import { can, withinBranchScope, type JournalEntry } from "@mezan/domain";
import { VIEW_UNATTRIBUTED_PERMISSION } from "./branch-policy.js";
import { branchGrantOf, branchScopeOf, getAuthContext } from "./permission-gate.js";

export { VIEW_UNATTRIBUTED_PERMISSION };

/**
 * What of the posted ledger a caller may read, line by line.
 *
 * INVARIANT: `includeUnattributed` is decided by the session's GRANT, never by
 * the shell's branch selector. DEC-20's "never hide «غير مخصص»" is a
 * reconciliation rule for whoever sees the whole company; on a books file
 * older than the branch fill the bucket IS the whole history, so a
 * branch-granted session reads it only when it holds
 * {@link VIEW_UNATTRIBUTED_PERMISSION}.
 */
export interface BranchLineView {
  readonly scope: readonly string[] | undefined;
  readonly includeUnattributed: boolean;
}

export function canSeeUnattributed(c: Context): boolean {
  if (branchGrantOf(c) === undefined) return true;
  const ctx = getAuthContext(c);
  return ctx !== undefined && can(ctx, VIEW_UNATTRIBUTED_PERMISSION);
}

export function branchLineViewOf(c: Context): BranchLineView {
  return { scope: branchScopeOf(c), includeUnattributed: canSeeUnattributed(c) };
}

export function isWholeLedgerView(view: BranchLineView): boolean {
  return view.scope === undefined && view.includeUnattributed;
}

export function lineInView(view: BranchLineView, branchId: string | null | undefined): boolean {
  return withinBranchScope(branchId, view.scope, view.includeUnattributed);
}

/** The entry cut down to the lines the caller may read, or null when it has none. */
export function entryInView(view: BranchLineView, entry: JournalEntry): JournalEntry | null {
  if (isWholeLedgerView(view)) return entry;
  const lines = entry.lines.filter((line) => lineInView(view, line.branchId));
  return lines.length === 0 ? null : { ...entry, lines };
}

/**
 * The ledger a statement may aggregate. A statement applies the caller's
 * branch SCOPE itself, line by line; this only removes what the session may
 * not read at all.
 */
export function readableEntries(c: Context, entries: readonly JournalEntry[]): JournalEntry[] {
  return entriesInView({ scope: undefined, includeUnattributed: canSeeUnattributed(c) }, entries);
}

export function entriesInView(view: BranchLineView, entries: readonly JournalEntry[]): JournalEntry[] {
  if (isWholeLedgerView(view)) return [...entries];
  return entries.flatMap((entry) => entryInView(view, entry) ?? []);
}
