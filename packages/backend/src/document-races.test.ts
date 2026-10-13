import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { bootBackendKit, raceBothOrders, RaceOutcome, rowsOf, type BackendKit } from "./test-helpers/backend-kit.js";

const TODAY = "2026-08-24";
const UNNAMED_ZERO = { taxRateId: null, taxRatePercent: 0 };
const EXEMPT_RATE = "VAT-EXEMPT";
const SUPPLIER = "SUPP-DEMO-1";
const CASH_GL = "1300-1";

let kit: BackendKit;

const serviceLine = (lineId: string, over: Record<string, unknown> = {}) => ({
  lineId, itemId: "ITEM-DEMO-10", itemNameAr: "خدمة", isStock: false, qty: "1", unitPrice: "100", revenueAccountId: "4100", ...over,
});

const stockLine = (lineId: string, over: Record<string, unknown> = {}) => ({
  lineId, itemId: "ITEM-DEMO-2", itemNameAr: "صنف", isStock: true, qty: "2", unitPrice: "100",
  revenueAccountId: "4100", cogsAccountId: "5100", inventoryAccountId: "1200", ...over,
});

async function confirmedSale(id: string, lines: readonly Record<string, unknown>[]): Promise<string> {
  const created = await kit.call("POST", "/sales-invoices", {
    id, date: TODAY, dueDate: "2026-09-23", customerId: "CUST-DEMO-1", customerNameAr: "عميل", warehouseId: "WH-MAIN", branchId: "BR-MAIN",
    arAccountId: "1105", taxAccountId: "2200", lines,
  });
  expect(created.status, JSON.stringify(created.body)).toBe(201);
  const confirmed = await kit.call("POST", `/sales-invoices/${id}/confirm`, {});
  expect(confirmed.status, JSON.stringify(confirmed.body)).toBe(200);
  return id;
}

async function draftReturn(id: string, sourceInvoiceId: string, sourceLineId: string): Promise<string> {
  const created = await kit.call("POST", "/sales-returns/from-invoice", {
    id, date: TODAY, memo: "", warehouseId: "WH-MAIN", sourceInvoiceId, reason: "DEFECTIVE",
    requested: [{ itemId: "ITEM-DEMO-2", sourceLineId, qty: "1" }],
  });
  expect(created.status, JSON.stringify(created.body)).toBeLessThan(300);
  return id;
}

async function confirmedPurchase(id: string): Promise<string> {
  const created = await kit.call("POST", "/purchases/invoices", {
    id, supplierId: SUPPLIER, date: TODAY, dueDate: "2026-09-23", branchId: "BR-MAIN", warehouseId: "WH-MAIN",
    lines: [{ itemId: null, kind: "expense", description: "خدمة", qty: "1", unitCost: "200", ...UNNAMED_ZERO }],
  });
  expect(created.status, JSON.stringify(created.body)).toBe(201);
  const confirmed = await kit.call("POST", `/purchases/invoices/${id}/confirm`, {});
  expect(confirmed.status, JSON.stringify(confirmed.body)).toBe(200);
  return id;
}

const voidSale = (id: string) => kit.call("POST", `/sales-invoices/${id}/void`, { reason: "race" });
const collect = (id: string) => kit.call("POST", `/sales-invoices/${id}/payments`, { amount: "40", treasuryAccountId: "TR-DEMO-CASH", paymentMethod: "cash", referenceNo: `REF-${id}` });
const classifySale = (id: string, lineId: string) => kit.call("POST", `/sales-invoices/${id}/lines/${lineId}/classify-tax`, { taxRateId: EXEMPT_RATE });
const classifyPurchase = (id: string) => kit.call("POST", `/purchases/invoices/${id}/lines/0/classify-tax`, { taxRateId: EXEMPT_RATE });

const namesOf = (lines: readonly { taxRateId: string | null }[]) => lines.map((line) => line.taxRateId);

beforeAll(async () => {
  kit = await bootBackendKit();
}, 120_000);

afterAll(async () => {
  await kit.close();
});

