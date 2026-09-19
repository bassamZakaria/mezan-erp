import type { App } from "@mezan/api";
import { Money } from "@mezan/domain";
import type { SeedFragment, SeedFragmentContext } from "./fragments.js";
import { HISTORY_CUSTOMERS, HISTORY_ITEMS, type HistoryItem } from "./history-data.js";
import { ACCOUNTS, BRANCH_ID, VAT_PERCENT, WAREHOUSE_ID, seedToday, step } from "./shared.js";

const DAYS_BACK = 13;
const CASH_TREASURY_ID = "TR-DEMO-CASH";
const BANK_TREASURY_ID = "TR-DEMO-BANK";
const ITEM_ROTATION = [0, 6, 14, 16, 11, 23, 4, 20, 9, 27, 1, 21] as const;

function addDays(iso: string, days: number): string {
  const date = new Date(`${iso}T00:00:00.000Z`);
  date.setUTCDate(date.getUTCDate() + days);
  return date.toISOString().slice(0, 10);
}

function priceOf(item: HistoryItem): string {
  return Money.fromScaled(BigInt(item.pricePiastres) * 10_000n).toString();
}

async function onHandOf(app: App, item: HistoryItem): Promise<number> {
  const rows = (await step(app, "GET", `/items?q=${encodeURIComponent(item.code)}`)) as { readonly id: string; readonly onHand: string | null }[];
  const row = rows.find((r) => r.id === item.id);
  return row?.onHand ? Math.floor(Number(row.onHand)) : 0;
}

async function run(app: App, ctx: SeedFragmentContext): Promise<void> {
  if (!ctx.licensed("sales") || !ctx.licensed("inventory")) return;
  const today = seedToday();
  const held = new Map<string, number>();
  const heldOf = async (item: HistoryItem) => {
    if (!held.has(item.id)) held.set(item.id, await onHandOf(app, item));
    return held.get(item.id)!;
  };
  let serial = 0;
  for (let back = DAYS_BACK; back >= 0; back -= 1) {
    const date = addDays(today, -back);
    const perDay = back % 3 === 0 ? 2 : 1;
    const thisWeek = back < 7;
    for (let n = 0; n < perDay; n += 1) {
      serial += 1;
      const customer = HISTORY_CUSTOMERS[(serial * 5) % HISTORY_CUSTOMERS.length]!;
      const picks = [ITEM_ROTATION[serial % ITEM_ROTATION.length]!, ITEM_ROTATION[(serial + 3) % ITEM_ROTATION.length]!];
      const lines: { item: HistoryItem; qty: number }[] = [];
      for (const [index, pick] of picks.entries()) {
        const item = HISTORY_ITEMS[pick]!;
        const boost = thisWeek && index === 0 && serial % 2 === 0 ? 3 : 1;
        const qty = (6 + ((serial * 7 + index * 3) % 19)) * boost;
        const available = await heldOf(item);
        if (available < qty) continue;
        lines.push({ item, qty });
        held.set(item.id, available - qty);
      }
      if (lines.length === 0) continue;
      const id = `INV-DEMO-CKP-${String(serial).padStart(2, "0")}`;
      const terms = serial % 4 === 0 ? 3 : customer.paymentTermsDays;
      await step(app, "POST", "/sales-invoices", {
        id,
        date,
        dueDate: addDays(date, terms),
        customerId: customer.id,
        customerNameAr: customer.nameAr,
        warehouseId: WAREHOUSE_ID,
        branchId: BRANCH_ID,
        currency: "EGP",
        arAccountId: ACCOUNTS.receivable,
        taxAccountId: ACCOUNTS.outputVat,
        lines: lines.map((line, index) => ({
          lineId: `${id}-L${index + 1}`,
          itemId: line.item.id,
          itemNameAr: line.item.nameAr,
          isStock: true,
          qty: String(line.qty),
          unitPrice: priceOf(line.item),
          taxRatePercent: VAT_PERCENT,
          revenueAccountId: ACCOUNTS.revenue,
          cogsAccountId: ACCOUNTS.cogs,
          inventoryAccountId: ACCOUNTS.inventory,
        })),
      });
      const confirmed = (await step(app, "POST", `/sales-invoices/${id}/confirm`, {})) as { readonly remainingBalance?: string };
      const outstanding = confirmed.remainingBalance;
      if (!outstanding || serial % 4 === 0 || serial % 5 === 0) continue;
      await step(app, "POST", `/sales-invoices/${id}/payments`, {
        amount: outstanding,
        treasuryAccountId: serial % 2 === 0 ? CASH_TREASURY_ID : BANK_TREASURY_ID,
        paymentMethod: serial % 2 === 0 ? "cash" : "bank",
        date,
        notes: "تحصيل يوم الفاتورة",
      });
    }
  }
}

export const seed: SeedFragment = {
  roleGrants: {
    FINANCE_MANAGER: ["accounting.cockpit.view"],
    BRANCH_MANAGER: ["accounting.cockpit.view"],
    AUDITOR: ["accounting.cockpit.view"],
  },
  run,
};
