import type { Money } from "../money/index.js";

export enum CashFlowDirection {
  Inflow = "inflow",
  Outflow = "outflow",
}

export enum CashForecastSourceKind {
  Receivable = "receivable",
  Installment = "installment",
  ReceivableOther = "receivable_other",
  Payable = "payable",
  PayableOther = "payable_other",
  ChequeIncoming = "cheque_incoming",
  ChequeOutgoing = "cheque_outgoing",
  Commitment = "commitment",
}

export enum CashForecastHorizon {
  Days30 = "30",
  Days60 = "60",
  Days90 = "90",
}

export enum OverdueTreatment {
  Today = "today",
  Exclude = "exclude",
}

export const CASH_FORECAST_MAX_HORIZON = CashForecastHorizon.Days90;

export function horizonDays(horizon: CashForecastHorizon): number {
  return Number.parseInt(horizon, 10);
}

export interface CashForecastItem {
  readonly id: string;
  readonly kind: CashForecastSourceKind;
  readonly direction: CashFlowDirection;
  readonly dueDate: string;
  readonly amount: Money;
  readonly partyId: string | null;
  readonly partyName: string | null;
  readonly partyNameEn: string | null;
  readonly reference: string | null;
  readonly documentId: string | null;
  readonly currency: string | null;
  readonly detail: string | null;
}

export interface CashCommitment {
  readonly id: string;
  readonly date: string;
  readonly direction: CashFlowDirection;
  readonly amount: Money;
  readonly label: string;
  readonly reference?: string | null;
  readonly documentId?: string | null;
}

export interface CommitmentWindow {
  readonly from: string;
  readonly to: string;
}

export interface CommitmentSource {
  readonly id: string;
  commitments(window: CommitmentWindow): Promise<readonly CashCommitment[]>;
}

export interface CashForecastOpeningAccount {
  readonly treasuryAccountId: string;
  readonly name: string;
  readonly glAccountId: string;
  readonly balance: Money;
}

export interface CashForecastInput {
  readonly today: string;
  readonly horizon: CashForecastHorizon;
  readonly openingCash: Money;
  readonly threshold: Money;
  readonly overdueReceivables: OverdueTreatment;
  readonly items: readonly CashForecastItem[];
}

export interface ScheduledCashItem extends CashForecastItem {
  readonly expectedDate: string;
  readonly overdue: boolean;
}

export interface CashForecastDay {
  readonly date: string;
  readonly opening: Money;
  readonly inflows: Money;
  readonly outflows: Money;
  readonly closing: Money;
  readonly itemCount: number;
}

export interface CashForecastDip {
  readonly startDate: string;
  readonly endDate: string | null;
  readonly lowestDate: string;
  readonly lowestBalance: Money;
  readonly drivers: readonly ScheduledCashItem[];
}

export interface CashForecastTotals {
  readonly inflows: Money;
  readonly outflows: Money;
  readonly closing: Money;
}

export interface CashForecastOverdue {
  readonly receivables: Money;
  readonly receivablesCount: number;
  readonly payables: Money;
  readonly payablesCount: number;
}

export interface CashForecast {
  readonly today: string;
  readonly horizon: CashForecastHorizon;
  readonly endDate: string;
  readonly openingCash: Money;
  readonly threshold: Money;
  readonly overdueReceivables: OverdueTreatment;
  readonly days: readonly CashForecastDay[];
  readonly items: readonly ScheduledCashItem[];
  readonly totals: CashForecastTotals;
  readonly byKind: Readonly<Record<CashForecastSourceKind, Money>>;
  readonly overdue: CashForecastOverdue;
  readonly excludedOverdueReceivables: Money;
  readonly beyondHorizon: { readonly inflows: Money; readonly outflows: Money };
  readonly firstBelowZero: string | null;
  readonly firstBelowThreshold: string | null;
  readonly lowest: { readonly date: string; readonly balance: Money };
  readonly runwayDays: number | null;
  readonly dips: readonly CashForecastDip[];
}
