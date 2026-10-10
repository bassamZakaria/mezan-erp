import { z } from "zod";
import type { ReportParamField } from "./types.js";
import { ReportParamKind } from "./types.js";

/**
 * الفرع — the branch dimension every branch-aware report declares (D111).
 *
 * A four-branch retailer could not narrow a single report to one branch, and a
 * branch manager saw every branch's figures. The parameter is declared here
 * once so the shape is identical across reports and the parameter bar renders
 * the same control everywhere.
 *
 * ONLY reports whose source rows actually carry a branch declare it. A stock
 * report reaches the branch through the warehouse holding the goods
 * ({@link branchOfWarehouse}); the financial statements read the posted journal
 * line, which carries a branch of its own since DEC-20. Every posting path whose
 * source document has an unambiguous branch fills it (D111); company-level
 * entries and lines posted before a path was filled stay null, so every
 * statement that narrows on it must say so out loud
 * ({@link UNATTRIBUTED_BRANCH_LABEL}).
 */
export const BRANCH_PARAM_FIELD: ReportParamField = {
  kind: ReportParamKind.Branch,
  key: "branchId",
  label: "الفرع",
  allowUnattributed: false,
};

/**
 * The wire schema for that parameter.
 *
 * Defaulted rather than required: every saved view, bookmark and screen
 * predates the parameter, and a required key would turn each of them into a
 * 400 on the first load after this shipped.
 */
export const branchIdParamSchema = z.string().default("");

/**
 * Whether a row belongs to the requested branch. An empty `branchId` means
 * every branch.
 *
 * A row with no branch on it does NOT match a specific branch: this is a
 * filter the reader chose, not the authority scope. Scope keeps unattributable
 * rows visible (`withinScope`); asking for فرع القاهرة does not.
 */
export function matchesBranch(rowBranchId: string | null | undefined, branchId: string): boolean {
  return branchId === "" || rowBranchId === branchId;
}

/**
 * The bucket a posted line with no branch on it falls into (DEC-20), as a
 * selectable value of the branch parameter.
 *
 * `branchId` is nullable. Documents raised in a branch, or moving stock held
 * in one, carry it; a manual journal only when the poster picks a branch; and
 * company-level entries — opening balances, unrealised FX revaluation, HR
 * provisions, contracting certificates, a company-wide asset's depreciation —
 * carry none at all. Branch columns therefore do NOT sum to the entity on their own,
 * and the only honest statement is one that names what is left over. The
 * bucket is always reachable and is never defaulted away.
 */
export const UNATTRIBUTED_BRANCH_ID = "__unattributed__";
export const UNATTRIBUTED_BRANCH_LABEL = "غير مخصص";

/**
 * The branch parameter as a financial statement declares it: every branch, one
 * branch, or the «غير مخصص» bucket on its own.
 */
export const BRANCH_STATEMENT_PARAM_FIELD: ReportParamField = {
  kind: ReportParamKind.Branch,
  key: "branchId",
  label: "الفرع",
  allowUnattributed: true,
};

/**
 * What every branch-narrowed statement prints above its figures.
 *
 * Said in the report itself because it is not a caveat a reader can infer from
 * the numbers: these are MANAGEMENT branch figures, not statutory branch books.
 * Cash and stock moved between branches post one balanced entry across both, so
 * neither side carries a due-to/due-from, and a branch's statement therefore
 * neither shows what it owes another branch nor what it is owed.
 */
export const BRANCH_STATEMENT_NOTE_AR =
  "عرض إداري للفروع وليس دفاتر فرعية نظامية: تحويلات النقدية والبضاعة بين الفروع تُرحَّل في قيد واحد بلا حسابات تسوية بينية (مستحق لـ/من فرع)، " +
  `كما أن بُعد الفرع يُملأ تدريجياً — لذلك لا تتساوى مجاميع الفروع مع إجمالي المنشأة إلا بإضافة «${UNATTRIBUTED_BRANCH_LABEL}»، وهو معروض دائماً.`;

/**
 * Whether a posted line belongs to the branch the reader asked for. An empty
 * `branchId` means every branch; {@link UNATTRIBUTED_BRANCH_ID} means only the
 * lines that carry none.
 *
 * A line with no branch does NOT match a specific branch — that is what makes
 * the «غير مخصص» bucket a real, separately readable figure rather than an
 * amount silently folded into whichever branch was asked for.
 */
export function matchesStatementBranch(rowBranchId: string | null | undefined, branchId: string): boolean {
  if (branchId === "") return true;
  if (branchId === UNATTRIBUTED_BRANCH_ID) return rowBranchId == null || rowBranchId === "";
  return rowBranchId === branchId;
}

/**
 * Whether a posted line is inside the caller's own branch authority.
 *
 * AUTHORITY, not presentation: a caller scoped to فرع القاهرة never receives
 * another branch's figures whatever they pass as `branchId`. Unattributable
 * lines stay visible, exactly as `withinScope` keeps them — same rule, and the
 * reason a scoped trial balance still balances for whole-document postings.
 */
export function withinBranchScope(
  rowBranchId: string | null | undefined,
  scope: readonly string[] | undefined,
  includeUnattributed = true,
): boolean {
  if (rowBranchId == null || rowBranchId === "") return includeUnattributed;
  return !scope || scope.includes(rowBranchId);
}

/**
 * Resolves the branch that holds a warehouse — the only route from stock to a
 * branch, since movements, cost layers and WAC snapshots carry a warehouse and
 * never a branch.
 */
export function branchOfWarehouse(
  warehouses: readonly { readonly id: string; readonly branchId: string }[] | undefined,
): (warehouseId: string) => string | null {
  const index = new Map((warehouses ?? []).map((warehouse) => [warehouse.id, warehouse.branchId]));
  return (warehouseId) => index.get(warehouseId) ?? null;
}
