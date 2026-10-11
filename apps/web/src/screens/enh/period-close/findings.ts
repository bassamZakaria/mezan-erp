import type { PillTone } from "@mezan/ui";
import {
  PeriodCloseCheckCodeDTO,
  PeriodCloseCheckStatusDTO,
  PeriodCloseDocKindDTO,
  PeriodCloseFindingKindDTO,
  PeriodCloseFindingStateDTO,
  PeriodCloseTieKeyDTO,
  periodCloseDocKindSchema,
  periodCloseTieKeySchema,
  type PeriodCloseCheckDTO,
  type PeriodCloseFindingDTO,
  type PeriodCloseFixTargetDTO,
} from "@mezan/contracts";
import type { AppI18n, AppTranslationKey } from "../../../i18n";

export type Translate = AppI18n["t"];

export interface FindingFormatters {
  readonly money: (value: string) => string;
  readonly number: (value: number) => string;
  readonly date: (value: string) => string;
  readonly branchName: (branchId: string) => string;
}

export const CHECK_TITLE_KEY: Readonly<Record<PeriodCloseCheckCodeDTO, AppTranslationKey>> = {
  [PeriodCloseCheckCodeDTO.Drafts]: "periodClose.check.drafts",
  [PeriodCloseCheckCodeDTO.PendingApprovals]: "periodClose.check.pending_approvals",
  [PeriodCloseCheckCodeDTO.SubledgerTies]: "periodClose.check.subledger_ties",
  [PeriodCloseCheckCodeDTO.TrialBalance]: "periodClose.check.trial_balance",
  [PeriodCloseCheckCodeDTO.BankStatements]: "periodClose.check.bank_statements",
  [PeriodCloseCheckCodeDTO.FxRevaluation]: "periodClose.check.fx_revaluation",
  [PeriodCloseCheckCodeDTO.RecurringJournals]: "periodClose.check.recurring_journals",
  [PeriodCloseCheckCodeDTO.Depreciation]: "periodClose.check.depreciation",
  [PeriodCloseCheckCodeDTO.SequenceGaps]: "periodClose.check.sequence_gaps",
  [PeriodCloseCheckCodeDTO.EtaErrors]: "periodClose.check.eta_errors",
};

export const CHECK_BODY_KEY: Readonly<Record<PeriodCloseCheckCodeDTO, AppTranslationKey>> = {
  [PeriodCloseCheckCodeDTO.Drafts]: "periodClose.check.drafts.body",
  [PeriodCloseCheckCodeDTO.PendingApprovals]: "periodClose.check.pending_approvals.body",
  [PeriodCloseCheckCodeDTO.SubledgerTies]: "periodClose.check.subledger_ties.body",
  [PeriodCloseCheckCodeDTO.TrialBalance]: "periodClose.check.trial_balance.body",
  [PeriodCloseCheckCodeDTO.BankStatements]: "periodClose.check.bank_statements.body",
  [PeriodCloseCheckCodeDTO.FxRevaluation]: "periodClose.check.fx_revaluation.body",
  [PeriodCloseCheckCodeDTO.RecurringJournals]: "periodClose.check.recurring_journals.body",
  [PeriodCloseCheckCodeDTO.Depreciation]: "periodClose.check.depreciation.body",
  [PeriodCloseCheckCodeDTO.SequenceGaps]: "periodClose.check.sequence_gaps.body",
  [PeriodCloseCheckCodeDTO.EtaErrors]: "periodClose.check.eta_errors.body",
};

export const CHECK_STATUS_KEY: Readonly<Record<PeriodCloseCheckStatusDTO, AppTranslationKey>> = {
  [PeriodCloseCheckStatusDTO.Pass]: "periodClose.status.pass",
  [PeriodCloseCheckStatusDTO.Fail]: "periodClose.status.fail",
  [PeriodCloseCheckStatusDTO.NotApplicable]: "periodClose.status.not_applicable",
  [PeriodCloseCheckStatusDTO.Unavailable]: "periodClose.status.unavailable",
};

export const CHECK_STATUS_TONE: Readonly<Record<PeriodCloseCheckStatusDTO, PillTone>> = {
  [PeriodCloseCheckStatusDTO.Pass]: "success",
  [PeriodCloseCheckStatusDTO.Fail]: "danger",
  [PeriodCloseCheckStatusDTO.NotApplicable]: "neutral",
  [PeriodCloseCheckStatusDTO.Unavailable]: "warning",
};

