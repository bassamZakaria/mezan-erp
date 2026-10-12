import { resolvePermissions } from "@mezan/domain";
import type { Session } from "./session";

export enum DocumentReadPermission {
  Customers = "sales.customer.view",
  EtaQueue = "accounting.eta.view",
  JournalEntries = "accounting.journal.view",
  TaxRates = "accounting.tax.view",
  TaxRatesManage = "accounting.tax.manage",
  SalesInvoiceEdit = "sales.invoice.edit",
  SalesInvoiceClassifyTax = "sales.invoice.classify_tax",
  PurchaseInvoiceClassifyTax = "purchases.invoice.classify_tax",
  SalesInvoiceVoid = "sales.invoice.void",
  SalesReturnVoid = "sales.return.void",
  PurchaseReturnVoid = "purchases.return.void",
  Items = "inventory.item.view",
  Projects = "projects.project.view",
  SalesReturns = "sales.return.view",
  SalesReturnsOwn = "sales.return.view_own",
  InstallmentPlans = "installments.plan.view",
  AuditLog = "audit.logs.view",
  Workflow = "workflow.view",
  Subscription = "admin.settings.view",
}

const EVERY_PERMISSION = "*";

// SECURITY: this decides only whether a READ is worth sending — the server
// decides whether it is allowed. It follows the catalog's own implications, so
// a holder of `classify_tax` is known to read tax rates as the server knows it.
export function sessionMayRead(session: Session | null, ...anyOf: readonly DocumentReadPermission[]): boolean {
  if (session === null) return false;
  const held = resolvePermissions(session.permissions);
  return held.has(EVERY_PERMISSION) || anyOf.some((permission) => held.has(permission));
}
