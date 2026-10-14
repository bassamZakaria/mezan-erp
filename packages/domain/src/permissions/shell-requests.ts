import type { Entitlements } from "../entitlements/index.js";
import { can, type AuthContext } from "./auth-context.js";
import { getPermission } from "./catalog.js";
import { isModuleLicensed, isModuleReadOnly } from "./module-licensing.js";

export enum ShellRequest {
  Roles = "roles",
  Users = "users",
  Branches = "branches",
  Warehouses = "warehouses",
  Employees = "employees",
  JobTitles = "jobTitles",
  PendingApprovals = "pendingApprovals",
  Settings = "settings",
  Subscription = "subscription",
}

export enum ShellRequestModule {
  Hr = "hr",
}

export interface ShellRequestGate {
  readonly path: string;
  readonly permission: string;
  readonly servedByTenant: boolean;
  // INVARIANT: the module the route is licensed under, or null for a route
  // every plan serves. The shell asks only when the tenant's plan includes it:
  // a request for a module the plan lacks is a 403 on every screen.
  readonly module: ShellRequestModule | null;
}

// INVARIANT: each permission is the one the route itself is gated on; a session is asked to send a request only when it holds it, so a mismatch is either a refused request on every screen or a list the shell never loads.
export const SHELL_REQUESTS: Record<ShellRequest, ShellRequestGate> = {
  [ShellRequest.Roles]: { path: "/roles", permission: "admin.roles.view", servedByTenant: true, module: null },
  [ShellRequest.Users]: { path: "/users", permission: "admin.users.view", servedByTenant: true, module: null },
  [ShellRequest.Branches]: { path: "/branches", permission: "admin.branches.view", servedByTenant: true, module: null },
  [ShellRequest.Warehouses]: { path: "/warehouses", permission: "admin.warehouses.view", servedByTenant: true, module: null },
  [ShellRequest.Employees]: { path: "/hr/employees", permission: "hr.employee.view", servedByTenant: true, module: ShellRequestModule.Hr },
  [ShellRequest.JobTitles]: { path: "/hr/job-titles", permission: "hr.job_title.view", servedByTenant: true, module: ShellRequestModule.Hr },
  [ShellRequest.PendingApprovals]: { path: "/workflow/requests/pending-count", permission: "workflow.view", servedByTenant: true, module: null },
  [ShellRequest.Settings]: { path: "/settings", permission: "admin.settings.view", servedByTenant: true, module: null },
  [ShellRequest.Subscription]: { path: "/billing/subscription", permission: "admin.settings.view", servedByTenant: false, module: null },
};

export function holdsShellRequest(auth: AuthContext, request: ShellRequest): boolean {
  return can(auth, SHELL_REQUESTS[request].permission);
}

export interface PlanModules {
  readonly activeModules: readonly string[];
  readonly readOnlyModules?: readonly string[];
}

export function planServesShellRequest(plan: PlanModules, request: ShellRequest): boolean {
  const { module } = SHELL_REQUESTS[request];
  return module === null || plan.activeModules.includes(module) || (plan.readOnlyModules ?? []).includes(module);
}

export enum ScreenRequest {
  Accounts = "accounts",
  TreasuryAccounts = "treasuryAccounts",
  Vouchers = "vouchers",
  SupplierAging = "supplierAging",
  Suppliers = "suppliers",
  PurchaseOrders = "purchaseOrders",
  GoodsReceipts = "goodsReceipts",
  PriceLists = "priceLists",
  CostCenters = "costCenters",
  FiscalPeriods = "fiscalPeriods",
  ExchangeRates = "exchangeRates",
  ProductTemplates = "productTemplates",
  ConfigurableProducts = "configurableProducts",
  Boms = "boms",
  Departments = "departments",
  EmploymentContracts = "employmentContracts",
  EmployeeAdvances = "employeeAdvances",
  PayrollStatutoryFlag = "payrollStatutoryFlag",
  Cheques = "cheques",
  SalesQuotes = "salesQuotes",
  Assets = "assets",
  WorksContracts = "worksContracts",
  FinancialReports = "financialReports",
  PayrollComponents = "payrollComponents",
  Attendance = "attendance",
  LeaveBalances = "leaveBalances",
  LeaveRequests = "leaveRequests",
  YearEndClosePreview = "yearEndClosePreview",
}

export interface ScreenRequestGate {
  readonly path: string;
  readonly permission: string;
  /** Narrower tiers the route also serves, each cut to the caller's own records. */
  readonly ownTiers?: readonly string[];
}

