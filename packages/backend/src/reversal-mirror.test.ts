import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { bootBackendKit, type BackendKit, type Reply } from "./test-helpers/backend-kit.js";

const TODAY = "2026-08-24";
const WAREHOUSE = "WH-MAIN";
const CUSTOMER = "CUST-DEMO-1";
const SUPPLIER = "SUPP-DEMO-1";
const REASON = "أُدخل المستند على الطرف الخطأ";
const ARABIC = /[؀-ۿ]/;
const NOT_REVERSIBLE = "REVERSAL_NOT_REVERSIBLE";

let kit: BackendKit;

async function stockItem(id: string) {
  const created = await kit.call("POST", "/items", { id, code: id, nameAr: `صنف ${id}`, type: "stock", baseUnitCode: "PCS", trackInventory: true, revenueAccountId: "4100", cogsAccountId: "5100", inventoryAccountId: "1200" });
  expect(created.status, JSON.stringify(created.body)).toBe(201);
}

async function purchase(id: string, itemId: string, qty: string, unitCost: string) {
  const created = await kit.call("POST", "/purchases/invoices", {
    id, supplierId: SUPPLIER, date: TODAY, dueDate: "2026-09-23", branchId: "BR-MAIN", warehouseId: WAREHOUSE,
    lines: [{ itemId, kind: "inventory", qty, unitCost, taxRateId: "VAT14" }],
  });
  expect(created.status, JSON.stringify(created.body)).toBe(201);
  expect((await kit.call("POST", `/purchases/invoices/${id}/confirm`, {})).status).toBe(200);
}

async function sale(id: string, itemId: string, qty: string) {
  const created = await kit.call("POST", "/sales-invoices", {
    id, date: TODAY, dueDate: "2026-09-23", customerId: CUSTOMER, customerNameAr: "عميل", warehouseId: WAREHOUSE, branchId: "BR-MAIN",
    arAccountId: "1105", taxAccountId: "2200",
    lines: [{ lineId: "A", itemId, itemNameAr: "صنف", isStock: true, qty, unitPrice: "100", revenueAccountId: "4100", cogsAccountId: "5100", inventoryAccountId: "1200", taxRateId: "VAT14" }],
  });
  expect(created.status, JSON.stringify(created.body)).toBe(201);
  expect((await kit.call("POST", `/sales-invoices/${id}/confirm`, {})).status).toBe(200);
}

async function salesReturn(id: string, sourceInvoiceId: string, itemId: string, qty: string) {
  const drafted = await kit.call("POST", "/sales-returns/from-invoice", {
    id, date: TODAY, memo: "", warehouseId: WAREHOUSE, sourceInvoiceId, reason: "DEFECTIVE", requested: [{ itemId, sourceLineId: "A", qty }],
  });
  expect(drafted.status, JSON.stringify(drafted.body)).toBe(201);
  expect((await kit.call("POST", `/sales-returns/${id}/confirm`, {})).status).toBe(200);
}

async function purchaseReturn(id: string, sourceInvoiceId: string, itemId: string, qty: string) {
  const drafted = await kit.call("POST", "/purchase-returns", {
    id, date: TODAY, memo: "",
    lines: [{ itemId, warehouseId: WAREHOUSE, supplierId: SUPPLIER, sourceInvoiceId, sourceInvoiceNumber: null, sourceLineId: "0", reason: "DEFECTIVE", qty }],
  });
  expect(drafted.status, JSON.stringify(drafted.body)).toBe(201);
  expect((await kit.call("POST", `/purchase-returns/${id}/confirm`, {})).status).toBe(200);
}

const position = async (itemId: string) => {
  const balance = (await kit.call("GET", `/inventory/balance?itemId=${itemId}&warehouseId=${WAREHOUSE}`)).body;
  return [balance.onHand, balance.totalValue];
};

const journalEntries = async () => (await kit.call("GET", "/gl/journal-entries?pageSize=1")).body.total as number;

const books = async (itemId: string) => ({ invariants: await kit.invariants(), position: await position(itemId), entries: await journalEntries() });

function expectRefusedAsAReversal(reply: Reply) {
  expect([reply.status, reply.body?.error], JSON.stringify(reply.body)).toEqual([422, NOT_REVERSIBLE]);
  expect(reply.body.message).toMatch(ARABIC);
  expect(typeof reply.body.messageEn).toBe("string");
}

beforeAll(async () => {
  kit = await bootBackendKit();
}, 120_000);

afterAll(async () => {
  await kit.close();
});

