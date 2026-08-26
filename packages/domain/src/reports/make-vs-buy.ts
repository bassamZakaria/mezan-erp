import { z } from "zod";
import { Money, Qty } from "../money/index.js";
import { unitCostOf } from "../inventory/index.js";
import { bomCostEstimate, type Bom } from "../manufacturing/index.js";
import type { Item } from "../items/item.js";
import { purchaseInvoiceLineBase, type PurchaseInvoice } from "../purchasing/purchase-invoice.js";
import type { ReportDefinition } from "./types.js";
import { sumRows, countRows } from "./kpi.js";
import { itemTypeTracksStock } from "../items/item-type.js";

/**
 * التصنيع أم الشراء — Make vs Buy (docs/catalog/07 §التصنيع مقابل الشراء):
 * for every item with an active BOM, compares the standard cost to
 * manufacture it against the real cost history of buying it, and says which
 * side is cheaper. BOTH sides are read off documents that were actually
 * confirmed — never off `item.costPrice` (an editable list price, not a
 * recorded transaction) and never a fallback to zero.
 *
 * Cost basis (surfaced to the reader via `descriptionAr` and the row-level
 * `basisNote`, since which basis a number uses is itself a decision the
 * reader needs to see):
 *  - الشراء (buy cost) = the weighted-average unit cost across every line of
 *    every CONFIRMED purchase invoice for that item — Σ(qty × unit cost) ÷
 *    Σ qty. An item never purchased has no entry in this map at all: its buy
 *    cost is `null`, rendered as "—", never 0.
 *  - التصنيع (make cost) = the BOM's standard cost estimate (material +
 *    labour + overhead, ÷ standard batch qty), where EVERY component line's
 *    unit cost is resolved through the SAME weighted-average purchase-cost
 *    basis above. If even one component was never purchased, its cost is
 *    unknown, so the whole material cost — and therefore the make cost — is
 *    `null` rather than silently treating the missing component as free.
 */

export interface MakeVsBuyContext {
  readonly items: readonly Item[];
  readonly boms: readonly Bom[];
  readonly purchaseInvoices: readonly PurchaseInvoice[];
}

export interface MakeVsBuyParams {
  readonly search: string;
}

export type MakeVsBuyVerdict = "make" | "buy" | "tie" | "unknown";

const VERDICT_LABELS: Record<MakeVsBuyVerdict, string> = {
  make: "التصنيع أرخص",
  buy: "الشراء أرخص",
  tie: "متعادل",
  unknown: "بيانات غير كافية",
};

export interface MakeVsBuyRow {
  readonly itemId: string;
  readonly itemCode: string;
  readonly itemNameAr: string;
  readonly bomNumber: string;
  /** BOM standard cost (material at weighted-average purchase cost + standard labour/overhead) ÷ standard qty. `null` when a component was never purchased. */
  readonly makeCost: number | null;
  /** Weighted-average confirmed purchase cost for the finished item itself. `null` when it was never purchased. */
  readonly buyCost: number | null;
  /** buyCost − makeCost; only meaningful (non-null) when both sides are known. */
  readonly diff: number | null;
  readonly verdict: MakeVsBuyVerdict;
  readonly verdictLabel: string;
}

const paramsSchema = z.object({
  search: z.string(),
});

/** Weighted-average unit cost per item across every line of every CONFIRMED purchase invoice — real recorded purchases only, never a list price. */
function weightedAveragePurchaseCosts(invoices: readonly PurchaseInvoice[]): Map<string, Money> {
  const totals = new Map<string, { qty: Qty; cost: Money }>();
  for (const invoice of invoices) {
    if (invoice.status !== "confirmed") continue;
    for (const line of invoice.lines) {
      if (line.kind !== "inventory" || line.itemId === null) continue;
      const existing = totals.get(line.itemId) ?? { qty: Qty.zero(), cost: Money.zero() };
      totals.set(line.itemId, {
        qty: existing.qty.add(line.qty),
        cost: existing.cost.add(purchaseInvoiceLineBase(line)),
      });
    }
  }
  const result = new Map<string, Money>();
  for (const [itemId, agg] of totals) {
    if (agg.qty.isZero()) continue;
    result.set(itemId, unitCostOf(agg.cost, agg.qty));
  }
  return result;
}

function latestActiveBomByProduct(boms: readonly Bom[]): Map<string, Bom> {
  const byProduct = new Map<string, Bom>();
  for (const bom of boms) {
    if (bom.status !== "active" || bom.custom) continue;
    byProduct.set(bom.productItemId, bom);
  }
  return byProduct;
}

function verdictOf(diff: Money | null): MakeVsBuyVerdict {
  if (diff === null) return "unknown";
  if (diff.scaled > 0n) return "make";
  if (diff.scaled < 0n) return "buy";
  return "tie";
}

