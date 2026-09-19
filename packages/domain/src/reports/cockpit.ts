import { Money } from "../money/index.js";
import { Qty } from "../money/qty.js";
import { matchesStatementBranch, withinBranchScope } from "./branch-filter.js";

export enum CockpitDirection {
  Up = "up",
  Down = "down",
  Level = "level",
}

export const COCKPIT_SPARK_DAYS = 7;
export const COCKPIT_MARGIN_WEEKS = 8;
export const COCKPIT_MOVERS_LIMIT = 5;

export interface CockpitAccountSets {
  readonly revenue: ReadonlySet<string>;
  readonly cogs: ReadonlySet<string>;
  readonly treasury: ReadonlySet<string>;
  readonly customerSide: ReadonlySet<string>;
}

export interface CockpitLedgerLine {
  readonly entryId: string;
  readonly date: string;
  readonly accountId: string;
  readonly branchId: string | null;
  readonly debit: Money;
  readonly credit: Money;
}

export interface CockpitBranchView {
  readonly branchId: string;
  readonly scope: readonly string[] | undefined;
}

export interface CockpitDayFlow {
  readonly date: string;
  readonly sales: bigint;
  readonly cogs: bigint;
  readonly collections: bigint;
}

export function cockpitAddDays(iso: string, days: number): string {
  const date = new Date(`${iso}T00:00:00.000Z`);
  date.setUTCDate(date.getUTCDate() + days);
  return date.toISOString().slice(0, 10);
}

export function cockpitLineInView(branchId: string | null, view: CockpitBranchView): boolean {
  return withinBranchScope(branchId, view.scope) && matchesStatementBranch(branchId, view.branchId);
}

export function cockpitUnattributedLine(branchId: string | null, view: CockpitBranchView): boolean {
  return (branchId === null || branchId === "") && withinBranchScope(branchId, view.scope);
}

interface EntryTally {
  date: string;
  treasuryNet: bigint;
  customerCredit: bigint;
}

export function cockpitDailyFlows(
  lines: readonly CockpitLedgerLine[],
  sets: CockpitAccountSets,
  from: string,
  to: string,
  include: (line: CockpitLedgerLine) => boolean,
): Map<string, CockpitDayFlow> {
  const sales = new Map<string, bigint>();
  const cogs = new Map<string, bigint>();
  const entries = new Map<string, EntryTally>();
  for (const line of lines) {
    if (line.date < from || line.date > to || !include(line)) continue;
    const debit = line.debit.scaled;
    const credit = line.credit.scaled;
    if (sets.revenue.has(line.accountId)) sales.set(line.date, (sales.get(line.date) ?? 0n) + credit - debit);
    if (sets.cogs.has(line.accountId)) cogs.set(line.date, (cogs.get(line.date) ?? 0n) + debit - credit);
    const onTreasury = sets.treasury.has(line.accountId);
    const onCustomerSide = sets.customerSide.has(line.accountId) || sets.revenue.has(line.accountId);
    if (!onTreasury && !onCustomerSide) continue;
    const tally = entries.get(line.entryId) ?? { date: line.date, treasuryNet: 0n, customerCredit: 0n };
    if (onTreasury) tally.treasuryNet += debit - credit;
    else tally.customerCredit += credit - debit;
    entries.set(line.entryId, tally);
  }
  const collections = new Map<string, bigint>();
  for (const tally of entries.values()) {
    if (tally.customerCredit <= 0n || tally.treasuryNet <= 0n) continue;
    collections.set(tally.date, (collections.get(tally.date) ?? 0n) + tally.treasuryNet);
  }
  const out = new Map<string, CockpitDayFlow>();
  for (let day = from; day <= to; day = cockpitAddDays(day, 1)) {
    out.set(day, { date: day, sales: sales.get(day) ?? 0n, cogs: cogs.get(day) ?? 0n, collections: collections.get(day) ?? 0n });
  }
  return out;
}

export function cockpitSumFlows(flows: Iterable<CockpitDayFlow>): { sales: bigint; cogs: bigint; collections: bigint } {
  let sales = 0n;
  let cogs = 0n;
  let collections = 0n;
  for (const flow of flows) {
    sales += flow.sales;
    cogs += flow.cogs;
    collections += flow.collections;
  }
  return { sales, cogs, collections };
}

export function cockpitMarginPercent(revenue: bigint, cogs: bigint): string | null {
  if (revenue <= 0n) return null;
  const numerator = (revenue - cogs) * 1000n;
  const negative = numerator < 0n;
  const abs = negative ? -numerator : numerator;
  const tenths = (abs * 2n + revenue) / (revenue * 2n);
  const text = `${tenths / 10n}.${tenths % 10n}`;
  return negative && tenths !== 0n ? `-${text}` : text;
}