describe("the document that undid another is not itself undone", () => {
  it("refuses to void the mirror of a voided sales return, and stock, the journal and every control account stay put", async () => {
    await stockItem("MIR-S");
    await purchase("MIR-S-BUY", "MIR-S", "5", "10");
    await sale("MIR-S-INV", "MIR-S", "3");
    await salesReturn("MIR-S-R", "MIR-S-INV", "MIR-S", "2");
    expect((await kit.call("POST", "/sales-returns/MIR-S-R/void", { reason: REASON })).status).toBe(200);
    const before = await books("MIR-S");
    expect(Object.values(before.invariants)).toEqual([0n, 0n, 0n, 0n]);

    expectRefusedAsAReversal(await kit.call("POST", "/sales-returns/MIR-S-R:void/void", { reason: REASON }));

    expect(await books("MIR-S")).toEqual(before);
    expect((await kit.call("GET", "/sales-returns/source-lines/MIR-S-INV")).body.lines.map((line: { returnedQty: string }) => Number(line.returnedQty))).toEqual([0]);
  });

  it("refuses to void the mirror of a voided purchase return, and the supplier's balance does not move", async () => {
    await stockItem("MIR-P");
    await purchase("MIR-P-BUY", "MIR-P", "5", "10");
    await purchaseReturn("MIR-P-R", "MIR-P-BUY", "MIR-P", "2");
    expect((await kit.call("POST", "/purchase-returns/MIR-P-R/void", { reason: REASON })).status).toBe(200);
    const before = await books("MIR-P");
    expect(Object.values(before.invariants)).toEqual([0n, 0n, 0n, 0n]);

    expectRefusedAsAReversal(await kit.call("POST", "/purchase-returns/MIR-P-R:void/void", { reason: REASON }));

    expect(await books("MIR-P")).toEqual(before);
  });

  it("refuses to reverse the reversal of a refund voucher, and the customer's balance does not move", async () => {
    await stockItem("MIR-V");
    await purchase("MIR-V-BUY", "MIR-V", "5", "10");
    await sale("MIR-V-INV", "MIR-V", "2");
    expect((await kit.call("POST", "/sales-invoices/MIR-V-INV/payments", { amount: "228", treasuryAccountId: "TR-DEMO-CASH", paymentMethod: "cash" })).status).toBeLessThan(300);
    await salesReturn("MIR-V-R", "MIR-V-INV", "MIR-V", "1");
    const refund = await kit.call("POST", "/sales-returns/MIR-V-R/refund", { amount: "10", treasuryAccountId: "TR-DEMO-CASH", paymentMethod: "cash" });
    expect(refund.status, JSON.stringify(refund.body)).toBe(200);
    const reversed = await kit.call("POST", `/vouchers/${encodeURIComponent(refund.body.voucherId)}/reverse`, { memo: "خطأ في السند" });
    expect(reversed.status, JSON.stringify(reversed.body)).toBe(201);
    const reversalId = reversed.body.reversal.id as string;
    const before = await books("MIR-V");
    expect(Object.values(before.invariants)).toEqual([0n, 0n, 0n, 0n]);

    expectRefusedAsAReversal(await kit.call("POST", `/vouchers/${encodeURIComponent(reversalId)}/reverse`, { memo: "خطأ في السند" }));

    expect(await books("MIR-V")).toEqual(before);
  });
});

describe("the mirror of a voided return answers to no state change", () => {
  const families = [
    {
      mount: "/sales-returns",
      arrange: async () => {
        await stockItem("MIR-T-S");
        await purchase("MIR-T-S-BUY", "MIR-T-S", "5", "10");
        await sale("MIR-T-S-INV", "MIR-T-S", "3");
        await salesReturn("MIR-T-S-R", "MIR-T-S-INV", "MIR-T-S", "2");
        expect((await kit.call("POST", "/sales-returns/MIR-T-S-R/void", { reason: REASON })).status).toBe(200);
        return { mirrorId: "MIR-T-S-R:void", itemId: "MIR-T-S" };
      },
    },
    {
      mount: "/purchase-returns",
      arrange: async () => {
        await stockItem("MIR-T-P");
        await purchase("MIR-T-P-BUY", "MIR-T-P", "5", "10");
        await purchaseReturn("MIR-T-P-R", "MIR-T-P-BUY", "MIR-T-P", "2");
        expect((await kit.call("POST", "/purchase-returns/MIR-T-P-R/void", { reason: REASON })).status).toBe(200);
        return { mirrorId: "MIR-T-P-R:void", itemId: "MIR-T-P" };
      },
    },
  ];
  const bodyOf = (path: string): unknown => (path.endsWith("/refund") ? { amount: "1", treasuryAccountId: "TR-DEMO-CASH", paymentMethod: "cash" } : path.endsWith("/journal-tax") ? { taxRateId: "VAT14" } : {});

  for (const family of families) {
    it(`${family.mount}: every state-changing route under the mirror's id says it does not exist, and nothing moves`, async () => {
      const { mirrorId, itemId } = await family.arrange();
      const routes = new Map<string, string>();
      for (const route of kit.backend.app.routes) {
        if (route.method !== "POST" || !route.path.startsWith(`${family.mount}/:id/`) || route.path.endsWith("/void")) continue;
        routes.set(route.path, route.path.replace(":id", encodeURIComponent(mirrorId)).replace(":lineId", "0"));
      }
      expect([...routes.keys()].map((path) => path.slice(family.mount.length)).sort()).toEqual(
        expect.arrayContaining(["/:id/cancel", "/:id/confirm", "/:id/lines/:lineId/journal-tax", "/:id/resubmit"]),
      );
      const before = await books(itemId);

      const answers: Record<string, string> = {};
      for (const [route, path] of routes) {
        const reply = await kit.call("POST", path, bodyOf(route));
        answers[route] = `${reply.status} ${reply.body?.error ?? ""}`;
      }

      expect(answers).toEqual(Object.fromEntries([...routes.keys()].map((route) => [route, "404 NOT_FOUND"])));
      expect(await books(itemId)).toEqual(before);
      expect((await kit.call("GET", `${family.mount}/${encodeURIComponent(mirrorId)}`)).body.status).toBe("confirmed");
    });
  }
});
