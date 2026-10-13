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

export interface ShellRequestGate {
  readonly path: string;
  readonly permission: string;
  readonly servedByTenant: boolean;
}

// INVARIANT: each permission is the one the route itself is gated on; a session is asked to send a request only when it holds it, so a mismatch is either a refused request on every screen or a list the shell never loads.
export const SHELL_REQUESTS: Record<ShellRequest, ShellRequestGate> = {
  [ShellRequest.Roles]: { path: "/roles", permission: "admin.roles.view", servedByTenant: true },
  [ShellRequest.Users]: { path: "/users", permission: "admin.users.view", servedByTenant: true },
  [ShellRequest.Branches]: { path: "/branches", permission: "admin.branches.view", servedByTenant: true },
  [ShellRequest.Warehouses]: { path: "/warehouses", permission: "admin.warehouses.view", servedByTenant: true },
  [ShellRequest.Employees]: { path: "/hr/employees", permission: "hr.employee.view", servedByTenant: true },
  [ShellRequest.JobTitles]: { path: "/hr/job-titles", permission: "hr.job_title.view", servedByTenant: true },
  [ShellRequest.PendingApprovals]: { path: "/workflow/requests/pending-count", permission: "workflow.view", servedByTenant: true },
  [ShellRequest.Settings]: { path: "/settings", permission: "admin.settings.view", servedByTenant: true },
  [ShellRequest.Subscription]: { path: "/billing/subscription", permission: "admin.settings.view", servedByTenant: false },
};

export function holdsShellRequest(auth: AuthContext, request: ShellRequest): boolean {
  return can(auth, SHELL_REQUESTS[request].permission);
}

export enum ScreenRequest {
  Accounts = "accounts",
  TreasuryAccounts = "treasuryAccounts",
  Vouchers = "vouchers",
  SupplierAging = "supplierAging",
}

export interface ScreenRequestGate {
  readonly path: string;
  readonly permission: string;
}

// INVARIANT: lists a document screen reads beside its own document. Each
// permission is the one the route itself is gated on, and the route refuses
// on that permission's MODULE too — so a screen asks only when both hold.
export const SCREEN_REQUESTS: Record<ScreenRequest, ScreenRequestGate> = {
  [ScreenRequest.Accounts]: { path: "/accounts", permission: "accounting.coa.view" },
  [ScreenRequest.TreasuryAccounts]: { path: "/treasury-accounts", permission: "treasury.account.view" },
  [ScreenRequest.Vouchers]: { path: "/vouchers", permission: "treasury.cash_voucher.view" },
  [ScreenRequest.SupplierAging]: { path: "/reports/aging/suppliers", permission: "purchases.invoice.view" },
};

export function mayAskScreenRequest(auth: AuthContext, entitlements: Entitlements | null, request: ScreenRequest): boolean {
  const { permission } = SCREEN_REQUESTS[request];
  if (!can(auth, permission)) return false;
  const module = getPermission(permission)?.module;
  return !entitlements || !module || isModuleLicensed(module, entitlements) || isModuleReadOnly(module, entitlements);
}
