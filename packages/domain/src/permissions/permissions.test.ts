import { describe, it, expect } from "vitest";
import {
  PERMISSIONS,
  MODULES,
  getPermission,
  isSensitive,
  isPlatformAdminOnly,
  assertCatalogIntegrity,
  resolvePermissions,
  dependenciesOf,
  createAuthContext,
  can,
  visibilityTier,
  isTenantAdmin,
  ALL_SCOPE,
} from "./index.js";

describe("permission catalog", () => {
  it("carries only what the product enforces — 281 permissions across 20 modules (DEC-14, DEC-23)", () => {
    // 298 → 231. DEC-14 removed the 67 codes that named nothing the server
    // checks: the `dashboard` and `transactions` modules, per-voucher-type
    // `.view` tiers over a single voucher list, print rights that are
    // renderer-side, and the approvals DEC-2 made ROLE-based so a permission
    // code could never honour them. The POS module went with them, all
    // thirty-eight codes — thirty-seven named a till the build did not have,
    // and the thirty-eighth guarded the discount ceiling on a SALES invoice,
    // so it moved to `sales.discount.approve`.
    //
    // 231 → 247 since. DEC-23 un-deferred POS and the module came back with
    // the four codes its routes gate on (`packages/domain/src/pos/permissions/master.ts`,
    // `packages/api/src/pos/*-routes.ts`) — including a till-side
    // `pos.discount.approve` that is NOT the invoice ceiling beside it. The
    // other twelve are the HR self-service set (`hr.self.*`, five), the
    // cockpit and cash-forecast reads (`packages/domain/src/enh/permissions/`),
    // and the rest of the ENH lanes' own gates.
    //
    // 247 → 248. D348 added `admin.users.erase_personal`, gated on
    // `POST /users/:id/erase` (`packages/api/src/users-routes.ts`) — the
    // personal-data erasure the store listings promise a path for.
    //
    // 248 → 249. D111 added `accounting.reports.view_unattributed`, checked by
    // every GL read (`packages/api/src/branch-view.ts`): a branch-granted
    // session sees the lines that carry no branch only when it holds it.
    //
    // 249 → 250, 19 → 20 modules. D111 brought `dashboard.view` back as the
    // one code of a `dashboard` module, now that `GET /dashboard/summary`
    // (`packages/backend/src/dashboard-routes.ts`) and the home entry of the
    // rail both check it.
    // 248 → 250. D79 added `sales.invoice.classify_tax` and
    // `purchases.invoice.classify_tax`, gated on
    // `POST /sales-invoices/:id/lines/:lineId/classify-tax` and its purchase
    // twin — naming the tax rate of a posted line that stored none.
    // 268 → 269. `POST /vouchers/:id/reverse` joined the reversal registry with
    // `treasury.cash_voucher.reverse`; it rode on the three voucher `.void` codes.
    //
    // 269 → 274. ENH-E2-09 AR collections: `sales.collections.{view,edit,run,send,manage}`,
    // gated by `/collections`; `send` and `manage` reach customers or the dunning policy and are sensitive.
    //
    // 274 → 276. ENH-E2-08 price floor: `sales.pricing_guard.{view,manage}` (manage is sensitive).
    //
    // 276 → 277. Lane 4D added `hr.payroll.bank_file` (sensitive), gated on
    // `POST /hr/payroll/runs/:id/bank-file` (`packages/api/src/hr-payroll-routes.ts`) —
    // exporting the salary transfer file for a run.
    //
    // 277 → 281. ENH-E2-03 count mode: inventory.count.scan, .assign, .review and .approve (sensitive).
    //
    // 281 → 284. ENH-E3-08 evidence pack: audit.sequence_gaps.view (`GET /audit/sequence-gaps`),
    // audit.evidence_pack.view (pack register and public key) and audit.evidence_pack.build
    // (sensitive, `POST /audit/evidence-packs`).
    //
    // Pinned deliberately. A code added without a route to check it, or a route
    // deleted while its code stays, moves one of these numbers — which is the
    // whole point of asserting them.
    expect(PERMISSIONS).toHaveLength(284);
    expect(MODULES).toHaveLength(20);
    const summed = MODULES.reduce((n, m) => n + m.count, 0);
    expect(summed).toBe(284);
  });

  it("carries a `pos` module again, and the INVOICE discount ceiling still lives under sales", () => {
    // DEC-14 deleted the module because nothing checked it; DEC-23 brought it
    // back with routes that do. Every code it carries is gated
    // (`packages/api/src/pos/terminals-routes.ts`, `settings-routes.ts`,
    // `payment-methods-routes.ts`), and the module is in MODULE_CATALOG, so an
    // administrator can grant them without the `*` wildcard.
    expect(PERMISSIONS.filter((p) => p.module === "pos").map((p) => p.code)).toEqual([
      "pos.terminal.view",
      "pos.terminal.manage",
      "pos.settings.edit",
      "pos.discount.approve",
    ]);
    // Two ceilings, two codes: the till's and the sales invoice's. Collapsing
    // them would let a POS supervisor discount an invoice they never see.
    expect(getPermission("sales.discount.approve")?.module).toBe("sales");
    expect(getPermission("pos.discount.approve")?.module).toBe("pos");
  });

  it("has no module left whose permissions are all gone", () => {
    for (const mod of MODULES) {
      expect(PERMISSIONS.some((p) => p.module === mod.id), `${mod.id} has no permissions`).toBe(true);
    }
  });

  it("passes integrity checks (unique codes, resolvable deps, module counts)", () => {
    expect(() => assertCatalogIntegrity()).not.toThrow();
  });

  it("flags the documented sensitive permissions", () => {
    expect(isSensitive("sales.invoice.view_cost")).toBe(true);
    expect(isSensitive("hr.employee.view_salary")).toBe(true);
    expect(isSensitive("sales.invoice.view")).toBe(false);
    expect(isSensitive("contracting.certificate.approve")).toBe(true);
    expect(isSensitive("contracting.retention.release")).toBe(true);
    expect(isSensitive("contracting.guarantee.release")).toBe(true);
    expect(isSensitive("contracting.guarantee.manage")).toBe(false);
    // Five under DEC-14 (`hr.employee.view_personal` and `pos.delivery.cancel`
    // went with it — no route filtered personal fields, and the POS delivery
    // screen did not exist). Eight now: the till discount ceiling came back
    // with the POS module, and the cockpit and cash-forecast reads are both
    // flagged because each shows the whole company's money to whoever holds it.
    expect(isSensitive("pos.discount.approve")).toBe(true);
    expect(isSensitive("accounting.cockpit.view")).toBe(true);
    expect(isSensitive("treasury.cash_forecast.view")).toBe(true);
    expect(isSensitive("accounting.reports.view_unattributed")).toBe(true);
    expect(isSensitive("accounting.period.override_close")).toBe(true);
    expect(isSensitive("accounting.period.close")).toBe(false);
    expect(PERMISSIONS.filter((p) => p.code.endsWith(".reverse")).every((p) => p.sensitive)).toBe(true);
    expect(isSensitive("purchases.landed_cost.void")).toBe(false);
    // 26 → 27: the salary bank file carries every bank-paid employee's IBAN and net pay.
    expect(isSensitive("hr.payroll.bank_file")).toBe(true);
    // 31 → 32: the evidence pack carries the whole ledger, the audit trail and every user's grant.
    expect(isSensitive("audit.evidence_pack.build")).toBe(true);
    const sensitiveCount = PERMISSIONS.filter((p) => p.sensitive).length;
    expect(sensitiveCount).toBe(32);
  });

  it("marks the one platform-admin-only permission", () => {
    expect(isPlatformAdminOnly("admin.tenant.settings.edit")).toBe(true);
    expect(isPlatformAdminOnly("admin.roles.manage")).toBe(false);
    // `admin.modules.manage` was the second, and it managed nothing:
    // entitlements arrive in a signed licence file and there is no screen.
    expect(PERMISSIONS.filter((p) => p.platformAdminOnly)).toHaveLength(1);
  });

  it("derives module ownership from the code", () => {
    expect(getPermission("sales.discount.approve")?.module).toBe("sales");
    expect(getPermission("admin.tenant.settings.edit")?.module).toBe("admin");
    expect(getPermission("cheques.bounce")?.module).toBe("cheques");
  });
});

