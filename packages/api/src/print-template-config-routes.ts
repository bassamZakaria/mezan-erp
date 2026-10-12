import { Hono } from "hono";
import {
  createDefaultSettings,
  DEFAULT_PRINT_TEMPLATE_CONFIG,
  type PrintTemplateConfigRepository,
  type SettingsRepository,
} from "@mezan/domain";
import { printTemplateConfigSchema } from "@mezan/contracts";
import { createAnyPermissionGate, createPermissionGate, type AuthContextResolver } from "./permission-gate.js";

/**
 * Print Template Config routes (docs/archive/catalog/09 §"قوالب الطباعة"): a single
 * tenant-wide print-template settings object feeding the 9-tab designer UI.
 * `GET /` reads it (falling back to the catalog default so the UI always has
 * something to render) and `PUT /` validates and replaces it wholesale — same
 * shape as `createSettingsRoutes`, gated via the permissions engine.
 */
export interface PrintTemplateConfigRoutesDeps {
  readonly repo: PrintTemplateConfigRepository;
  readonly settings?: Pick<SettingsRepository, "get">;
}

export enum PrintableDocumentFamily {
  SalesInvoice = "sales_invoice",
  SalesQuote = "sales_quote",
  SalesReturn = "sales_return",
  PurchaseOrder = "purchase_order",
  GoodsReceipt = "goods_receipt",
  PurchaseInvoice = "purchase_invoice",
  PurchaseReturn = "purchase_return",
  JournalEntry = "journal_entry",
  TreasuryVoucher = "treasury_voucher",
  PartyStatement = "party_statement",
  Payslip = "payslip",
}

// SECURITY: the template and the letterhead are what a PRINTED DOCUMENT
// carries, so they are read by whoever may view one of the documents that
// prints — the families below, each with the view permissions its own routes
// accept — and by nobody else. The list is explicit on purpose: "any view
// permission" let a caller who may only see the item catalogue read them.
// Editing the template stays behind `admin.settings.edit`.
export const PRINTABLE_DOCUMENT_VIEW_PERMISSIONS: Readonly<Record<PrintableDocumentFamily, readonly string[]>> = {
  [PrintableDocumentFamily.SalesInvoice]: ["sales.invoice.view", "sales.invoice.view_all", "sales.invoice.view_own"],
  [PrintableDocumentFamily.SalesQuote]: ["sales.quote.view", "sales.quote.view_own"],
  [PrintableDocumentFamily.SalesReturn]: ["sales.return.view", "sales.return.view_own"],
  [PrintableDocumentFamily.PurchaseOrder]: ["purchases.order.view"],
  [PrintableDocumentFamily.GoodsReceipt]: ["purchases.receipt.view"],
  [PrintableDocumentFamily.PurchaseInvoice]: ["purchases.invoice.view", "purchases.invoice.view_own"],
  [PrintableDocumentFamily.PurchaseReturn]: ["purchases.return.view"],
  [PrintableDocumentFamily.JournalEntry]: ["accounting.journal.view"],
  [PrintableDocumentFamily.TreasuryVoucher]: ["treasury.cash_voucher.view"],
  [PrintableDocumentFamily.PartyStatement]: ["sales.customer.view", "purchases.supplier.view"],
  [PrintableDocumentFamily.Payslip]: ["hr.payroll.view"],
};

export const DOCUMENT_VIEW_PERMISSIONS: readonly string[] = [...new Set(Object.values(PRINTABLE_DOCUMENT_VIEW_PERMISSIONS).flat())];

export function createPrintTemplateConfigRoutes(
  deps: PrintTemplateConfigRoutesDeps,
  resolveAuthContext: AuthContextResolver,
) {
  const app = new Hono();
  const gate = createPermissionGate(resolveAuthContext);
  const gateAnyDocumentView = createAnyPermissionGate(resolveAuthContext)(...DOCUMENT_VIEW_PERMISSIONS, "admin.settings.view");

  app.get("/", gateAnyDocumentView, async (c) => {
    const existing = await deps.repo.get();
    return c.json(existing ?? DEFAULT_PRINT_TEMPLATE_CONFIG);
  });

  app.get("/letterhead", gateAnyDocumentView, async (c) => {
    const settings = (await deps.settings?.get()) ?? createDefaultSettings();
    return c.json({
      companyName: settings.companyName,
      address: settings.address,
      phone: settings.phone,
      email: settings.email,
      taxRegistrationNumber: settings.taxRegistrationNumber,
      commercialRegistrationNumber: settings.commercialRegistrationNumber,
    });
  });

  app.put("/", gate("admin.settings.edit"), async (c) => {
    const parsed = printTemplateConfigSchema.safeParse(await c.req.json());
    if (!parsed.success) {
      return c.json({ error: "VALIDATION_ERROR", details: parsed.error.flatten() }, 400);
    }

    await deps.repo.save(parsed.data);
    return c.json(parsed.data);
  });

  return app;
}