export function createMakeVsBuyReport(): ReportDefinition<MakeVsBuyParams, MakeVsBuyRow, MakeVsBuyContext> {
  return {
    id: "manufacturing.make-vs-buy",
    titleAr: "التصنيع أم الشراء",
    descriptionAr:
      "تكلفة التصنيع = تكلفة قائمة المواد القياسية (المواد بمتوسط تكلفة الشراء الفعلي من فواتير الشراء المؤكدة + العمالة والتكاليف الإضافية القياسية) ÷ الكمية القياسية للدفعة. تكلفة الشراء = متوسط تكلفة الشراء الفعلي للصنف نفسه من فواتير الشراء المؤكدة. عند غياب تاريخ شراء فعلي تظهر الخانة «—» ولا تُحتسب ضمن المقارنة — لا سعر قائمة، ولا قيمة افتراضية.",
    paramsSchema,
    defaultParams: { search: "" },
    paramFields: [{ kind: "text", key: "search", label: "بحث", placeholder: "بحث بالاسم أو الكود" }],
    rowKey: (row) => row.itemId,
    columns: [
      { key: "itemNameAr", header: "الصنف", format: "text", value: (row) => row.itemNameAr, entity: { kind: "item", id: (row) => row.itemId } },
      { key: "bomNumber", header: "قائمة المواد", format: "text", value: (row) => row.bomNumber },
      { key: "makeCost", header: "تكلفة التصنيع", format: "money", align: "end", value: (row) => row.makeCost },
      { key: "buyCost", header: "تكلفة الشراء", format: "money", align: "end", value: (row) => row.buyCost },
      { key: "diff", header: "الفرق (الشراء − التصنيع)", format: "money", align: "end", value: (row) => row.diff },
      { key: "verdictLabel", header: "الأرخص", format: "text", value: (row) => row.verdictLabel },
    ],
    kpis: [
      { key: "makeCheaper", labelAr: "التصنيع أرخص", format: "qty", value: (rows) => countRows(rows, (r) => r.verdict === "make"), tone: () => "success" },
      { key: "buyCheaper", labelAr: "الشراء أرخص", format: "qty", value: (rows) => countRows(rows, (r) => r.verdict === "buy") },
      { key: "potentialSaving", labelAr: "الوفر المحتمل", hintAr: "مجموع الفروق حيث التصنيع أرخص", format: "money", value: (rows) => sumRows(rows, (r) => (r.verdict === "make" ? r.diff : 0)) },
      { key: "comparable", labelAr: "أصناف قابلة للمقارنة", hintAr: "الأصناف التي لها تكلفة تصنيع وتكلفة شراء فعليتان", format: "qty", value: (rows) => countRows(rows, (r) => r.verdict !== "unknown") },
    ],
    chart: {
      labelColumn: "itemNameAr",
      valueColumn: "diff",
      maxPoints: 8,
      captionAr: "الفرق بين تكلفة الشراء وتكلفة التصنيع لكل صنف — الموجب يعني أن التصنيع أرخص.",
    },
    run: (params, ctx) => {
      const search = params.search.trim().toLowerCase();
      const purchaseCosts = weightedAveragePurchaseCosts(ctx.purchaseInvoices);
      const activeBoms = latestActiveBomByProduct(ctx.boms);

      const rows: MakeVsBuyRow[] = [];
      for (const item of ctx.items) {
        if (!itemTypeTracksStock(item.type)) continue;
        const bom = activeBoms.get(item.id);
        if (!bom) continue;
        if (search && !item.nameAr.toLowerCase().includes(search) && !item.code.toLowerCase().includes(search)) continue;

        const everyComponentKnown = bom.lines.every((line) => purchaseCosts.has(line.itemId));
        const makeCostMoney = everyComponentKnown
          ? bomCostEstimate(bom, (id) => purchaseCosts.get(id) ?? Money.zero()).unitCost
          : null;
        const buyCostMoney = purchaseCosts.get(item.id) ?? null;
        const diffMoney = makeCostMoney !== null && buyCostMoney !== null ? buyCostMoney.add(makeCostMoney.negate()) : null;

        const verdict = verdictOf(diffMoney);
        rows.push({
          itemId: item.id,
          itemCode: item.code,
          itemNameAr: item.nameAr,
          bomNumber: bom.number,
          makeCost: makeCostMoney !== null ? Number(makeCostMoney.toString()) : null,
          buyCost: buyCostMoney !== null ? Number(buyCostMoney.toString()) : null,
          diff: diffMoney !== null ? Number(diffMoney.toString()) : null,
          verdict,
          verdictLabel: VERDICT_LABELS[verdict],
        });
      }

      return rows.sort((a, b) => a.itemNameAr.localeCompare(b.itemNameAr, "ar"));
    },
  };
}
