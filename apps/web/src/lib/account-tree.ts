import type { AccountDTO } from "@mezan/contracts";

/**
 * Presentation-only Chart of Accounts tree helpers for apps/web.
 *
 * Mirrors the shape of `buildAccountTree`/`flattenAccountTree` in
 * `@mezan/domain` (the real, tested hierarchy logic — see
 * packages/domain/src/accounts/hierarchy.ts) without importing the whole
 * domain package into web's bundle/typecheck: the screen only needs "nest by
 * parentId, sorted by code" for display, while the business-rule enforcement
 * stays in the domain, behind the API's create/edit routes.
 */

export interface AccountTreeNode extends AccountDTO {
  readonly children: readonly AccountTreeNode[];
}

export function buildAccountTree(accounts: readonly AccountDTO[]): AccountTreeNode[] {
  const byId = new Map(accounts.map((a) => [a.id, a]));
  const childrenOf = new Map<string | null, AccountDTO[]>();

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

export function hasChildAccounts(accounts: readonly AccountDTO[], accountId: string): boolean {
  return accounts.some((a) => a.parentId === accountId);
}

export function isDescendantOf(accounts: readonly AccountDTO[], accountId: string, candidateAncestorId: string): boolean {
  const byId = new Map(accounts.map((a) => [a.id, a]));
  let cursor = byId.get(accountId)?.parentId ?? null;
  const seen = new Set<string>();
  while (cursor !== null) {
    if (cursor === candidateAncestorId) return true;
    if (seen.has(cursor)) return false;
    seen.add(cursor);
    cursor = byId.get(cursor)?.parentId ?? null;
  }
  return false;
}
