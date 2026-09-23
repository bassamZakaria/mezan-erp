import type { Context } from "hono";
import { LimitKind } from "@mezan/domain";
import { refuseOverLimitLocation } from "./plan-locations.js";

/**
 * Refuses a document that names a master record the tenant does not hold (D310).
 *
 * `supplierId` was validated as `z.string().min(1)` and nothing else, so
 * `POST /purchases/invoices` accepted `SUP-DEMO-1` — an id no supplier has —
 * and answered 201. The aging ladders read invoices rather than the master, so
 * the phantom then appeared as a supplier owed 342.00 whose drill-down 404s.
 * The same hole existed for `customerId`, `warehouseId`, `branchId` and
 * `costCenterId` on every document route that persists them.
 *
 * The check is a dependency rather than a schema rule because zod cannot reach
 * the tenant's repositories, and each kind is optional for the same reason
 * `ItemCatalogCheck` is: a caller that does not wire it gets the old behaviour
 * rather than a route that cannot be mounted.
 */
export enum MasterDataKind {
  Customer = "customer",
  Supplier = "supplier",
  Warehouse = "warehouse",
  Branch = "branch",
  CostCenter = "cost_center",
}

export interface MasterRecordCheck {
  findById(id: string): Promise<{ readonly id: string } | null | undefined>;
}

export type MasterDataChecks = Partial<Readonly<Record<MasterDataKind, MasterRecordCheck>>>;

export interface MasterDataRef {
  readonly kind: MasterDataKind;
  readonly ids: readonly (string | null | undefined)[];
}

interface RefusalCopy {
  readonly error: string;
  readonly field: string;
  readonly ar: string;
  readonly en: string;
}

const REFUSALS: Readonly<Record<MasterDataKind, RefusalCopy>> = {
  [MasterDataKind.Customer]: {
    error: "CUSTOMER_NOT_FOUND",
    field: "customerIds",
    ar: "عملاء غير موجودين في دليل العملاء",
    en: "Customers that are not in the customer master",
  },
  [MasterDataKind.Supplier]: {
    error: "SUPPLIER_NOT_FOUND",
    field: "supplierIds",
    ar: "موردون غير موجودين في دليل الموردين",
    en: "Suppliers that are not in the supplier master",
  },
  [MasterDataKind.Warehouse]: {
    error: "WAREHOUSE_NOT_FOUND",
    field: "warehouseIds",
    ar: "مستودعات غير موجودة في دليل المستودعات",
    en: "Warehouses that are not in the warehouse master",
  },
  [MasterDataKind.Branch]: {
    error: "BRANCH_NOT_FOUND",
    field: "branchIds",
    ar: "فروع غير موجودة في دليل الفروع",
    en: "Branches that are not in the branch master",
  },
  [MasterDataKind.CostCenter]: {
    error: "COST_CENTER_NOT_FOUND",
    field: "costCenterIds",
    ar: "مراكز تكلفة غير موجودة في دليل مراكز التكلفة",
    en: "Cost centres that are not in the cost-centre master",
  },
};

/** Ids of one kind that its repository does not hold, in first-seen order. */
export async function unknownMasterIds(
  check: MasterRecordCheck,
  ids: readonly (string | null | undefined)[],
): Promise<readonly string[]> {
  const distinct = [...new Set(ids.filter((id): id is string => typeof id === "string" && id !== ""))];
  const found = await Promise.all(distinct.map(async (id) => ({ id, hit: await check.findById(id) })));
  return found.filter((r) => !r.hit).map((r) => r.id);
}

/**
 * Returns a 422 body naming the first kind that has an unknown id, or null.
 *
 * The message is Arabic because a domain refusal reaches an Arabic UI, and
 * `messageEn` carries the English half of the same reason.
 */
export async function refuseUnknownMasterData(
  c: Context,
  checks: MasterDataChecks | undefined,
  refs: readonly MasterDataRef[],
): Promise<Response | null> {
  // The plan-limit check runs even with no master-data checks wired: it is a
  // licence rule, not a referential one, and every route that names a branch
  // or a warehouse on a write already calls through here.
  for (const ref of refs) {
    const kind =
      ref.kind === MasterDataKind.Branch
        ? LimitKind.Branches
        : ref.kind === MasterDataKind.Warehouse
          ? LimitKind.Warehouses
          : null;
    if (!kind) continue;
    const overLimit = await refuseOverLimitLocation(c, kind, ref.ids);
    if (overLimit) return overLimit;
  }
  if (!checks) return null;
  for (const ref of refs) {
    const check = checks[ref.kind];
    if (!check) continue;
    const unknown = await unknownMasterIds(check, ref.ids);
    if (unknown.length === 0) continue;
    const copy = REFUSALS[ref.kind];
    const joined = unknown.join("، ");
    return c.json(
      {
        error: copy.error,
        [copy.field]: unknown,
        message: `${copy.ar}: ${joined}`,
        messageEn: `${copy.en}: ${unknown.join(", ")}`,
      },
      422,
    );
  }
  return null;
}