describe("dependency resolution", () => {
  it("creating a sales invoice, a quote or a purchase invoice implies reading the tax rates its lines pick from (D79)", () => {
    for (const create of ["sales.invoice.create", "sales.quote.create", "purchases.invoice.create"]) {
      const resolved = resolvePermissions([create]);
      expect(resolved.has("accounting.tax.view")).toBe(true);
      expect(resolved.has("accounting.tax.manage")).toBe(false);
    }
  });

  it("granting .confirm implies .view_own (single hop)", () => {
    const resolved = resolvePermissions(["sales.invoice.confirm"]);
    expect(resolved.has("sales.invoice.confirm")).toBe(true);
    expect(resolved.has("sales.invoice.view_own")).toBe(true);
  });

  it("resolves transitive chains (pay -> approve -> view)", () => {
    const resolved = resolvePermissions(["hr.payroll.pay"]);
    expect(resolved.has("hr.payroll.pay")).toBe(true);
    expect(resolved.has("hr.payroll.approve")).toBe(true);
    expect(resolved.has("hr.payroll.view")).toBe(true);
  });

  it("resolves multiple dependencies of one permission", () => {
    // There is one voucher list and therefore one `.view`, so the per-type
    // action depends on the generic one rather than on a `.view` of its own.
    const resolved = resolvePermissions(["treasury.transfer.create"]);
    expect(resolved.has("treasury.cash_voucher.view")).toBe(true);
    expect(resolved.has("treasury.account.view")).toBe(true);
  });

  it("follows cross-module dependencies", () => {
    const resolved = resolvePermissions(["crm.lead.convert"]);
    expect(resolved.has("crm.lead.view")).toBe(true);
    expect(resolved.has("crm.opportunity.create")).toBe(true);
    expect(resolved.has("crm.opportunity.view")).toBe(true);
  });

  it("preserves the wildcard and unknown codes without expansion", () => {
    const resolved = resolvePermissions(["*", "some.future.permission"]);
    expect(resolved.has("*")).toBe(true);
    expect(resolved.has("some.future.permission")).toBe(true);
  });

  it("dependenciesOf excludes the permission itself", () => {
    const deps = dependenciesOf("sales.invoice.create");
    expect(deps.has("sales.invoice.create")).toBe(false);
    expect(deps.has("sales.invoice.view_own")).toBe(true);
  });
});

