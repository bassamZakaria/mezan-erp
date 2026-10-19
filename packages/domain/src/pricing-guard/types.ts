import { Money, Qty } from "../money/index.js";

export enum PricingGuardMode {
  Block = "block",
  Approval = "approval",
}

export enum PricingGuardRuleStatus {
  Active = "active",
  Inactive = "inactive",
}

export enum PricingGuardScope {
  Item = "item",
  Category = "category",
  CustomerCategory = "customer_category",
  All = "all",
}

export enum PricingGuardBreachKind {
  BelowFloor = "below_floor",
  BelowMinMargin = "below_min_margin",
}

export enum PricingGuardLineOutcome {
  Pass = "pass",
  NeedsApproval = "needs_approval",
  Blocked = "blocked",
}

export enum PricingGuardCostBasis {
  Wac = "wac",
  ItemCostPrice = "item_cost_price",
  None = "none",
}

export enum PricingGuardDocType {
  SalesInvoice = "sales_invoice",
  SalesQuote = "sales_quote",
}

export enum PricingGuardOverrideKind {
  ApprovedByChain = "approved_by_chain",
  AdminBypass = "admin_bypass",
  QuoteSentBelowFloor = "quote_sent_below_floor",
}

export interface PricingGuardRule {
  readonly id: string;
  readonly nameAr: string;
  readonly itemId: string | null;
  readonly categoryId: string | null;
  readonly customerCategory: string | null;
  readonly floorPrice: Money | null;
  readonly minMarginPercent: number | null;
  readonly mode: PricingGuardMode;
  readonly status: PricingGuardRuleStatus;
  readonly note: string | null;
  readonly createdAt: string;
  readonly updatedAt: string;
  readonly createdBy: string;
  readonly updatedBy: string;
}

export interface PricingGuardRuleRepository {
  findById(id: string): Promise<PricingGuardRule | null>;
  list(): Promise<readonly PricingGuardRule[]>;
  insert(rule: PricingGuardRule): Promise<void>;
  save(rule: PricingGuardRule): Promise<void>;
}

export interface PricingGuardBreach {
  readonly ruleId: string;
  readonly ruleNameAr: string;
  readonly kind: PricingGuardBreachKind;
  readonly mode: PricingGuardMode;
  readonly floorPrice: Money | null;
  readonly minMarginPercent: number | null;
}

export interface PricingGuardEvaluationLineInput {
  readonly lineId: string;
  readonly itemId: string;
  readonly categoryIds: readonly string[];
  readonly baseQty: Qty;
  readonly netBase: Money | null;
  readonly unitCostBase: Money | null;
  readonly costBasis: PricingGuardCostBasis;
}

export interface PricingGuardLineEvaluation {
  readonly lineId: string;
  readonly itemId: string;
  readonly outcome: PricingGuardLineOutcome;
  readonly breaches: readonly PricingGuardBreach[];
  readonly netBase: Money | null;
  readonly netUnitPrice: Money | null;
  readonly unitCost: Money | null;
  readonly costBasis: PricingGuardCostBasis;
  readonly marginBasisPoints: bigint | null;
}

export interface PricingGuardEvaluation {
  readonly outcome: PricingGuardLineOutcome;
  readonly lines: readonly PricingGuardLineEvaluation[];
}

export interface PricingGuardDocumentLine {
  readonly lineId: string;
  readonly itemId: string;
  readonly baseQty: Qty;
  readonly netAmount: Money;
}

export interface PricingGuardDocumentInput {
  readonly docType: PricingGuardDocType;
  readonly docId: string;
  readonly date: string;
  readonly customerId: string;
  readonly branchId: string;
  readonly warehouseId: string | null;
  readonly currency: string;
  readonly lines: readonly PricingGuardDocumentLine[];
}

export interface PricingGuardOverride {
  readonly id: string;
  readonly docType: PricingGuardDocType;
  readonly docId: string;
  readonly docNo: string | null;
  readonly docDate: string;
  readonly customerId: string;
  readonly customerNameAr: string;
  readonly branchId: string;
  readonly lineId: string;
  readonly itemId: string;
  readonly baseQty: Qty;
  readonly netBase: Money;
  readonly netUnitPrice: Money;
  readonly unitCost: Money | null;
  readonly costBasis: PricingGuardCostBasis;
  readonly marginBasisPoints: bigint | null;
  readonly breaches: readonly PricingGuardBreach[];
  readonly kind: PricingGuardOverrideKind;
  readonly approvalRequestId: string | null;
  readonly actor: string;
  readonly recordedAt: string;
}

export interface PricingGuardOverrideFilter {
  readonly fromDate?: string;
  readonly toDate?: string;
  readonly customerId?: string;
  readonly itemId?: string;
  readonly docType?: PricingGuardDocType;
  readonly branchScope?: readonly string[] | null;
}

export interface PricingGuardOverrideRepository {
  recordAll(rows: readonly PricingGuardOverride[]): Promise<void>;
  list(filter: PricingGuardOverrideFilter): Promise<readonly PricingGuardOverride[]>;
}

const PRICE_FLOOR_REQUEST_SUFFIX = ":price-floor";

/** SECURITY: derived from the stored document's id only, never from anything a caller sends — same rule as `confirmRequestIdOf`. */
export function priceFloorRequestIdOf(documentId: string): string {
  return `${documentId}${PRICE_FLOOR_REQUEST_SUFFIX}`;
}

export function scopeOfRule(rule: Pick<PricingGuardRule, "itemId" | "categoryId" | "customerCategory">): PricingGuardScope {
  if (rule.itemId) return PricingGuardScope.Item;
  if (rule.categoryId) return PricingGuardScope.Category;
  if (rule.customerCategory) return PricingGuardScope.CustomerCategory;
  return PricingGuardScope.All;
}

export const PRICE_FLOOR_ACTION_TYPE = "SALES_PRICE_FLOOR_OVERRIDE" as const;
export const PRICE_FLOOR_APPROVE_PERMISSION = "sales.pricing_guard.approve";
export const PRICE_FLOOR_MANAGE_PERMISSION = "sales.pricing_guard.manage";
