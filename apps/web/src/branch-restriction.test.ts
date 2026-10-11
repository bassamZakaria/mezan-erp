import { describe, expect, it } from "vitest";
import { BRANCH_POLICY_TABLE, BranchPolicy, BranchRestrictedAccess } from "@mezan/contracts";
import {
  BRANCH_GATED_ACTION_API,
  BranchGatedAction,
  COMPANY_WIDE_WITHOUT_A_SURFACE,
  NAV_ITEM_API,
  actionAccess,
  branchRefusalBefore,
  isBranchRestricted,
  navItemAccess,
  restrictedFieldsOf,
  withoutBranchUnavailable,
} from "./branch-restriction";
import { navGroupSpecs } from "./nav-config";

const navKeys = navGroupSpecs.flatMap((group) => [...group.itemKeys, ...(group.sections ?? []).flatMap((section) => section.itemKeys)]);

describe("what a branch-restricted session is shown is read from the server's own policy table", () => {
  it("a session is restricted exactly when its branch scope is not every branch", () => {
    expect(isBranchRestricted({ branchScope: "*" })).toBe(false);
    expect(isBranchRestricted({ branchScope: ["BR-ALEX"] })).toBe(true);
    expect(isBranchRestricted(null)).toBe(false);
  });

  it("every company-wide family the server declares is tied to the screens or actions it backs, so a new one cannot be forgotten", () => {
    const surfaced = [...Object.values(NAV_ITEM_API), ...Object.values(BRANCH_GATED_ACTION_API)];
    const forgotten = BRANCH_POLICY_TABLE.filter((entry) => entry.policy === BranchPolicy.CompanyWide)
      .map((entry) => entry.prefix)
      .filter((prefix) => !COMPANY_WIDE_WITHOUT_A_SURFACE.includes(prefix) && !surfaced.some((path) => path === prefix || path.startsWith(`${prefix}/`)));
    expect(forgotten).toEqual([]);
  });

  it("names only screens that exist", () => {
    expect(Object.keys(NAV_ITEM_API).filter((key) => !navKeys.includes(key))).toEqual([]);
  });

  it("hides the company-wide screens the owner listed, and leaves the daily ones", () => {
    const hidden = [
      "projects",
      "contracting-contracts",
      "certificates",
      "leads",
      "reconciliation",
      "revaluation",
      "tax-simplified-regime",
      "hr-dashboard",
      "production-dashboard",
      "settings-data-migration",
      "report-security-exceptions",
      "report-sod-conflicts",
      "report-installments-overdue",
      "report-inventory-drift",
      "leave-accrual-batches",
    ];
    for (const key of hidden) expect(navItemAccess(key), key).toBe(BranchRestrictedAccess.Unavailable);
    for (const key of ["dashboard", "sales-invoices", "customers", "treasury-vouchers", "stock-transfers", "journals"]) {
      expect(navItemAccess(key), key).toBe(BranchRestrictedAccess.Full);
    }
  });

  it("marks shared configuration read-only", () => {
    for (const key of ["price-lists", "promotions", "boms", "coa", "taxes", "fiscal-periods", "settings-general", "roles", "settings-branches"]) {
      expect(navItemAccess(key), key).toBe(BranchRestrictedAccess.ReadOnly);
    }
  });

  it("gates the actions that live inside an otherwise open screen", () => {
    for (const action of Object.values(BranchGatedAction)) expect(actionAccess(action), action).toBe(BranchRestrictedAccess.Unavailable);
  });

  it("follows the table: a family the server opens is shown again without touching the web", () => {
    const opened = BRANCH_POLICY_TABLE.map((entry) => (entry.prefix === "/projects" ? { ...entry, policy: BranchPolicy.Public } : entry));
    expect(navItemAccess("projects", opened)).toBe(BranchRestrictedAccess.Full);
  });

  it("cuts the nav tree to what a branch-restricted session can open, dropping a shelf left empty", () => {
    const tree = [
      { key: "contracting", items: [{ key: "projects" }, { key: "certificates" }] },
      { key: "sell", items: [{ key: "sales-invoices" }], sections: [{ key: "reports", items: [{ key: "report-installments-overdue" }] }, { key: "config", items: [{ key: "price-lists" }] }] },
    ];
    expect(withoutBranchUnavailable(tree)).toEqual([{ key: "sell", items: [{ key: "sales-invoices" }], sections: [{ key: "config", items: [{ key: "price-lists" }] }] }]);
  });

  it("answers a company-wide read and a write to shared configuration on the device, and lets the rest travel", () => {
    expect(branchRefusalBefore("/projects?status=open", "GET")?.error).toBe("COMPANY_WIDE_REPORT");
    expect(branchRefusalBefore("/price-lists", "POST")?.error).toBe("COMPANY_WIDE_REPORT");
    expect(branchRefusalBefore("/a-family-nobody-declared", "GET")?.error).toBe("BRANCH_POLICY_UNDECLARED");
    expect(branchRefusalBefore("/price-lists", "GET")).toBeNull();
    expect(branchRefusalBefore("/price-lists/resolve-price", "POST")).toBeNull();
    expect(branchRefusalBefore("/sales-invoices", "POST")).toBeNull();
    expect(branchRefusalBefore("/lan/sessions", "POST")).toBeNull();
    expect(branchRefusalBefore("/lan/sessions", "GET")?.error).toBe("COMPANY_WIDE_REPORT");
  });

  it("reads the refused master-data fields from the same table", () => {
    expect(restrictedFieldsOf("/customers")).toEqual(expect.arrayContaining(["creditLimit", "priceListId", "paymentTermsDays", "taxExempt", "active"]));
    expect(restrictedFieldsOf("/items")).toEqual(expect.arrayContaining(["costPrice", "revenueAccountId"]));
    expect(restrictedFieldsOf("/sales-invoices")).toEqual([]);
  });
});
