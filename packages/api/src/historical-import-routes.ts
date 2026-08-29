import { Hono, type Context } from "hono";
import {
  Money,
  Qty,
  previewHistoricalImport,
  importHistoricalPurchaseDocuments,
  InvalidPurchaseDocumentError,
  type HistoricalPurchaseArchiveRepository,
  type HistoricalImportGlPostingPort,
  type HistoricalImportGlAccounts,
  type HistoricalImportRowInput,
  type HistoricalImportGroup,
} from "@mezan/domain";
import { historicalImportBatchSchema } from "@mezan/contracts";
import {
  createPermissionGate,
  getAuthContext,
  headerAuthContextResolver,
  type AuthContextResolver,
} from "./permission-gate.js";

/**
 * Routes for the historical purchase-document import (docs/archive/catalog/02
 * §"استيراد فواتير سابقة" / §"استيراد مرتجعات سابقة"), mounted under
 * `/purchases/historical-import`. `/preview` is a pure dry-run (no writes, no
 * GL); `/commit` archives every valid document and posts a GL entry for JUST
 * an unsettled document's remaining balance — never touching inventory.
 *
 *   POST /preview   validate + group rows, no writes    (purchases.invoice.create)
 *   POST /commit     archive + post remaining balances   (purchases.invoice.create)
 *   GET  /archives   list every archived document        (purchases.invoice.view)
 */
export interface HistoricalImportRoutesDeps {
  readonly archives: HistoricalPurchaseArchiveRepository;
  readonly gl?: HistoricalImportGlPostingPort;
  readonly accounts?: HistoricalImportGlAccounts;
  readonly now?: () => string;
}

function toRowInputs(rows: readonly {
  rowNumber: number;
  docType: "PURCHASE_INVOICE" | "PURCHASE_RETURN";
  documentNumber: string;
  supplierId: string;
  date: string;
  dueDate?: string | null;
  itemId?: string | null;
  description?: string | null;
  qty: string;
  unitCost: string;
  amountPaid: string;
}[]): HistoricalImportRowInput[] {
  return rows.map((r) => ({
    rowNumber: r.rowNumber,
    docType: r.docType,
    documentNumber: r.documentNumber,
    supplierId: r.supplierId,
    date: r.date,
    dueDate: r.dueDate,
    itemId: r.itemId,
    description: r.description,
    qty: Qty.fromMajor(r.qty),
    unitCost: Money.fromMajor(r.unitCost),
    amountPaid: Money.fromMajor(r.amountPaid),
  }));
}

function serializeGroup(g: HistoricalImportGroup) {
  return {
    documentNumber: g.documentNumber,
    docType: g.docType,
    supplierId: g.supplierId,
    date: g.date,
    dueDate: g.dueDate,
    lineCount: g.lines.length,
    total: g.total.toString(),
    amountPaid: g.amountPaid.toString(),
    remainingBalance: g.remainingBalance.toString(),
    settled: g.settled,
  };
}

export function createHistoricalImportRoutes(
  deps: HistoricalImportRoutesDeps,
  resolveAuthContext: AuthContextResolver = headerAuthContextResolver,
) {
  const app = new Hono();
  const gate = createPermissionGate(resolveAuthContext);
  const actor = (c: Context) => getAuthContext(c)?.userId ?? "system";

  app.post("/preview", gate("purchases.invoice.create"), async (c) => {
    const parsed = historicalImportBatchSchema.safeParse(await c.req.json());
    if (!parsed.success) {
      return c.json({ error: "VALIDATION_ERROR", details: parsed.error.flatten() }, 400);
    }
    try {
      const preview = previewHistoricalImport(toRowInputs(parsed.data.rows));
      return c.json({
        groups: preview.groups.map(serializeGroup),
        errors: preview.errors,
      });
    } catch (err) {
      if (err instanceof InvalidPurchaseDocumentError) {
        return c.json({ error: err.code, message: err.message, reasons: err.reasons }, 422);
      }
      throw err;
    }
  });

  app.post("/commit", gate("purchases.invoice.create"), async (c) => {
    const parsed = historicalImportBatchSchema.safeParse(await c.req.json());
    if (!parsed.success) {
      return c.json({ error: "VALIDATION_ERROR", details: parsed.error.flatten() }, 400);
    }
    try {
      const result = await importHistoricalPurchaseDocuments(
        {
          importBatchId: `HPI-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
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
      if (err instanceof InvalidPurchaseDocumentError) {
        return c.json({ error: err.code, message: err.message, reasons: err.reasons }, 422);
      }
      throw err;
    }
  });

  app.get("/archives", gate("purchases.invoice.view"), async (c) => {
    const archives = await deps.archives.list();
    return c.json(
      archives.map((a) => ({
        id: a.id,
        docType: a.docType,
        originalNumber: a.originalNumber,
        supplierId: a.supplierId,
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
