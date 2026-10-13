import { seededWorld, type SeededWorld } from "./seeded-world.js";

export enum Side {
  Receivable = "R",
  Payable = "P",
}
export enum Cur {
  Usd = "USD",
  Eur = "EUR",
}
export enum OpKind {
  Pay = "pay",
  SettleRoute = "settleRoute",
  SettleAll = "settleAll",
  Return = "ret",
  Void = "void",
  OnAccount = "onacc",
  Cheque = "cheque",
  Undo = "undo",
  Run = "run",
  RunReversal = "runrev",
}
export enum OnAccountNext {
  None = "none",
  Allocate = "alloc",
  Refund = "refund",
  Reverse = "reverse",
}
export enum PostingOrder {
  Chronological = "natural",
  RunsLast = "late",
}
const CONTROL: Record<Side, string> = { [Side.Receivable]: "1105", [Side.Payable]: "2100" };
const RATES: Record<Cur, Record<string, string>> = {
  [Cur.Usd]: { "2026-08-01": "48.00", "2026-08-31": "48.45", "2026-09-05": "48.20", "2026-09-10": "48.70", "2026-09-15": "49.10", "2026-09-20": "47.80", "2026-09-30": "48.95", "2026-10-02": "49.30", "2026-10-05": "49.05", "2026-10-08": "48.60", "2026-10-13": "48.85" },
  [Cur.Eur]: { "2026-08-01": "52.3371", "2026-08-31": "53.0119", "2026-09-05": "52.9", "2026-09-10": "53.4477", "2026-09-15": "51.9983", "2026-09-20": "52.6", "2026-09-30": "53.7313", "2026-10-02": "54.01", "2026-10-05": "53.2229", "2026-10-08": "52.8", "2026-10-13": "53.5" },
};
const RELIEF_DATES = ["2026-09-05", "2026-09-10", "2026-09-20", "2026-10-02", "2026-10-08"];
const RUN_DATES = ["2026-08-31", "2026-09-15", "2026-09-30", "2026-10-05"];
const TODAY = "2026-10-13";

function prng(seed: number) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

interface Item { id: string; side: Side; cur: Cur; units: number; price: string; date: string }
type Op =
  | { k: OpKind.Pay; item: number; pct: number; date: string; id: string }
  | { k: OpKind.SettleRoute; item: number; pct: number; date: string; id: string; foreign: boolean }
  | { k: OpKind.SettleAll; item: number; date: string; id: string }
  | { k: OpKind.Return; item: number; qty: number; date: string; id: string }
  | { k: OpKind.Void; item: number; date: string }
  | { k: OpKind.OnAccount; item: number; amount: string; date: string; id: string; then: OnAccountNext; thenDate: string }
  | { k: OpKind.Cheque; item: number; pct: number; date: string; id: string; bounce: string | null }
  | { k: OpKind.Undo; alloc: string }
  | { k: OpKind.Run; date: string; auto: boolean; idx: number }
  | { k: OpKind.RunReversal; idx: number; date: string };

export interface Trial { seed: number; items: Item[]; ops: Op[]; runs: Extract<Op, { k: OpKind.Run }>[]; runrevs: Extract<Op, { k: OpKind.RunReversal }>[] }

