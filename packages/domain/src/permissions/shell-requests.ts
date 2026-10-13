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
