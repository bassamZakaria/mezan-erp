import { splitReasons, type ReasonInput } from "../bilingual-reasons.js";
import type { BilingualReason } from "../collections/errors.js";
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
  readonly reasons: string[];
  readonly messageEn: string;
  constructor(reasons: readonly ReasonInput[]) {
    const split = splitReasons(reasons, "the details are not valid");
    super(`بيانات الفرع غير صالحة: ${split.ar.join("؛ ")}`);
    this.reasons = [...split.ar];
    this.messageEn = `Invalid branch: ${split.en}`;
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

function validate(branch: Branch): BilingualReason[] {
  const reasons: BilingualReason[] = [];
  if (branch.id.trim() === "") reasons.push({ ar: "معرّف الفرع مطلوب", en: "The branch ID is required" });
  if (!/^[A-Z0-9_-]{1,20}$/.test(branch.code)) {
    reasons.push({ ar: "كود الفرع يجب أن يتكوّن من 1 إلى 20 حرفاً لاتينياً كبيراً أو رقماً أو الرمزين - و _", en: "The branch code must be 1 to 20 characters: capital Latin letters, digits, hyphens or underscores" });
  }
  if (branch.name.trim() === "") reasons.push({ ar: "اسم الفرع مطلوب", en: "The branch name is required" });
  if (branch.parentBranchId === branch.id) {
    reasons.push({ ar: "لا يمكن أن يكون الفرع هو الفرع الأب لنفسه.", en: "A branch cannot be its own parent branch." });
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