const FINDING_STATE_KEY: Readonly<Record<PeriodCloseFindingStateDTO, AppTranslationKey>> = {
  [PeriodCloseFindingStateDTO.Ok]: "periodClose.state.ok",
  [PeriodCloseFindingStateDTO.Missing]: "periodClose.state.missing",
  [PeriodCloseFindingStateDTO.Draft]: "periodClose.state.draft",
  [PeriodCloseFindingStateDTO.Pending]: "periodClose.state.pending",
  [PeriodCloseFindingStateDTO.NotFinalized]: "periodClose.state.not_finalized",
  [PeriodCloseFindingStateDTO.Mismatch]: "periodClose.state.mismatch",
  [PeriodCloseFindingStateDTO.Reversed]: "periodClose.state.reversed",
  [PeriodCloseFindingStateDTO.NotCovered]: "periodClose.state.not_covered",
  [PeriodCloseFindingStateDTO.ForcedFinalization]: "periodClose.state.forced_finalization",
  [PeriodCloseFindingStateDTO.DoubleCharged]: "periodClose.state.double_charged",
};

const DOC_KIND_KEY: Readonly<Record<PeriodCloseDocKindDTO, AppTranslationKey>> = {
  [PeriodCloseDocKindDTO.JournalEntry]: "periodClose.doc.journal_entry",
  [PeriodCloseDocKindDTO.SalesInvoice]: "periodClose.doc.sales_invoice",
  [PeriodCloseDocKindDTO.PurchaseInvoice]: "periodClose.doc.purchase_invoice",
  [PeriodCloseDocKindDTO.GoodsReceipt]: "periodClose.doc.goods_receipt",
  [PeriodCloseDocKindDTO.Voucher]: "periodClose.doc.voucher",
  [PeriodCloseDocKindDTO.SalesReturn]: "periodClose.doc.sales_return",
  [PeriodCloseDocKindDTO.PurchaseReturn]: "periodClose.doc.purchase_return",
  [PeriodCloseDocKindDTO.LandedCost]: "periodClose.doc.landed_cost",
  [PeriodCloseDocKindDTO.StockTransfer]: "periodClose.doc.stock_transfer",
  [PeriodCloseDocKindDTO.StockAdjustment]: "periodClose.doc.stock_adjustment",
  [PeriodCloseDocKindDTO.DepreciationRun]: "periodClose.doc.depreciation_run",
  [PeriodCloseDocKindDTO.WritedownRun]: "periodClose.doc.writedown_run",
  [PeriodCloseDocKindDTO.PayrollRun]: "periodClose.doc.payroll_run",
  [PeriodCloseDocKindDTO.ProgressCertificate]: "periodClose.doc.progress_certificate",
  [PeriodCloseDocKindDTO.SubcontractCertificate]: "periodClose.doc.subcontract_certificate",
  [PeriodCloseDocKindDTO.PhysicalCount]: "periodClose.doc.physical_count",
  [PeriodCloseDocKindDTO.SiteIssue]: "periodClose.doc.site_issue",
  [PeriodCloseDocKindDTO.SiteReceipt]: "periodClose.doc.site_receipt",
  [PeriodCloseDocKindDTO.MaterialConsumption]: "periodClose.doc.material_consumption",
  [PeriodCloseDocKindDTO.EquipmentLog]: "periodClose.doc.equipment_log",
};

const TIE_KEY: Readonly<Record<PeriodCloseTieKeyDTO, AppTranslationKey>> = {
  [PeriodCloseTieKeyDTO.Inventory]: "periodClose.tie.inventory",
  [PeriodCloseTieKeyDTO.Receivables]: "periodClose.tie.ar",
  [PeriodCloseTieKeyDTO.Payables]: "periodClose.tie.ap",
  [PeriodCloseTieKeyDTO.RetentionReceivable]: "periodClose.tie.contracting_retention_receivable",
  [PeriodCloseTieKeyDTO.RetentionPayable]: "periodClose.tie.contracting_retention_payable",
  [PeriodCloseTieKeyDTO.CustomerAdvances]: "periodClose.tie.contracting_customer_advances",
  [PeriodCloseTieKeyDTO.WorkInProgress]: "periodClose.tie.contracting_wip",
  [PeriodCloseTieKeyDTO.Billings]: "periodClose.tie.contracting_billings",
  [PeriodCloseTieKeyDTO.ContractAsset]: "periodClose.tie.contracting_contract_asset",
  [PeriodCloseTieKeyDTO.ContractLiability]: "periodClose.tie.contracting_contract_liability",
};

const MAX_LISTED_NUMBERS = 5;

export function fixScreenLabelKey(fix: PeriodCloseFixTargetDTO): AppTranslationKey {
  return `nav.item.${fix}`;
}

export function findingStateLabel(finding: PeriodCloseFindingDTO, t: Translate): string {
  return t(FINDING_STATE_KEY[finding.state]);
}

function tieName(finding: PeriodCloseFindingDTO, t: Translate): string {
  const key = periodCloseTieKeySchema.safeParse(finding.ref);
  return key.success ? t(TIE_KEY[key.data]) : (finding.label ?? finding.ref);
}

