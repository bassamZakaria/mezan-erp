import type { Ctx } from "./harness.js";

/**
 * Executable checks for the purchases module — see docs/scenarios/02-purchases.md.
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

  async function confirmedInvoiceTotals() {
    const res = await req("GET", "/purchases/invoices");
    return rows(res.body)
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
    checkEq(
      "receipt-confirm moves stock (+16,550) with NO GL movement — inventory sub-ledger runs exactly that far ahead of GL 1200",
      afterReceipt.inventory - beforeReceipt.inventory,
      16550,
    );
    checkEq("receipt-confirm does not touch AP at all", afterReceipt.ap, beforeReceipt.ap);
    checkEq("trial balance is untouched by a receipt confirm (no GL posted)", afterReceipt.tb, beforeReceipt.tb);

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
    "purchases: DEFECT — a second purchase invoice from an already-invoiced receipt (GRN-DEMO-1) is accepted, not refused",
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
      // createPurchaseInvoice (packages/domain/src/purchasing/purchase-invoice.ts)
      // only checks receipt.status === "confirmed" — it never checks receipt.invoiced.
      // markGoodsReceiptInvoiced() on confirm silently no-ops (`if (receipt.invoiced) return;`)
      // instead of throwing, so nothing anywhere blocks a second invoice against the
      // same receipt claiming the same goods a second time.
      check(
        "EXPECTED (but broken): create should refuse a 2nd invoice against an already-invoiced receipt",
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
        "receiving 15 against an order for 10 is ACCEPTED at create (default policy has blockOverReceipt: false, docs/catalog/09)",
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

  // --- 7. D10 — hardcoded branch/warehouse ids -----------------------------
  await scenario(
    "purchases: D10 — RFQ/PO/invoice create silently accept the UI's hardcoded branchId 'MAIN'/warehouseId 'MAIN-WH', ids that do not exist in this tenant (real ids BR-MAIN/WH-MAIN)",
    async () => {
      const rfq = await req("POST", "/rfqs", {
        id: "SCN-RFQ-D10",
        date: "2026-08-24",
        branchId: "MAIN",
        warehouseId: "MAIN-WH",
        lines: [{ itemId: "ITEM-DEMO-3", qty: "5", notes: null }],
      });
      check(
        "D10: RFQ create with the UI's hardcoded 'MAIN'/'MAIN-WH' succeeds silently — no FK check anywhere rejects a non-existent branch/warehouse",
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
      check("D10: PO create with 'MAIN'/'MAIN-WH' also succeeds silently", po.status === 201, `status ${po.status}`);

      const invoice = await req("POST", "/purchases/invoices", {
        id: "SCN-PI-D10",
        supplierId: "SUPP-DEMO-1",
        date: "2026-08-24",
        branchId: "MAIN",
        warehouseId: "MAIN-WH",
        lines: [{ itemId: "ITEM-DEMO-3", kind: "inventory", qty: "5", unitCost: "32", taxRatePercent: VAT }],
      });
      check("D10: manual invoice create with 'MAIN'/'MAIN-WH' also succeeds silently (left as draft, not confirmed)", invoice.status === 201, `status ${invoice.status}`);
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
    // DEFECT (packages/backend/src/create-backend.ts, resolveReconciliationControls): a LandedCostLine
    // denormalizes the FULL costItems array onto every target line (see landed-cost-document.ts's
    // `lines: allocated.map(a => ({ ...a, costItems, distributionMethod }))`), and the AP sub-ledger
    // loop sums `totalLandedCost(line.costItems)` PER LINE instead of once per document. With 2 target
    // lines here, the sub-ledger adds the 2,500 total TWICE (5,000) while GL 2100 is correctly credited
    // exactly once (2,500) — a genuine, previously unrecorded reconciliation bug for any landed cost
    // with more than one target line. This is what the automatic "AP still reconciles" check above
    // (from ctx.scenario()) is reporting when it fails. LC-DEMO-1 in the seed itself has 2 target lines
    // too, so this same bug already inflates the tenant's baseline AP-vs-GL gap before this file runs
    // anything at all.
    checkEq(
      "DEFECT: multi-line landed cost double-counts its total in the AP sub-ledger (2 target lines -> 5,000 counted vs 2,500 actually credited to GL 2100) — matches the failing 'AP still reconciles' check above",
      afterConfirm.ap - beforeConfirm.ap,
      2500,
    );
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
    "purchases: confirming GRN-DEMO-3 moves stock with NO GL entry (documented, correct) — invoicing it afterward closes the gap",
    async () => {
      const before = await req("GET", "/purchases/receipts/GRN-DEMO-3");
      check("GRN-DEMO-3 starts draft and uninvoiced (seeded that way on purpose)", before.body?.status === "draft" && before.body?.invoiced === false, JSON.stringify(before.body).slice(0, 120));

      const start = await ctx.invariants();
      const confirm = await req("POST", "/purchases/receipts/GRN-DEMO-3/confirm", {});
      check("GRN-DEMO-3 confirms", confirm.status === 200 && confirm.body?.status === "confirmed", confirm.status.toString());

      const po = await req("GET", "/purchases/orders/PO-DEMO-4");
      check("PO-DEMO-4 (sugar's only PO) advances to fully_received", po.body?.status === "fully_received", po.body?.status);

      const afterReceipt = await ctx.invariants();
      // 250 sugar @ 31 = 7,750, matching GRN-DEMO-3's totalCost.
      checkEq(
        "documented behavior: inventory sub-ledger runs exactly +7,750 ahead of GL 1200 (no goods-received-not-invoiced accrual account exists) — NOT a defect, do not re-file",
        afterReceipt.inventory - start.inventory,
        7750,
      );

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
      checkEq("the +7,750 gap opened by the receipt confirm is fully closed by the invoice confirm", afterInvoice.inventory, start.inventory);
    },
  );
}
