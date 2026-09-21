/**
 * Local TS enums over string-literal unions that @mezan/contracts declares as
 * bare `z.enum([...])` rather than a `z.nativeEnum`. Kept here so no screen
 * ever writes one of these values as a raw string literal.
 */

export enum DocumentKind {
  Quote = "quote",
  Invoice = "invoice",
}

export enum ItemType {
  Stock = "stock",
  Service = "service",
  RawMaterial = "raw_material",
  FinishedGood = "finished_good",
  Consumable = "consumable",
  Recipe = "recipe",
}

export enum CollectPaymentMethod {
  Cash = "cash",
}

export enum VoucherTypeCode {
  CustomerCollection = "customer_collection",
}

export enum ApprovalDecision {
  Approve = "approve",
  Reject = "reject",
}

export enum AllocationInvoiceKind {
  Sales = "sales",
}

export enum SalesInvoiceSort {
  DocNo = "docNo",
}

export enum SortDirection {
  Desc = "desc",
}

export enum TreasuryAccountStatus {
  Active = "active",
}

export enum TreasuryAccountType {
  Bank = "bank",
}