export function findingTitle(finding: PeriodCloseFindingDTO, t: Translate, format: FindingFormatters): string {
  switch (finding.kind) {
    case PeriodCloseFindingKindDTO.Drafts:
    case PeriodCloseFindingKindDTO.PendingApproval: {
      const kind = periodCloseDocKindSchema.safeParse(finding.ref);
      return kind.success ? t(DOC_KIND_KEY[kind.data]) : finding.ref;
    }
    case PeriodCloseFindingKindDTO.Tie:
      return t("periodClose.finding.tie", { name: tieName(finding, t), account: finding.items[0] ?? "" });
    case PeriodCloseFindingKindDTO.TrialBalance:
      return t("periodClose.finding.trialBalance");
    case PeriodCloseFindingKindDTO.ForeignCurrency:
      return t("periodClose.finding.currency", { currency: finding.ref });
    case PeriodCloseFindingKindDTO.RecurringTemplate:
      return t("periodClose.finding.recurring", { name: finding.label ?? finding.ref, period: finding.items[0] ?? "" });
    case PeriodCloseFindingKindDTO.DepreciationRun:
      return t("periodClose.finding.depreciation", {
        period: finding.items[0] ?? "",
        branch: finding.label ? format.branchName(finding.label) : t("periodClose.finding.generalAssets"),
      });
    case PeriodCloseFindingKindDTO.SequenceGap:
      return t("periodClose.finding.sequence", { series: finding.label ?? finding.ref });
    case PeriodCloseFindingKindDTO.EtaSubmission:
      return t("periodClose.finding.eta", { count: format.number(finding.count ?? 0) });
    case PeriodCloseFindingKindDTO.BankStatement:
      return finding.label ?? finding.ref;
    case PeriodCloseFindingKindDTO.PayrollDue:
      return t("periodClose.finding.payroll", { period: finding.items[0] ?? finding.ref });
    case PeriodCloseFindingKindDTO.PayrollPartMonthTax:
      return t("periodClose.finding.partMonthTax", { period: finding.items[0] ?? finding.ref });
  }
}

export function findingFigure(finding: PeriodCloseFindingDTO, t: Translate, format: FindingFormatters): string {
  switch (finding.kind) {
    case PeriodCloseFindingKindDTO.Tie:
    case PeriodCloseFindingKindDTO.TrialBalance:
      return t("periodClose.finding.difference", { amount: format.money(finding.amount ?? "0") });
    case PeriodCloseFindingKindDTO.SequenceGap:
      return t("periodClose.finding.sequenceMissing", {
        count: format.number(finding.count ?? 0),
        numbers: finding.items.slice(0, MAX_LISTED_NUMBERS).join(t("periodClose.listSeparator")),
      });
    case PeriodCloseFindingKindDTO.BankStatement:
    case PeriodCloseFindingKindDTO.ForeignCurrency:
      return finding.asOfDate ? t("periodClose.finding.asOf", { date: format.date(finding.asOfDate) }) : "";
    case PeriodCloseFindingKindDTO.Drafts:
    case PeriodCloseFindingKindDTO.PendingApproval:
      return t("periodClose.finding.count", { count: format.number(finding.count ?? 0) });
    case PeriodCloseFindingKindDTO.DepreciationRun: {
      if (finding.passed) return t("periodClose.finding.assetsCovered", { count: format.number(finding.count ?? 0) });
      const key = finding.state === PeriodCloseFindingStateDTO.DoubleCharged ? "periodClose.finding.assetsDoubleCharged" : "periodClose.finding.assetsUncovered";
      return t(key, { count: format.number(finding.count ?? 0), assets: finding.items.slice(1).join(t("periodClose.listSeparator")) });
    }
    case PeriodCloseFindingKindDTO.PayrollDue:
      return t("periodClose.finding.employeesUnpaid", { count: format.number(finding.count ?? 0) });
    case PeriodCloseFindingKindDTO.PayrollPartMonthTax:
      return t("periodClose.finding.partMonthTaxDetail", { count: format.number(finding.count ?? 0) });
    case PeriodCloseFindingKindDTO.RecurringTemplate:
    case PeriodCloseFindingKindDTO.EtaSubmission:
      return "";
  }
}

export function checkHeadline(check: PeriodCloseCheckDTO, t: Translate): string {
  if (check.status === PeriodCloseCheckStatusDTO.Unavailable) return t("periodClose.unavailableHint");
  if (check.status === PeriodCloseCheckStatusDTO.NotApplicable) return t("periodClose.notApplicableHint");
  return t(CHECK_BODY_KEY[check.code]);
}

export function isClear(check: PeriodCloseCheckDTO): boolean {
  return check.status === PeriodCloseCheckStatusDTO.Pass || check.status === PeriodCloseCheckStatusDTO.NotApplicable;
}
