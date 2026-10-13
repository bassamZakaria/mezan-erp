import { afterEach, describe, expect, it } from "vitest";
import { ALL_SCOPE } from "@mezan/domain";
import { createBackend, type BackendHandle } from "./create-backend.js";

const handles: BackendHandle[] = [];
afterEach(() => {
  for (const h of handles.splice(0)) h.close();
});

const REP_PERMISSIONS = ["sales.invoice.create", "sales.invoice.view_own", "sales.invoice.confirm"];

async function rig() {
  const h = await createBackend({ dbPath: ":memory:" });
  handles.push(h);
  const as = (userId: string, permissions: string[]) => ({
    authorization: `Bearer ${h.sessions.issue({ userId, permissions, roleCode: null, branchScope: ALL_SCOPE, warehouseScope: ALL_SCOPE })}`,
    "content-type": "application/json",
  });
  const send = (method: string, pathname: string, headers: Record<string, string>, body?: unknown) =>
    h.app.fetch(new Request(`http://local${pathname}`, { method, headers, body: body === undefined ? undefined : JSON.stringify(body) }));
  const admin = as("admin", ["*"]);
  await send("POST", "/customers", admin, {
    id: "CUST-1", code: "CUST-1", nameAr: "عميل نقدي", paymentTermsDays: 30, currency: "EGP", openingBalance: "0", active: true, creditLimit: "0", taxExempt: false, etaBuyerType: "auto",
  });
  await send("POST", "/items", admin, { id: "SVC-1", code: "SVC-1", nameAr: "خدمة", type: "service", baseUnitCode: "PCS" });
  return { h, as, send, admin };
}

const invoice = (id: string) => ({
  id, date: "2026-08-22", dueDate: "2026-09-21", customerId: "CUST-1", customerNameAr: "عميل نقدي", warehouseId: "WH-MAIN", branchId: "BR-MAIN",
  arAccountId: "1105", taxAccountId: "2200",
  lines: [{ lineId: "L1", itemId: "SVC-1", itemNameAr: "خدمة", isStock: false, qty: "1", unitPrice: "100", taxRatePercent: 0, revenueAccountId: "4100" }],
});

describe("a sales rep who may create an invoice but only read their own", () => {
  it("is answered with the invoice they created when the create is sent again, not told it does not exist", async () => {
    const { send, as, admin } = await rig();
    const rep = as("rep-without-employee", REP_PERMISSIONS);

    const first = await send("POST", "/sales-invoices", rep, invoice("m-rep-1"));
    expect(first.status).toBe(201);
    const resent = await send("POST", "/sales-invoices", rep, invoice("m-rep-1"));

    expect(resent.status).toBe(201);
    expect(resent.headers.get("idempotent-replay")).toBe("true");
    expect(((await resent.json()) as { id: string }).id).toBe("m-rep-1");
    expect((await send("GET", "/sales-invoices/m-rep-1", admin)).status).toBe(200);
    expect((await send("GET", "/sales-invoices/m-rep-1", rep)).status).toBe(404);
  });

  it("is recorded as the salesperson of an invoice they create without naming one, so they can open it afterwards", async () => {
    const { h, send, as, admin } = await rig();
    const created = await send("POST", "/hr/employees", admin, { firstName: "Sales", lastName: "Rep", branchId: "BR-MAIN", hireDate: "2026-01-01" });
    const employeeId = created.ok ? ((await created.json()) as { id: string }).id : null;
    expect(employeeId, `employee create answered ${created.status}`).not.toBeNull();
    const user = await send("POST", "/users", admin, {
      nameAr: "مندوب المبيعات", email: "rep@shop.test", roleId: null, isCompanyAdmin: true, employeeId,
      branchScope: "*", warehouseScope: "*", password: "rep-password-1", pin: "246813", acknowledge: true, reason: "test fixture",
    });
    expect(user.status).toBe(201);
    const userId = ((await user.json()) as { id: string }).id;
    const rep = {
      authorization: `Bearer ${h.sessions.issue({ userId, permissions: REP_PERMISSIONS, roleCode: null, branchScope: ALL_SCOPE, warehouseScope: ALL_SCOPE })}`,
      "content-type": "application/json",
    };

    expect((await send("POST", "/sales-invoices", rep, invoice("m-rep-2"))).status).toBe(201);

    const own = await send("GET", "/sales-invoices/m-rep-2", rep);
    expect(own.status).toBe(200);
    expect(((await own.json()) as { salespersonId: string | null }).salespersonId).toBe(employeeId);
  });

  it("keeps the salesperson an office user names, and names none for a caller who sees every invoice", async () => {
    const { send, admin } = await rig();
    expect((await send("POST", "/sales-invoices", admin, invoice("m-admin-1"))).status).toBe(201);
    const read = (await (await send("GET", "/sales-invoices/m-admin-1", admin)).json()) as { salespersonId: string | null };
    expect(read.salespersonId).toBeNull();
  });
});
