import type { Account } from "./account.js";
import { HeaderAccountNotPostableError } from "./errors.js";

/** An `Account` nested with its children, sorted by `code` at every level. */
export interface AccountTreeNode extends Account {
  readonly children: readonly AccountTreeNode[];
}

/**
 * Nests a flat account list into a tree by `parentId`, sorted by `code` at
 * every level (root accounts and each set of siblings). Orphaned rows (a
 * `parentId` that does not resolve to another row in the list) are treated as
 * roots rather than silently dropped, so a partial/paginated fetch degrades
 * gracefully instead of losing data.
 */
export function buildAccountTree(accounts: readonly Account[]): AccountTreeNode[] {
  const byId = new Map(accounts.map((a) => [a.id, a]));
  const childrenOf = new Map<string | null, Account[]>();

  for (const account of accounts) {
    const parentKey = account.parentId !== null && byId.has(account.parentId) ? account.parentId : null;
    const bucket = childrenOf.get(parentKey);
    if (bucket) bucket.push(account);
    else childrenOf.set(parentKey, [account]);
  }

  function build(parentId: string | null): AccountTreeNode[] {
    const siblings = childrenOf.get(parentId) ?? [];
    return [...siblings]
      .sort((a, b) => a.code.localeCompare(b.code))
      .map((account) => ({ ...account, children: build(account.id) }));
  }

  return build(null);
}

/** Flattens a tree back into depth-first order, annotating each row with its nesting `level`. */
export interface FlattenedAccountRow extends Account {
  readonly level: number;
  readonly hasChildren: boolean;
}

export function flattenAccountTree(nodes: readonly AccountTreeNode[], level = 0): FlattenedAccountRow[] {
  const out: FlattenedAccountRow[] = [];
  for (const node of nodes) {
    const { children, ...account } = node;
    out.push({ ...account, level, hasChildren: children.length > 0 });
    out.push(...flattenAccountTree(children, level + 1));
  }
  return out;
}

/** Throws {@link HeaderAccountNotPostableError} if `account` is a header (non-postable) account. */
export function assertPostable(account: Pick<Account, "id" | "isHeader">): void {
  if (account.isHeader) {
    throw new HeaderAccountNotPostableError(account.id);
  }
}

export function isPostable(account: Pick<Account, "isHeader" | "status">): boolean {
  return !account.isHeader && account.status === "active";
}

/**
 * True if `candidateAncestorId` appears anywhere in `accountId`'s ancestor
 * chain (walking `parentId` links) — used to reject a reparent that would
 * create a cycle.
 */
export function isDescendantOf(
  accounts: readonly Account[],
  accountId: string,
  candidateAncestorId: string,
): boolean {
  const byId = new Map(accounts.map((a) => [a.id, a]));
  let cursor = byId.get(accountId)?.parentId ?? null;
  const seen = new Set<string>();
  while (cursor !== null) {
    if (cursor === candidateAncestorId) return true;
    if (seen.has(cursor)) return false; // defensive: pre-existing corrupt cycle, don't loop forever
    seen.add(cursor);
    cursor = byId.get(cursor)?.parentId ?? null;
  }
  return false;
}

export function hasChildren(accounts: readonly Account[], accountId: string): boolean {
  return accounts.some((a) => a.parentId === accountId);
}
