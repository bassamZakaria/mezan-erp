import { sessionHolds, type Session } from "./session";

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
}

// SECURITY: this decides only whether a READ is worth sending — the server
// decides whether it is allowed. INVARIANT: the rule itself — the catalog's
// own implications, as the server resolves a grant — is stated ONCE, in
// `sessionHolds`; this is its any-of mode and resolves nothing itself.
export function sessionMayRead(session: Session | null, ...anyOf: readonly DocumentReadPermission[]): boolean {
  return anyOf.some((permission) => sessionHolds(session, permission));
}