// INVARIANT: lists a document screen reads beside its own document. Each
// permission is the one the route itself is gated on, and the route refuses
// on that permission's MODULE too — so a screen asks only when both hold.
export const SCREEN_REQUESTS: Record<ScreenRequest, ScreenRequestGate> = {
  [ScreenRequest.Accounts]: { path: "/accounts", permission: "accounting.coa.view" },
  [ScreenRequest.TreasuryAccounts]: { path: "/treasury-accounts", permission: "treasury.account.view" },
  [ScreenRequest.Vouchers]: { path: "/vouchers", permission: "treasury.cash_voucher.view" },
  [ScreenRequest.SupplierAging]: { path: "/reports/aging/suppliers", permission: "purchases.invoice.view" },
  [ScreenRequest.Suppliers]: { path: "/suppliers", permission: "purchases.supplier.view" },
  [ScreenRequest.PurchaseOrders]: { path: "/purchases/orders", permission: "purchases.order.view" },
  [ScreenRequest.GoodsReceipts]: { path: "/purchases/receipts", permission: "purchases.receipt.view" },
  [ScreenRequest.PriceLists]: { path: "/price-lists", permission: "sales.price_list.view" },
  [ScreenRequest.CostCenters]: { path: "/cost-centers", permission: "accounting.coa.view" },
  [ScreenRequest.FiscalPeriods]: { path: "/fiscal-periods", permission: "accounting.period.view" },
  [ScreenRequest.ExchangeRates]: { path: "/exchange-rates", permission: "accounting.exchange_rate.manage" },
  [ScreenRequest.ProductTemplates]: { path: "/inventory/product-templates", permission: "inventory.template.view" },
  [ScreenRequest.ConfigurableProducts]: { path: "/manufacturing/configurable-products", permission: "manufacturing.bom.view" },
  [ScreenRequest.Boms]: { path: "/manufacturing/boms", permission: "manufacturing.bom.view" },
  [ScreenRequest.Departments]: { path: "/hr/departments", permission: "hr.department.view" },
  [ScreenRequest.EmploymentContracts]: { path: "/hr/contracts", permission: "hr.contract.view" },
  [ScreenRequest.EmployeeAdvances]: { path: "/hr/advances", permission: "hr.advance.view" },
  [ScreenRequest.PayrollStatutoryFlag]: { path: "/hr/payroll/statutory-flag", permission: "hr.payroll.view" },
  [ScreenRequest.Cheques]: { path: "/cheques", permission: "cheques.view" },
  [ScreenRequest.SalesQuotes]: { path: "/sales-quotes", permission: "sales.quote.view", ownTiers: ["sales.quote.view_own"] },
  [ScreenRequest.Assets]: { path: "/assets", permission: "assets.view" },
  [ScreenRequest.WorksContracts]: { path: "/contracting/contracts", permission: "contracting.boq.view" },
  [ScreenRequest.FinancialReports]: { path: "/financial-reports/trial-balance", permission: "accounting.reports.view" },
  [ScreenRequest.PayrollComponents]: { path: "/hr/payroll/components", permission: "hr.payroll.view" },
  [ScreenRequest.Attendance]: { path: "/hr/attendance", permission: "hr.attendance.view" },
  [ScreenRequest.LeaveBalances]: { path: "/hr/leave-balances", permission: "hr.leave.view" },
  [ScreenRequest.LeaveRequests]: { path: "/hr/leave-requests", permission: "hr.leave.view" },
  [ScreenRequest.YearEndClosePreview]: { path: "/gl/year-end-close/2026/preview", permission: "accounting.period.close" },
};

export function mayAskScreenRequest(auth: AuthContext, entitlements: Entitlements | null, request: ScreenRequest): boolean {
  const { permission, ownTiers } = SCREEN_REQUESTS[request];
  if (![permission, ...(ownTiers ?? [])].some((code) => can(auth, code))) return false;
  const module = getPermission(permission)?.module;
  return !entitlements || !module || isModuleLicensed(module, entitlements) || isModuleReadOnly(module, entitlements);
}

export enum ShellModuleRequest {
  Notifications = "notifications",
  UnreadNotificationCount = "unreadNotificationCount",
}

export interface ShellModuleRequestGate {
  readonly path: string;
  readonly module: string;
}

// INVARIANT: requests the shell sends for every signed-in person, on routes that carry no permission of their own and are refused on their MODULE alone. The shell asks only once the licence is known to carry it; polling a refusal every thirty seconds is what a Core licence did before.
export const SHELL_MODULE_REQUESTS: Record<ShellModuleRequest, ShellModuleRequestGate> = {
  [ShellModuleRequest.Notifications]: { path: "/notifications", module: "notifications" },
  [ShellModuleRequest.UnreadNotificationCount]: { path: "/notifications/unread-count", module: "notifications" },
};

export function mayAskShellModuleRequest(entitlements: Entitlements | null, request: ShellModuleRequest): boolean {
  if (!entitlements) return true;
  const { module } = SHELL_MODULE_REQUESTS[request];
  return isModuleLicensed(module, entitlements) || isModuleReadOnly(module, entitlements);
}
