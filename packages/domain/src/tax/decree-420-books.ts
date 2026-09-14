/**
 * الدفاتر المطلوبة — the five books a taxpayer inside the simplified regime
 * must keep, per قرار وزير المالية رقم 420 لسنة 2025، المادة 3 (electronic or
 * paper).
 *
 * NONE OF THESE IS A NEW REGISTER. Mezan already keeps every one of them under
 * a different name; this table is the statutory naming, pointing each required
 * book at the report or screen that IS it. Building five parallel registers
 * would create five more places for a figure to disagree with the ledger, which
 * is the opposite of what a book is for.
 */

export interface Decree420Book {
  readonly key: string;
  readonly nameAr: string;
  readonly nameEn: string;
  /** The `ReportDefinition` id that serves this book, when a report serves it. */
  readonly reportId: string | null;
  /** The screen key the book is read on — where there is no report, this is the whole answer. */
  readonly screenKey: string;
  readonly source: string;
}

const DECREE = "قرار وزير المالية 420 لسنة 2025، المادة 3";

export const DECREE_420_BOOKS: readonly Decree420Book[] = [
  {
    key: "fixedAssetRegister",
    nameAr: "سجل الأصول الثابتة",
    nameEn: "Fixed-asset register",
    // The asset register is a live list screen over `/assets`, not a
    // ReportDefinition — it is still the book, and naming a report that does
    // not exist would be worse than naming the screen that does.
    reportId: null,
    screenKey: "asset-register",
    source: DECREE,
  },
  {
    key: "stockRegister",
    nameAr: "سجل مخزون الخامات",
    nameEn: "Raw-materials stock register",
    reportId: "inventory.valuation",
    screenKey: "report-inventory-valuation",
    source: DECREE,
  },
  {
    key: "salesJournal",
    nameAr: "دفتر المبيعات",
    nameEn: "Sales journal",
    reportId: "sales.by-period",
    screenKey: "report-sales-by-period",
    source: DECREE,
  },
  {
    key: "purchasesJournal",
    nameAr: "دفتر المشتريات",
    nameEn: "Purchases journal",
    reportId: "purchases.by-period",
    screenKey: "report-purchases-by-period",
    source: DECREE,
  },
  {
    key: "taxSummaryBook",
    nameAr: "دفتر ملخص الضريبة",
    nameEn: "Tax summary book",
    reportId: "accounting.vat-return",
    screenKey: "financial-reports",
    source: DECREE,
  },
];
