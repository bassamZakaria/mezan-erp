/**
 * Branch — docs/archive/catalog/09 §"إدارة الفروع (Branches list)" / §"صفحة الفرع —
 * MAIN (Branch detail / Branch 360)". A branch is a first-class operational
 * unit (own treasury accounts, inventory, staff roster) that can be flagged
 * "main" and can nest under a parent branch (the catalog's "الفرع الرئيسي"
 * table column implies sub-branch hierarchy).
 */

export interface Branch {
  readonly id: string;
  readonly code: string;
  readonly name: string;
  readonly parentBranchId: string | null;
  readonly phone: string | null;
  readonly email: string | null;
  readonly address: string | null;
  readonly isMain: boolean;
  readonly active: boolean;
}

export class InvalidBranchError extends Error {
  readonly code = "INVALID_BRANCH";
  constructor(reasons: readonly string[]) {
    super(`Invalid branch: ${reasons.join("; ")}`);
    this.name = "InvalidBranchError";
  }
}

export interface CreateBranchInput {
  readonly id: string;
  readonly code: string;
  readonly name: string;
  readonly parentBranchId?: string | null;
  readonly phone?: string | null;
  readonly email?: string | null;
  readonly address?: string | null;
  readonly isMain?: boolean;
  readonly active?: boolean;
}

function validate(branch: Branch): string[] {
  const reasons: string[] = [];
  if (branch.id.trim() === "") reasons.push("id is required");
  if (!/^[A-Z0-9_-]{1,20}$/.test(branch.code)) {
    reasons.push("code must be 1-20 uppercase alphanumeric/-/_ characters");
  }
  if (branch.name.trim() === "") reasons.push("name is required");
  if (branch.parentBranchId === branch.id) {
    reasons.push("a branch cannot be its own parent");
  }
  return reasons;
}

/** Constructs a `Branch`, applying sane defaults and enforcing invariants. */
export function createBranch(input: CreateBranchInput): Branch {
  const branch: Branch = {
    id: input.id,
    code: input.code,
    name: input.name,
    parentBranchId: input.parentBranchId ?? null,
    phone: input.phone ?? null,
    email: input.email ?? null,
    address: input.address ?? null,
    isMain: input.isMain ?? false,
    active: input.active ?? true,
  };
  const reasons = validate(branch);
  if (reasons.length > 0) throw new InvalidBranchError(reasons);
  return branch;
}

/** Applies a patch to an existing branch, re-validating the result. */
export function updateBranch(current: Branch, patch: Partial<Omit<Branch, "id">>): Branch {
  const next: Branch = { ...current, ...patch };
  const reasons = validate(next);
  if (reasons.length > 0) throw new InvalidBranchError(reasons);
  return next;
}
