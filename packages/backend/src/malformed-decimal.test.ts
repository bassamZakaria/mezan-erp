import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { ALL_SCOPE, Money } from "@mezan/domain";
import { createBackend, type BackendHandle } from "./create-backend.js";

const ARABIC = /[؀-ۿ]/;
const MALFORMED = ["1e3", "abc", "1,000.50", " 12 ", "0x10", "NaN", "1.0000001", "١٢٣"];

let handle: BackendHandle;
let admin: (method: string, path: string, body?: unknown) => Promise<{ status: number; body: any }>;

beforeAll(async () => {
  handle = await createBackend({ dbPath: ":memory:" });
  const token = await handle.sessions.issue({ userId: "USER-DEC", permissions: ["*"], roleCode: null, branchScope: ALL_SCOPE, warehouseScope: ALL_SCOPE });
  admin = async (method, path, body) => {
    const res = await handle.app.fetch(
      new Request(`http://local${path}`, { method, headers: { "content-type": "application/json", authorization: `Bearer ${token}` }, body: body === undefined ? undefined : JSON.stringify(body) }),
    );
    const text = await res.text();
    return { status: res.status, body: text ? JSON.parse(text) : null };
  };
  expect((await admin("POST", "/customers", { id: "CUST-DEC", code: "CUST-DEC", nameAr: "عميل", type: "company" })).status).toBe(201);
  expect((await admin("POST", "/treasury-accounts", { id: "TR-DEC", code: "TR-DEC", name: "صندوق", type: "cash", currency: "EGP", branchId: "BR-MAIN", glAccountId: "1300-1", openingBalance: "0" })).status).toBe(201);
  expect((await admin("POST", "/items", { id: "ITEM-DEC", code: "ITEM-DEC", nameAr: "خدمة", type: "service", baseUnitCode: "PCS", salePrice: "10" })).status).toBe(201);
});

afterAll(() => handle.close());

const line = (field: string, value: string) => ({ lineId: "L1", itemId: "ITEM-DEC", itemNameAr: "خدمة", isStock: false, qty: "1", unitPrice: "100", taxRatePercent: 0, revenueAccountId: "4100", [field]: value });
const salesDocument = (id: string, field: string, value: string) => ({
  id,
  date: "2026-08-22",
  dueDate: "2026-09-21",
  expiryDate: "2026-09-21",
  customerId: "CUST-DEC",
  customerNameAr: "عميل",
  warehouseId: "WH-MAIN",
  branchId: "BR-MAIN",
  arAccountId: "1105",
  taxAccountId: "2200",
  lines: [line(field, value)],
});

const ROUTES: readonly (readonly [label: string, path: string, body: (value: string, n: number) => unknown])[] = [
  ["a sales invoice line quantity", "/sales-invoices", (value, n) => salesDocument(`DEC-INV-Q-${n}`, "qty", value)],
  ["a sales invoice line price", "/sales-invoices", (value, n) => salesDocument(`DEC-INV-P-${n}`, "unitPrice", value)],
  ["a sales quote line quantity", "/sales-quotes", (value, n) => salesDocument(`DEC-Q-${n}`, "qty", value)],
  ["an exchange rate", "/exchange-rates", (value, n) => ({ id: `DEC-FX-${n}`, currency: "USD", rate: value, effectiveDate: "2026-08-22" })],
  ["a promotion's fixed amount", "/promotions", (value, n) => ({ id: `DEC-PR-${n}`, code: `DEC-PR-${n}`, nameAr: "عرض", type: "fixed_amount", amountValue: value, startDate: "2026-08-01", endDate: "2026-08-31" })],
  ["a promotion's minimum invoice value", "/promotions", (value, n) => ({ id: `DEC-PM-${n}`, code: `DEC-PM-${n}`, nameAr: "عرض", type: "percentage", percentValue: 5, minInvoiceValue: value, startDate: "2026-08-01", endDate: "2026-08-31" })],
  ["a voucher amount", "/vouchers", (value, n) => ({ id: `DEC-V-${n}`, date: "2026-08-22", memo: "سند", voucherType: "other_income", amount: value, branchId: "BR-MAIN", paymentMethod: "cash", treasuryAccountId: "TR-DEC", treasuryGlAccountId: "1300-1", counterpartyGlAccountId: "4100" })],
];

describe("a malformed amount, quantity, price or rate is the caller's mistake: 400, in Arabic, and nothing is stored", () => {
  it.each(ROUTES)("%s", async (_label, path, body) => {
    for (const [n, value] of MALFORMED.entries()) {
      const before = JSON.stringify((await admin("GET", path)).body).length;
      const res = await admin("POST", path, body(value, n));
      expect(res.status, `${JSON.stringify(value)} → ${JSON.stringify(res.body).slice(0, 200)}`).toBe(400);
      expect(res.body.message, JSON.stringify(value)).toMatch(ARABIC);
      expect(JSON.stringify((await admin("GET", path)).body).length, JSON.stringify(value)).toBe(before);
    }
  });

  it("each body is refused for its decimal alone: the same body with a well-formed literal is accepted", async () => {
    for (const [label, path, body] of ROUTES) {
      const res = await admin("POST", path, body("7.50", 900));
      expect(res.status, `${label}: ${JSON.stringify(res.body).slice(0, 300)}`).toBe(201);
    }
  });

  it("a well-formed literal still passes the same schemas", async () => {
    expect((await admin("POST", "/sales-invoices", salesDocument("DEC-INV-OK", "qty", "2.500000"))).status).toBe(201);
    expect((await admin("POST", "/exchange-rates", { id: "DEC-FX-OK", currency: "USD", rate: "48.25", effectiveDate: "2026-08-22" })).status).toBe(201);
  });
});

describe("a literal that reaches the engine outside a contract schema", () => {
  it("is answered 400 in Arabic by the application, not 500", async () => {
    const fresh = await createBackend({ dbPath: ":memory:" });
    fresh.app.post("/__probe/decimal", () => {
      Money.fromMajor("1e3");
      return new Response(null, { status: 204 });
    });
    const token = await fresh.sessions.issue({ userId: "USER-DEC", permissions: ["*"], roleCode: null, branchScope: ALL_SCOPE, warehouseScope: ALL_SCOPE });
    const response = await fresh.app.fetch(new Request("http://local/__probe/decimal", { method: "POST", headers: { authorization: `Bearer ${token}` }, body: "{}" }));
    const res = { status: response.status, body: (await response.json()) as { error: string; message: string } };
    fresh.close();
    expect(res.status).toBe(400);
    expect(res.body.error).toBe("INVALID_DECIMAL");
    expect(res.body.message).toMatch(ARABIC);
  });
});
