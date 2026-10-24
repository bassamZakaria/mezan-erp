import type { Entitlements } from "../entitlements/entitlements.js";
import { getPermission } from "./catalog.js";
import { isModuleLicensed, isModuleReadOnly } from "./module-licensing.js";

export enum DashboardRequest {
  Summary = "summary",
  Cockpit = "cockpit",
  IncomeStatement = "incomeStatement",
  VatReturn = "vatReturn",
  CustomerAging = "customerAging",
  SupplierAging = "supplierAging",
  StockLevels = "stockLevels",
  TopProducts = "topProducts",
  SalesInvoices = "salesInvoices",
  ContractingExceptions = "contractingExceptions",
  TreasuryBalances = "treasuryBalances",
  VoucherCounts = "voucherCounts",
  LeaveRequestCounts = "leaveRequestCounts",
  MyLeave = "myLeave",
}

export interface DashboardRequestGate {
  readonly path: string;
  readonly allOf: readonly string[];
  readonly anyOf?: readonly string[];
}

// INVARIANT: each entry names the permissions the route itself is gated on; the dashboard sends a request only to a session this table passes, so a mismatch is either a refused request on every sign-in or a tile the role never gets.
export const DASHBOARD_REQUESTS: Record<DashboardRequest, DashboardRequestGate> = {
  [DashboardRequest.Summary]: { path: "/dashboard/summary", allOf: ["dashboard.view", "accounting.journal.view"] },
  [DashboardRequest.Cockpit]: { path: "/dashboard/cockpit", allOf: ["accounting.cockpit.view"] },
  [DashboardRequest.IncomeStatement]: { path: "/financial-reports/income-statement", allOf: ["accounting.reports.view"] },
  [DashboardRequest.VatReturn]: { path: "/financial-reports/vat-return", allOf: ["accounting.reports.view"] },
  [DashboardRequest.CustomerAging]: { path: "/reports/aging/customers", allOf: ["sales.invoice.view"] },
  [DashboardRequest.SupplierAging]: { path: "/reports/aging/suppliers", allOf: ["purchases.invoice.view"] },
  [DashboardRequest.StockLevels]: { path: "/reports/inventory/stock-levels/summary", allOf: ["inventory.stock.view"] },
  [DashboardRequest.TopProducts]: { path: "/reports/sales/top-products", allOf: ["sales.invoice.view"] },
  [DashboardRequest.SalesInvoices]: { path: "/sales-invoices/stats", allOf: [], anyOf: ["sales.invoice.view", "sales.invoice.view_all", "sales.invoice.view_own"] },
  [DashboardRequest.ContractingExceptions]: { path: "/contracting/reports/summary", allOf: ["contracting.certificate.view"] },
  [DashboardRequest.TreasuryBalances]: { path: "/treasury-accounts/stats", allOf: ["treasury.account.view"] },
  [DashboardRequest.VoucherCounts]: { path: "/vouchers/counts", allOf: ["treasury.cash_voucher.view"] },
  [DashboardRequest.LeaveRequestCounts]: { path: "/hr/leave-requests/counts", allOf: ["hr.leave.view"] },
  [DashboardRequest.MyLeave]: { path: "/hr/leave-requests/me", allOf: ["hr.self.leave"] },
};

export type PermissionHeld = (permission: string) => boolean;

export function mayReadWith(permission: string, holds: PermissionHeld, entitlements: Entitlements | null | undefined): boolean {
  if (!holds(permission)) return false;
  const module = getPermission(permission)?.module;
  if (!entitlements || module === undefined) return true;
  return isModuleLicensed(module, entitlements) || isModuleReadOnly(module, entitlements);
}

export function mayActWith(permission: string, holds: PermissionHeld, entitlements: Entitlements | null | undefined): boolean {
  if (!holds(permission)) return false;
  const module = getPermission(permission)?.module;
  return !entitlements || module === undefined || isModuleLicensed(module, entitlements);
}

export function mayAskDashboard(request: DashboardRequest, holds: PermissionHeld, entitlements: Entitlements | null | undefined): boolean {
  const gate = DASHBOARD_REQUESTS[request];
  const readable = (permission: string) => mayReadWith(permission, holds, entitlements);
  return gate.allOf.every(readable) && (gate.anyOf === undefined || gate.anyOf.some(readable));
}
