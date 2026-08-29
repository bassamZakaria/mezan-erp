import { Hono, type Context } from "hono";
import {
  Money,
  Qty,
  previewHistoricalSalesImport,
  importHistoricalSalesDocuments,
  InvalidSalesInvoiceError,
  type HistoricalSalesArchiveRepository,
  type HistoricalSalesImportGlPostingPort,
  type HistoricalSalesImportGlAccounts,
  type HistoricalSalesImportRowInput,
  type HistoricalSalesImportGroup,
} from "@mezan/domain";
import { historicalSalesImportBatchSchema } from "@mezan/contracts";
import {
  createPermissionGate,
  getAuthContext,
  headerAuthContextResolver,
  type AuthContextResolver,
} from "./permission-gate.js";

/**
 * Routes for the historical sales-document import (docs/archive/catalog/01
 * §"استيراد فواتير سابقة" / §"استيراد مرتجعات سابقة"), mounted under
 * `/sales/historical-import`. `/preview` is a pure dry-run (no writes, no
 * GL); `/commit` archives every valid document and posts a GL entry for JUST
 * an unsettled document's remaining balance — never touching inventory.
 *
 *   POST /preview   validate + group rows, no writes    (sales.invoice.create)
 *   POST /commit     archive + post remaining balances   (sales.invoice.create)
 *   GET  /archives   list every archived document        (sales.invoice.view)
 */
export interface SalesHistoricalImportRoutesDeps {
  readonly archives: HistoricalSalesArchiveRepository;
  readonly gl?: HistoricalSalesImportGlPostingPort;
  readonly accounts?: HistoricalSalesImportGlAccounts;
  readonly now?: () => string;
}

function toRowInputs(rows: readonly {
  rowNumber: number;
  docType: "SALES_INVOICE" | "SALES_RETURN";
  documentNumber: string;
  customerId: string;
  date: string;
  dueDate?: string | null;
  itemId?: string | null;
  description?: string | null;
  qty: string;
  unitCost: string;
  amountPaid: string;
}[]): HistoricalSalesImportRowInput[] {
  return rows.map((r) => ({
    rowNumber: r.rowNumber,
    docType: r.docType,
    documentNumber: r.documentNumber,
    customerId: r.customerId,
    date: r.date,
    dueDate: r.dueDate,
    itemId: r.itemId,
    description: r.description,
    qty: Qty.fromMajor(r.qty),
    unitCost: Money.fromMajor(r.unitCost),
    amountPaid: Money.fromMajor(r.amountPaid),
  }));
}

function serializeGroup(g: HistoricalSalesImportGroup) {
  return {
    documentNumber: g.documentNumber,
    docType: g.docType,
    customerId: g.customerId,
    date: g.date,
    dueDate: g.dueDate,
    lineCount: g.lines.length,
    total: g.total.toString(),
    amountPaid: g.amountPaid.toString(),
    remainingBalance: g.remainingBalance.toString(),
    settled: g.settled,
  };
}

export function createSalesHistoricalImportRoutes(
  deps: SalesHistoricalImportRoutesDeps,
  resolveAuthContext: AuthContextResolver = headerAuthContextResolver,
) {
  const app = new Hono();
  const gate = createPermissionGate(resolveAuthContext);
  const actor = (c: Context) => getAuthContext(c)?.userId ?? "system";

  app.post("/preview", gate("sales.invoice.create"), async (c) => {
    const parsed = historicalSalesImportBatchSchema.safeParse(await c.req.json());
    if (!parsed.success) {
      return c.json({ error: "VALIDATION_ERROR", details: parsed.error.flatten() }, 400);
    }
    try {
      const preview = previewHistoricalSalesImport(toRowInputs(parsed.data.rows));
      return c.json({
        groups: preview.groups.map(serializeGroup),
        errors: preview.errors,
      });
    } catch (err) {
      if (err instanceof InvalidSalesInvoiceError) {
        return c.json({ error: err.code, message: err.message, reasons: err.reasons }, 422);
      }
      throw err;
    }
  });

  app.post("/commit", gate("sales.invoice.create"), async (c) => {
    const parsed = historicalSalesImportBatchSchema.safeParse(await c.req.json());
    if (!parsed.success) {
      return c.json({ error: "VALIDATION_ERROR", details: parsed.error.flatten() }, 400);
    }
    try {
      const result = await importHistoricalSalesDocuments(
        {
          importBatchId: `HSI-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
          rows: toRowInputs(parsed.data.rows),
          createdBy: actor(c),
        },
        { archives: deps.archives, gl: deps.gl, accounts: deps.accounts, now: deps.now },
      );
      return c.json(
        {
          groups: [],
          errors: result.errors,
          archivedIds: result.archived.map((a) => a.id),
        },
        201,
      );
    } catch (err) {
      if (err instanceof InvalidSalesInvoiceError) {
        return c.json({ error: err.code, message: err.message, reasons: err.reasons }, 422);
      }
      throw err;
    }
  });

  app.get("/archives", gate("sales.invoice.view"), async (c) => {
    const archives = await deps.archives.list();
    return c.json(
      archives.map((a) => ({
        id: a.id,
        docType: a.docType,
        originalNumber: a.originalNumber,
        customerId: a.customerId,
        date: a.date,
        dueDate: a.dueDate,
        lines: a.lines.map((l) => ({
          itemId: l.itemId,
          description: l.description,
          qty: l.qty.toString(),
          unitCost: l.unitCost.toString(),
        })),
        total: a.total.toString(),
        amountPaid: a.amountPaid.toString(),
        remainingBalance: a.remainingBalance.toString(),
        settled: a.settled,
        importBatchId: a.importBatchId,
        createdBy: a.createdBy,
        createdAt: a.createdAt,
      })),
    );
  });

  return app;
}
