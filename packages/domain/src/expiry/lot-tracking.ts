import { LotIssueKind, type LotRequirementLookup } from "./types.js";
import { isExpiryIsoDay } from "./dates.js";

export interface LotIssue {
  readonly itemId: string;
  readonly itemLabel: string;
  readonly kind: LotIssueKind;
  readonly expiryDate?: string | null;
}

export interface LotCheckedLine {
  readonly itemId: string;
  readonly batchNo?: string | null;
  readonly expiryDate?: string | null;
}

const ISSUE_AR: Record<LotIssueKind, string> = {
  [LotIssueKind.MissingBatch]: "يتتبع التشغيلات: أدخل رقم التشغيلة",
  [LotIssueKind.MissingExpiry]: "يتتبع الصلاحية: أدخل تاريخ صلاحية صحيحاً",
  [LotIssueKind.ExpiredOnReceipt]: "تاريخ صلاحيته سابق لتاريخ الاستلام",
};

const ISSUE_EN: Record<LotIssueKind, string> = {
  [LotIssueKind.MissingBatch]: "tracks batches: enter the batch number",
  [LotIssueKind.MissingExpiry]: "tracks expiry: enter a valid expiry date",
  [LotIssueKind.ExpiredOnReceipt]: "expires before the receipt date",
};

export class LotDetailsRequiredError extends Error {
  readonly code = "LOT_DETAILS_REQUIRED";
  readonly messageEn: string;
  constructor(readonly issues: readonly LotIssue[]) {
    super(
      `بيانات التشغيلة ناقصة أو غير صالحة: ${issues
        .map((i) => `الصنف "${i.itemLabel}" ${ISSUE_AR[i.kind]}`)
        .join("؛ ")}.`,
    );
    this.messageEn = `Batch details are missing or invalid: ${issues
      .map((i) => `item "${i.itemLabel}" ${ISSUE_EN[i.kind]}`)
      .join("; ")}.`;
    this.name = "LotDetailsRequiredError";
  }
}

export interface LotCheckOptions {
  readonly receivedOn?: string | null;
}

export async function lotIssuesOf(
  lines: readonly LotCheckedLine[],
  lookup: LotRequirementLookup,
  options: LotCheckOptions = {},
): Promise<LotIssue[]> {
  const issues: LotIssue[] = [];
  const cache = new Map<string, Awaited<ReturnType<LotRequirementLookup>>>();
  for (const line of lines) {
    if (!cache.has(line.itemId)) cache.set(line.itemId, await lookup(line.itemId));
    const requirement = cache.get(line.itemId);
    if (!requirement) continue;
    const itemLabel = requirement.labelAr ?? line.itemId;
    const batch = (line.batchNo ?? "").trim();
    const expiry = (line.expiryDate ?? "").trim();
    if (requirement.batch && batch === "") issues.push({ itemId: line.itemId, itemLabel, kind: LotIssueKind.MissingBatch });
    if (requirement.expiry && !isExpiryIsoDay(expiry)) {
      issues.push({ itemId: line.itemId, itemLabel, kind: LotIssueKind.MissingExpiry });
      continue;
    }
    if (expiry !== "" && options.receivedOn && isExpiryIsoDay(expiry) && expiry < options.receivedOn) {
      issues.push({ itemId: line.itemId, itemLabel, kind: LotIssueKind.ExpiredOnReceipt, expiryDate: expiry });
    }
  }
  return issues;
}

export async function assertLotDetails(
  lines: readonly LotCheckedLine[],
  lookup: LotRequirementLookup | undefined,
  options: LotCheckOptions = {},
): Promise<void> {
  if (!lookup) return;
  const issues = await lotIssuesOf(lines, lookup, options);
  if (issues.length > 0) throw new LotDetailsRequiredError(issues);
}
