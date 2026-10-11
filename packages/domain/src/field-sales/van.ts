/**
 * المركبات — the van registry (R3.13). A van is the physical thing a rep
 * drives; the warehouse it carries stock in and the till it carries cash in
 * belong to it, not to the trip.
 *
 * This exists because the trip form previously asked for the van warehouse and
 * the van treasury as three unrelated dropdowns, so any combination could be
 * opened: van A's stock could be settled into van B's cash. Naming the van now
 * decides both, and the server resolves them from THIS registry rather than
 * believing what the request body claims.
 */

export interface Van {
  readonly id: string;
  readonly code: string;
  readonly nameAr: string;
  readonly nameEn: string | null;
  /** Plate number as it appears on the vehicle — how a warehouse keeper actually names one. */
  readonly plateNumber: string | null;
  readonly branchId: string;
  /** The VAN-type warehouse this vehicle's stock sits in. */
  readonly warehouseId: string;
  /** The till the vehicle's cash sits in. */
  readonly treasuryAccountId: string;
  readonly active: boolean;
}

export class InvalidVanError extends Error {
  readonly code = "INVALID_VAN";
  constructor(readonly reasons: readonly string[]) {
    super(reasons.join("، "));
    this.name = "InvalidVanError";
  }
}

export class VanNotFoundError extends Error {
  readonly code = "VAN_NOT_FOUND";
  constructor(readonly vanId: string) {
    super(`المركبة "${vanId}" غير موجودة.`);
    this.name = "VanNotFoundError";
  }
}

/**
 * Raised when a trip names a van AND a warehouse or till that is not the one
 * the registry holds for it. Refusing beats quietly overwriting: a caller that
 * meant a different van should say so, not have its choice silently replaced.
 */
export class VanCascadeMismatchError extends Error {
  readonly code = "VAN_CASCADE_MISMATCH";
  constructor(readonly vanId: string, readonly field: "warehouse" | "treasury") {
    super(
      field === "warehouse"
        ? `المستودع المحدد لا يخص المركبة "${vanId}".`
        : `الخزينة المحددة لا تخص المركبة "${vanId}".`,
    );
    this.name = "VanCascadeMismatchError";
  }
}

export interface CreateVanInput {
  readonly id: string;
  readonly code: string;
  readonly nameAr: string;
  readonly nameEn?: string | null;
  readonly plateNumber?: string | null;
  readonly branchId: string;
  readonly warehouseId: string;
  readonly treasuryAccountId: string;
  readonly active?: boolean;
}

export function createVan(input: CreateVanInput): Van {
  const reasons: string[] = [];
  if (input.id.trim() === "") reasons.push("معرف المركبة مطلوب");
  if (input.code.trim() === "") reasons.push("كود المركبة مطلوب");
  if (input.nameAr.trim() === "") reasons.push("اسم المركبة بالعربية مطلوب");
  if (input.branchId.trim() === "") reasons.push("الفرع مطلوب");
  if (input.warehouseId.trim() === "") reasons.push("مستودع المركبة مطلوب");
  if (input.treasuryAccountId.trim() === "") reasons.push("خزينة المركبة مطلوبة");
  if (reasons.length > 0) throw new InvalidVanError(reasons);

  return {
    id: input.id,
    code: input.code,
    nameAr: input.nameAr,
    nameEn: input.nameEn ?? null,
    plateNumber: input.plateNumber ?? null,
    branchId: input.branchId,
    warehouseId: input.warehouseId,
    treasuryAccountId: input.treasuryAccountId,
    active: input.active ?? true,
  };
}

/** Persistence port for the van registry. The domain depends on this interface only — no SQL, no driver. */
export interface VanRepository {
  findById(id: string): Promise<Van | null>;
  list(): Promise<readonly Van[]>;
  save(van: Van): Promise<void>;
  insert(van: Van): Promise<void>;
}

/**
 * The cascade, applied server-side. `claimed` is whatever the request body
 * carried: a value that agrees with the registry is kept, one that contradicts
 * it is refused, and an absent one is filled in from the van. Never trust a
 * number the caller supplied — including which warehouse a van uses.
 */
export function resolveVanCascade(
  van: Van,
  claimed: { warehouseId?: string | null; treasuryAccountId?: string | null },
): { warehouseId: string; treasuryAccountId: string; branchId: string } {
  if (claimed.warehouseId && claimed.warehouseId !== van.warehouseId) {
    throw new VanCascadeMismatchError(van.id, "warehouse");
  }
  if (claimed.treasuryAccountId && claimed.treasuryAccountId !== van.treasuryAccountId) {
    throw new VanCascadeMismatchError(van.id, "treasury");
  }
  return { warehouseId: van.warehouseId, treasuryAccountId: van.treasuryAccountId, branchId: van.branchId };
}