describe("AuthContext.can — scoping", () => {
  it("allows a held permission within scope, denies outside scope", () => {
    const ctx = createAuthContext({
      userId: "u1",
      permissions: ["sales.invoice.create"],
      branchScope: ["branch-A"],
      warehouseScope: ["wh-1"],
    });
    // create resolves view_own, so both are held
    expect(can(ctx, "sales.invoice.view_own")).toBe(true);
    expect(can(ctx, "sales.invoice.create", { branch: "branch-A" })).toBe(true);
    expect(can(ctx, "sales.invoice.create", { branch: "branch-B" })).toBe(false);
    expect(
      can(ctx, "sales.invoice.create", { branch: "branch-A", warehouse: "wh-1" }),
    ).toBe(true);
    expect(
      can(ctx, "sales.invoice.create", { branch: "branch-A", warehouse: "wh-9" }),
    ).toBe(false);
  });

  it("denies a permission that is not held even inside scope", () => {
    const ctx = createAuthContext({
      userId: "u2",
      permissions: ["sales.invoice.view"],
      branchScope: ALL_SCOPE,
      warehouseScope: ALL_SCOPE,
    });
    expect(can(ctx, "sales.invoice.void")).toBe(false);
  });

  it("ALL_SCOPE permits any branch/warehouse", () => {
    const ctx = createAuthContext({
      userId: "u3",
      permissions: ["inventory.transfer.confirm"],
      branchScope: ALL_SCOPE,
      warehouseScope: ALL_SCOPE,
    });
    expect(
      can(ctx, "inventory.transfer.confirm", {
        branch: "anything",
        warehouse: "anywhere",
      }),
    ).toBe(true);
  });

  it("tenant admin (*) holds every permission, and is still held to the branches and warehouses it was granted (D111)", () => {
    const ctx = createAuthContext({
      userId: "admin",
      permissions: ["*"],
      branchScope: ["BR-ALEX"],
      warehouseScope: ALL_SCOPE,
    });
    expect(isTenantAdmin(ctx)).toBe(true);
    expect(can(ctx, "admin.tenant.settings.edit", { branch: "BR-ALEX", warehouse: "y" })).toBe(true);
    expect(can(ctx, "admin.tenant.settings.edit", { branch: "BR-MAIN" })).toBe(false);
    const narrowed = createAuthContext({ userId: "admin", permissions: ["*"], branchScope: ["BR-ALEX"], branchGrant: ALL_SCOPE, warehouseScope: ALL_SCOPE });
    expect(can(narrowed, "admin.tenant.settings.edit", { branch: "BR-MAIN" })).toBe(true);
    expect(can(ctx, "any.unknown.permission")).toBe(true);
  });
});

