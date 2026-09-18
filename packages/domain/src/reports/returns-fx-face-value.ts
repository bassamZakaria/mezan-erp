import { z } from "zod";
import { Money } from "../money/index.js";
import { salesReturnLineCredit, type SalesReturnLine } from "../sales-returns/sales-return-document.js";
import { purchaseReturnLineCredit, type PurchaseReturnLine } from "../purchase-returns/purchase-return-document.js";
import type { ReportDefinition } from "./types.js";
import { sumRows } from "./kpi.js";

/**
 * مرتجعات بعملة أجنبية مرحّلة بالقيمة الاسمية — an EXCEPTIONS report (D222).
 *
 * Before D203 a return raised against a foreign invoice carried no currency or
 * rate, so it posted the invoice's own digits as base: a return of CHF 50
 * credited the customer 50.00 where 3,000.00 was owed back. Those entries are
 * posted and stay posted; this lists every confirmed return still standing in
 * that state and what it misstated, so an accountant can correct each by
 * reversal. It reads and never writes. A return raised since D203 carries its
 * invoice's rate and never appears; a tenant with none is the clean reading.
 */

export type ReturnFxKind = "sales" | "purchase";

/** The currency and rate a foreign invoice confirmed at, with what names it on screen. */
export interface ForeignInvoiceRef {
  readonly number: string;
  readonly currency: string;
  readonly fxRate: string;
  readonly partyId: string;
}

/** The part of a return document the report reads. */
export interface ReturnDocumentLike<L> {
  readonly id: string;
  readonly docNo: string | null;
  readonly date: string;
  readonly status: string;
  readonly lines: readonly L[];
}

export interface ReturnsFxFaceValueContext {
  readonly salesReturns: readonly ReturnDocumentLike<SalesReturnLine>[];
  readonly purchaseReturns: readonly ReturnDocumentLike<PurchaseReturnLine>[];
  /** Only foreign invoices; a base-currency one cannot have been misstated. */
  readonly salesInvoices: ReadonlyMap<string, ForeignInvoiceRef>;
  readonly purchaseInvoices: ReadonlyMap<string, ForeignInvoiceRef>;
  readonly partyNames: ReadonlyMap<string, string>;
}

export interface ReturnsFxFaceValueParams {
  readonly kind: "" | ReturnFxKind;
}

export interface ReturnsFxFaceValueRow {
  readonly key: string;
  readonly returnId: string;
  readonly kind: ReturnFxKind;
  readonly kindLabel: string;
  readonly returnNo: string;
  readonly date: string;
  readonly partyId: string;
  readonly partyName: string;
  readonly invoiceNo: string;
  readonly currency: string;
  readonly fxRate: string;
  /** What the return posted to the party's control account, in base: the face value. */
  readonly postedBase: number;
  /** What it should have posted: the same lines at the invoice's rate. */
  readonly correctBase: number;
  /** correct − posted: how far the party's account and its counter-entries are understated. */
  readonly misstatement: number;
}

const KIND_LABELS: Record<ReturnFxKind, string> = { sales: "مرتجع مبيعات", purchase: "مرتجع مشتريات" };

const paramsSchema = z.object({ kind: z.enum(["", "sales", "purchase"]) });

const toNumber = (money: Money): number => Number(money.toString());

interface ReturnLineLike {
  readonly sourceInvoiceId: string;
  readonly fxRate?: string | null;
}

function affectedRow<L extends ReturnLineLike>(
  kind: ReturnFxKind,
  doc: ReturnDocumentLike<L>,
  invoices: ReadonlyMap<string, ForeignInvoiceRef>,
  partyNames: ReadonlyMap<string, string>,
  credit: (line: L) => Money,
): ReturnsFxFaceValueRow | null {
  if (doc.status !== "confirmed") return null;
  let posted = Money.zero();
  let correct = Money.zero();
  let invoice: ForeignInvoiceRef | null = null;
  for (const line of doc.lines) {
    const source = invoices.get(line.sourceInvoiceId);
    const asPosted = credit(line);
    posted = posted.add(asPosted);
    if (source && !line.fxRate) {
      invoice ??= source;
      correct = correct.add(credit({ ...line, currency: source.currency, fxRate: source.fxRate }));
    } else {
      correct = correct.add(asPosted);
    }
  }
  if (!invoice) return null;
  return {
    key: `${kind}|${doc.id}`,
    returnId: doc.id,
    kind,
    kindLabel: KIND_LABELS[kind],
    returnNo: doc.docNo ?? doc.id,
    date: doc.date,
    partyId: invoice.partyId,
    partyName: partyNames.get(invoice.partyId) ?? invoice.partyId,
    invoiceNo: invoice.number,
    currency: invoice.currency,
    fxRate: invoice.fxRate,
    postedBase: toNumber(posted),
    correctBase: toNumber(correct),
    misstatement: toNumber(Money.fromScaled(correct.scaled - posted.scaled)),
  };
}

