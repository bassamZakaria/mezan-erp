import type { ScenarioFragment } from "./fragments.js";

const SERVICE_ITEM = "ITEM-DEMO-10";
const CUSTOMER = "CUST-DEMO-1";
const WAREHOUSE = "WH-MAIN";
const BRANCH = "BR-MAIN";
const UNIT_PRICE = "75";
const QTY = "400";

/**
 * Owner cockpit (ENH-E1-01) — top movers and the live-refresh counter.
 *
 * The movers list ranked an item by what was invoiced and never looked at what
 * came back, so a sold-then-returned item topped it. Proved on a SERVICE line
 * so the pair moves no stock: the invoice makes the item the biggest mover of
 * the window, and the full return must take it straight back out.
 */
export const scenario: ScenarioFragment = {
  smokePaths: ["/dashboard/cockpit", "/dashboard/version"],

  async run(ctx) {
    const { scenario: it, req, n, check, checkEq } = ctx;

    await it("cockpit · a sold-then-returned item stops being a top mover", async () => {
      const before = (await req("GET", "/dashboard/cockpit")).body;
      const today = before?.today as string;
      const beforeFigure = n((before?.topMovers ?? []).find((m: any) => m.itemId === SERVICE_ITEM)?.current ?? 0);

      const invoice = await req("POST", "/sales-invoices", {
        id: "SCN-CKP-INV-1",
        date: today,
        dueDate: today,
        customerId: CUSTOMER,
        customerNameAr: "عميل السيناريو",
        warehouseId: WAREHOUSE,
        branchId: BRANCH,
        currency: "EGP",
        arAccountId: "1105",
        taxAccountId: "2200",
        lines: [
          {
            lineId: "SCN-CKP-INV-1-L1",
            itemId: SERVICE_ITEM,
            itemNameAr: "خدمة توصيل الطلبات",
            isStock: false,
            qty: QTY,
            unitPrice: UNIT_PRICE,
            taxRatePercent: 14,
            revenueAccountId: "4100",
            cogsAccountId: "5100",
            inventoryAccountId: "1200",
          },
        ],
      });
      check("a service invoice is raised", invoice.status === 201, JSON.stringify(invoice.body).slice(0, 200));
      const confirmedInvoice = await req("POST", "/sales-invoices/SCN-CKP-INV-1/confirm", {});
      check("and confirmed", confirmedInvoice.ok, JSON.stringify(confirmedInvoice.body).slice(0, 200));

      const sold = (await req("GET", "/dashboard/cockpit")).body;
      const ranked = (sold?.topMovers ?? []).find((m: any) => m.itemId === SERVICE_ITEM);
      check("the item is now a top mover", ranked !== undefined, JSON.stringify(sold?.topMovers ?? []).slice(0, 200));
      checkEq("by exactly what the invoice charged for it", n(ranked?.current ?? 0) - beforeFigure, 400 * 75);

      const invoiceBody = confirmedInvoice.body?.document ?? confirmedInvoice.body;
      const line = (invoiceBody?.lines ?? [])[0];
      const created = await req("POST", "/sales-returns", {
        id: "SCN-CKP-RET-1",
        date: today,
        memo: "SCN cockpit movers return",
        lines: [
          {
            itemId: SERVICE_ITEM,
            warehouseId: WAREHOUSE,
            customerId: CUSTOMER,
            sourceInvoiceId: "SCN-CKP-INV-1",
            sourceInvoiceNumber: invoiceBody?.docNo ?? null,
            reason: "DEFECTIVE",
            availableQty: QTY,
            qty: QTY,
            unitPrice: UNIT_PRICE,
            unitCost: "0",
            taxAmount: line?.taxAmount ?? "0",
            isStock: false,
          },
        ],
      });
      check("the full return is raised", created.status === 201, JSON.stringify(created.body).slice(0, 200));
      const confirmedReturn = await req("POST", "/sales-returns/SCN-CKP-RET-1/confirm", {});
      check("and confirmed", confirmedReturn.ok, JSON.stringify(confirmedReturn.body).slice(0, 200));

      const after = (await req("GET", "/dashboard/cockpit")).body;
      const stillRanked = (after?.topMovers ?? []).find((m: any) => m.itemId === SERVICE_ITEM);
      checkEq(
        "the return nets the item's current-window figure straight back to where it started",
        n(stillRanked?.current ?? 0),
        beforeFigure,
      );
    });

    await it("cockpit · the book-version counter is readable by any signed-in dashboard, not just the cockpit's", async () => {
      const cockpitReader = await req("GET", "/dashboard/version", undefined, { "x-permissions": "accounting.cockpit.view" });
      check("a cockpit holder reads it", cockpitReader.ok, String(cockpitReader.status));
      const classicReader = await req("GET", "/dashboard/version", undefined, { "x-permissions": "accounting.journal.view" });
      check("and so does the classic dashboard's reader", classicReader.ok, String(classicReader.status));
      check("it carries nothing but the counter", JSON.stringify(Object.keys(classicReader.body ?? {})) === '["bookVersion"]', JSON.stringify(classicReader.body));

      const cockpitDenied = await req("GET", "/dashboard/cockpit", undefined, { "x-permissions": "accounting.journal.view" });
      checkEq("while the cockpit's own figures stay behind their permission", cockpitDenied.status, 403);
    });
  },
};