export function generate(seed: number, opts: { routeAllocs: boolean }): Trial {
  const r = prng(seed);
  const pick = <T,>(xs: readonly T[]): T => xs[Math.floor(r() * xs.length)]!;
  const items: Item[] = [];
  const n = r() < 0.5 ? 1 : 2;
  for (let i = 0; i < n; i++) items.push({ id: `it${i}`, side: pick([Side.Receivable, Side.Payable] as const), cur: pick([Cur.Usd, Cur.Eur] as const), units: 3 + Math.floor(r() * 12), price: pick(["100", "33.33", "71.07"]), date: pick(["2026-08-22", "2026-08-28"]) });
  const ops: Op[] = [];
  let c = 0;
  for (let i = 0; i < items.length; i++) {
    const count = 1 + Math.floor(r() * 3);
    let from = 0;
    const allocs: string[] = [];
    let voided = false;
    for (let j = 0; j < count && !voided; j++) {
      from = Math.min(RELIEF_DATES.length - 1, from + Math.floor(r() * 2));
      const date = RELIEF_DATES[from]!;
      const id = `s${seed}-${c++}`;
      const roll = r();
      if (roll < 0.25) { ops.push({ k: OpKind.Pay, item: i, pct: pick([20, 35, 50]), date, id }); allocs.push(`pay:${id}`); }
      else if (roll < 0.4 && opts.routeAllocs) { ops.push({ k: OpKind.SettleRoute, item: i, pct: pick([25, 40, 60]), date, id, foreign: r() < 0.5 }); allocs.push(`al-${id}`); }
      else if (roll < 0.55) ops.push({ k: OpKind.Return, item: i, qty: 1 + Math.floor(r() * 2), date, id });
      else if (roll < 0.63 && allocs.length === 0 && j === 0) { ops.push({ k: OpKind.Void, item: i, date }); voided = true; }
      else if (roll < 0.78) ops.push({ k: OpKind.OnAccount, item: i, amount: pick(["150", "210.55", "80"]), date, id, then: pick(opts.routeAllocs ? ([OnAccountNext.None, OnAccountNext.Allocate, OnAccountNext.Refund, OnAccountNext.Reverse] as const) : ([OnAccountNext.None, OnAccountNext.Refund, OnAccountNext.Reverse] as const)), thenDate: RELIEF_DATES[Math.min(RELIEF_DATES.length - 1, from + 1)]! });
      else if (roll < 0.9 && opts.routeAllocs) ops.push({ k: OpKind.Cheque, item: i, pct: pick([20, 30]), date, id, bounce: r() < 0.5 ? RELIEF_DATES[Math.min(RELIEF_DATES.length - 1, from + 1)]! : null });
      else if (opts.routeAllocs && allocs.some((a) => a.startsWith("al-"))) ops.push({ k: OpKind.Undo, alloc: allocs.filter((a) => a.startsWith("al-"))[0]! });
      else { ops.push({ k: OpKind.SettleAll, item: i, date, id }); }
    }
  }
  const runs: Extract<Op, { k: OpKind.Run }>[] = [];
  const runCount = 1 + (r() < 0.45 ? 1 : 0);
  const dates = [...RUN_DATES].sort(() => r() - 0.5).slice(0, runCount).sort();
  if (r() < 0.12 && dates.length === 1) dates.push(dates[0]!);
  dates.forEach((date, idx) => runs.push({ k: OpKind.Run, date, auto: r() < 0.3, idx }));
  const runrevs: Extract<Op, { k: OpKind.RunReversal }>[] = [];
  if (r() < 0.3) { const idx = Math.floor(r() * runs.length); if (!runs[idx]!.auto) runrevs.push({ k: OpKind.RunReversal, idx, date: TODAY }); }
  return { seed, items, ops, runs, runrevs };
}

const effective = (op: Op): string => ("date" in op && op.k !== OpKind.RunReversal ? op.date : TODAY);

export function order(trial: Trial, mode: PostingOrder): Op[] {
  const body = trial.ops.map((op, i) => ({ op, d: effective(op), i })).sort((x, y) => (x.d < y.d ? -1 : x.d > y.d ? 1 : x.i - y.i)).map((x) => x.op);
  if (mode === PostingOrder.RunsLast) return [...body, ...trial.runs, ...trial.runrevs];
  const stamped = [...body.map((op, i) => ({ op, d: effective(op), rank: 0, i })), ...trial.runs.map((op, i) => ({ op: op as Op, d: op.date, rank: 1, i }))];
  stamped.sort((x, y) => (x.d < y.d ? -1 : x.d > y.d ? 1 : x.rank - y.rank || x.i - y.i));
  return [...stamped.map((x) => x.op), ...trial.runrevs];
}