describe("three-tier visibility", () => {
  it("returns the highest tier held", () => {
    const own = createAuthContext({
      userId: "a",
      permissions: ["sales.invoice.view_own"],
      branchScope: ALL_SCOPE,
      warehouseScope: ALL_SCOPE,
    });
    const inScope = createAuthContext({
      userId: "b",
      permissions: ["sales.invoice.view"],
      branchScope: ALL_SCOPE,
      warehouseScope: ALL_SCOPE,
    });
    const all = createAuthContext({
      userId: "c",
      permissions: ["sales.invoice.view_all"],
      branchScope: ALL_SCOPE,
      warehouseScope: ALL_SCOPE,
    });
    const none = createAuthContext({
      userId: "d",
      permissions: [],
      branchScope: ALL_SCOPE,
      warehouseScope: ALL_SCOPE,
    });
    expect(visibilityTier(own, "sales.invoice")).toBe("own");
    expect(visibilityTier(inScope, "sales.invoice")).toBe("in_scope");
    // view_all resolves view too, so highest tier wins
    expect(visibilityTier(all, "sales.invoice")).toBe("all");
    expect(visibilityTier(none, "sales.invoice")).toBe("none");
  });

  it("admin always sees all", () => {
    const ctx = createAuthContext({
      userId: "admin",
      permissions: ["*"],
      branchScope: ALL_SCOPE,
      warehouseScope: ALL_SCOPE,
    });
    expect(visibilityTier(ctx, "hr.employee")).toBe("all");
  });
});

describe("raising a return implies reading the invoice it is raised against", () => {
  it("a returns-only grant reads its own source invoices, sales and purchases alike, and nobody else's", () => {
    expect([...resolvePermissions(["sales.return.create"])]).toEqual(expect.arrayContaining(["sales.return.view_own", "sales.invoice.view_own"]));
    expect([...resolvePermissions(["purchases.return.create"])]).toEqual(expect.arrayContaining(["purchases.return.view", "purchases.invoice.view_own"]));
    expect(resolvePermissions(["sales.return.create"]).has("sales.invoice.view")).toBe(false);
    expect(resolvePermissions(["purchases.return.create"]).has("purchases.invoice.view")).toBe(false);
  });
});

