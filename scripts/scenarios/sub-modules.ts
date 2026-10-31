import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createBackend } from "../../packages/backend/src/create-backend.js";
import { ALL_SCOPE, createEntitlements } from "../../packages/domain/src/index.js";
import type { Ctx } from "./harness.js";

/**
 * Licensable sub-modules (docs/superpowers/specs/2026-10-31-licensable-sub-modules-design.md),
 * end to end through the real routes on a seeded backend of its own: the HR
 * staff list is free on every plan so other modules can map people, and each
 * paid HR part answers only where the plan sells it.
 */

async function tenantOn(activeModules: string[], readOnlyModules?: string[]) {
  const dbPath = join(mkdtempSync(join(tmpdir(), "mezan-sub-")), "s.db");
  const backend = await createBackend({
    dbPath,
    // The demo seed writes into every module; this tenant holds only some, so it seeds its own rows.
    resolveEntitlements: () =>
      createEntitlements({ plan: "SCN", activeModules, ...(readOnlyModules ? { readOnlyModules } : {}), features: {}, seats: 50, expiresAt: null }),
  });
  const token = await backend.sessions.issue({ userId: "USER-ADMIN", permissions: ["*"], roleCode: "*", branchScope: ALL_SCOPE, warehouseScope: ALL_SCOPE });
  const api = async (method: string, path: string, body?: unknown) => {
    const res = await backend.app.fetch(
      new Request(`http://local${path}`, {
        method,
        headers: { authorization: `Bearer ${token}`, "content-type": "application/json", "x-branch-scope": "*", "x-warehouse-scope": "*" },
        body: body === undefined ? undefined : JSON.stringify(body),
      }),
    );
    const text = await res.text();
    return { status: res.status, body: text ? JSON.parse(text) : null };
  };
  return { api, close: () => backend.close() };
}

export async function run(ctx: Ctx): Promise<void> {
  const { check } = ctx;

  // 1 · A plan with no HR at all keeps the staff list and maps a salesperson.
  const shop = await tenantOn(["sales", "inventory", "accounting", "treasury"]);
  try {
    const hired = await shop.api("POST", "/hr/employees", { firstName: "مندوب", lastName: "المبيعات", branchId: "BR-MAIN", hireDate: "2026-01-01" });
    check("sub-modules · a plan without HR still hires onto the staff list", hired.status === 201, `status ${hired.status} ${JSON.stringify(hired.body).slice(0, 160)}`);
    const employeeId = String(hired.body?.id ?? "");
    const staff = await shop.api("GET", "/hr/employees");
    check("sub-modules · and lists it back", ctx.rows(staff.body).some((e: { id: string }) => e.id === employeeId), `status ${staff.status}`);

    await shop.api("POST", "/customers", { id: "SUB-CUST", code: "SUB-CUST", nameAr: "عميل", paymentTermsDays: 30, currency: "EGP", openingBalance: "0", active: true, creditLimit: "0", taxExempt: false, etaBuyerType: "auto" });
    await shop.api("POST", "/items", { id: "SUB-SVC", code: "SUB-SVC", nameAr: "خدمة", type: "service", baseUnitCode: "PCS" });
    const invoice = await shop.api("POST", "/sales-invoices", {
      id: "SUB-INV-1", date: "2026-10-20", dueDate: "2026-11-19", customerId: "SUB-CUST", customerNameAr: "عميل",
      warehouseId: "WH-MAIN", branchId: "BR-MAIN", arAccountId: "1105", taxAccountId: "2200", salespersonId: employeeId,
      lines: [{ lineId: "L1", itemId: "SUB-SVC", itemNameAr: "خدمة", isStock: false, qty: "1", unitPrice: "100", taxRatePercent: 0, revenueAccountId: "4100" }],
    });
    check("sub-modules · a sales invoice takes that employee as its salesperson", invoice.status === 201, `status ${invoice.status} ${JSON.stringify(invoice.body).slice(0, 200)}`);
    const stored = await shop.api("GET", "/sales-invoices/SUB-INV-1");
    check("sub-modules · and stores the employee's real id, not a typed name", stored.body?.salespersonId === employeeId, String(stored.body?.salespersonId));

    for (const [path, part] of [["/hr/payroll/runs", "hr.payroll"], ["/hr/contracts", "hr.contracts"], ["/hr/attendance", "hr.time"]] as const) {
      const refused = await shop.api("GET", path);
      check(`sub-modules · ${path} is refused by its part (${part})`, refused.status === 403 && refused.body?.module === part, `status ${refused.status} ${JSON.stringify(refused.body).slice(0, 160)}`);
      check(`sub-modules · and says so in Arabic (${part})`, typeof refused.body?.message === "string" && /الموارد البشرية/.test(refused.body.message), String(refused.body?.message));
    }
    const salary = await shop.api("PUT", `/hr/employees/${employeeId}/salary-payment`, { salaryPaymentMethod: "cash" });
    check("sub-modules · salary bank details are payroll's, not the staff list's", salary.status === 403, `status ${salary.status}`);
  } finally {
    shop.close();
  }

  // 2 · One part sold on its own answers; its siblings do not.
  const timeOnly = await tenantOn(["sales", "hr.time"]);
  try {
    check("sub-modules · hr.time alone serves attendance", (await timeOnly.api("GET", "/hr/attendance")).status === 200);
    check("sub-modules · and leave requests", (await timeOnly.api("GET", "/hr/leave-requests")).status === 200);
    check("sub-modules · but not payroll", (await timeOnly.api("GET", "/hr/payroll/runs")).status === 403);
  } finally {
    timeOnly.close();
  }

  // 3 · A tenant that dropped HR: the staff list stays writable, payroll stays readable only.
  const dropped = await tenantOn(["sales"], ["hr"]);
  try {
    check("sub-modules · after dropping HR the staff list still takes a hire", (await dropped.api("POST", "/hr/employees", { firstName: "A", lastName: "B", branchId: "BR-MAIN", hireDate: "2026-02-01" })).status === 201);
    check("sub-modules · payroll still reads", (await dropped.api("GET", "/hr/payroll/runs")).status === 200);
    const write = await dropped.api("POST", "/hr/holidays", { date: "2026-10-06", nameEn: "Armed Forces Day" });
    check("sub-modules · a paid part's write is refused read-only", write.status === 403 && write.body?.error === "MODULE_READ_ONLY", `status ${write.status} ${JSON.stringify(write.body).slice(0, 160)}`);
  } finally {
    dropped.close();
  }
}