describe("two operations on one stored document land as one story", () => {
  it("void against a collection: one of them wins, and a reversed invoice never holds an allocated voucher", async () => {
    await raceBothOrders<string>(kit, "RC-VOID-PAY", {
      outcome: RaceOutcome.ExactlyOneWins,
      arrange: (tag) => confirmedSale(tag, [serviceLine("A", UNNAMED_ZERO)]),
      first: voidSale,
      second: collect,
      agree: async ({ fixture, first, second }) => {
        const invoice = (await kit.call("GET", `/sales-invoices/${fixture}`)).body;
        const voids = await kit.auditRows("SALES_INVOICE", fixture, "VOID");
        const reversal = await kit.journalLines(`${fixture}:void`);
        const found = (await kit.call("GET", `/vouchers?pageSize=200&search=${encodeURIComponent(`REF-${fixture}`)}`)).body;
        const collections = rowsOf(found).filter((voucher) => voucher.referenceNo === `REF-${fixture}`);
        if (second.status === 200) expect(collections.length, JSON.stringify(found).slice(0, 400)).toBe(1);
        if (first.status === 200) {
          expect(second.status).toBe(422);
          expect(second.body.error).toBe("INVALID_SALES_INVOICE_PAYMENT");
          expect([invoice.status, invoice.amountPaid]).toEqual(["reversed", "0.000000"]);
          expect(voids).toHaveLength(1);
          expect(reversal.length).toBeGreaterThan(0);
          expect(collections).toHaveLength(0);
        } else {
          expect([first.status, first.body.error]).toEqual([409, "INVOICE_HAS_COLLECTIONS"]);
          expect(second.status).toBe(200);
          expect([invoice.status, invoice.amountPaid]).toEqual(["partially_paid", "40.000000"]);
          expect(voids).toHaveLength(0);
          expect(reversal).toHaveLength(0);
          expect(collections.map((voucher) => voucher.status)).toEqual(["confirmed"]);
        }
      },
    });
  }, 120_000);

  it("classify against a return's confirm: both land and the return's line and journal carry the invoice's rate", async () => {
    await raceBothOrders<{ invoiceId: string; returnId: string }>(kit, "RC-CLS-RET", {
      outcome: RaceOutcome.BothLand,
      arrange: async (tag) => {
        const invoiceId = await confirmedSale(tag, [stockLine("A", UNNAMED_ZERO)]);
        return { invoiceId, returnId: await draftReturn(`${tag}-R`, invoiceId, "A") };
      },
      first: ({ invoiceId }) => classifySale(invoiceId, "A"),
      second: ({ returnId }) => kit.call("POST", `/sales-returns/${returnId}/confirm`, {}),
      agree: async ({ fixture }) => {
        const invoice = (await kit.call("GET", `/sales-invoices/${fixture.invoiceId}`)).body;
        const returned = (await kit.call("GET", `/sales-returns/${fixture.returnId}`)).body;
        expect(namesOf(invoice.lines)).toEqual([EXEMPT_RATE]);
        expect(returned.status).toBe("confirmed");
        expect(namesOf(returned.lines)).toEqual([EXEMPT_RATE]);
        const revenue = (await kit.journalLines(returned.journalEntryId)).filter((line) => line.accountId === "4100" || line.taxRatePercent !== null);
        expect(revenue.length).toBeGreaterThan(0);
        expect(revenue.map((line) => line.taxRateId)).toEqual(revenue.map(() => EXEMPT_RATE));
        expect(await kit.auditRows("SALES_INVOICE", fixture.invoiceId, "CLASSIFY_LINE_TAX")).toHaveLength(1);
      },
    });
  }, 120_000);

  it("a purchase cancel against a classify: the line, the entry and its reversal agree whichever lands first", async () => {
    await raceBothOrders<string>(kit, "RC-PCANCEL-CLS", {
      outcome: RaceOutcome.FirstCommitDecides,
      arrange: confirmedPurchase,
      first: (id) => kit.call("POST", `/purchases/invoices/${id}/cancel`, { reason: "race" }),
      second: classifyPurchase,
      agree: async ({ fixture, first, second }) => {
        expect(first.status).toBe(200);
        const named = second.status === 200 ? EXEMPT_RATE : null;
        if (!named) expect(second.status).toBe(409);
        const invoice = (await kit.call("GET", `/purchases/invoices/${fixture}`)).body;
        expect(invoice.status).toBe("cancelled");
        expect(namesOf(invoice.lines)).toEqual([named]);
        const taxed = (lines: Awaited<ReturnType<BackendKit["journalLines"]>>) => lines.filter((line) => Number(line.debit) + Number(line.credit) > 0 && line.accountId !== "2100");
        const entry = taxed(await kit.journalLines(`PI-JE:${fixture}`));
        const reversal = taxed(await kit.journalLines(`${fixture}:cancel`));
        expect(entry.length).toBeGreaterThan(0);
        expect(reversal).toHaveLength(entry.length);
        expect(entry.map((line) => line.taxRateId)).toEqual(entry.map(() => named));
        expect(reversal.map((line) => line.taxRateId)).toEqual(reversal.map(() => named));
        expect(await kit.auditRows("PURCHASE_INVOICE", fixture, "CLASSIFY_LINE_TAX")).toHaveLength(named ? 1 : 0);
      },
    });
  }, 120_000);

  it("a goods receipt's confirm against the invoice raised from it: an invoice is never raised from a receipt that is not confirmed, and is raised once it is", async () => {
    await raceBothOrders<string>(kit, "RC-GRN-INV", {
      outcome: RaceOutcome.FirstCommitDecides,
      arrange: async (tag) => {
        const drafted = await kit.call("POST", "/purchases/receipts", {
          id: tag, supplierId: SUPPLIER, date: TODAY, branchId: "BR-MAIN", warehouseId: "WH-MAIN", lines: [{ itemId: "ITEM-DEMO-2", qty: "3", unitCost: "70" }],
        });
        expect(drafted.status, JSON.stringify(drafted.body)).toBe(201);
        return tag;
      },
      first: (id) => kit.call("POST", `/purchases/receipts/${id}/confirm`, {}),
      second: (id) => kit.call("POST", "/purchases/invoices", { id: `${id}-INV`, supplierId: SUPPLIER, date: TODAY, dueDate: "2026-09-23", branchId: "BR-MAIN", warehouseId: "WH-MAIN", receiptId: id }),
      agree: async ({ fixture, first, second }) => {
        expect(first.status, JSON.stringify(first.body)).toBe(200);
        const receipt = (await kit.call("GET", `/purchases/receipts/${fixture}`)).body;
        expect(receipt.status).toBe("confirmed");
        const invoice = await kit.call("GET", `/purchases/invoices/${fixture}-INV`);
        if (second.status === 201) {
          expect([invoice.status, invoice.body.status, invoice.body.receiptId]).toEqual([200, "draft", fixture]);
          expect(invoice.body.lines.map((line: { itemId: string; qty: string }) => [line.itemId, Number(line.qty)])).toEqual([["ITEM-DEMO-2", 3]]);
        } else {
          expect(second.status, JSON.stringify(second.body)).toBeGreaterThanOrEqual(400);
          expect(second.body.message ?? "").toMatch(/[\u0600-\u06FF]/);
          expect(invoice.status).toBe(404);
        }
      },
    });
  }, 120_000);

  it("a voucher's confirm against its reversal: a voucher is never reversed before it posts, and its reversal mirrors the one entry it posted", async () => {
    await raceBothOrders<string>(kit, "RC-VCH-REV", {
      outcome: RaceOutcome.FirstCommitDecides,
      arrange: async (tag) => {
        const drafted = await kit.call("POST", "/vouchers", {
          id: tag, date: TODAY, voucherType: "other_income", amount: "120", branchId: "BR-MAIN", paymentMethod: "cash",
          treasuryAccountId: "TR-DEMO-CASH", treasuryGlAccountId: CASH_GL, counterpartyGlAccountId: "4100",
        });
        expect(drafted.status, JSON.stringify(drafted.body)).toBe(201);
        return tag;
      },
      first: (id) => kit.call("POST", `/vouchers/${id}/confirm`, {}),
      second: (id) => kit.call("POST", `/vouchers/${id}/reverse`, { reversalId: `${id}-REV` }),
      agree: async ({ fixture, first, second }) => {
        expect(first.status, JSON.stringify(first.body)).toBe(200);
        const voucher = (await kit.call("GET", `/vouchers/${fixture}`)).body;
        const posted = await kit.journalLines(voucher.journalEntryId);
        expect(posted.length).toBeGreaterThan(0);
        if (second.status >= 200 && second.status < 300) {
          expect([voucher.status, voucher.reversedByDocId]).toEqual(["reversed", `${fixture}-REV`]);
          const mirror = await kit.call("GET", `/vouchers/${voucher.reversedByDocId}`);
          expect([mirror.status, mirror.body.reversesDocId, mirror.body.reversedByDocId]).toEqual([200, fixture, null]);
          const reversal = await kit.journalLines(mirror.body.journalEntryId);
          expect(reversal.map((line) => [line.accountId, line.debit, line.credit]).sort()).toEqual(posted.map((line) => [line.accountId, line.credit, line.debit]).sort());
        } else {
          expect(second.status, JSON.stringify(second.body)).toBe(409);
          expect(second.body.message ?? "").toMatch(/[\u0600-\u06FF]/);
          expect([voucher.status, voucher.reversedByDocId]).toEqual(["confirmed", null]);
        }
      },
    });
  }, 120_000);

  it("refund against refund: two that together exceed the return's credit — one is paid, the other is refused in Arabic and leaves no voucher", async () => {
    const refund = (returnId: string) => kit.call("POST", `/sales-returns/${returnId}/refund`, { amount: "80", treasuryAccountId: "TR-DEMO-CASH", paymentMethod: "cash" });
    await raceBothOrders<string>(kit, "RC-REFUND-2", {
      outcome: RaceOutcome.ExactlyOneWins,
      arrange: async (tag) => {
        await confirmedSale(tag, [stockLine("A", { taxRateId: "VAT14" })]);
        const returnId = await draftReturn(`${tag}-R`, tag, "A");
        expect((await kit.call("POST", `/sales-returns/${returnId}/confirm`, {})).status).toBe(200);
        return returnId;
      },
      first: refund,
      second: refund,
      agree: async ({ fixture, first, second }) => {
        const refused = first.status === 200 ? second : first;
        expect([refused.status, refused.body.error], JSON.stringify(refused.body)).toEqual([422, "SALES_RETURN_NOT_REFUNDABLE"]);
        expect(refused.body.message).toMatch(/[\u0600-\u06FF]/);
        const returned = (await kit.call("GET", `/sales-returns/${fixture}`)).body;
        expect([returned.refunds.length, returned.refundedTotal, returned.refundDue]).toEqual([1, "80.000000", "34.000000"]);
      },
    });
  }, 120_000);

  it("supplier payment against cancel: one of them wins, and a cancelled purchase invoice never holds an allocated payment", async () => {
    await raceBothOrders<string>(kit, "RC-PAY-CANCEL", {
      outcome: RaceOutcome.ExactlyOneWins,
      arrange: (tag) => confirmedPurchase(tag),
      first: (id) => kit.call("POST", `/purchases/invoices/${id}/payments`, { amount: "50", treasuryAccountId: "TR-DEMO-CASH", paymentMethod: "cash", referenceNo: `REF-${id}` }),
      second: (id) => kit.call("POST", `/purchases/invoices/${id}/cancel`, {}),
      agree: async ({ fixture, first, second }) => {
        const invoice = (await kit.call("GET", `/purchases/invoices/${fixture}`)).body;
        const found = (await kit.call("GET", `/vouchers?pageSize=200&search=${encodeURIComponent(`REF-${fixture}`)}`)).body;
        const payments = rowsOf(found).filter((voucher) => voucher.referenceNo === `REF-${fixture}`);
        if (first.status === 200) {
          expect([invoice.status, payments.length, second.status, second.body.error]).toEqual(["confirmed", 1, 409, "INVOICE_HAS_PAYMENTS"]);
        } else {
          expect([invoice.status, payments.length, first.status, first.body.error]).toEqual(["cancelled", 0, 422, "INVOICE_NOT_PAYABLE"]);
        }
        expect((first.status === 200 ? second : first).body.message).toMatch(/[\u0600-\u06FF]/);
      },
    });
  });

  it("collection against collection: two that together exceed the invoice — one lands, the other is refused in Arabic and leaves no voucher", async () => {
    await raceBothOrders<string>(kit, "RC-COLL-COLL", {
      outcome: RaceOutcome.ExactlyOneWins,
      arrange: (tag) => confirmedSale(tag, [serviceLine("A", UNNAMED_ZERO)]),
      first: (id) => kit.call("POST", `/sales-invoices/${id}/payments`, { amount: "70", treasuryAccountId: "TR-DEMO-CASH", paymentMethod: "cash", referenceNo: `REF-${id}` }),
      second: (id) => kit.call("POST", `/sales-invoices/${id}/payments`, { amount: "70", treasuryAccountId: "TR-DEMO-CASH", paymentMethod: "cash", referenceNo: `REF-${id}` }),
      agree: async ({ fixture, first, second }) => {
        const loser = first.status === 200 ? second : first;
        expect(loser.status, JSON.stringify(loser.body)).toBe(422);
        expect(loser.body.message).toMatch(/[\u0600-\u06FF]/);
        const invoice = (await kit.call("GET", `/sales-invoices/${fixture}`)).body;
        const found = (await kit.call("GET", `/vouchers?pageSize=200&search=${encodeURIComponent(`REF-${fixture}`)}`)).body;
        expect([invoice.amountPaid, rowsOf(found).filter((voucher) => voucher.referenceNo === `REF-${fixture}`).length]).toEqual(["70.000000", 1]);
      },
    });
  });

  it("one quote converted twice at once: one invoice is raised, the other conversion is refused and leaves no draft behind", async () => {
    const convert = (quoteId: string, invoiceId: string) =>
      kit.call("POST", `/sales-quotes/${quoteId}/convert-to-invoice`, {
        id: invoiceId, dueDate: "2026-09-30", warehouseId: "WH-MAIN", arAccountId: "1105", taxAccountId: "2200",
        lines: [{ lineId: "A", isStock: false, revenueAccountId: "4100" }],
      });
    await raceBothOrders<string>(kit, "RC-CONVERT", {
      outcome: RaceOutcome.ExactlyOneWins,
      arrange: async (tag) => {
        const quoted = await kit.call("POST", "/sales-quotes", {
          id: tag, date: TODAY, expiryDate: "2026-09-30", customerId: "CUST-DEMO-1", customerNameAr: "عميل", branchId: "BR-MAIN",
          lines: [{ lineId: "A", itemId: "ITEM-DEMO-10", itemNameAr: "خدمة", qty: "1", unitPrice: "100", taxRateId: "VAT14" }],
        });
        expect(quoted.status, JSON.stringify(quoted.body)).toBe(201);
        for (const action of ["send", "accept"]) expect((await kit.call("POST", `/sales-quotes/${tag}/${action}`, {})).status).toBe(200);
        return tag;
      },
      first: (id) => convert(id, `${id}-I1`),
      second: (id) => convert(id, `${id}-I2`),
      agree: async ({ fixture, first, second }) => {
        const [won, lost] = first.status === 201 ? [`${fixture}-I1`, `${fixture}-I2`] : [`${fixture}-I2`, `${fixture}-I1`];
        const loser = first.status === 201 ? second : first;
        expect(loser.status, JSON.stringify(loser.body)).toBe(409);
        expect([loser.body.error, loser.body.message]).toEqual(["INVALID_QUOTE_STATUS", expect.stringContaining("حُوِّل بالفعل إلى فاتورة مبيعات")]);
        const quote = (await kit.call("GET", `/sales-quotes/${fixture}`)).body;
        expect([quote.status, quote.convertedInvoiceId]).toEqual(["converted", won]);
        expect([(await kit.call("GET", `/sales-invoices/${won}`)).status, (await kit.call("GET", `/sales-invoices/${lost}`)).status]).toEqual([200, 404]);
      },
    });
  });
});