export function createReturnsFxFaceValueReport(): ReportDefinition<
  ReturnsFxFaceValueParams,
  ReturnsFxFaceValueRow,
  ReturnsFxFaceValueContext
> {
  return {
    id: "returns.fx-face-value",
    titleAr: "مرتجعات بعملة أجنبية مرحّلة بالقيمة الاسمية",
    descriptionAr:
      "مرتجعات أُكّدت على فواتير بعملة أجنبية قبل ترحيلها بسعر الفاتورة، فرُحّلت أرقام العملة الأجنبية كأنها بالجنيه. صحّح كل مرتجع بعكسه وإعادة إصداره من الفاتورة.",
    paramsSchema,
    defaultParams: { kind: "" },
    paramFields: [
      {
        kind: "select",
        key: "kind",
        label: "النوع",
        options: [
          { value: "", label: "الكل" },
          { value: "sales", label: KIND_LABELS.sales },
          { value: "purchase", label: KIND_LABELS.purchase },
        ],
      },
    ],
    rowKey: (row) => row.key,
    columns: [
      { key: "returnNo", header: "رقم المرتجع", format: "text", value: (row) => row.returnNo },
      { key: "kindLabel", header: "النوع", format: "text", value: (row) => row.kindLabel },
      { key: "date", header: "التاريخ", format: "date", value: (row) => row.date },
      {
        key: "partyName",
        header: "الطرف",
        format: "text",
        value: (row) => row.partyName,
        entity: { kind: "customer", id: (row) => (row.kind === "sales" ? row.partyId : null) },
      },
      { key: "invoiceNo", header: "الفاتورة المصدر", format: "text", value: (row) => row.invoiceNo },
      { key: "currency", header: "العملة", format: "text", value: (row) => row.currency },
      { key: "fxRate", header: "سعر الفاتورة", format: "text", value: (row) => row.fxRate },
      { key: "postedBase", header: "المرحَّل", format: "money", align: "end", total: true, value: (row) => row.postedBase },
      { key: "correctBase", header: "الصحيح بسعر الفاتورة", format: "money", align: "end", total: true, value: (row) => row.correctBase },
      { key: "misstatement", header: "فرق التحريف", format: "money", align: "end", total: true, value: (row) => row.misstatement },
    ],
    kpis: [
      { key: "count", labelAr: "مرتجعات تحتاج تصحيحاً", format: "qty", value: (rows) => rows.length, tone: (value) => (value > 0 ? "danger" : "success") },
      { key: "postedBase", labelAr: "المرحَّل بالقيمة الاسمية", format: "money", value: (rows) => sumRows(rows, (r) => r.postedBase) },
      { key: "correctBase", labelAr: "الصحيح بسعر الفاتورة", format: "money", value: (rows) => sumRows(rows, (r) => r.correctBase) },
      { key: "misstatement", labelAr: "إجمالي فرق التحريف", format: "money", value: (rows) => sumRows(rows, (r) => r.misstatement), tone: (value) => (value === 0 ? "success" : "danger") },
    ],
    run: (params, ctx) => {
      const rows: ReturnsFxFaceValueRow[] = [];
      if (params.kind !== "purchase") {
        for (const doc of ctx.salesReturns) {
          const row = affectedRow("sales", doc, ctx.salesInvoices, ctx.partyNames, salesReturnLineCredit);
          if (row) rows.push(row);
        }
      }
      if (params.kind !== "sales") {
        for (const doc of ctx.purchaseReturns) {
          const row = affectedRow("purchase", doc, ctx.purchaseInvoices, ctx.partyNames, purchaseReturnLineCredit);
          if (row) rows.push(row);
        }
      }
      return rows.sort((a, b) => (a.date === b.date ? a.returnNo.localeCompare(b.returnNo) : a.date.localeCompare(b.date)));
    },
  };
}
