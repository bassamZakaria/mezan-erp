import { z } from "zod";
import { moneyString } from "./money-string.js";

/**
 * A report's drill-down panel (A5): the entity behind a cell, and the source
 * documents that produced the figure in it.
 *
 * The documents are resolved SERVER-SIDE from the posted records — a report row
 * is an aggregate, and the only honest way to answer "what is this made of" is
 * to go back to the documents, not to re-slice the aggregate in the browser.
 */
export const reportDrillDownKindSchema = z.enum(["customer", "supplier", "item", "account"]);

/** What kind of document a drill-down row points at — the client maps it to a screen. */
export const reportDrillDownDocTypeSchema = z.enum([
  "SALES_INVOICE",
  "PURCHASE_INVOICE",
  "STOCK_MOVEMENT",
  "JOURNAL_ENTRY",
]);

export enum ReportDrillDownFactFormat {
  Text = "text",
  Money = "money",
  Qty = "qty",
  Date = "date",
}

/**
 * A fact's `value` is text unless its `format` says it is a figure: a phone
 * number or a date is not an amount, and declaring every value a money string
 * meant no real panel ever parsed (D345).
 */
export const reportDrillDownFactSchema = z
  .object({
    /** Translation key suffix — `reportDrill.fact.<key>` on the client. */
    key: z.string(),
    labelAr: z.string(),
    value: z.string(),
    format: z.nativeEnum(ReportDrillDownFactFormat).optional(),
  })
  .superRefine((fact, ctx) => {
    if (fact.format !== ReportDrillDownFactFormat.Money && fact.format !== ReportDrillDownFactFormat.Qty) return;
    const parsed = moneyString.safeParse(fact.value);
    if (!parsed.success) ctx.addIssue({ code: z.ZodIssueCode.custom, path: ["value"], message: parsed.error.issues[0]?.message ?? "not an exact decimal" });
  });

export const reportDrillDownDocumentSchema = z.object({
  id: z.string(),
  docNo: z.string(),
  date: z.string(),
  type: reportDrillDownDocTypeSchema,
  /** Domain status/direction code — `reportDrill.status.<status>` on the client. */
  status: z.string(),
  /** An exact decimal string, like every other figure on the wire (D126, D345): money, or a stock quantity when `amountFormat` is `qty`. */
  amount: moneyString,
  /** `money` for a value, `qty` for a stock movement. */
  amountFormat: z.enum(["money", "qty"]),
});

export const reportDrillDownSchema = z.object({
  kind: reportDrillDownKindSchema,
  id: z.string(),
  titleAr: z.string(),
  subtitleAr: z.string().nullable(),
  facts: z.array(reportDrillDownFactSchema),
  documents: z.array(reportDrillDownDocumentSchema),
  /**
   * How many source documents exist in total. The list itself is capped
   * server-side, so a panel showing twenty-five of two hundred must say so
   * rather than let the reader believe it is looking at all of them.
   */
  documentCount: z.number(),
});

export type ReportDrillDownKindDTO = z.infer<typeof reportDrillDownKindSchema>;
export type ReportDrillDownDocTypeDTO = z.infer<typeof reportDrillDownDocTypeSchema>;
export type ReportDrillDownFactDTO = z.infer<typeof reportDrillDownFactSchema>;
export type ReportDrillDownDocumentDTO = z.infer<typeof reportDrillDownDocumentSchema>;
export type ReportDrillDownDTO = z.infer<typeof reportDrillDownSchema>;
