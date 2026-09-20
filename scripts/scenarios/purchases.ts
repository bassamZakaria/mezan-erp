import type { Ctx } from "./harness.js";

/**
 * Executable checks for the purchases module — see docs/TESTING.md §6.
 *
 * Drives the real three-gate chain (RFQ → PO → Goods Receipt → Purchase
 * Invoice, plus Returns and Landed Costs) through the API the UI itself
 * calls. Purely-visual scenarios ([NOT IMPLEMENTED] UI gaps, missing filter
 * panels, column layouts, empty-state copy, SidePanel-vs-page navigation
 * patterns) are out of scope for an in-process harness with no DOM and are
 * skipped — see the report for the full list.
 */

const BRANCH_ID = "BR-MAIN";
const WAREHOUSE_ID = "WH-MAIN";
const VAT = 14;


export async function run(ctx: Ctx): Promise<void> {
  const { req, rows, n, check, checkEq, scenario } = ctx;

  async function itemBalance(itemId: string) {
    const res = await req("GET", `/inventory/balance?itemId=${itemId}&warehouseId=${WAREHOUSE_ID}`);
    return {
      onHand: n(res.body?.onHand),
      totalValue: n(res.body?.totalValue),
      averageCost: n(res.body?.averageCost),
      averageCostExact: String(res.body?.averageCost ?? "0"),
    };
  }

  async function accountBalance(accountId: string): Promise<number> {
    const res = await req("GET", `/gl/accounts/${accountId}/ledger`);
    return n(res.body?.balance?.balance);
  }

  async function confirmedInvoiceTotals() {
    return (await ctx.allRows("/purchases/invoices"))
      .filter((x: any) => x.status === "confirmed")
      .reduce((s: number, x: any) => s + n(x.total), 0);
  }

  // --- 1. The procurement chain end to end --------------------------------
  await scenario("purchases: RFQ -> quotes -> compare -> convert -> PO -> receipt -> invoice, full chain", async () => {
    const start = await ctx.invariants();

    const rfq = await req("POST", "/rfqs", {
      id: "SCN-RFQ-1",
      date: "2026-08-24",
      requiredByDate: "2026-09-10",
      branchId: BRANCH_ID,
      warehouseId: WAREHOUSE_ID,
      notes: "سيناريو تنفيذي — سلسلة الشراء الكاملة",
      lines: [
        { itemId: "ITEM-DEMO-1", qty: "80", notes: null },
        { itemId: "ITEM-DEMO-3", qty: "150", notes: null },
      ],
    });
    check("RFQ created as draft", rfq.status === 201 && rfq.body.status === "draft", `status ${rfq.status}`);

    const sent = await req("POST", "/rfqs/SCN-RFQ-1/send", {});
    check("RFQ send -> sent", sent.status === 200 && sent.body.status === "sent", `status ${sent.status}, doc ${sent.body?.status}`);

    const q1 = await req("POST", "/rfqs/SCN-RFQ-1/quotes", {
      id: "SCN-RFQQ-1",
      supplierId: "SUPP-DEMO-1",
      notes: "عرض المورد الأول",
      lines: [
        { itemId: "ITEM-DEMO-1", unitPrice: "145", notes: null },
        { itemId: "ITEM-DEMO-3", unitPrice: "33", notes: null },
      ],
    });
    check("quote 1 recorded (SUPP-DEMO-1)", q1.status === 201, `status ${q1.status}`);

    const q2 = await req("POST", "/rfqs/SCN-RFQ-1/quotes", {
      id: "SCN-RFQQ-2",
      supplierId: "SUPP-DEMO-2",
      notes: "عرض المورد الثاني",
      lines: [
        { itemId: "ITEM-DEMO-1", unitPrice: "150", notes: null },
        { itemId: "ITEM-DEMO-3", unitPrice: "35", notes: null },
      ],
    });
    check("quote 2 recorded (SUPP-DEMO-2)", q2.status === 201, `status ${q2.status}`);

    // supplier 1: 80*145 + 150*33 = 16,550 — supplier 2: 80*150 + 150*35 = 17,250. Supplier 1 is cheaper overall.
    const cmp = await req("GET", "/rfqs/SCN-RFQ-1/comparison");
    const totals = cmp.body?.totalsBySupplier ?? {};
    checkEq("comparison: SUPP-DEMO-1 basket total is 16,550", n(totals["SUPP-DEMO-1"]), 16550);
    checkEq("comparison: SUPP-DEMO-2 basket total is 17,250", n(totals["SUPP-DEMO-2"]), 17250);
    const rows2 = cmp.body?.rows ?? [];
    check(
      "comparison: both rows independently confirm SUPP-DEMO-1 as cheaper supplier overall",
      totals["SUPP-DEMO-1"] !== undefined && n(totals["SUPP-DEMO-1"]) < n(totals["SUPP-DEMO-2"]) && rows2.length === 2,
      JSON.stringify(totals),
    );

    const convert = await req("POST", "/rfqs/SCN-RFQ-1/convert", { purchaseOrderId: "SCN-PO-1", supplierId: "SUPP-DEMO-1" });
    check(
      "convert: RFQ closes and links the new PO",
      convert.status === 201 && convert.body?.rfq?.status === "closed" && convert.body?.purchaseOrderId === "SCN-PO-1",
      JSON.stringify(convert.body),
    );

    const po = await req("GET", "/purchases/orders/SCN-PO-1");
    checkEq("PO created as draft with the winning quote's prices, subtotal 16,550", n(po.body?.subtotal), 16550);
    check("PO status is draft before confirm", po.body?.status === "draft", po.body?.status);

    const poConfirm = await req("POST", "/purchases/orders/SCN-PO-1/confirm", {});
    check("PO confirm: draft -> sent", poConfirm.status === 200 && poConfirm.body.status === "sent", poConfirm.body?.status);

    const beforeReceipt = await ctx.invariants();
    const grn = await req("POST", "/purchases/receipts", {
      id: "SCN-GRN-1",
      purchaseOrderId: "SCN-PO-1",
      date: "2026-08-24",
      notes: "استلام كامل مطابق لأمر الشراء",
    });
    check("receipt created as draft, auto-filled from PO outstanding qty", grn.status === 201 && grn.body.status === "draft", grn.status.toString());
    checkEq("receipt line 1 auto-fills full outstanding qty (80) at the PO's unit price (145)", n(grn.body.lines[0].qty) * n(grn.body.lines[0].unitCost), 80 * 145);
    checkEq("receipt line 2 auto-fills full outstanding qty (150) at the PO's unit price (33)", n(grn.body.lines[1].qty) * n(grn.body.lines[1].unitCost), 150 * 33);

    const grnConfirm = await req("POST", "/purchases/receipts/SCN-GRN-1/confirm", {});
    check("receipt confirm: draft -> confirmed", grnConfirm.status === 200 && grnConfirm.body.status === "confirmed", grnConfirm.body?.status);

    const afterReceipt = await ctx.invariants();
    // Since D53 the receipt posts Dr 1200 / Cr 2120 for the same 16,550 it
    // moved, so the sub-ledger and its control account never diverge.
    checkEq(
      "receipt-confirm moves stock AND posts for it — the sub-ledger stays level with GL 1200",
      afterReceipt.inventory,
      beforeReceipt.inventory,
    );
    checkEq("receipt-confirm still does not touch AP — nothing is owed to the supplier until they invoice", afterReceipt.ap, beforeReceipt.ap);
    checkEq("and the entry it posts balances, so the trial balance still nets to zero", afterReceipt.tb, beforeReceipt.tb);

    const poAfterReceipt = await req("GET", "/purchases/orders/SCN-PO-1");
    check(
      "PO status advances to fully_received off the one full receipt",
      poAfterReceipt.body?.status === "fully_received",
      poAfterReceipt.body?.status,
    );
    checkEq("PO line 1 receivedQty reaches ordered qty (80)", n(poAfterReceipt.body.lines[0].receivedQty), 80);
    checkEq("PO line 2 receivedQty reaches ordered qty (150)", n(poAfterReceipt.body.lines[1].receivedQty), 150);

    const apBeforeInvoice = await confirmedInvoiceTotals();
    const invoice = await req("POST", "/purchases/invoices", {
      id: "SCN-PI-1",
      supplierId: "SUPP-DEMO-1",
      date: "2026-08-24",
      dueDate: "2026-09-23",
      branchId: BRANCH_ID,
      warehouseId: WAREHOUSE_ID,
      receiptId: "SCN-GRN-1",
      lines: [
        { itemId: "ITEM-DEMO-1", kind: "inventory", qty: "80", unitCost: "145", taxRatePercent: VAT },
        { itemId: "ITEM-DEMO-3", kind: "inventory", qty: "150", unitCost: "33", taxRatePercent: VAT },
      ],
    });
    check("from-receipt invoice created as draft", invoice.status === 201 && invoice.body.status === "draft", invoice.status.toString());
    // subtotal 16,550 * 1.14 = 18,867 total.
    checkEq("invoice total is subtotal(16,550) + 14% VAT = 18,867", n(invoice.body.total), 18867);

    const invConfirm = await req("POST", "/purchases/invoices/SCN-PI-1/confirm", {});
    check("invoice confirm: draft -> confirmed", invConfirm.status === 200 && invConfirm.body.status === "confirmed", invConfirm.body?.status);

    const afterInvoice = await ctx.invariants();
    checkEq(
      "invoice-confirm posts GL 1200 for exactly the receipt's value, closing the receipt-confirm gap back to the pre-chain baseline",
      afterInvoice.inventory,
      start.inventory,
    );
    checkEq(
      "invoice-confirm's AP posting matches its sub-ledger figure exactly — the reconciliation diff is unchanged, not merely the same sign (ctx.invariants().ap is subLedger-minus-GL, not an absolute balance)",
      afterInvoice.ap,
      beforeReceipt.ap,
    );

    const apAfterInvoice = await confirmedInvoiceTotals();
    checkEq(
      "independent cross-check: summing /purchases/invoices' confirmed totals shows the same +18,867 the reconciliation figure showed",
      apAfterInvoice - apBeforeInvoice,
      18867,
    );

    checkEq("trial balance still balances after the full chain", afterInvoice.tb, 0);
  });

  // --- 2. Trying to skip a gate: confirming twice --------------------------
  await scenario("purchases: confirming an already-confirmed PO / receipt / invoice is refused (409)", async () => {
    const poRe = await req("POST", "/purchases/orders/SCN-PO-1/confirm", {});
    // confirmPurchaseOrder (purchase-order.ts) throws InvalidPurchaseDocumentError (422) on a
    // non-draft order, unlike receipt/invoice confirm which throw PurchaseDocumentNotDraftError (409).
    check("PO double-confirm refused (422 INVALID_PURCHASE_DOCUMENT)", poRe.status === 422, `status ${poRe.status}: ${JSON.stringify(poRe.body)}`);

    const grnRe = await req("POST", "/purchases/receipts/SCN-GRN-1/confirm", {});
    check("receipt double-confirm refused (409)", grnRe.status === 409, `status ${grnRe.status}: ${JSON.stringify(grnRe.body)}`);

    const invRe = await req("POST", "/purchases/invoices/SCN-PI-1/confirm", {});
    check("invoice double-confirm refused (409)", invRe.status === 409, `status ${invRe.status}: ${JSON.stringify(invRe.body)}`);
  });

  // --- 3. Trying to skip a gate: over-return, server-derived cap -----------
  await scenario(
    "purchases: return-quantity cap on PI-DEMO-1 is derived server-side (invoiced 200 - confirmed returns) — 4acf10f",
    async () => {
      const pi = await req("GET", "/purchases/invoices/PI-DEMO-1");
      const line = pi.body.lines.find((l: any) => l.itemId === "ITEM-DEMO-1");
      checkEq("PI-DEMO-1's rice line was invoiced for 200", n(line.qty), 200);

      // PRET-DEMO-1 (seeded by demo-seed/platform.ts) already confirmed a return
      // of 10 against this exact line, so the true cap is 200 - 10 = 190.
      const over200 = await req("POST", "/purchase-returns", {
        id: "SCN-PRT-200",
        date: "2026-08-24",
        memo: "محاولة إرجاع كامل الكمية المفوترة",
        lines: [
          {
            itemId: "ITEM-DEMO-1",
            warehouseId: WAREHOUSE_ID,
            supplierId: "SUPP-DEMO-1",
            sourceInvoiceId: "PI-DEMO-1",
            sourceInvoiceNumber: pi.body.number,
            reason: "OTHER",
            availableQty: "200",
            qty: "200",
            unitCost: "140",
            taxAmount: "0",
          },
        ],
      });
      check(
        "returning the full invoiced 200 is refused (exceeds the true 190 cap)",
        over200.status === 422,
        `status ${over200.status}: ${JSON.stringify(over200.body).slice(0, 200)}`,
      );
      check("422 body names the 190 cap", JSON.stringify(over200.body).includes("190"), JSON.stringify(over200.body));

      const over191 = await req("POST", "/purchase-returns", {
        id: "SCN-PRT-191",
        date: "2026-08-24",
        memo: "محاولة تجاوز الحد بوحدة واحدة",
        lines: [
          {
            itemId: "ITEM-DEMO-1",
            warehouseId: WAREHOUSE_ID,
            supplierId: "SUPP-DEMO-1",
            sourceInvoiceId: "PI-DEMO-1",
            sourceInvoiceNumber: pi.body.number,
            reason: "OTHER",
            availableQty: "191",
            qty: "191",
            unitCost: "140",
            taxAmount: "0",
          },
        ],
      });
      check("returning 191 (cap + 1) is refused", over191.status === 422, `status ${over191.status}`);

      const at190 = await req("POST", "/purchase-returns", {
        id: "SCN-PRT-190",
        date: "2026-08-24",
        memo: "عند الحد الأقصى بالضبط",
        lines: [
          {
            itemId: "ITEM-DEMO-1",
            warehouseId: WAREHOUSE_ID,
            supplierId: "SUPP-DEMO-1",
            sourceInvoiceId: "PI-DEMO-1",
            sourceInvoiceNumber: pi.body.number,
            reason: "OTHER",
            availableQty: "190",
            qty: "190",
            unitCost: "140",
            taxAmount: "0",
          },
        ],
      });
      check("returning exactly 190 (the true cap) is accepted at create", at190.status === 201, `status ${at190.status}: ${JSON.stringify(at190.body).slice(0, 200)}`);
      // Left as a draft deliberately — a draft return has no stock/GL effect,
      // so proving the boundary this way needs no on-hand-stock guesswork.

      // A small, safely-within-stock CONFIRMED return proves the actual money/stock movement.
      // The return's GL posting credits inventory at the LINE'S DECLARED unitCost, while the
      // stock-ledger engine actually draws the position down at its LIVE weighted-average cost
      // (buildStockPlan carries no unitCost at all — see purchase-return-document.ts). Rice's
      // live WAC has drifted away from PI-DEMO-1's original 140 by this point in the run (the
      // seed's own LC-DEMO-1 already revalued it, and this file's own chain scenario bought more
      // at 145) — matching the seed's own comment on PRT-DEMO-1 about the two needing to agree.
      // Querying the live average and declaring THAT keeps this test about the cap, not that gap.
      const before = await itemBalance("ITEM-DEMO-1");
      const taxAmount = Math.round(5 * before.averageCost * (VAT / 100) * 100) / 100;
      const beforeSmall = await ctx.invariants();
      const small = await req("POST", "/purchase-returns", {
        id: "SCN-PRT-SMALL",
        date: "2026-08-24",
        memo: "إرجاع صغير للتحقق من الأثر المالي",
        lines: [
          {
            itemId: "ITEM-DEMO-1",
            warehouseId: WAREHOUSE_ID,
            supplierId: "SUPP-DEMO-1",
            sourceInvoiceId: "PI-DEMO-1",
            sourceInvoiceNumber: pi.body.number,
            reason: "OTHER",
            availableQty: "5",
            qty: "5",
            unitCost: before.averageCostExact,
            taxAmount: String(taxAmount),
          },
        ],
      });
      check("small (5-unit) return creates fine", small.status === 201, `status ${small.status}`);
      const smallConfirm = await req("POST", "/purchase-returns/SCN-PRT-SMALL/confirm", {});
      check("small return confirms", smallConfirm.status === 200 && smallConfirm.body?.document?.status === "confirmed", JSON.stringify(smallConfirm.body).slice(0, 150));

      const after = await itemBalance("ITEM-DEMO-1");
      checkEq("confirmed return pulls exactly 5 units of stock back out", before.onHand - after.onHand, 5);
      const afterSmall = await ctx.invariants();
      checkEq("inventory reconciliation still holds after the confirmed return (declared unitCost matched the live WAC)", afterSmall.inventory, beforeSmall.inventory);
      checkEq("AP reconciliation still holds too", afterSmall.ap, beforeSmall.ap);

      // Cap recomputes with the newly-confirmed return: 200 - 10 - 5 = 185.
      const over186 = await req("POST", "/purchase-returns", {
        id: "SCN-PRT-186",
        date: "2026-08-24",
        memo: "بعد الإرجاع الصغير — تجاوز الحد الجديد",
        lines: [
          {
            itemId: "ITEM-DEMO-1",
            warehouseId: WAREHOUSE_ID,
            supplierId: "SUPP-DEMO-1",
            sourceInvoiceId: "PI-DEMO-1",
            sourceInvoiceNumber: pi.body.number,
            reason: "OTHER",
            availableQty: "186",
            qty: "186",
            unitCost: "140",
            taxAmount: "0",
          },
        ],
      });
      check("cap recomputes after the confirmed return: 186 (new cap + 1) is refused", over186.status === 422, `status ${over186.status}`);

      const at185 = await req("POST", "/purchase-returns", {
        id: "SCN-PRT-185",
        date: "2026-08-24",
        memo: "عند الحد الجديد بالضبط",
        lines: [
          {
            itemId: "ITEM-DEMO-1",
            warehouseId: WAREHOUSE_ID,
            supplierId: "SUPP-DEMO-1",
            sourceInvoiceId: "PI-DEMO-1",
            sourceInvoiceNumber: pi.body.number,
            reason: "OTHER",
            availableQty: "185",
            qty: "185",
            unitCost: "140",
            taxAmount: "0",
          },
        ],
      });
      check("cap recomputes after the confirmed return: exactly 185 is accepted at create", at185.status === 201, `status ${at185.status}`);
    },
  );

  // --- 4. Trying to skip a gate: double-invoicing an already-invoiced receipt (DEFECT) ---
  await scenario(
    "purchases: a second purchase invoice from an already-invoiced receipt (GRN-DEMO-1) is refused",
    async () => {
      const receipt = await req("GET", "/purchases/receipts/GRN-DEMO-1");
      check("GRN-DEMO-1 is confirmed and already invoiced (precondition)", receipt.body?.status === "confirmed" && receipt.body?.invoiced === true, JSON.stringify(receipt.body).slice(0, 150));

      const start = await ctx.invariants();
      const apBefore = await confirmedInvoiceTotals();

      const dupe = await req("POST", "/purchases/invoices", {
        id: "SCN-PI-DOUBLE",
        supplierId: receipt.body.supplierId,
        date: "2026-08-24",
        branchId: BRANCH_ID,
        warehouseId: WAREHOUSE_ID,
        receiptId: "GRN-DEMO-1",
      });
      // createPurchaseInvoice must check receipt.invoiced, not only receipt.status ===
      // "confirmed": without it a second invoice claims the same goods twice, and
      // markGoodsReceiptInvoiced() on confirm no-ops rather than throwing, so nothing
      // downstream catches it either.
      check(
        "create refuses a 2nd invoice against an already-invoiced receipt",
        dupe.status >= 400,
        `create actually returned ${dupe.status}: ${JSON.stringify(dupe.body).slice(0, 150)}`,
      );

      if (dupe.status < 300) {
        const dupeConfirm = await req("POST", "/purchases/invoices/SCN-PI-DOUBLE/confirm", {});
        check(
          "the duplicate invoice also confirms cleanly — no downstream guard catches it either",
          dupeConfirm.status === 200 && dupeConfirm.body?.status === "confirmed",
          `confirm status ${dupeConfirm.status}`,
        );

        const after = await ctx.invariants();
        const apAfter = await confirmedInvoiceTotals();
        checkEq(
          "DEFECT impact: AP genuinely rose a 2nd time for goods already paid for once (independent /purchases/invoices sum)",
          apAfter - apBefore,
          n(dupeConfirm.body.total),
        );
        checkEq(
          "DEFECT impact: this posts Dr Inventory a 2nd time on GL 1200 with NO matching stock movement (stock already entered the ledger once, at the original receipt confirm) — inventory sub-ledger now sits BEHIND GL 1200 by the duplicate's value",
          after.inventory - start.inventory,
          0,
        );
      }
    },
  );

  // --- 5. Policy: over-receiving is accepted (blockOverReceipt defaults off), ---
  // --- and the PO's own receivedQty tracking silently caps at the ordered qty ---
  await scenario(
    "purchases: receiving more than ordered is accepted (blockOverReceipt is off by default) and the PO under-reports what actually arrived",
    async () => {
      const po = await req("POST", "/purchases/orders", {
        id: "SCN-PO-OVER",
        supplierId: "SUPP-DEMO-2",
        date: "2026-08-24",
        branchId: BRANCH_ID,
        warehouseId: WAREHOUSE_ID,
        lines: [{ itemId: "ITEM-DEMO-4", qty: "10", unitPrice: "210" }],
      });
      check("over-receipt PO created", po.status === 201, po.status.toString());
      const poConfirm = await req("POST", "/purchases/orders/SCN-PO-OVER/confirm", {});
      check("over-receipt PO confirmed (sent)", poConfirm.status === 200, poConfirm.status.toString());

      const grn = await req("POST", "/purchases/receipts", {
        id: "SCN-GRN-OVER",
        purchaseOrderId: "SCN-PO-OVER",
        date: "2026-08-24",
        lines: [{ itemId: "ITEM-DEMO-4", qty: "15", unitCost: "210" }],
      });
      check(
        "receiving 15 against an order for 10 is ACCEPTED at create (default policy has blockOverReceipt: false, docs/archive/catalog/09)",
        grn.status === 201,
        `status ${grn.status}: ${JSON.stringify(grn.body).slice(0, 150)}`,
      );

      const grnConfirm = await req("POST", "/purchases/receipts/SCN-GRN-OVER/confirm", {});
      check("the over-receipt confirms without error", grnConfirm.status === 200 && grnConfirm.body?.status === "confirmed", grnConfirm.status.toString());

      const poAfter = await req("GET", "/purchases/orders/SCN-PO-OVER");
      const receiptAfter = await req("GET", "/purchases/receipts/SCN-GRN-OVER");
      checkEq("the RECEIPT genuinely recorded all 15 units (source of truth for what physically arrived)", n(receiptAfter.body.lines[0].qty), 15);
      checkEq(
        "FINDING: the PO's own receivedQty tracking silently caps at the ordered 10 — the extra 5 units are invisible on the PO line even though they truly entered stock and will post real GL value once invoiced",
        n(poAfter.body.lines[0].receivedQty),
        10,
      );
      check("PO status still reads fully_received (its own tracking thinks the order is complete, hiding the over-receipt)", poAfter.body.status === "fully_received", poAfter.body.status);

      // Close the chain so the run's books stay balanced going forward.
      const invoice = await req("POST", "/purchases/invoices", {
        id: "SCN-PI-OVER",
        supplierId: "SUPP-DEMO-2",
        date: "2026-08-24",
        branchId: BRANCH_ID,
        warehouseId: WAREHOUSE_ID,
        receiptId: "SCN-GRN-OVER",
        lines: [{ itemId: "ITEM-DEMO-4", kind: "inventory", qty: "15", unitCost: "210", taxRatePercent: VAT }],
      });
      check("invoice for the full (over-)received 15 units creates fine", invoice.status === 201, invoice.status.toString());
      const invConfirm = await req("POST", "/purchases/invoices/SCN-PI-OVER/confirm", {});
      check("invoice confirms, closing the chain", invConfirm.status === 200 && invConfirm.body?.status === "confirmed", invConfirm.status.toString());
      // 15*210 = 3,150 subtotal, *1.14 = 3,591 total.
      checkEq("invoice total for the 15 over-received units is 3,591 (3,150 + 14% VAT)", n(invConfirm.body.total), 3591);
    },
  );

  // --- 6. Invoicing with no receipt: manual path supported; draft-receipt path blocked ---
  await scenario(
    "purchases: manual invoice with no PO/receipt is a supported path; from-receipt invoicing against a DRAFT receipt is refused",
    async () => {
      const start = await ctx.invariants();
      const manual = await req("POST", "/purchases/invoices", {
        id: "SCN-PI-MANUAL",
        supplierId: "SUPP-DEMO-1",
        date: "2026-08-24",
        branchId: BRANCH_ID,
        warehouseId: WAREHOUSE_ID,
        lines: [{ itemId: "ITEM-DEMO-3", kind: "inventory", qty: "20", unitCost: "32", taxRatePercent: VAT }],
      });
      check("manual invoice (no PO, no receipt) creates fine — this is a supported alternate entry point, not a skipped gate", manual.status === 201, manual.status.toString());
      const manualConfirm = await req("POST", "/purchases/invoices/SCN-PI-MANUAL/confirm", {});
      check("manual invoice confirms and posts its own stock IN", manualConfirm.status === 200 && manualConfirm.body?.status === "confirmed", manualConfirm.status.toString());
      // 20*32=640 subtotal, *1.14=729.6 total.
      checkEq("manual invoice total is 640 + 14% VAT = 729.60", n(manualConfirm.body.total), 729.6);
      const after = await ctx.invariants();
      checkEq("manual invoice posts stock+AP together — reconciliation holds", after.inventory, start.inventory);
      checkEq("AP reconciliation still holds (sub-ledger and GL both took the same +729.60)", after.ap, start.ap);

      const po = await req("POST", "/purchases/orders", {
        id: "SCN-PO-BLOCK",
        supplierId: "SUPP-DEMO-1",
        date: "2026-08-24",
        branchId: BRANCH_ID,
        warehouseId: WAREHOUSE_ID,
        lines: [{ itemId: "ITEM-DEMO-1", qty: "10", unitPrice: "145" }],
      });
      await req("POST", "/purchases/orders/SCN-PO-BLOCK/confirm", {});
      const draftReceipt = await req("POST", "/purchases/receipts", {
        id: "SCN-GRN-BLOCK",
        purchaseOrderId: "SCN-PO-BLOCK",
        date: "2026-08-24",
      });
      check("draft (unconfirmed) receipt created for the block test", po.status === 201 && draftReceipt.status === 201 && draftReceipt.body.status === "draft", draftReceipt.status.toString());

      const blocked = await req("POST", "/purchases/invoices", {
        id: "SCN-PI-BLOCKED",
        supplierId: "SUPP-DEMO-1",
        date: "2026-08-24",
        branchId: BRANCH_ID,
        warehouseId: WAREHOUSE_ID,
        receiptId: "SCN-GRN-BLOCK",
      });
      check(
        "invoicing from a DRAFT (unconfirmed) receipt is refused server-side (422) — unlike the double-invoice case, THIS gate really is enforced, not just at the UI picker",
        blocked.status === 422,
        `status ${blocked.status}: ${JSON.stringify(blocked.body).slice(0, 150)}`,
      );

      const missing = await req("POST", "/purchases/invoices", {
        id: "SCN-PI-MISSING-GRN",
        supplierId: "SUPP-DEMO-1",
        date: "2026-08-24",
        branchId: BRANCH_ID,
        warehouseId: WAREHOUSE_ID,
        receiptId: "GRN-DOES-NOT-EXIST",
      });
      check("invoicing from a nonexistent receiptId returns 404", missing.status === 404, `status ${missing.status}`);
    },
  );

  // --- 7. D10/D310 — a document may not name a branch or warehouse that does not exist ---
  await scenario(
    "purchases: D310 — PO and invoice create refuse the UI's hardcoded branchId 'MAIN'/warehouseId 'MAIN-WH', ids that do not exist in this tenant (real ids BR-MAIN/WH-MAIN); RFQ still accepts them (D10, open)",
    async () => {
      const rfq = await req("POST", "/rfqs", {
        id: "SCN-RFQ-D10",
        date: "2026-08-24",
        branchId: "MAIN",
        warehouseId: "MAIN-WH",
        lines: [{ itemId: "ITEM-DEMO-3", qty: "5", notes: null }],
      });
      check(
        "D10 (still open): RFQ create with the UI's hardcoded 'MAIN'/'MAIN-WH' succeeds silently — the RFQ route has no master-data check",
        rfq.status === 201,
        `status ${rfq.status}`,
      );

      const po = await req("POST", "/purchases/orders", {
        id: "SCN-PO-D10",
        supplierId: "SUPP-DEMO-1",
        date: "2026-08-24",
        branchId: "MAIN",
        warehouseId: "MAIN-WH",
        lines: [{ itemId: "ITEM-DEMO-3", qty: "5", unitPrice: "32" }],
      });
      check("D310: PO create with 'MAIN'/'MAIN-WH' is refused 422", po.status === 422, `status ${po.status}`);
      check(
        "D310: the PO refusal names the branch, in Arabic and English",
        po.body?.error === "BRANCH_NOT_FOUND" && typeof po.body?.message === "string" && typeof po.body?.messageEn === "string",
        JSON.stringify(po.body),
      );

      const invoice = await req("POST", "/purchases/invoices", {
        id: "SCN-PI-D10",
        supplierId: "SUPP-DEMO-1",
        date: "2026-08-24",
        branchId: "MAIN",
        warehouseId: "MAIN-WH",
        lines: [{ itemId: "ITEM-DEMO-3", kind: "inventory", qty: "5", unitCost: "32", taxRatePercent: VAT }],
      });
      check("D310: manual invoice create with 'MAIN'/'MAIN-WH' is refused 422", invoice.status === 422, `status ${invoice.status}`);

      const phantomSupplier = await req("POST", "/purchases/invoices", {
        id: "SCN-PI-D310",
        supplierId: "SUP-DEMO-1",
        date: "2026-08-24",
        branchId: "BR-MAIN",
        warehouseId: "WH-MAIN",
        lines: [{ itemId: "ITEM-DEMO-3", kind: "inventory", qty: "5", unitCost: "32", taxRatePercent: VAT }],
      });
      check(
        "D310: an invoice naming a supplier with no master record is refused 422, not posted into the aging ladder",
        phantomSupplier.status === 422 && phantomSupplier.body?.error === "SUPPLIER_NOT_FOUND",
        `status ${phantomSupplier.status} ${JSON.stringify(phantomSupplier.body)}`,
      );

      const aging = await req("GET", "/reports/aging/suppliers");
      check(
        "D310: the supplier aging ladder carries no row for the phantom supplier",
        !JSON.stringify(aging.body).includes('"SUP-DEMO-1"'),
        JSON.stringify(aging.body).slice(0, 200),
      );
    },
  );

  // --- 8. Landed costs: BY_VALUE, exact allocation, unit-cost bump ---------
  await scenario("purchases: landed cost BY_VALUE allocation sums EXACTLY to the total entered and raises each target's unit cost by its share", async () => {
    const invoice = await req("POST", "/purchases/invoices", {
      id: "SCN-PI-LC1",
      supplierId: "SUPP-DEMO-1",
      date: "2026-08-24",
      branchId: BRANCH_ID,
      warehouseId: WAREHOUSE_ID,
      lines: [
        { itemId: "ITEM-DEMO-1", kind: "inventory", qty: "100", unitCost: "140", taxRatePercent: VAT },
        { itemId: "ITEM-DEMO-3", kind: "inventory", qty: "300", unitCost: "31", taxRatePercent: VAT },
      ],
    });
    check("source invoice for landed cost created", invoice.status === 201, invoice.status.toString());
    const invConfirm = await req("POST", "/purchases/invoices/SCN-PI-LC1/confirm", {});
    check("source invoice confirmed (posts its own stock IN — manual, no receipt)", invConfirm.status === 200, invConfirm.status.toString());

    const beforeRice = await itemBalance("ITEM-DEMO-1");
    const beforeSugar = await itemBalance("ITEM-DEMO-3");

    // Reproduces LC-DEMO-1's exact numbers: rice 100@140=14,000, sugar 300@31=9,300 (total value 23,300); SHIPPING 1,800 + CLEARANCE 700 = 2,500.
    const lc = await req("POST", "/landed-costs", {
      id: "SCN-LC-1",
      date: "2026-08-24",
      memo: "شحن وتخليص — سيناريو تنفيذي",
      distributionMethod: "BY_VALUE",
      costItems: [
        { costType: "SHIPPING", description: "نقل بري", amount: "1800" },
        { costType: "CLEARANCE", description: "تخليص جمركي", amount: "700" },
      ],
      targets: [
        { itemId: "ITEM-DEMO-1", warehouseId: WAREHOUSE_ID, sourceInvoiceId: "SCN-PI-LC1", sourceInvoiceNumber: null, qty: "100", unitCost: "140" },
        { itemId: "ITEM-DEMO-3", warehouseId: WAREHOUSE_ID, sourceInvoiceId: "SCN-PI-LC1", sourceInvoiceNumber: null, qty: "300", unitCost: "31" },
      ],
    });
    check("landed cost document created as draft", lc.status === 201 && lc.body.status === "draft", lc.status.toString());
    const l1 = lc.body.lines.find((l: any) => l.itemId === "ITEM-DEMO-1");
    const l2 = lc.body.lines.find((l: any) => l.itemId === "ITEM-DEMO-3");
    checkEq("allocated amounts sum EXACTLY to the 2,500 entered (no rounding leak)", n(l1.allocatedAmount) + n(l2.allocatedAmount), 2500, 0.0001);
    check(
      "rice's allocation is close to its by-value share (14,000/23,300 * 2,500 ≈ 1,502.15)",
      Math.abs(n(l1.allocatedAmount) - (2500 * 14000) / 23300) < 0.5,
      `allocated ${l1.allocatedAmount}`,
    );
    checkEq("rice's new unit cost = old unit cost + allocated/qty", n(l1.newUnitCost), 140 + n(l1.allocatedAmount) / 100, 0.001);
    checkEq("sugar's new unit cost = old unit cost + allocated/qty", n(l2.newUnitCost), 31 + n(l2.allocatedAmount) / 300, 0.001);

    const beforeConfirm = await ctx.invariants();
    const lcConfirm = await req("POST", "/landed-costs/SCN-LC-1/confirm", {});
    check("landed cost confirms and applies the revaluation", lcConfirm.status === 200 && lcConfirm.body?.document?.status === "confirmed", JSON.stringify(lcConfirm.body).slice(0, 150));

    const afterRice = await itemBalance("ITEM-DEMO-1");
    const afterSugar = await itemBalance("ITEM-DEMO-3");
    checkEq("rice's inventory VALUE rose by exactly its allocated amount (independent /inventory/balance check)", afterRice.totalValue - beforeRice.totalValue, n(l1.allocatedAmount), 0.01);
    checkEq("sugar's inventory VALUE rose by exactly its allocated amount", afterSugar.totalValue - beforeSugar.totalValue, n(l2.allocatedAmount), 0.01);

    const afterConfirm = await ctx.invariants();
    checkEq("inventory still reconciles to GL 1200 after the landed cost (Dr Inventory/Cr AP is balanced)", afterConfirm.inventory, beforeConfirm.inventory);
    // A LandedCostLine denormalizes the FULL costItems array onto every target
    // line, so the AP sub-ledger must count the document's total ONCE, not once
    // per line — summing per line credited 5,000 against a GL 2100 movement of
    // 2,500 for this two-line document (fixed in 4acf10f / F14).
    checkEq(
      "a multi-line landed cost leaves AP reconciled — its total counted once per document, not once per line",
      afterConfirm.ap - beforeConfirm.ap,
      0,
    );
  });

  // --- 8b. Landed cost that lands AFTER the goods were sold (D84) ---------
  /**
   * The freight invoice usually arrives weeks after the shipment, by which
   * time some of it has been sold. Only the units still on hand can carry the
   * cost; the rest is a period cost. Debiting the whole amount to GL 1200 left
   * the ledger above the valuation report by exactly the difference, forever.
   */
  await scenario("purchases: a landed cost booked after part of the goods were sold reclassifies the unabsorbed share to COGS, and GL 1200 still equals the valuation report", async () => {
    // Its own item, so the position holds this receipt and nothing else — a
    // shared item's earlier layers would absorb the whole cost and hide the case.
    const item = await req("POST", "/items", {
      id: "SCN-ITEM-LC-LATE",
      code: "SCN-ITEM-LC-LATE",
      nameAr: "صنف تكلفة إضافية متأخرة",
      type: "stock",
      baseUnitCode: "PCS",
      trackInventory: true,
      revenueAccountId: "4100",
      cogsAccountId: "5100",
      inventoryAccountId: "1200",
    });
    check("a dedicated item for the late landed cost", item.status === 201, item.status.toString());

    const invoice = await req("POST", "/purchases/invoices", {
      id: "SCN-PI-LC-LATE",
      supplierId: "SUPP-DEMO-1",
      date: "2026-08-24",
      branchId: BRANCH_ID,
      warehouseId: WAREHOUSE_ID,
      lines: [{ itemId: "SCN-ITEM-LC-LATE", kind: "inventory", qty: "100", unitCost: "100", taxRatePercent: VAT }],
    });
    check("source invoice for the late landed cost created", invoice.status === 201, invoice.status.toString());
    const invConfirm = await req("POST", "/purchases/invoices/SCN-PI-LC-LATE/confirm", {});
    check("source invoice confirmed", invConfirm.status === 200, invConfirm.status.toString());

    const beforeIssue = await itemBalance("SCN-ITEM-LC-LATE");
    // 60 of the 100 leave before the freight invoice arrives.
    const issue = await req("POST", "/inventory/adjustments", {
      adjustmentId: "SCN-ADJ-LC-LATE",
      warehouseId: WAREHOUSE_ID,
      reason: "SHORTAGE",
      lines: [{ itemId: "SCN-ITEM-LC-LATE", direction: "OUT", qty: "60" }],
    });
    check("60 of the 100 pieces leave before the freight invoice arrives", issue.status === 201, issue.status.toString());

    const cogsBefore = await accountBalance("5100");
    const lc = await req("POST", "/landed-costs", {
      id: "SCN-LC-LATE",
      date: "2026-08-24",
      memo: "شحن متأخر — بعد بيع جزء من البضاعة",
      distributionMethod: "BY_VALUE",
      costItems: [{ costType: "SHIPPING", description: "نقل بري", amount: "1000" }],
      targets: [
        { itemId: "SCN-ITEM-LC-LATE", warehouseId: WAREHOUSE_ID, sourceInvoiceId: "SCN-PI-LC-LATE", sourceInvoiceNumber: null, qty: "100", unitCost: "100" },
      ],
    });
    check("late landed cost created as a draft", lc.status === 201 && lc.body?.status === "draft", lc.status.toString());

    const beforeValue = (await itemBalance("SCN-ITEM-LC-LATE")).totalValue;
    const confirm = await req("POST", "/landed-costs/SCN-LC-LATE/confirm", {});
    check("late landed cost confirms", confirm.status === 200, JSON.stringify(confirm.body).slice(0, 200));

    // The whole 1,000 was allocated to this one line, but the position holds
    // only what the earlier receipts left. Whatever the layers could not
    // absorb is reported, and it is the same figure the valuation report
    // failed to rise by.
    const unabsorbed = n(confirm.body?.unabsorbedTotal);
    const afterValue = (await itemBalance("SCN-ITEM-LC-LATE")).totalValue;
    check("part of the late landed cost could NOT be capitalised", unabsorbed > 0, `unabsorbed ${unabsorbed}`);
    checkEq("the valuation report rose by exactly the part the stock could absorb", afterValue - beforeValue, 1000 - unabsorbed, 0.000001);
    check(
      "the reclassification is a real posted entry, named on the response",
      confirm.body?.unabsorbedJournalEntryId === "SCN-LC-LATE:UNABSORBED",
      String(confirm.body?.unabsorbedJournalEntryId),
    );
    checkEq("and COGS 5100 carries exactly the unabsorbed share", (await accountBalance("5100")) - cogsBefore, unabsorbed, 0.000001);
    // The scenario harness asserts `inventory` — the stock valuation minus GL
    // 1200 — is unchanged either side of every scenario, so a 1200 that ran
    // ahead of the valuation report by the unabsorbed figure fails right here.
    check("the goods really had left before the cost landed", beforeIssue.onHand > 0, `on hand before the issue ${beforeIssue.onHand}`);
  });

  // --- 9. Landed costs: BY_QUANTITY on the seeded draft LC-DEMO-2 ---------
  await scenario("purchases: landed cost BY_QUANTITY (LC-DEMO-2) allocates 100% of the total to its single target", async () => {
    const lc = await req("GET", "/landed-costs/LC-DEMO-2");
    check("LC-DEMO-2 is still draft (seeded that way)", lc.body?.status === "draft", lc.body?.status);
    const line = lc.body.lines[0];
    checkEq("single target (oil, qty 120) already computed allocatedAmount=750 at create time", n(line.allocatedAmount), 750);
    checkEq("new unit cost = 72 + 750/120 = 78.25", n(line.newUnitCost), 78.25);

    const before = await itemBalance("ITEM-DEMO-2");
    const beforeInv = await ctx.invariants();
    const confirm = await req("POST", "/landed-costs/LC-DEMO-2/confirm", {});
    check("LC-DEMO-2 confirms", confirm.status === 200 && confirm.body?.document?.status === "confirmed", JSON.stringify(confirm.body).slice(0, 150));

    const after = await itemBalance("ITEM-DEMO-2");
    checkEq("oil's inventory value rose by exactly 750 (independent /inventory/balance check)", after.totalValue - before.totalValue, 750, 0.01);
    const afterInv = await ctx.invariants();
    checkEq("inventory still reconciles to GL 1200", afterInv.inventory, beforeInv.inventory);
    // Unlike scenario 8's 2-target-line landed cost, LC-DEMO-2 has exactly ONE target line, so the
    // create-backend.ts double-counting bug can't manifest (summing the total "per line" is correct
    // when there's only one line) — AP sub-ledger and GL both take the same +750, so the reconciliation
    // diff itself stays flat, proving the bug is specifically about line COUNT, not landed costs generally.
    checkEq("AP still reconciles (single target line — GL 2100 and the sub-ledger both moved by the same +750)", afterInv.ap, beforeInv.ap);
  });

  // --- 10. The documented no-GL-entry gap on a confirmed-but-uninvoiced receipt ---
  await scenario(
    "purchases: confirming GRN-DEMO-3 posts Dr inventory / Cr بضاعة واردة لم تُفوتر, and invoicing it moves the liability to the supplier (D53 fixed)",
    async () => {
      const before = await req("GET", "/purchases/receipts/GRN-DEMO-3");
      check("GRN-DEMO-3 starts draft and uninvoiced (seeded that way on purpose)", before.body?.status === "draft" && before.body?.invoiced === false, JSON.stringify(before.body).slice(0, 120));

      const start = await ctx.invariants();
      const confirm = await req("POST", "/purchases/receipts/GRN-DEMO-3/confirm", {});
      check("GRN-DEMO-3 confirms", confirm.status === 200 && confirm.body?.status === "confirmed", confirm.status.toString());

      const po = await req("GET", "/purchases/orders/PO-DEMO-4");
      check("PO-DEMO-4 (sugar's only PO) advances to fully_received", po.body?.status === "fully_received", po.body?.status);

      const afterReceipt = await ctx.invariants();
      // 250 sugar @ 31 = 7,750, matching GRN-DEMO-3's totalCost. That value now
      // reaches the GL as it moves: this scenario used to assert the sub-ledger
      // running 7,750 ahead of its control account and called it correct.
      checkEq(
        "the sub-ledger does NOT run ahead of GL 1200 any more — receiving posts the asset and the obligation together",
        afterReceipt.inventory,
        start.inventory,
      );
      const receiptEntry = (await ctx.allRows("/gl/journal-entries?sourceModule=purchases")).find((e: any) => e.sourceDocId === "GRN-DEMO-3");
      checkEq("crediting بضاعة واردة لم تُفوتر by the goods' value", n(receiptEntry?.lines?.find((l: any) => l.accountId === "2120")?.credit), 7750);

      const invoice = await req("POST", "/purchases/invoices", {
        id: "SCN-PI-GRN3",
        supplierId: before.body.supplierId,
        date: "2026-08-24",
        branchId: BRANCH_ID,
        warehouseId: WAREHOUSE_ID,
        receiptId: "GRN-DEMO-3",
        lines: [{ itemId: "ITEM-DEMO-3", kind: "inventory", qty: "250", unitCost: "31", taxRatePercent: VAT }],
      });
      check("from-receipt invoice against the now-confirmed GRN-DEMO-3 creates fine", invoice.status === 201, invoice.status.toString());
      const invConfirm = await req("POST", "/purchases/invoices/SCN-PI-GRN3/confirm", {});
      check("invoice confirms, closing the gap", invConfirm.status === 200 && invConfirm.body?.status === "confirmed", invConfirm.status.toString());

      const afterInvoice = await ctx.invariants();
      checkEq("the books stay reconciled through the invoice too", afterInvoice.inventory, start.inventory);
      const invoiceEntry = (await ctx.allRows("/gl/journal-entries?sourceModule=purchases")).find((e: any) => e.sourceDocId === "SCN-PI-GRN3");
      checkEq("and the invoice DEBITS 2120, clearing what the receipt credited", n(invoiceEntry?.lines?.find((l: any) => l.accountId === "2120")?.debit), 7750);
      check(
        "without debiting inventory a second time — the receipt already owns that debit",
        !(invoiceEntry?.lines ?? []).some((l: any) => l.accountId === "1200" && n(l.debit) > 0),
        JSON.stringify(invoiceEntry?.lines),
      );
    },
  );

  // --- 11. R4.4: per-line delivery is read from the stock ledger, never stored ---
  await scenario(
    "purchases: a purchase invoice reports received / consumed / still-in-stock per line, and moving the goods out moves those figures",
    async () => {
      const manual = await req("GET", "/purchases/invoices/PI-DEMO-1");
      check(
        "PI-DEMO-1 is a manual (no-receipt) confirmed invoice, so it funds its own cost layers",
        manual.body?.receiptId === null && manual.body?.status === "confirmed",
        JSON.stringify({ receiptId: manual.body?.receiptId, status: manual.body?.status }),
      );

      const f = await req("GET", "/purchases/invoices/PI-DEMO-1/fulfilment");
      check("its per-line delivery reads back", f.status === 200, `status ${f.status} ${JSON.stringify(f.body).slice(0, 200)}`);
      check("the source document it measures against is the invoice itself", f.body?.sourceDocType === "PURCHASE_INVOICE", String(f.body?.sourceDocType));

      const line0 = (f.body?.lines ?? [])[0];
      checkEq("line 0 was received in full — a manual invoice IS the receiving document", n(line0?.receivedQty), n(manual.body?.lines?.[0]?.qty));
      checkEq(
        "received = consumed + still in stock on every line — the identity that makes the figure trustworthy rather than decorative",
        (f.body?.lines ?? []).filter((l: any) => Math.abs(n(l.receivedQty) - n(l.consumedQty) - n(l.remainingQty)) > 0.000001).length,
        0,
      );

      // Move some of those goods out of the invoice's warehouse; the same line
      // must then report more consumed and less remaining, with received flat.
      const consumedBefore = n(line0?.consumedQty);
      const remainingBefore = n(line0?.remainingQty);
      const draft = await req("POST", "/inventory/stock-transfers/draft", {
        id: "SCN-PI-CONSUME",
        date: "2026-08-26",
        lines: [{ itemId: "ITEM-DEMO-1", fromWarehouseId: WAREHOUSE_ID, toWarehouseId: "WH-DEMO-2", qty: "5" }],
      });
      check("a transfer of 5 out of the invoice's warehouse drafts", draft.status === 201, `status ${draft.status} ${JSON.stringify(draft.body).slice(0, 200)}`);
      const moved = await req("POST", "/inventory/stock-transfers/SCN-PI-CONSUME/confirm", {});
      check("and confirms", moved.status === 200, `status ${moved.status} ${JSON.stringify(moved.body).slice(0, 200)}`);

      const after = await req("GET", "/purchases/invoices/PI-DEMO-1/fulfilment");
      const line0After = (after.body?.lines ?? [])[0];
      checkEq("moving 5 out raises the line's consumed quantity by exactly 5", n(line0After?.consumedQty) - consumedBefore, 5);
      checkEq("and drops what is still in stock from that purchase by the same 5", remainingBefore - n(line0After?.remainingQty), 5);
      checkEq("received never moves — what arrived is history", n(line0After?.receivedQty), n(line0?.receivedQty));
    },
  );

  // --- 12. R4.4: paying off the invoice posts a real voucher -------------------
  await scenario(
    "purchases: «تسجيل السداد» on a purchase invoice creates a confirmed payment voucher — the treasury falls and the payable drops by the same amount",
    async () => {
      const before = await req("GET", "/purchases/invoices/PI-DEMO-4");
      check("PI-DEMO-4 is confirmed and unpaid", before.body?.status === "confirmed" && n(before.body?.amountPaid) === 0, JSON.stringify(before.body?.amountPaid));

      const cashBefore = n((await req("GET", "/gl/accounts/1300-1/ledger")).body?.balance?.balance);
      const apBefore = -n((await req("GET", "/gl/accounts/2100/ledger")).body?.balance?.balance);

      const paid = await req("POST", "/purchases/invoices/PI-DEMO-4/payments", {
        amount: "1200.00",
        treasuryAccountId: "TR-DEMO-CASH",
        paymentMethod: "cash",
      });
      check("the payment is accepted", paid.status === 200, `status ${paid.status} ${JSON.stringify(paid.body).slice(0, 200)}`);
      check(
        "and it names the voucher it created — a status that says money moved must have a document behind it (the D40 shape, on the purchase side)",
        typeof paid.body?.voucherId === "string" && paid.body.voucherId.length > 0,
        JSON.stringify(paid.body?.voucherId),
      );

      const cashAfter = n((await req("GET", "/gl/accounts/1300-1/ledger")).body?.balance?.balance);
      const apAfter = -n((await req("GET", "/gl/accounts/2100/ledger")).body?.balance?.balance);
      checkEq("the خزنة falls by exactly what was paid", cashBefore - cashAfter, 1200);
      checkEq("and the payable falls by the same 1,200 — the two sides of one voucher", apBefore - apAfter, 1200);

      const after = await req("GET", "/purchases/invoices/PI-DEMO-4");
      checkEq("the invoice now reports 1,200 paid", n(after.body?.amountPaid), 1200);
      checkEq("and the rest still outstanding", n(after.body?.remainingBalance), n(before.body?.total) - 1200);

      const over = await req("POST", "/purchases/invoices/PI-DEMO-4/payments", {
        amount: "9999999.00",
        treasuryAccountId: "TR-DEMO-CASH",
      });
      checkEq("paying more than the invoice still owes is refused server-side, not merely hidden in the form", over.status, 422);

      const draft = await req("POST", "/purchases/invoices", {
        id: "SCN-PI-UNPAYABLE",
        supplierId: "SUPP-DEMO-1",
        date: "2026-08-26",
        branchId: BRANCH_ID,
        warehouseId: WAREHOUSE_ID,
        lines: [{ itemId: "ITEM-DEMO-1", kind: "inventory", qty: "1", unitCost: "100", taxRatePercent: 0 }],
      });
      check("a fresh draft invoice exists to test against", draft.status === 201, `status ${draft.status}`);
      const draftPay = await req("POST", "/purchases/invoices/SCN-PI-UNPAYABLE/payments", {
        amount: "10.00",
        treasuryAccountId: "TR-DEMO-CASH",
      });
      checkEq("a draft invoice cannot be paid — the payable does not exist in the ledger yet", draftPay.status, 422);
    },
  );

  // --- 13. R4.2: the three line types each debit their own account -------------
  await scenario(
    "purchases: stock / expense / freight lines on one invoice land in three different accounts, and all three are owed to the supplier",
    async () => {
      const glBal = async (code: string) => n((await req("GET", `/gl/accounts/${code}/ledger`)).body?.balance?.balance);
      const inventoryBefore = await glBal("1200");
      const freightBefore = await glBal("5200");
      const expenseBefore = await glBal("5910");
      const apBefore = -(await glBal("2100"));

      const created = await req("POST", "/purchases/invoices", {
        id: "SCN-PI-KINDS",
        supplierId: "SUPP-DEMO-1",
        date: "2026-08-26",
        branchId: BRANCH_ID,
        warehouseId: WAREHOUSE_ID,
        lines: [
          { itemId: "ITEM-DEMO-1", kind: "inventory", qty: "10", unitCost: "100", taxRatePercent: 0 },
          { itemId: null, kind: "freight", description: "نولون بحري", qty: "1", unitCost: "300", taxRatePercent: 0 },
          { itemId: null, kind: "expense", description: "رسوم بنكية على الاعتماد", qty: "1", unitCost: "200", taxRatePercent: 0 },
        ],
      });
      check("an invoice carrying all three line types drafts", created.status === 201, `status ${created.status} ${JSON.stringify(created.body).slice(0, 200)}`);
      check(
        "and keeps each line's own type — the line-kind enum is three-valued, not two (R4.2)",
        (created.body?.lines ?? []).map((l: any) => l.kind).join(",") === "inventory,freight,expense",
        (created.body?.lines ?? []).map((l: any) => l.kind).join(","),
      );
      checkEq("the supplier is owed all three: 1,000 + 300 + 200", n(created.body?.total), 1500);

      const confirmed = await req("POST", "/purchases/invoices/SCN-PI-KINDS/confirm", {});
      check("it confirms", confirmed.status === 200, `status ${confirmed.status} ${JSON.stringify(confirmed.body).slice(0, 200)}`);

      checkEq("only the stock line raises inventory (1200)", (await glBal("1200")) - inventoryBefore, 1000);
      checkEq("the freight line debits مصروفات الشحن والنقل (5200)", (await glBal("5200")) - freightBefore, 300);
      checkEq(
        "and the expense line debits مصروفات أخرى (5910) rather than being binned into freight, which is what every non-stock line used to do",
        (await glBal("5910")) - expenseBefore,
        200,
      );
      checkEq("the payable takes the whole 1,500 — how a cost is classified never changes what is owed", (-(await glBal("2100"))) - apBefore, 1500);
    },
  );
  // --- R4.6: the goods-receipt gate follows the tenant setting, in BOTH positions ---
  await scenario(
    "purchases (R4.6): «إلزام أمر الشراء قبل الاستلام» actually gates the goods receipt — refused when on, allowed when off",
    async () => {
      const original = (await req("GET", "/settings")).body as Record<string, unknown>;
      try {
        // Position 1: policy ON — a PO-less receipt must be refused, by the
        // SETTING and not by a hardcoded constant.
        const on = await req("PUT", "/settings", { ...original, requirePoForGrn: true });
        check("the require-PO policy can be switched on", on.status === 200 && on.body?.requirePoForGrn === true, JSON.stringify(on.body?.requirePoForGrn));

        const refused = await req("POST", "/purchases/receipts", {
          id: "SCN-GRN-POLICY-1",
          date: "2026-08-24",
          supplierId: "SUPP-DEMO-1",
          warehouseId: WAREHOUSE_ID,
          lines: [{ itemId: "ITEM-DEMO-3", qty: "3", unitCost: "31" }],
        });
        checkEq("with the policy ON an ad-hoc receipt is refused 422", refused.status, 422);
        check(
          "and the refusal names the gate (PURCHASE_ORDER_REQUIRED), not a generic validation error",
          refused.body?.error === "PURCHASE_ORDER_REQUIRED",
          String(refused.body?.error),
        );
        check(
          "the refusal reaches an Arabic UI in Arabic",
          typeof refused.body?.message === "string" && /[؀-ۿ]/.test(refused.body.message),
          String(refused.body?.message).slice(0, 80),
        );
        const afterRefusal = await req("GET", "/purchases/receipts/SCN-GRN-POLICY-1");
        checkEq("nothing was persisted by the refused request", afterRefusal.status, 404);

        // Position 2: policy OFF — the SAME request must now succeed. A gate
        // that refuses in both positions is a hardcoded `true` wearing a
        // setting's name.
        const off = await req("PUT", "/settings", { ...original, requirePoForGrn: false });
        check("the require-PO policy can be switched off", off.status === 200 && off.body?.requirePoForGrn === false, JSON.stringify(off.body?.requirePoForGrn));

        const allowed = await req("POST", "/purchases/receipts", {
          id: "SCN-GRN-POLICY-1",
          date: "2026-08-24",
          supplierId: "SUPP-DEMO-1",
          warehouseId: WAREHOUSE_ID,
          lines: [{ itemId: "ITEM-DEMO-3", qty: "3", unitCost: "31" }],
        });
        checkEq("with the policy OFF the identical ad-hoc receipt is created", allowed.status, 201);
        check("and it is genuinely PO-less", allowed.body?.purchaseOrderId === null, JSON.stringify(allowed.body?.purchaseOrderId));
        check("carrying the supplier the caller named", allowed.body?.supplierId === "SUPP-DEMO-1", String(allowed.body?.supplierId));
      } finally {
        // Leave the tenant as it was found — a later suite measured behind a
        // flipped policy is a journey that stopped halfway.
        await req("PUT", "/settings", original);
      }
      const restored = await req("GET", "/settings");
      check("the tenant's own policy is restored", restored.body?.requirePoForGrn === original.requirePoForGrn, String(restored.body?.requirePoForGrn));
    },
  );

  // --- R4.7: every allocation basis distributes to the cent, with no drift ---
  await scenario(
    "purchases (R4.7): BY_VALUE, BY_QUANTITY and BY_WEIGHT each allocate a landed cost EXACTLY, to the cent, on a total that does not divide evenly",
    async () => {
      const invoice = await req("POST", "/purchases/invoices", {
        id: "SCN-PI-BASIS",
        supplierId: "SUPP-DEMO-1",
        date: "2026-08-24",
        branchId: BRANCH_ID,
        warehouseId: WAREHOUSE_ID,
        lines: [
          { itemId: "ITEM-DEMO-1", kind: "inventory", qty: "7", unitCost: "13", taxRatePercent: VAT },
          { itemId: "ITEM-DEMO-2", kind: "inventory", qty: "11", unitCost: "17", taxRatePercent: VAT },
          { itemId: "ITEM-DEMO-3", kind: "inventory", qty: "13", unitCost: "19", taxRatePercent: VAT },
        ],
      });
      checkEq("a three-line source invoice for the basis comparison is created", invoice.status, 201);
      checkEq("and confirms", (await req("POST", "/purchases/invoices/SCN-PI-BASIS/confirm", {})).status, 200);

      // 1,000.01 across three lines on prime quantities: no basis divides it
      // evenly, so a naive per-line round leaves a residue. Largest-remainder
      // must place every last piastre.
      const TOTAL = 1000.01;
      const targets = [
        { itemId: "ITEM-DEMO-1", warehouseId: WAREHOUSE_ID, sourceInvoiceId: "SCN-PI-BASIS", sourceInvoiceNumber: null, qty: "7", unitCost: "13", weight: "3" },
        { itemId: "ITEM-DEMO-2", warehouseId: WAREHOUSE_ID, sourceInvoiceId: "SCN-PI-BASIS", sourceInvoiceNumber: null, qty: "11", unitCost: "17", weight: "5" },
        { itemId: "ITEM-DEMO-3", warehouseId: WAREHOUSE_ID, sourceInvoiceId: "SCN-PI-BASIS", sourceInvoiceNumber: null, qty: "13", unitCost: "19", weight: "7" },
      ];

      const bases: { method: string; id: string; weights: number[] }[] = [
        { method: "BY_VALUE", id: "SCN-LC-BASIS-V", weights: [7 * 13, 11 * 17, 13 * 19] },
        { method: "BY_QUANTITY", id: "SCN-LC-BASIS-Q", weights: [7, 11, 13] },
        { method: "BY_WEIGHT", id: "SCN-LC-BASIS-W", weights: [3, 5, 7] },
      ];

      for (const basis of bases) {
        const doc = await req("POST", "/landed-costs", {
          id: basis.id,
          date: "2026-08-24",
          memo: `توزيع ${basis.method}`,
          distributionMethod: basis.method,
          costItems: [
            { costType: "SHIPPING", description: "شحن", amount: "600.01" },
            { costType: "CUSTOMS", description: "جمارك", amount: "400" },
          ],
          targets,
        });
        checkEq(`${basis.method}: the landed cost document is created`, doc.status, 201);

        const raw: string[] = (doc.body?.lines ?? []).map((l: any) => String(l.allocatedAmount));
        const allocated = raw.map((v) => n(v));
        // Summed as scaled INTEGERS, the way the ledger holds them — adding the
        // decoded floats would be the very drift this is meant to catch.
        const scaled = raw.map((v) => {
          const [whole = "0", frac = ""] = v.split(".");
          return BigInt(whole + frac.padEnd(6, "0").slice(0, 6));
        });
        check(
          `${basis.method}: the allocated parts sum EXACTLY to the ${TOTAL} entered — nothing lost, nothing invented`,
          scaled.reduce((a, b) => a + b, 0n) === 1_000_010_000n,
          raw.join(" · "),
        );
        check(
          `${basis.method}: every part is an exact 6-decimal amount, never a float`,
          raw.every((v) => /^\d+\.\d{6}$/.test(v)),
          raw.join(" · "),
        );

        const weightTotal = basis.weights.reduce((s, v) => s + v, 0);
        basis.weights.forEach((w, i) => {
          check(
            `${basis.method}: line ${i + 1} takes its own share of the basis (within one piastre of ${TOTAL} × ${w}/${weightTotal})`,
            Math.abs(allocated[i] - (TOTAL * w) / weightTotal) <= 0.01,
            `allocated ${allocated[i]}`,
          );
        });

        // The basis is what makes them different — a BY_WEIGHT document whose
        // split equals the BY_VALUE one would mean the field is decorative.
        doc.body.lines.forEach((l: any, i: number) => {
          checkEq(
            `${basis.method}: line ${i + 1}'s new unit cost = old + allocated ÷ qty`,
            n(l.newUnitCost),
            n(l.unitCost) + n(l.allocatedAmount) / n(l.qty),
            0.000001,
          );
          check(`${basis.method}: the persisted line records the basis it was allocated under`, l.distributionMethod === basis.method, l.distributionMethod);
        });
      }

      const byValue = (await req("GET", "/landed-costs/SCN-LC-BASIS-V")).body.lines.map((l: any) => l.allocatedAmount).join(",");
      const byQty = (await req("GET", "/landed-costs/SCN-LC-BASIS-Q")).body.lines.map((l: any) => l.allocatedAmount).join(",");
      const byWeight = (await req("GET", "/landed-costs/SCN-LC-BASIS-W")).body.lines.map((l: any) => l.allocatedAmount).join(",");
      check("the three bases genuinely produce three different splits", byValue !== byQty && byQty !== byWeight && byValue !== byWeight, `${byValue} | ${byQty} | ${byWeight}`);

      // Confirming one of them must move the stock value by exactly what it
      // allocated, and leave the sub-ledger reconciled to GL 1200.
      const beforeInv = await ctx.invariants();
      const before1 = await itemBalance("ITEM-DEMO-1");
      const confirm = await req("POST", "/landed-costs/SCN-LC-BASIS-W/confirm", {});
      checkEq("the BY_WEIGHT document confirms", confirm.status, 200);
      const w1 = n((await req("GET", "/landed-costs/SCN-LC-BASIS-W")).body.lines[0].allocatedAmount);
      const after1 = await itemBalance("ITEM-DEMO-1");
      checkEq("the first line's stock VALUE rose by exactly its by-weight allocation", after1.totalValue - before1.totalValue, w1, 0.0000005);
      const afterInv = await ctx.invariants();
      checkEq("and the inventory sub-ledger still reconciles to GL 1200 exactly", afterInv.inventory, beforeInv.inventory);

      // The two unconfirmed drafts must not have moved anything.
      await req("POST", "/landed-costs/SCN-LC-BASIS-V/cancel", {});
      await req("POST", "/landed-costs/SCN-LC-BASIS-Q/cancel", {});
      const afterCancel = await ctx.invariants();
      checkEq("cancelling the two unconfirmed drafts changes nothing — a draft cost has revalued no stock", afterCancel.inventory, afterInv.inventory);
    },
  );

  // --- R4.7: a typed cost line keeps its type all the way to the document ---
  await scenario(
    "purchases (R4.7): a landed cost's typed lines survive onto the document, and their types sum to the total",
    async () => {
      const doc = await req("GET", "/landed-costs/SCN-LC-BASIS-W");
      const costItems = doc.body?.lines?.[0]?.costItems ?? [];
      checkEq("both entered cost lines are on the document", costItems.length, 2);
      check(
        "each keeps its own نوع التكلفة rather than collapsing into one bucket",
        costItems.map((c: any) => c.costType).join(",") === "SHIPPING,CUSTOMS",
        costItems.map((c: any) => c.costType).join(","),
      );
      checkEq(
        "and the typed amounts sum to the document's total cost",
        costItems.reduce((s: number, c: any) => s + n(c.amount), 0),
        1000.01,
        0.0000005,
      );
    },
  );

  // --- R9.1: a shop-floor action records the station and the operator -------
  await scenario(
    "manufacturing (R9.1): a work order's issue records محطة العمل and المشغّل, and the movement it produced reports both",
    async () => {
      const stations = await req("GET", "/manufacturing/work-stations");
      check("the work-station registry answers with the seeded stations", stations.status === 200 && rows(stations.body).length > 0, `${stations.status} / ${rows(stations.body).length}`);
      const station = rows(stations.body).find((w: any) => w.id === "WST-DEMO-1");
      check("WST-DEMO-1 (خط الخلط) is one of them", station !== undefined, JSON.stringify(rows(stations.body).map((w: any) => w.id)));

      const activity = await req("GET", "/manufacturing/work-orders/WO-DEMO-4/activity");
      checkEq("the completed demo run's activity feed answers", activity.status, 200);
      const movements = activity.body?.movements ?? [];
      check("it produced material movements", movements.length > 0, String(movements.length));
      check(
        "and every one of them names the station it happened at",
        movements.every((m: any) => m.stationId !== null),
        movements.map((m: any) => m.stationId).join(","),
      );
      check(
        "with the station's own name resolved from the registry, not the raw id",
        movements.every((m: any) => m.stationName !== null && m.stationName !== m.stationId),
        movements.map((m: any) => m.stationName).join(","),
      );
      check(
        "and the operator who performed it",
        movements.every((m: any) => m.operatorId !== null && m.operatorName !== null),
        movements.map((m: any) => `${m.operatorId}=${m.operatorName}`).join(","),
      );
      const receipts = activity.body?.receipts ?? [];
      check("the finished-goods receipt carries the same two dimensions", receipts.length > 0 && receipts.every((m: any) => m.stationId !== null && m.operatorId !== null), JSON.stringify(receipts.map((m: any) => [m.stationId, m.operatorId])));

      // The seeded run issued at خط الخلط and returned at خط التعبئة, within the
      // same millisecond. Joining the attribution on the timestamp reported the
      // LAST station on every row; the join is on the movement's own reference.
      //
      // Partitioned by that reference, NOT by direction: since D63 gave WIP a
      // physical address an issue is a transfer and produces two legs — an OUT
      // of the raw store and an IN to مستودع التشغيل — so "OUT" no longer means
      // "issue" and "IN" no longer means "return".
      const startingWith = (...prefixes: string[]) =>
        movements.filter((m: any) => prefixes.some((p) => m.id.startsWith(p)));
      const issued = startingWith("WO-ISSUE:WO-DEMO-4", "WO-XISSUE:WO-DEMO-4");
      const returned = startingWith("WO-RETURN:WO-DEMO-4");
      check(
        "the issues are attributed to the station they were actually made at (WST-DEMO-1), not to whichever action happened to be logged last",
        issued.length > 0 && issued.every((m: any) => m.stationId === "WST-DEMO-1" && m.operatorId === "EMP-DEMO-3"),
        issued.map((m: any) => `${m.id}=${m.stationId}/${m.operatorId}`).join(" · "),
      );
      check(
        "and the return to its own station (WST-DEMO-2) and operator — two actions one millisecond apart keep two attributions",
        returned.length > 0 && returned.every((m: any) => m.stationId === "WST-DEMO-2" && m.operatorId === "EMP-DEMO-4"),
        returned.map((m: any) => `${m.id}=${m.stationId}/${m.operatorId}`).join(" · "),
      );

      // D63 — issuing material moves it to a PLACE, it does not delete it. Every
      // issue leg leaves WH-MAIN and lands in WH-WIP, so the quantity standing on
      // the floor is something a stock count can be held against.
      const issueOut = issued.filter((m: any) => m.direction.toUpperCase() === "OUT");
      const issueIn = issued.filter((m: any) => m.direction.toUpperCase() === "IN");
      check(
        "issuing material is a TRANSFER: every OUT of the raw store has a matching IN to مستودع التشغيل",
        issueOut.length > 0 && issueOut.length === issueIn.length,
        `${issueOut.length} out / ${issueIn.length} in`,
      );
      check(
        "and the IN leg lands in the work order's WIP warehouse, not back where it came from",
        issueIn.length > 0 && issueIn.every((m: any) => m.warehouseId === "WH-WIP"),
        issueIn.map((m: any) => `${m.id}@${m.warehouseId}`).join(" · "),
      );

      // The ids are checked against their registries, not trusted.
      const bogusStation = await req("POST", "/manufacturing/work-orders/WO-DEMO-2/issue", { stationId: "WST-DOES-NOT-EXIST" });
      checkEq("an issue naming a station that does not exist is refused", bogusStation.status, 422);
      const bogusOperator = await req("POST", "/manufacturing/work-orders/WO-DEMO-2/issue", { operatorId: "EMP-DOES-NOT-EXIST" });
      checkEq("and so is one naming an operator that does not exist", bogusOperator.status, 422);
      const stillStarted = await req("GET", "/manufacturing/work-orders/WO-DEMO-2");
      check("neither refusal moved the work order on", stillStarted.body?.stage === "started", String(stillStarted.body?.stage));
    },
  );
}
