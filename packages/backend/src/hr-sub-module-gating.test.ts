import { afterEach, describe, expect, it } from "vitest";
import { ALL_SCOPE, createEntitlements } from "@mezan/domain";
import { createBackend, type BackendHandle } from "./create-backend.js";

// Sub-modules (docs/superpowers/specs/2026-10-31-licensable-sub-modules-design.md):
// the staff list is free in every plan, every other HR part needs its own grant.

const handles: BackendHandle[] = [];
afterEach(() => {
  for (const h of handles.splice(0)) h.close();
});

async function rig(activeModules: string[], readOnlyModules?: string[]) {
  const h = await createBackend({
    dbPath: ":memory:",
    resolveEntitlements: () =>
      createEntitlements({ plan: "TEST", activeModules, ...(readOnlyModules ? { readOnlyModules } : {}), features: {}, seats: 50, expiresAt: null }),
  });
  handles.push(h);
  const bearer = async (permissions: string[]) => ({
    authorization: `Bearer ${await h.sessions.issue({ userId: "U", permissions, roleCode: null, branchScope: ALL_SCOPE, warehouseScope: ALL_SCOPE })}`,
    "content-type": "application/json",
    "x-branch-scope": "*",
    "x-warehouse-scope": "*",
  });
  const admin = await bearer(["*"]);
  const send = async (method: string, path: string, body?: unknown, headers = admin) => {
    const res = await h.app.fetch(new Request(`http://local${path}`, { method, headers, body: body === undefined ? undefined : JSON.stringify(body) }));
    const text = await res.text();
    return { status: res.status, body: text ? JSON.parse(text) : null };
  };
  const hire = async () => {
    const r = await send("POST", "/hr/employees", { firstName: "Sales", lastName: "Rep", branchId: "BR-MAIN", hireDate: "2026-01-01" });
    expect(r.status, JSON.stringify(r.body)).toBe(201);
    return r.body.id as string;
  };
  return { send, bearer, hire };
}

const NOT_LICENSED = "MODULE_NOT_LICENSED";

describe("a plan without HR keeps the staff list", () => {
  it("lists and creates employees", async () => {
    const { send, hire } = await rig(["sales", "inventory", "accounting"]);
    await hire();
    const list = await send("GET", "/hr/employees");
    expect(list.status).toBe(200);
    expect(list.body.length ?? list.body.items?.length).toBeGreaterThan(0);
    expect((await send("GET", "/hr/departments")).status).toBe(200);
    expect((await send("GET", "/hr/job-titles")).status).toBe(200);
  });

  it("stores the real employee id as an invoice's salesperson", async () => {
    const { send, hire } = await rig(["sales", "inventory", "accounting"]);
    const employeeId = await hire();
    await send("POST", "/customers", { id: "CUST-1", code: "CUST-1", nameAr: "عميل", paymentTermsDays: 30, currency: "EGP", openingBalance: "0", active: true, creditLimit: "0", taxExempt: false, etaBuyerType: "auto" });
    await send("POST", "/items", { id: "SVC-1", code: "SVC-1", nameAr: "خدمة", type: "service", baseUnitCode: "PCS" });
    const created = await send("POST", "/sales-invoices", {
      id: "INV-REP", date: "2026-08-22", dueDate: "2026-09-21", customerId: "CUST-1", customerNameAr: "عميل", warehouseId: "WH-MAIN", branchId: "BR-MAIN",
      arAccountId: "1105", taxAccountId: "2200", salespersonId: employeeId,
      lines: [{ lineId: "L1", itemId: "SVC-1", itemNameAr: "خدمة", isStock: false, qty: "1", unitPrice: "100", taxRatePercent: 0, revenueAccountId: "4100" }],
    });
    expect(created.status, JSON.stringify(created.body)).toBe(201);
    expect((await send("GET", "/sales-invoices/INV-REP")).body.salespersonId).toBe(employeeId);
  });

  it("refuses the paid parts by name", async () => {
    const { send, hire } = await rig(["sales"]);
    const id = await hire();
    const payroll = await send("GET", "/hr/payroll/runs");
    expect(payroll.status).toBe(403);
    expect(payroll.body).toMatchObject({ error: NOT_LICENSED, module: "hr.payroll" });
    expect(payroll.body.message).toContain("الرواتب");
    expect((await send("GET", "/hr/contracts")).body).toMatchObject({ error: NOT_LICENSED, module: "hr.contracts" });
    expect((await send("GET", "/hr/attendance")).body).toMatchObject({ error: NOT_LICENSED, module: "hr.time" });
    expect((await send("GET", `/hr/employees/${id}/end-of-service`)).status).toBe(403);
    expect((await send("PUT", `/hr/employees/${id}/salary-payment`, { salaryPaymentMethod: "cash" })).status).toBe(403);
    expect((await send("GET", `/hr/employees/${id}/clock-credential`)).status).toBe(403);
  });

  it("refuses a stale role grant at request time", async () => {
    const { send, bearer } = await rig(["sales"]);
    const res = await send("GET", "/hr/payroll/runs", undefined, await bearer(["hr.payroll.view"]));
    expect(res.status).toBe(403);
    expect(res.body.error).toBe(NOT_LICENSED);
  });
});

describe("a plan with one HR part", () => {
  it("serves that part and refuses its siblings", async () => {
    const { send } = await rig(["sales", "hr.time"]);
    expect((await send("GET", "/hr/attendance")).status).toBe(200);
    expect((await send("GET", "/hr/leave-requests")).status).toBe(200);
    expect((await send("GET", "/hr/payroll/runs")).status).toBe(403);
  });
});

describe("a tenant that dropped HR keeps it readable", () => {
  it("writes the free staff list, reads payroll, refuses payroll writes", async () => {
    const { send, hire } = await rig(["sales"], ["hr"]);
    await hire();
    expect((await send("GET", "/hr/payroll/runs")).status).toBe(200);
    const write = await send("POST", "/hr/payroll/runs", { periodStart: "2026-01-01", periodEnd: "2026-01-31" });
    expect(write.status).toBe(403);
    expect(write.body.error).toBe("MODULE_READ_ONLY");
  });
});

describe("a plan with all of HR is unchanged", () => {
  it("serves every part", async () => {
    const { send, hire } = await rig(["sales", "hr"]);
    const id = await hire();
    for (const path of ["/hr/payroll/runs", "/hr/contracts", "/hr/attendance", `/hr/employees/${id}/end-of-service`]) {
      expect((await send("GET", path)).status, path).not.toBe(403);
    }
  });
});