const SCALE = 1_000_000n;
const toScaled = (s: string): bigint => { const neg = s.startsWith("-"); const [a, b = ""] = s.replace("-", "").split("."); const v = BigInt(a!) * SCALE + BigInt((b + "000000").slice(0, 6)); return neg ? -v : v; };
const fmt = (v: bigint): string => `${v < 0n ? "-" : ""}${(v < 0n ? -v : v) / SCALE}.${String((v < 0n ? -v : v) % SCALE).padStart(6, "0")}`;
const round2 = (v: bigint): bigint => ((v + 5_000n) / 10_000n) * 10_000n;
const rateOn = (cur: Cur, date: string): bigint => { const keys = Object.keys(RATES[cur]).sort().filter((k) => k <= date); return toScaled(RATES[cur][keys[keys.length - 1]!]!); };

export interface Outcome { oracle: string[]; tb: Map<string, bigint>; inv: Record<string, string>; residue: unknown[]; log: string[]; refused: string[] }

export async function play(trial: Trial, ops: Op[]): Promise<Outcome> {
  const world: SeededWorld = await seededWorld({ seedDemoData: false });
  const log: string[] = [];
  const refused: string[] = [];
  const call = async (label: string, method: string, url: string, body?: unknown, want: number[] = [200, 201]) => {
    const res = await world.request(method, url, body);
    const line = `${label} -> ${res.status}${want.includes(res.status) ? "" : " " + String(res.body.error ?? "") + " " + String(res.body.message ?? JSON.stringify(res.body)).slice(0, 160)}`;
    log.push(line);
    if (!want.includes(res.status)) refused.push(`${label}:${res.status}:${String(res.body.error ?? "")}`);
    return res;
  };
  const must = async (label: string, method: string, url: string, body?: unknown) => {
    const res = await world.request(method, url, body);
    if (res.status !== 200 && res.status !== 201) throw new Error(`setup ${label} ${res.status} ${JSON.stringify(res.body).slice(0, 300)}`);
    return res;
  };
  try {
    let rid = 0;
    for (const cur of [Cur.Usd, Cur.Eur]) for (const [date, value] of Object.entries(RATES[cur])) {
      const id = `fx-${cur}-${rid++}`;
      await must("rate", "POST", "/exchange-rates", { id, currency: cur, rate: value, effectiveDate: date, rateType: "standard", source: "manual" });
      await must("rate-approve", "POST", `/exchange-rates/${id}/approve`, {});
    }
    const settings = (await world.request("GET", "/settings")).body;
    await must("settings", "PUT", "/settings", { ...settings, multiCurrencyEnabled: true });
    await must("ta", "POST", "/treasury-accounts", { id: "ta-cash", code: "TA-CASH", name: "الخزينة", branchId: "BR-MAIN", glAccountId: "1300-1", openingBalance: "0" });
    await must("ta", "POST", "/treasury-accounts", { id: "ta-bank", code: "TA-BANK", name: "البنك", type: "bank", branchId: "BR-MAIN", glAccountId: "1310", openingBalance: "0" });
    await must("fund", "POST", "/vouchers", { id: "v-fund", date: "2026-08-01", voucherType: "capital_injection", amount: "50000000", branchId: "BR-MAIN", paymentMethod: "cash", treasuryAccountId: "ta-cash", treasuryGlAccountId: "1300-1", counterpartyGlAccountId: "3100" });
    await must("fund", "POST", "/vouchers/v-fund/confirm", {});
    await must("item", "POST", "/items", { id: "SVC-1", code: "SVC-1", nameAr: "خدمة", type: "service", baseUnitCode: "PCS" });
    await must("item", "POST", "/items", { id: "STK-1", code: "STK-1", nameAr: "صنف", type: "stock", baseUnitCode: "PCS", costingMethod: "WAC" });
    const partyOf = (item: Item) => `${item.side === Side.Receivable ? "cust" : "sup"}-${item.id}`;
    const foreignOpen = new Map<number, bigint>();
    for (const [index, item] of trial.items.entries()) {
      if (item.side === Side.Receivable) {
        await must("cust", "POST", "/customers", { id: partyOf(item), code: partyOf(item), nameAr: "عميل", paymentTermsDays: 30, currency: "EGP", openingBalance: "0", active: true, creditLimit: "0", taxExempt: false, etaBuyerType: "auto" });
        await must("inv", "POST", "/sales-invoices", { id: item.id, date: item.date, dueDate: "2026-09-21", customerId: partyOf(item), customerNameAr: "عميل", warehouseId: "WH-MAIN", branchId: "BR-MAIN", arAccountId: "1105", taxAccountId: "2200", currency: item.cur, lines: [{ lineId: "L1", itemId: "SVC-1", itemNameAr: "خدمة", isStock: false, qty: String(item.units), unitPrice: item.price, taxRatePercent: 0, revenueAccountId: "4100" }] });
        await must("inv-confirm", "POST", `/sales-invoices/${item.id}/confirm`, {});
      } else {
        await must("sup", "POST", "/suppliers", { id: partyOf(item), code: partyOf(item), nameAr: "مورد", currency: item.cur, openingBalance: "0" });
        await must("pi", "POST", "/purchases/invoices", { id: item.id, supplierId: partyOf(item), date: item.date, dueDate: "2026-09-21", branchId: "BR-MAIN", warehouseId: "WH-MAIN", currency: item.cur, lines: [{ itemId: "STK-1", description: "صنف", kind: "inventory", qty: String(item.units), unitCost: item.price, taxRatePercent: 0 }] });
        await must("pi-confirm", "POST", `/purchases/invoices/${item.id}/confirm`, {});
      }
      foreignOpen.set(index, round2(BigInt(item.units) * toScaled(item.price)));
    }
    const voucherBody = (item: Item, id: string, date: string, amount: string, currency: string | undefined, type?: string) => ({
      id, date, amount, branchId: "BR-MAIN", paymentMethod: "cash", treasuryAccountId: "ta-cash", treasuryGlAccountId: "1300-1", counterpartyGlAccountId: CONTROL[item.side], ...(currency ? { currency } : {}),
      ...(item.side === Side.Receivable ? { voucherType: type ?? "customer_collection", customerId: partyOf(item) } : { voucherType: type ?? "supplier_payment", supplierId: partyOf(item) }),
    });
    const remaining = async (voucherId: string): Promise<string> => {
      const res = await world.request("GET", `/vouchers/${voucherId}/allocations`);
      const s = res.body.allocationSummary as Record<string, string> | undefined;
      return String(s?.unallocated ?? s?.remaining ?? "0");
    };
    const runIds = new Map<number, string>();
    const standing = new Map<number, string>();
    for (const op of ops) {
      if (op.k === OpKind.Run) {
        const res = await call(`run#${op.idx} ${op.date} auto=${op.auto}`, "POST", "/revaluation/post", { date: op.date, autoReverse: op.auto });
        if (res.body.entryId) { runIds.set(op.idx, String(res.body.entryId)); if (!op.auto) standing.set(op.idx, op.date); }
        continue;
      }
      if (op.k === OpKind.RunReversal) {
        const id = runIds.get(op.idx);
        if (!id) { log.push(`runrev#${op.idx} skipped (no entry)`); continue; }
        const rr = await call(`runrev#${op.idx} ${op.date}`, "POST", `/revaluation/runs/${id}/reverse`, { memo: "سبب", date: op.date });
        if (rr.status < 300) standing.delete(op.idx);
        continue;
      }
      if (op.k === OpKind.Undo) { await call(`undo ${op.alloc}`, "POST", `/allocations/${op.alloc}/reverse`, {}); continue; }
      const item = trial.items[op.item]!;
      const open = foreignOpen.get(op.item) ?? 0n;
      if (op.k === OpKind.Pay) {
        const foreign = round2((open * BigInt(op.pct)) / 100n);
        const base = round2((foreign * rateOn(item.cur, op.date)) / SCALE);
        const res = await call(`pay ${item.id} ${fmt(foreign)}${item.cur}=${fmt(base)} ${op.date}`, "POST", item.side === Side.Receivable ? `/sales-invoices/${item.id}/payments` : `/purchases/invoices/${item.id}/payments`, { amount: fmt(base), treasuryAccountId: "ta-cash", date: op.date });
        if (res.status < 300) foreignOpen.set(op.item, open - foreign);
      } else if (op.k === OpKind.SettleRoute) {
        const foreign = round2((open * BigInt(op.pct)) / 100n);
        const amount = op.foreign ? fmt(foreign) : fmt(round2((foreign * rateOn(item.cur, op.date)) / SCALE));
        const made = await call(`voucher ${op.id} ${amount}${op.foreign ? item.cur : "EGP"} ${op.date}`, "POST", "/vouchers", voucherBody(item, op.id, op.date, amount, op.foreign ? item.cur : undefined));
        if (made.status >= 300) continue;
        await call(`confirm ${op.id}`, "POST", `/vouchers/${op.id}/confirm`, {});
        const res = await call(`allocate(route) ${op.id}->${item.id}`, "POST", `/vouchers/${op.id}/allocations`, { allocationId: `al-${op.id}`, invoiceId: item.id, amount: await remaining(op.id) });
        if (res.status < 300) foreignOpen.set(op.item, open - foreign);
      } else if (op.k === OpKind.SettleAll) {
        if (open <= 0n) { log.push(`settleAll ${item.id} skipped`); continue; }
        if (item.side === Side.Receivable) {
          const res = await call(`collect-all ${item.id} ${fmt(open)}${item.cur} ${op.date}`, "POST", "/vouchers/collections", { id: op.id, date: op.date, customerId: partyOf(item), branchId: "BR-MAIN", treasuryAccountId: "ta-cash", amount: fmt(open), currency: item.cur, paymentMethod: "cash", allocations: [{ allocationId: `al-${op.id}`, invoiceId: item.id }] });
          if (res.status < 300) foreignOpen.set(op.item, 0n);
        } else {
          const base = round2((open * rateOn(item.cur, op.date)) / SCALE);
          const res = await call(`pay-all ${item.id} ${fmt(open)}${item.cur}=${fmt(base)} ${op.date}`, "POST", `/purchases/invoices/${item.id}/payments`, { amount: fmt(base), treasuryAccountId: "ta-cash", date: op.date });
          if (res.status < 300) foreignOpen.set(op.item, 0n);
        }
      } else if (op.k === OpKind.Return) {
        const unit = toScaled(item.price);
        if (item.side === Side.Receivable) {
          const made = await call(`return ${item.id} qty${op.qty} ${op.date}`, "POST", "/sales-returns/from-invoice", { id: op.id, date: op.date, memo: "", warehouseId: "WH-MAIN", sourceInvoiceId: item.id, reason: "OTHER", requested: [{ itemId: "SVC-1", qty: String(op.qty) }] });
          if (made.status >= 300) continue;
          const res = await call(`return-confirm ${op.id}`, "POST", `/sales-returns/${op.id}/confirm`, {});
          if (res.status < 300) foreignOpen.set(op.item, open - BigInt(op.qty) * unit);
        } else {
          const bill = (await world.request("GET", `/purchases/invoices/${item.id}`)).body;
          const made = await call(`p-return ${item.id} qty${op.qty} ${op.date}`, "POST", "/purchase-returns", { id: op.id, date: op.date, memo: "", lines: [{ itemId: "STK-1", warehouseId: "WH-MAIN", supplierId: partyOf(item), sourceInvoiceId: item.id, sourceInvoiceNumber: String(bill.number), reason: "DEFECTIVE", availableQty: String(item.units), qty: String(op.qty), unitCost: item.price, taxAmount: "0" }] });
          if (made.status >= 300) continue;
          const res = await call(`p-return-confirm ${op.id}`, "POST", `/purchase-returns/${op.id}/confirm`, {});
          if (res.status < 300) foreignOpen.set(op.item, open - BigInt(op.qty) * unit);
        }
      } else if (op.k === OpKind.Void) {
        const res = await call(`void ${item.id} ${op.date}`, "POST", item.side === Side.Receivable ? `/sales-invoices/${item.id}/void` : `/purchases/invoices/${item.id}/cancel`, { date: op.date, memo: "إلغاء" });
        if (res.status < 300) foreignOpen.set(op.item, 0n);
      } else if (op.k === OpKind.OnAccount) {
        const made = await call(`onacc ${op.id} ${op.amount}${item.cur} ${op.date}`, "POST", "/vouchers", voucherBody(item, op.id, op.date, op.amount, item.cur));
        if (made.status >= 300) continue;
        await call(`confirm ${op.id}`, "POST", `/vouchers/${op.id}/confirm`, {});
        if (op.then === OnAccountNext.Allocate) {
          const rest = await remaining(op.id);
          const res = await call(`allocate(route) onacc ${op.id}->${item.id} ${rest}`, "POST", `/vouchers/${op.id}/allocations`, { allocationId: `al-${op.id}`, invoiceId: item.id, amount: rest });
          if (res.status < 300) foreignOpen.set(op.item, open - toScaled(op.amount));
        } else if (op.then === OnAccountNext.Refund) {
          await call(`refund ${op.id} ${op.thenDate}`, "POST", "/vouchers", voucherBody(item, `${op.id}-rf`, op.thenDate, op.amount, item.cur, item.side === Side.Receivable ? "customer_refund" : "supplier_refund"));
          await call(`refund-confirm ${op.id}`, "POST", `/vouchers/${op.id}-rf/confirm`, {});
        } else if (op.then === OnAccountNext.Reverse) {
          await call(`voucher-reverse ${op.id} ${op.thenDate}`, "POST", `/vouchers/${op.id}/reverse`, { memo: "خطأ", date: op.thenDate });
        }
      } else if (op.k === OpKind.Cheque) {
        const foreign = round2((open * BigInt(op.pct)) / 100n);
        const base = fmt(round2((foreign * rateOn(item.cur, op.date)) / SCALE));
        const direction = item.side === Side.Receivable ? { direction: "incoming", controlAccounts: { underCollectionAccountId: "1320", bouncedAccountId: "1360" } } : { direction: "outgoing", controlAccounts: { underCollectionAccountId: "2150", bouncedAccountId: null } };
        const made = await call(`cheque ${op.id} ${base} ${op.date}`, "POST", "/cheques", { id: op.id, chequeNumber: `N-${op.id}`, bankName: "بنك مصر", issueDate: op.date, dueDate: op.date, branchId: "BR-MAIN", partyId: partyOf(item), counterpartyGlAccountId: CONTROL[item.side], amount: base, ...direction });
        if (made.status >= 300) continue;
        const res = await call(`cheque-allocate ${op.id}`, "POST", `/cheques/${op.id}/allocations`, { allocationId: `al-${op.id}`, invoiceId: item.id, amount: base });
        if (res.status < 300) foreignOpen.set(op.item, open - foreign);
        if (op.bounce) {
          await call(`cheque-deposit ${op.id}`, "POST", `/cheques/${op.id}/deposit`, { bankTreasuryAccountId: "ta-bank" });
          const bounced = await call(`cheque-bounce ${op.id} ${op.bounce}`, "POST", `/cheques/${op.id}/bounce`, { date: op.bounce });
          if (bounced.status < 300 && res.status < 300) foreignOpen.set(op.item, open);
        }
      }
    }
    const snapshot = (asOf: string): Map<string, bigint> => {
      const rows = world.sqlite.prepare(`SELECT jl.account_id AS a, SUM(jl.debit - jl.credit) AS net FROM journal_line jl JOIN journal_entry je ON je.id = jl.entry_id WHERE je.status IN ('posted','reversed') AND substr(je.date,1,10) <= ? GROUP BY jl.account_id`).safeIntegers().all(asOf) as { a: string; net: bigint }[];
      return new Map(rows.filter((row) => row.net !== 0n).map((row) => [row.a, row.net]));
    };
    const residue = ((await world.request("GET", "/revaluation/residue")).body.rows as unknown[]) ?? [];
    const inv = await world.invariants();
    const oracle: string[] = [];
    for (const side of [Side.Receivable, Side.Payable]) {
      const mine = [...trial.items.entries()].filter(([, item]) => item.side === side);
      if (mine.length === 0) continue;
      if (trial.ops.some((op) => op.k === OpKind.Undo || ("item" in op && trial.items[op.item]!.side === side && (op.k === OpKind.OnAccount || op.k === OpKind.Cheque)))) continue;
      if (mine.some(([index]) => (foreignOpen.get(index) ?? 0n) < 0n)) continue;
      const row = world.sqlite.prepare(`SELECT COALESCE(SUM(jl.debit - jl.credit),0) AS net FROM journal_line jl JOIN journal_entry je ON je.id = jl.entry_id WHERE je.status IN ('posted','reversed') AND jl.account_id = ?`).safeIntegers().get(CONTROL[side]) as { net: bigint };
      let expected = 0n;
      const parts: string[] = [];
      for (const [index, item] of mine) {
        const open = foreignOpen.get(index) ?? 0n;
        const covering = [...standing.values()].filter((d) => d >= item.date).sort();
        const rate = covering.length ? rateOn(item.cur, covering[covering.length - 1]!) : rateOn(item.cur, item.date);
        expected += ((open * rate) / SCALE) * (side === Side.Receivable ? 1n : -1n);
        parts.push(`${item.id} ${fmt(open)}${item.cur}x${fmt(rate)}`);
      }
      const gap = row.net - expected;
      if ((gap < 0n ? -gap : gap) > 50_000n) oracle.push(`${CONTROL[side]} expected ${fmt(expected)} (${parts.join(" + ")}) but holds ${fmt(row.net)} (gap ${fmt(gap)})`);
    }
    log.push(`foreignOpen ${[...foreignOpen.entries()].map(([i, v]) => `${trial.items[i]!.id}=${fmt(v)}`).join(" ")}`);
    return { oracle, tb: snapshot("9999-12-31"), inv, residue, log, refused };
  } finally {
    world.close();
  }
}


const NET: Record<string, string> = { "4920": "realised", "5920": "realised", "4940": "unrealised", "5940": "unrealised" };

function netted(balances: Map<string, bigint>): Map<string, bigint> {
  const out = new Map<string, bigint>();
  for (const [account, value] of balances) {
    const key = NET[account] ?? account;
    out.set(key, (out.get(key) ?? 0n) + value);
  }
  return out;
}

export function balanceDifferences(first: Map<string, bigint>, second: Map<string, bigint>, gross = false): string[] {
  const a = gross ? first : netted(first);
  const b = gross ? second : netted(second);
  const out: string[] = [];
  for (const key of new Set([...a.keys(), ...b.keys()])) if ((a.get(key) ?? 0n) !== (b.get(key) ?? 0n)) out.push(`${key}: ${fmt(a.get(key) ?? 0n)} vs ${fmt(b.get(key) ?? 0n)}`);
  return out.sort();
}
