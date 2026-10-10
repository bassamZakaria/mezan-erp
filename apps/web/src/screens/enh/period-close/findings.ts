import type { PillTone } from "@mezan/ui";
import {
  PeriodCloseCheckCodeDTO,
  PeriodCloseCheckStatusDTO,
  PeriodCloseDocKindDTO,
  PeriodCloseFindingKindDTO,
  PeriodCloseFindingStateDTO,
  periodCloseDocKindSchema,
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
};

const MAX_LISTED_NUMBERS = 5;

export function fixScreenLabelKey(fix: PeriodCloseFixTargetDTO): AppTranslationKey {
  return `nav.item.${fix}`;
}

export function findingStateLabel(finding: PeriodCloseFindingDTO, t: Translate): string {
  return t(FINDING_STATE_KEY[finding.state]);
}

export function findingTitle(finding: PeriodCloseFindingDTO, t: Translate): string {
  switch (finding.kind) {
    case PeriodCloseFindingKindDTO.Drafts:
    case PeriodCloseFindingKindDTO.PendingApproval: {
      const kind = periodCloseDocKindSchema.safeParse(finding.ref);
      return kind.success ? t(DOC_KIND_KEY[kind.data]) : finding.ref;
    }
    case PeriodCloseFindingKindDTO.TrialBalance:
      return t("periodClose.finding.trialBalance");
    case PeriodCloseFindingKindDTO.ForeignCurrency:
      return t("periodClose.finding.foreignCurrencies", { currencies: finding.items.join("، ") });
    case PeriodCloseFindingKindDTO.RecurringTemplate:
      return t("periodClose.finding.recurring", { name: finding.label ?? finding.ref, period: finding.items[0] ?? "" });
    case PeriodCloseFindingKindDTO.DepreciationRun:
      return t("periodClose.finding.depreciation", { period: finding.ref, count: String(finding.count ?? 0) });
    case PeriodCloseFindingKindDTO.SequenceGap:
      return t("periodClose.finding.sequence", { series: finding.label ?? finding.ref });
    case PeriodCloseFindingKindDTO.EtaSubmission:
      return t("periodClose.finding.eta", { count: String(finding.count ?? 0) });
    case PeriodCloseFindingKindDTO.Tie:
    case PeriodCloseFindingKindDTO.BankStatement:
      return finding.label ?? finding.ref;
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
        numbers: finding.items.slice(0, MAX_LISTED_NUMBERS).join("، "),
      });
    case PeriodCloseFindingKindDTO.BankStatement:
      return finding.asOfDate ? t("periodClose.finding.statementThrough", { date: format.date(finding.asOfDate) }) : "";
    case PeriodCloseFindingKindDTO.Drafts:
    case PeriodCloseFindingKindDTO.PendingApproval:
      return t("periodClose.finding.count", { count: format.number(finding.count ?? 0) });
    case PeriodCloseFindingKindDTO.ForeignCurrency:
    case PeriodCloseFindingKindDTO.RecurringTemplate:
    case PeriodCloseFindingKindDTO.DepreciationRun:
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
