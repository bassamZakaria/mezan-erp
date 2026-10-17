import { Money } from "../money/index.js";
import { CashFlowDirection, CashForecastSourceKind, type CashForecastItem } from "../cash-forecast/types.js";
import type { CollectionWorkItem } from "./types.js";

const RECEIVABLE_KINDS = new Set<CashForecastSourceKind>([
  CashForecastSourceKind.Receivable,
  CashForecastSourceKind.Installment,
  CashForecastSourceKind.ReceivableOther,
]);

export function daysOverdue(dueDate: string, asOfDate: string): number {
  if (dueDate >= asOfDate) return 0;
  return Math.round((Date.parse(`${asOfDate}T00:00:00Z`) - Date.parse(`${dueDate}T00:00:00Z`)) / 86_400_000);
}

function stableKey(item: CashForecastItem): string {
  if (item.kind !== CashForecastSourceKind.ReceivableOther) return item.id;
  return `${item.kind}:${item.detail ?? ""}:${item.partyId ?? ""}:${item.reference ?? item.dueDate}`;
}

export interface CollectionCustomerRow {
  readonly customerId: string;
  readonly customerName: string;
  readonly customerNameEn: string | null;
  readonly overdue: Money;
  readonly notYetDue: Money;
  readonly oldestDaysOverdue: number;
  readonly items: readonly CollectionWorkItem[];
}

export function openReceivableItems(items: readonly CashForecastItem[], asOfDate: string): CollectionWorkItem[] {
  const out: CollectionWorkItem[] = [];
  const seen = new Map<string, number>();
  for (const item of items) {
    if (item.direction !== CashFlowDirection.Inflow || !RECEIVABLE_KINDS.has(item.kind) || !item.partyId) continue;
    if (item.amount.scaled <= 0n) continue;
    let key = stableKey(item);
    const count = seen.get(key) ?? 0;
    seen.set(key, count + 1);
    if (count > 0) key = `${key}#${count}`;
    out.push({
      key,
      kind: item.kind,
      customerId: item.partyId,
      documentId: item.documentId,
      reference: item.reference,
      detail: item.detail,
      dueDate: item.dueDate,
      daysOverdue: daysOverdue(item.dueDate, asOfDate),
      amount: item.amount,
    });
  }
  return out;
}

export function buildCollectionWorklist(items: readonly CashForecastItem[], asOfDate: string): CollectionCustomerRow[] {
  const names = new Map<string, { ar: string; en: string | null }>();
  for (const item of items) {
    if (item.partyId && !names.has(item.partyId)) names.set(item.partyId, { ar: item.partyName ?? item.partyId, en: item.partyNameEn });
  }
  const byCustomer = new Map<string, CollectionWorkItem[]>();
  for (const work of openReceivableItems(items, asOfDate)) {
    const list = byCustomer.get(work.customerId) ?? [];
    list.push(work);
    byCustomer.set(work.customerId, list);
  }
  const rows: CollectionCustomerRow[] = [];
  for (const [customerId, list] of byCustomer) {
    const overdueItems = list.filter((item) => item.daysOverdue > 0);
    if (overdueItems.length === 0) continue;
    const notYetDue = list.filter((item) => item.daysOverdue === 0);
    const name = names.get(customerId);
    rows.push({
      customerId,
      customerName: name?.ar ?? customerId,
      customerNameEn: name?.en ?? null,
      overdue: Money.sum(overdueItems.map((item) => item.amount)),
      notYetDue: Money.sum(notYetDue.map((item) => item.amount)),
      oldestDaysOverdue: Math.max(...overdueItems.map((item) => item.daysOverdue)),
      items: [...overdueItems].sort((a, b) => b.daysOverdue - a.daysOverdue),
    });
  }
  return rows.sort((a, b) => {
    if (a.overdue.scaled !== b.overdue.scaled) return a.overdue.scaled > b.overdue.scaled ? -1 : 1;
    return b.oldestDaysOverdue - a.oldestDaysOverdue;
  });
}