export function cockpitDirectionOf(current: bigint, previous: bigint): CockpitDirection {
  if (current === previous) return CockpitDirection.Level;
  return current > previous ? CockpitDirection.Up : CockpitDirection.Down;
}

export interface CockpitSaleLine {
  readonly itemId: string;
  readonly date: string;
  readonly amount: bigint;
}

export interface CockpitMover {
  readonly itemId: string;
  readonly current: Money;
  readonly previous: Money;
  readonly change: Money;
  readonly direction: CockpitDirection;
}

export function cockpitTopMovers(
  lines: readonly CockpitSaleLine[],
  current: { readonly from: string; readonly to: string },
  previous: { readonly from: string; readonly to: string },
  limit: number = COCKPIT_MOVERS_LIMIT,
): CockpitMover[] {
  const now = new Map<string, bigint>();
  const before = new Map<string, bigint>();
  for (const line of lines) {
    if (line.date >= current.from && line.date <= current.to) now.set(line.itemId, (now.get(line.itemId) ?? 0n) + line.amount);
    else if (line.date >= previous.from && line.date <= previous.to) before.set(line.itemId, (before.get(line.itemId) ?? 0n) + line.amount);
  }
  const ids = new Set([...now.keys(), ...before.keys()]);
  const movers: { itemId: string; current: bigint; previous: bigint; change: bigint }[] = [];
  for (const itemId of ids) {
    const a = now.get(itemId) ?? 0n;
    const b = before.get(itemId) ?? 0n;
    if (a === b) continue;
    movers.push({ itemId, current: a, previous: b, change: a - b });
  }
  const magnitude = (value: bigint) => (value < 0n ? -value : value);
  movers.sort((x, y) => {
    const dx = magnitude(x.change);
    const dy = magnitude(y.change);
    if (dx !== dy) return dx > dy ? -1 : 1;
    return x.itemId.localeCompare(y.itemId);
  });
  return movers.slice(0, limit).map((m) => ({
    itemId: m.itemId,
    current: Money.fromScaled(m.current),
    previous: Money.fromScaled(m.previous),
    change: Money.fromScaled(m.change),
    direction: cockpitDirectionOf(m.current, m.previous),
  }));
}

export interface CockpitOpenInvoice {
  readonly customerId: string;
  readonly dueDate: string | null;
  readonly remaining: bigint;
}

export interface CockpitOverdue {
  readonly amount: Money;
  readonly invoiceCount: number;
  readonly customerCount: number;
  readonly oldestDueDate: string | null;
}

export function cockpitOverdue(invoices: readonly CockpitOpenInvoice[], today: string): CockpitOverdue {
  let amount = 0n;
  let invoiceCount = 0;
  let oldest: string | null = null;
  const customers = new Set<string>();
  for (const invoice of invoices) {
    if (invoice.remaining <= 0n || invoice.dueDate === null || invoice.dueDate >= today) continue;
    amount += invoice.remaining;
    invoiceCount += 1;
    customers.add(invoice.customerId);
    if (oldest === null || invoice.dueDate < oldest) oldest = invoice.dueDate;
  }
  return { amount: Money.fromScaled(amount), invoiceCount, customerCount: customers.size, oldestDueDate: oldest };
}

export enum CockpitStockState {
  Out = "out",
  Low = "low",
  Ok = "ok",
}

export function cockpitStockState(onHand: Qty, reorderPoint: number | null): CockpitStockState {
  if (onHand.scaled <= 0n) return CockpitStockState.Out;
  if (reorderPoint !== null && onHand.scaled <= Qty.fromMajor(String(reorderPoint)).scaled) return CockpitStockState.Low;
  return CockpitStockState.Ok;
}

export interface CockpitStockItem {
  readonly id: string;
  readonly code: string;
  readonly nameAr: string;
  readonly nameEn: string | null;
  readonly trackInventory: boolean;
  readonly reorderPoint: number | null;
}

export interface CockpitLowStock {
  readonly low: number;
  readonly out: number;
  readonly first: CockpitStockItem | null;
}

export function cockpitLowStock(items: readonly CockpitStockItem[], onHandByItem: ReadonlyMap<string, Qty>): CockpitLowStock {
  let low = 0;
  let out = 0;
  let first: CockpitStockItem | null = null;
  for (const item of [...items].sort((a, b) => a.code.localeCompare(b.code))) {
    if (!item.trackInventory) continue;
    const state = cockpitStockState(onHandByItem.get(item.id) ?? Qty.zero(), item.reorderPoint);
    if (state === CockpitStockState.Out) out += 1;
    if (state === CockpitStockState.Low) {
      low += 1;
      first ??= item;
    }
  }
  return { low, out, first };
}
