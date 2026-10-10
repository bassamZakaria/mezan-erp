import { openSqliteConnection } from "../../packages/persistence/src/index.js";
import type { Ctx } from "./harness.js";

/**
 * الفاتورة الإلكترونية (ETA) — the registration surfaces and the producer that
 * feeds the submission queue.
 *
 * The queue's producer was D5: `EtaService.enqueue` had no caller, so a tenant
 * could configure e-invoicing fully, confirm invoices all day and submit none.
 * `seams.ts` x29 guards the switch ON. This file guards the other half — that
 * the switch is genuinely READ, so turning it off stops the queue — plus the
 * readiness meter and the three mapping surfaces the meter counts.
 *
 * Ids are prefixed `SCN-E-`. It restores auto-submit ON before it finishes, so
 * the suites that run after it see the tenant the seed built.
 */

const BRANCH = "BR-MAIN";
const WH = "WH-MAIN";
const AR = "1105";
const OUTPUT_TAX = "2200";
const REVENUE = "4100";
const CUSTOMER = "CUST-DEMO-1";
const TODAY = "2026-08-24";
const VAT = 14;

export async function run(ctx: Ctx): Promise<void> {
  const { req, n, check, checkEq, scenario, rows } = ctx;

  async function serviceInvoice(id: string, unitPrice: string) {
    const created = await req("POST", "/sales-invoices", {
      id,
      date: TODAY,
      dueDate: "2026-09-23",
      customerId: CUSTOMER,
      customerNameAr: "عميل",
      warehouseId: WH,
      branchId: BRANCH,
      arAccountId: AR,
      taxAccountId: OUTPUT_TAX,
      lines: [
        {
          lineId: `${id}-L1`,
          itemId: "ITEM-DEMO-1",
          itemNameAr: "خدمة اختبار",
          isStock: false,
          qty: "1",
          unitPrice,
          taxRatePercent: VAT,
          revenueAccountId: REVENUE,
        },
      ],
    });
    const confirmed = await req("POST", `/sales-invoices/${id}/confirm`, {});
    return { created, confirmed };
  }

  const readinessOf = async () => (await req("GET", "/eta/config")).body?.readiness;
  const itemOf = (readiness: any, key: string) => readiness?.items?.find((i: any) => i.key === key);

  // ---------------------------------------------------------------------------
  // e1 — the readiness meter counts what is still unregistered
  // ---------------------------------------------------------------------------
  await scenario("e1 · the readiness meter names every prerequisite and counts the records still missing a code", async () => {
    const readiness = await readinessOf();
    const keys = (readiness?.items ?? []).map((i: any) => i.key);
    for (const key of ["taxRegistrationNumber", "activityCode", "address", "branchCodes", "itemCodes", "unitMappings", "taxSubTypes"]) {
      check(`the checklist carries ${key}`, keys.includes(key), keys.join(","));
    }
    const items = itemOf(readiness, "itemCodes");
    const mappings = await req("GET", "/eta/item-mappings?unmapped=1");
    check(
      "the unmapped-items count on the meter equals the unmapped filter's own count",
      n(items?.missing) === n(mappings.body?.total),
      `meter ${items?.missing} vs filter ${mappings.body?.total}`,
    );
    check("a complete prerequisite reports zero missing", itemOf(readiness, "taxRegistrationNumber")?.missing === 0, JSON.stringify(itemOf(readiness, "taxRegistrationNumber")));
    check("the percentage is the share of complete prerequisites", n(readiness?.percent) === Math.round((readiness.items.filter((i: any) => i.complete).length / readiness.items.length) * 100), String(readiness?.percent));
  });

  // ---------------------------------------------------------------------------
  // e2 — item mapping
  // ---------------------------------------------------------------------------
  await scenario("e2 · mapping an item's authority code removes it from the unmapped filter and from the readiness count", async () => {
    const before = await req("GET", "/eta/item-mappings?unmapped=1");
    const target = rows(before.body)[0];
    check("the seeded tenant has at least one unmapped item to register", !!target, JSON.stringify(before.body).slice(0, 200));
    if (!target) return;

    const saved = await req("PUT", `/eta/item-mappings/${target.itemId}`, {
      etaCodeType: "EGS",
      etaItemCode: "EG-SCN-E-0001",
      gpcCode: "10000001",
    });
    check("the mapping saves", saved.status === 200, JSON.stringify(saved.body).slice(0, 200));
    check("and comes back with the registered code", saved.body?.etaItemCode === "EG-SCN-E-0001", JSON.stringify(saved.body).slice(0, 200));

    const after = await req("GET", "/eta/item-mappings?unmapped=1");
    check(
      "the unmapped filter is one row shorter",
      n(after.body?.total) === n(before.body?.total) - 1,
      `${before.body?.total} → ${after.body?.total}`,
    );
    check(
      "and the readiness meter agrees",
      n(itemOf(await readinessOf(), "itemCodes")?.missing) === n(after.body?.total),
      `meter ${itemOf(await readinessOf(), "itemCodes")?.missing} vs filter ${after.body?.total}`,
    );

    const search = await req("GET", `/eta/item-mappings?q=${encodeURIComponent(target.code)}`);
    check("searching by item code finds it", rows(search.body).some((r: any) => r.itemId === target.itemId), JSON.stringify(search.body).slice(0, 200));

    const missing = await req("PUT", "/eta/item-mappings/NOT-AN-ITEM", { etaItemCode: "X" });
    check("an unknown item is refused rather than invented", missing.status === 404, `status ${missing.status}`);
  });

  // ---------------------------------------------------------------------------
  // e3 — unit mapping and its suggestions
  // ---------------------------------------------------------------------------
  await scenario("e3 · apply-suggestions maps every unit the authority's list recognises and names the ones it cannot", async () => {
    const before = rows((await req("GET", "/eta/unit-mappings")).body);
    check("the tenant's units are listed", before.length > 0, JSON.stringify(before).slice(0, 200));
    const suggestible = before.filter((u: any) => u.etaUnitCode === null && u.suggestion !== null).length;

    const applied = await req("POST", "/eta/unit-mappings/apply-suggestions", {});
    check("the action succeeds", applied.status === 200, JSON.stringify(applied.body).slice(0, 200));
    check(
      "it maps exactly the units that had a suggestion",
      rows(applied.body?.applied).length === suggestible,
      `applied ${rows(applied.body?.applied).length} vs suggestible ${suggestible}`,
    );

    const after = rows((await req("GET", "/eta/unit-mappings")).body);
    const stillUnmapped = after.filter((u: any) => u.etaUnitCode === null);
    check(
      "every unit left unmapped is one with no suggestion, and it is reported by name",
      stillUnmapped.every((u: any) => u.suggestion === null && (applied.body?.unresolved ?? []).includes(u.unitCode)),
      JSON.stringify({ stillUnmapped: stillUnmapped.map((u: any) => u.unitCode), unresolved: applied.body?.unresolved }),
    );
    const pcs = after.find((u: any) => u.unitCode === "PCS");
    check("قطعة is mapped to the authority's EA", pcs?.etaUnitCode === "EA", JSON.stringify(pcs));

    const bogus = await req("PUT", "/eta/unit-mappings/PCS", { etaUnitCode: "NOT-A-CODE" });
    check("a code the authority does not publish is refused", bogus.status === 400, `status ${bogus.status}`);
    const remapped = await req("PUT", "/eta/unit-mappings/PCS", { etaUnitCode: "BX" });
    check("and a real one is accepted", remapped.status === 200 && remapped.body?.etaUnitCode === "BX", JSON.stringify(remapped.body).slice(0, 200));
    await req("PUT", "/eta/unit-mappings/PCS", { etaUnitCode: "EA" });
  });

  // ---------------------------------------------------------------------------
  // e4 — branch codes
  // ---------------------------------------------------------------------------
  await scenario("e4 · a branch's code with the authority is stored against the branch and closes its readiness chip", async () => {
    const listed = rows((await req("GET", "/eta/branch-codes")).body);
    check("every active branch is listed for registration", listed.length > 0, JSON.stringify(listed).slice(0, 200));

    const saved = await req("PUT", `/eta/branch-codes/${BRANCH}`, { etaBranchCode: "7" });
    check("the code saves", saved.status === 200 && saved.body?.etaBranchCode === "7", JSON.stringify(saved.body).slice(0, 200));
    const reread = rows((await req("GET", "/eta/branch-codes")).body).find((b: any) => b.branchId === BRANCH);
    check("and survives a re-read", reread?.etaBranchCode === "7", JSON.stringify(reread));
    const unregistered = rows((await req("GET", "/eta/branch-codes")).body).filter((b: any) => b.etaBranchCode === null).length;
    check(
      "the readiness chip counts exactly the branches still without a code",
      n(itemOf(await readinessOf(), "branchCodes")?.missing) === unregistered,
      `meter ${itemOf(await readinessOf(), "branchCodes")?.missing} vs unregistered ${unregistered}`,
    );

    const missing = await req("PUT", "/eta/branch-codes/NOT-A-BRANCH", { etaBranchCode: "9" });
    check("an unknown branch is refused", missing.status === 404, `status ${missing.status}`);
    await req("PUT", `/eta/branch-codes/${BRANCH}`, { etaBranchCode: "1" });
  });

  // ---------------------------------------------------------------------------
  // e5 — credentials never come back, and the connection test says what it knows
  // ---------------------------------------------------------------------------
  await scenario("e5 · the client secret is stored and never returned, and the connection test reports honestly", async () => {
    const saved = await req("PUT", "/eta/config", { clientId: "SCN-E-CLIENT", clientSecret: "scn-e-secret-value" });
    check("the credentials save", saved.status === 200, JSON.stringify(saved.body).slice(0, 200));
    const body = JSON.stringify((await req("GET", "/eta/config")).body);
    check("the secret is never in the response", !body.includes("scn-e-secret-value"), body.slice(0, 200));
    check("only the fact that one is on file is", JSON.parse(body).config?.hasClientSecret === true, body.slice(0, 200));

    const test = await req("POST", "/eta/test-connection", {});
    // The two honest answers to a REAL token request made with invented
    // credentials: `rejected` when the authority's identity server answered
    // and refused them, `unreachable` when the machine could not reach it at
    // all. Which one comes back depends on the network this suite runs on, so
    // the assertion is that the test never claims `connected`, and never
    // claims `missing_credentials` when a secret IS on file — that pair is the
    // whole promise, and `offline` is not a reason this product can return.
    check(
      "with credentials on file the test reports what really came back, not a fake success",
      test.status === 200 && test.body?.ok === false && ["rejected", "unreachable"].includes(test.body?.reason),
      JSON.stringify(test.body),
    );
  });

  // ---------------------------------------------------------------------------
  // e6 — the auto-submit switch is genuinely read (the other half of D5)
  // ---------------------------------------------------------------------------
  await scenario("e6 · turning الإرسال التلقائي off stops the queue, and turning it back on resumes it", async () => {
    const off = await req("PUT", "/eta/config", { autoSubmitOnConfirm: false });
    check("the switch turns off", off.status === 200 && off.body?.config?.autoSubmitOnConfirm === false, JSON.stringify(off.body?.config).slice(0, 200));

    const before = rows((await req("GET", "/eta/submissions")).body).length;
    const quiet = await serviceInvoice("SCN-E-INV-OFF", "500");
    check("a real invoice is confirmed with the switch off", quiet.confirmed.status === 200, JSON.stringify(quiet.confirmed.body).slice(0, 200));
    const afterOff = rows((await req("GET", "/eta/submissions")).body).length;
    check(
      "and the queue does NOT grow — the setting is read, not merely stored (docs/archive/defect-register.md F33 / D5)",
      afterOff === before,
      `before=${before} after=${afterOff}`,
    );

    await req("PUT", "/eta/config", { autoSubmitOnConfirm: true });
    const loud = await serviceInvoice("SCN-E-INV-ON", "500");
    check("a second invoice is confirmed with the switch on", loud.confirmed.status === 200, JSON.stringify(loud.confirmed.body).slice(0, 200));
    const afterOn = rows((await req("GET", "/eta/submissions")).body).length;
    check(
      "and that one does reach the queue",
      afterOn === afterOff + 1,
      `before=${afterOff} after=${afterOn}`,
    );

    const queued = rows((await req("GET", "/eta/submissions")).body).find((s: any) => s.internalId === "SCN-E-INV-ON" || s.internalId?.startsWith("INV-"));
    check("the queued document is جاهز, awaiting submission", queued?.status === "ready", JSON.stringify(queued));
  });

  // ---------------------------------------------------------------------------
  // e7 — a consumer sale is receipted AT the confirm, and the receipt ties to
  // the ledger; its return is a refund receipt that ties too (D282, D283)
  // ---------------------------------------------------------------------------
  await scenario("e7 · a consumer sale's receipt comes back with its confirm and states what the ledger posted; its return is a refund receipt against it", async () => {
    const WALK_IN = "SCN-E-WALKIN";
    const SERVICE = "ITEM-DEMO-10";
    const mapped = await req("PUT", `/eta/item-mappings/${SERVICE}`, { etaCodeType: "EGS", etaItemCode: "EG-SCN-E-0010" });
    check("the service is registered with the authority, as a receipt line requires", mapped.status === 200, JSON.stringify(mapped.body).slice(0, 200));
    const customer = await req("POST", "/customers", {
      id: WALK_IN, code: WALK_IN, nameAr: "عميل نقدي (سيناريو)", paymentTermsDays: 0, currency: "EGP",
      openingBalance: "0", active: true, creditLimit: "0", taxExempt: false, etaBuyerType: "individual",
    });
    check("a walk-in customer with no tax number exists", customer.status === 201, JSON.stringify(customer.body).slice(0, 200));

    async function consumerSale(id: string) {
      await req("POST", "/sales-invoices", {
        id, date: TODAY, dueDate: TODAY, customerId: WALK_IN, customerNameAr: "عميل نقدي", warehouseId: WH, branchId: BRANCH,
        arAccountId: AR, taxAccountId: OUTPUT_TAX,
        lines: [{ lineId: `${id}-L1`, itemId: SERVICE, itemNameAr: "خدمة توصيل", isStock: false, qty: "2", unitPrice: "75", taxRatePercent: VAT, revenueAccountId: REVENUE }],
      });
      return req("POST", `/sales-invoices/${id}/confirm`, {});
    }
    const lineOf = (entry: any, account: string) => (entry?.lines ?? []).filter((l: any) => l.accountId === account);
    const sum = (lines: any[], side: "debit" | "credit") => lines.reduce((s, l) => s + n(l[side]), 0);

    const first = await consumerSale("SCN-E-B2C-1");
    check("the consumer sale confirms", first.status === 200, JSON.stringify(first.body).slice(0, 200));
    const printed = first.body?.etaReceipt;
    check("the confirm response itself carries the receipt the till prints", /^[0-9a-f]{64}$/.test(printed?.uuid ?? ""), JSON.stringify(printed));
    check("its QR is the authority's share link for that UUID, with the total and issuer RIN", String(printed?.qrValue ?? "").includes(`/receipts/search/${printed?.uuid}/share/`) && String(printed?.qrValue).includes("#Total:"), String(printed?.qrValue));

    const stored = (await req("GET", `/eta/receipts/${encodeURIComponent(printed?.receiptNo ?? "")}`)).body;
    const payload = stored?.submission?.payload;
    check("it is filed as a sale receipt at version 1.2", payload?.documentType?.receiptType === "s" && payload?.documentType?.typeVersion === "1.2", JSON.stringify(payload?.documentType));
    const entry = (await req("GET", `/gl/journal-entries/${first.body?.journalEntryId}`)).body;
    checkEq("the receipt's total is the receivable the confirm debited", n(payload?.totalAmount), sum(lineOf(entry, AR), "debit"));
    checkEq("its T1 total is the output VAT the confirm credited", n(payload?.taxTotals?.[0]?.amount), sum(lineOf(entry, OUTPUT_TAX), "credit"));
    checkEq("and its net is the revenue the confirm credited", n(payload?.netAmount), sum(lineOf(entry, REVENUE), "credit"));

    const second = await consumerSale("SCN-E-B2C-2");
    const secondPayload = (await req("GET", `/eta/receipts/${encodeURIComponent(second.body?.etaReceipt?.receiptNo ?? "")}`)).body?.submission?.payload;
    check("the next sale on the same till chains onto this receipt", secondPayload?.header?.previousUUID === printed?.uuid, `${secondPayload?.header?.previousUUID} vs ${printed?.uuid}`);

    const draft = await req("POST", "/sales-returns/from-invoice", {
      id: "SCN-E-B2C-RET", date: TODAY, memo: "مرتجع مستهلك", warehouseId: WH, sourceInvoiceId: "SCN-E-B2C-1", reason: "DEFECTIVE",
      requested: [{ itemId: SERVICE, qty: "1" }],
    });
    check("a return of one unit drafts off the invoice", draft.status === 201, JSON.stringify(draft.body).slice(0, 200));
    const returned = await req("POST", "/sales-returns/SCN-E-B2C-RET/confirm", {});
    check("and confirms", returned.status === 200, JSON.stringify(returned.body).slice(0, 200));
    const returnNo = returned.body?.document?.docNo;
    let refund: any = null;
    for (let i = 0; i < 50 && !refund; i += 1) {
      const res = await req("GET", `/eta/receipts/${encodeURIComponent(returnNo ?? "")}`);
      if (res.status === 200) refund = res.body;
      else await new Promise((resolve) => setTimeout(resolve, 10));
    }
    check("the consumer return is a refund receipt (r), not a credit note", refund?.submission?.payload?.documentType?.receiptType === "r", JSON.stringify(refund?.submission?.payload?.documentType ?? null));
    check("that references the sale receipt's UUID", refund?.submission?.payload?.header?.referenceUUID === printed?.uuid, JSON.stringify(refund?.submission?.payload?.header ?? null));
    const retEntry = (await req("GET", `/gl/journal-entries/${returned.body?.document?.journalEntryId}`)).body;
    checkEq("its total is the receivable the return credited", n(refund?.submission?.payload?.totalAmount), sum(lineOf(retEntry, AR), "credit"));
    const credit = rows((await req("GET", "/eta/submissions")).body).find((s: any) => s.internalId === returnNo && s.documentType === "credit_note");
    check("and no credit note was queued for it (D282)", credit === undefined, JSON.stringify(credit ?? null));
  });

  await taxRateIdentity_D79(ctx);
}

/**
 * D79 — the tax rate a line was charged under is STORED on the line, and the
 * e-invoice, the e-receipt and the VAT return read the classification off that
 * row. معفى (V003) and تصدير (V001) are both 0%: before the id existed a 0% line
 * could only be filed as the neutral V004, or as whichever rate was defined
 * first. A line with no stored id — every line in a books file written before
 * the column existed — still takes that fallback, and only that line.
 */
export async function taxRateIdentity_D79(ctx: Ctx): Promise<void> {
  const { req, n, check, checkEq, scenario, rows } = ctx;
  const CONSUMER = "SCN-D79-WALKIN";
  const EXEMPT_ITEM = "ITEM-DEMO-10";
  const EXPORT_ITEM = "ITEM-DEMO-1";
  const UNNAMED_ITEM = "ITEM-DEMO-2";

  const taxRates = rows((await req("GET", "/tax-rates")).body);
  const exempt = taxRates.find((r: any) => r.etaSubType === "V003" && r.rate === 0 && r.status === "active");
  const exported = taxRates.find((r: any) => r.etaSubType === "V001" && r.rate === 0 && r.status === "active");
  const vat = taxRates.find((r: any) => r.rate === VAT && r.status === "active");

  const subTypesOf = (lines: any[] | undefined): string[] =>
    (lines ?? []).map((l: any) => String(l?.taxableItems?.[0]?.subType ?? "none"));

  function zeroRatedSale(id: string, customerId: string) {
    return {
      id, date: TODAY, dueDate: "2026-09-23", customerId, customerNameAr: "عميل", warehouseId: WH, branchId: BRANCH,
      arAccountId: AR, taxAccountId: OUTPUT_TAX,
      lines: [
        { lineId: `${id}-L1`, itemId: EXEMPT_ITEM, itemNameAr: "خدمة معفاة", isStock: false, qty: "2", unitPrice: "100", taxRateId: exempt?.id, revenueAccountId: REVENUE },
        { lineId: `${id}-L2`, itemId: EXPORT_ITEM, itemNameAr: "توريد تصدير", isStock: false, qty: "3", unitPrice: "100", taxRateId: exported?.id, revenueAccountId: REVENUE },
        { lineId: `${id}-L3`, itemId: UNNAMED_ITEM, itemNameAr: "بند بلا ضريبة مسماة", isStock: false, qty: "1", unitPrice: "100", taxRatePercent: 0, revenueAccountId: REVENUE },
      ],
    };
  }

  await scenario("d79a · the demo tenant holds معفى and تصدير at the same 0%, and a seeded invoice uses each", async () => {
    check("an active exempt rate (V003, 0%) is seeded", exempt !== undefined, JSON.stringify(taxRates.map((r: any) => [r.id, r.rate, r.etaSubType])));
    check("an active zero-rated export rate (V001, 0%) is seeded", exported !== undefined);
    check("they are two different rows at one percent", exempt?.id !== exported?.id && exempt?.rate === exported?.rate);

    const seeded = (await req("GET", "/sales-invoices/INV-DEMO-TAX-1")).body;
    check("the seeded exempt line stores the exempt rate's id", seeded?.lines?.[0]?.taxRateId === exempt?.id, JSON.stringify(seeded?.lines?.[0] ?? null).slice(0, 200));
    check("the seeded export line stores the export rate's id", seeded?.lines?.[1]?.taxRateId === exported?.id, JSON.stringify(seeded?.lines?.[1] ?? null).slice(0, 200));
    const taxed = (await req("GET", "/sales-invoices/INV-DEMO-1")).body;
    check(
      "and every line of a seeded taxed invoice stores the 14% rate's id",
      (taxed?.lines ?? []).length > 0 && (taxed?.lines ?? []).every((l: any) => l.taxRateId === vat?.id),
      JSON.stringify((taxed?.lines ?? []).map((l: any) => [l.taxRatePercent, l.taxRateId])),
    );

    const queued = rows((await req("GET", "/eta/submissions")).body).find((s: any) => s.internalId === seeded?.docNo);
    const payload = queued ? (await req("GET", `/eta/submissions/${queued.id}`)).body?.payload : null;
    check(
      "the seeded invoice's e-invoice files the exempt line V003 and the export line V001",
      JSON.stringify(subTypesOf(payload?.invoiceLines)) === JSON.stringify(["V003", "V001"]),
      JSON.stringify(subTypesOf(payload?.invoiceLines)),
    );
  });

  await scenario("d79b · an e-invoice files each 0% line by the rate it stored, and only the line with no stored rate stays V004", async () => {
    const created = await req("POST", "/sales-invoices", zeroRatedSale("SCN-D79-B2B", CUSTOMER));
    check("the invoice is drafted", created.status === 201, JSON.stringify(created.body).slice(0, 240));
    check("the exempt line reads back with the exempt rate's id", created.body?.lines?.[0]?.taxRateId === exempt?.id, String(created.body?.lines?.[0]?.taxRateId));
    check("the export line reads back with the export rate's id", created.body?.lines?.[1]?.taxRateId === exported?.id, String(created.body?.lines?.[1]?.taxRateId));
    check(
      "a 0% line that names no rate stores NO id — two rates share its percent, so the server will not pick one",
      created.body?.lines?.[2]?.taxRateId === null && created.body?.lines?.[2]?.taxRatePercent === 0,
      JSON.stringify(created.body?.lines?.[2] ?? null).slice(0, 200),
    );

    const confirmed = await req("POST", "/sales-invoices/SCN-D79-B2B/confirm", {});
    check("it confirms", confirmed.status === 200, JSON.stringify(confirmed.body).slice(0, 240));
    const docNo = confirmed.body?.invoice?.docNo ?? confirmed.body?.docNo;
    const queued = rows((await req("GET", "/eta/submissions")).body).find((s: any) => s.internalId === docNo);
    const payload = queued ? (await req("GET", `/eta/submissions/${queued.id}`)).body?.payload : null;
    const subTypes = subTypesOf(payload?.invoiceLines);
    check("the exempt line is filed V003", subTypes[0] === "V003", JSON.stringify(subTypes));
    check("the zero-rated export line is filed V001", subTypes[1] === "V001", JSON.stringify(subTypes));
    check("the line with no stored rate keeps the old neutral V004", subTypes[2] === "V004", JSON.stringify(subTypes));

    const entry = (await req("GET", `/gl/journal-entries/${confirmed.body?.invoice?.journalEntryId ?? confirmed.body?.journalEntryId}`)).body;
    const revenue = (entry?.lines ?? []).filter((l: any) => l.accountId === REVENUE);
    checkEq("the three lines post 600.00 of revenue and no VAT", revenue.reduce((s: number, l: any) => s + n(l.credit), 0), 600);
  });

  await scenario("d79c · the ids read back from SQLite are real tax-rate rows, and the unnamed line is a real NULL", async () => {
    const { sqlite: db } = openSqliteConnection(ctx.dbPath);
    try {
      const stored = db
        .prepare(`SELECT line_id AS lineId, tax_rate_percent AS percent, tax_rate_id AS taxRateId FROM sales_invoice_line WHERE invoice_id = ? ORDER BY line_no`)
        .all("SCN-D79-B2B") as { lineId: string; percent: number; taxRateId: string | null }[];
      const rateRow = (id: string | null) =>
        id === null ? undefined : (db.prepare(`SELECT id, rate, eta_sub_type AS etaSubType FROM tax_rate WHERE id = ?`).get(id) as { id: string; rate: number; etaSubType: string } | undefined);
      check("the stored exempt line's tax_rate_id is a tax_rate row classified V003", rateRow(stored[0]?.taxRateId ?? null)?.etaSubType === "V003", JSON.stringify(stored[0] ?? null));
      check("the stored export line's tax_rate_id is a tax_rate row classified V001", rateRow(stored[1]?.taxRateId ?? null)?.etaSubType === "V001", JSON.stringify(stored[1] ?? null));
      check("the unnamed line's tax_rate_id is NULL in the file, exactly what a pre-D79 line holds", stored[2]?.taxRateId === null, JSON.stringify(stored[2] ?? null));

      const orphans = (table: string) =>
        (db.prepare(`SELECT COUNT(*) AS c FROM ${table} WHERE tax_rate_id IS NOT NULL AND tax_rate_id NOT IN (SELECT id FROM tax_rate)`).get() as { c: number }).c;
      check("no sales invoice line names a tax rate that does not exist", orphans("sales_invoice_line") === 0, String(orphans("sales_invoice_line")));
      check("no sales quote line names a tax rate that does not exist", orphans("sales_quote_line") === 0, String(orphans("sales_quote_line")));
      check("no journal line names a tax rate that does not exist", orphans("journal_line") === 0, String(orphans("journal_line")));

      const posted = db
        .prepare(`SELECT jl.tax_rate_id AS taxRateId, jl.credit AS credit FROM journal_line jl JOIN journal_entry je ON je.id = jl.entry_id WHERE je.source_doc_id = ? AND jl.account_id = ? ORDER BY jl.line_no`)
        .all("SCN-D79-B2B", REVENUE) as { taxRateId: string | null; credit: number }[];
      check(
        "the posted revenue is split per stored rate — exempt, export and unnamed never blend",
        JSON.stringify(posted.map((l) => l.taxRateId).sort()) === JSON.stringify([exempt?.id, exported?.id, null].sort()),
        JSON.stringify(posted),
      );
    } finally {
      db.close();
    }
  });

  await scenario("d79d · a consumer e-receipt files the same three lines the same way, and the refund of the exempt line stays exempt", async () => {
    const customer = await req("POST", "/customers", {
      id: CONSUMER, code: CONSUMER, nameAr: "عميل نقدي (D79)", paymentTermsDays: 0, currency: "EGP",
      openingBalance: "0", active: true, creditLimit: "0", taxExempt: false, etaBuyerType: "individual",
    });
    check("a walk-in customer with no tax number exists", customer.status === 201, JSON.stringify(customer.body).slice(0, 200));
    await req("PUT", `/eta/item-mappings/${EXEMPT_ITEM}`, { etaCodeType: "EGS", etaItemCode: "EG-SCN-E-0010" });

    await req("POST", "/sales-invoices", zeroRatedSale("SCN-D79-B2C", CONSUMER));
    const confirmed = await req("POST", "/sales-invoices/SCN-D79-B2C/confirm", {});
    check("the consumer sale confirms with its receipt", confirmed.status === 200 && Boolean(confirmed.body?.etaReceipt?.receiptNo), JSON.stringify(confirmed.body).slice(0, 240));
    const receipt = (await req("GET", `/eta/receipts/${encodeURIComponent(confirmed.body?.etaReceipt?.receiptNo ?? "")}`)).body;
    const subTypes = subTypesOf(receipt?.submission?.payload?.itemData);
    check("the receipt files the exempt line V003", subTypes[0] === "V003", JSON.stringify(subTypes));
    check("the receipt files the export line V001", subTypes[1] === "V001", JSON.stringify(subTypes));
    check("and the line with no stored rate V004", subTypes[2] === "V004", JSON.stringify(subTypes));

    const draft = await req("POST", "/sales-returns/from-invoice", {
      id: "SCN-D79-RET", date: TODAY, memo: "مرتجع بند معفى", warehouseId: WH, sourceInvoiceId: "SCN-D79-B2C", reason: "DEFECTIVE",
      requested: [{ itemId: EXEMPT_ITEM, qty: "1" }],
    });
    check("a return of the exempt line drafts off the invoice", draft.status === 201, JSON.stringify(draft.body).slice(0, 200));
    check("the return line inherits the invoice line's rate id", draft.body?.lines?.[0]?.taxRateId === exempt?.id, JSON.stringify(draft.body?.lines?.[0] ?? null).slice(0, 200));
    const returned = await req("POST", "/sales-returns/SCN-D79-RET/confirm", {});
    check("and confirms", returned.status === 200, JSON.stringify(returned.body).slice(0, 200));
    const returnNo = returned.body?.document?.docNo;
    let refund: any = null;
    for (let i = 0; i < 50 && !refund; i += 1) {
      const res = await req("GET", `/eta/receipts/${encodeURIComponent(returnNo ?? "")}`);
      if (res.status === 200) refund = res.body;
      else await new Promise((resolve) => setTimeout(resolve, 10));
    }
    check(
      "the refund receipt files the returned line V003, not V004",
      JSON.stringify(subTypesOf(refund?.submission?.payload?.itemData)) === JSON.stringify(["V003"]),
      JSON.stringify(subTypesOf(refund?.submission?.payload?.itemData)),
    );
  });

  await scenario("d79e · the VAT return reports exempt and export on their own rows, and the rate is the server's, never the request's", async () => {
    const report = (await req("GET", `/financial-reports/vat-return?periodFrom=${TODAY}&periodTo=${TODAY}`)).body;
    const row = (id: string) => rows(report).find((r: any) => r.rowId === id);
    check("the exempt row carries what the two scenario sales and the return left at the exempt rate", n(row(`output-0-${exempt?.id}`)?.base) === 300, JSON.stringify(row(`output-0-${exempt?.id}`) ?? null));
    check("the export row carries the two sales' export lines", n(row(`output-0-${exported?.id}`)?.base) === 600, JSON.stringify(row(`output-0-${exported?.id}`) ?? null));
    check("each row is named by its rate", row(`output-0-${exempt?.id}`)?.taxRateName === exempt?.name && row(`output-0-${exported?.id}`)?.taxRateName === exported?.name);

    const attempt = (line: Record<string, unknown>) =>
      req("POST", "/sales-invoices", {
        id: `SCN-D79-BAD-${Math.random().toString(36).slice(2, 8)}`, date: TODAY, dueDate: "2026-09-23", customerId: CUSTOMER, customerNameAr: "عميل",
        warehouseId: WH, branchId: BRANCH, arAccountId: AR, taxAccountId: OUTPUT_TAX,
        lines: [{ lineId: "L1", itemId: EXEMPT_ITEM, itemNameAr: "خدمة", isStock: false, qty: "1", unitPrice: "100", revenueAccountId: REVENUE, ...line }],
      });
    const unknown = await attempt({ taxRateId: "TAX-1" });
    check("a rate id no tax rate has is refused", unknown.status === 422 && unknown.body?.error === "TAX_RATE_NOT_FOUND", `${unknown.status} ${JSON.stringify(unknown.body).slice(0, 160)}`);
    const mismatch = await attempt({ taxRateId: exempt?.id, taxRatePercent: VAT });
    check("a percent that is not the named rate's own is refused", mismatch.status === 422 && mismatch.body?.error === "TAX_RATE_PERCENT_MISMATCH", `${mismatch.status} ${JSON.stringify(mismatch.body).slice(0, 160)}`);
    check("and the refusal reaches the user in Arabic", /[؀-ۿ]/.test(String(mismatch.body?.message ?? "")), String(mismatch.body?.message));

    await req("POST", "/tax-rates", { id: "SCN-D79-RETIRED", code: "SCN-D79-RETIRED", name: "نسبة موقوفة (سيناريو)", rate: 7, etaSubType: "V009" });
    await req("PATCH", "/tax-rates/SCN-D79-RETIRED", { status: "inactive" });
    const inactive = await attempt({ taxRateId: "SCN-D79-RETIRED" });
    check("a deactivated rate cannot be put on a new line", inactive.status === 422 && inactive.body?.error === "TAX_RATE_INACTIVE", `${inactive.status} ${JSON.stringify(inactive.body).slice(0, 160)}`);

    const byPercent = await attempt({ taxRatePercent: VAT });
    check("a line that sends only 14% stores the one active 14% rate's id", byPercent.status === 201 && byPercent.body?.lines?.[0]?.taxRateId === vat?.id, JSON.stringify(byPercent.body?.lines?.[0] ?? byPercent.body).slice(0, 200));
    await req("POST", `/sales-invoices/${byPercent.body?.id}/cancel`, {});
  });

  await scenario("d79f · the twins resolve a real rate id too — a quote, the invoice it converts into, and a purchase invoice", async () => {
    const quote = await req("POST", "/sales-quotes", {
      id: "SCN-D79-QT", date: TODAY, expiryDate: "2026-09-23", customerId: CUSTOMER, customerNameAr: "عميل", branchId: BRANCH,
      lines: [
        { lineId: "SCN-D79-QT-L1", itemId: EXEMPT_ITEM, itemNameAr: "خدمة معفاة", qty: "1", unitPrice: "100", taxRateId: exported?.id },
        { lineId: "SCN-D79-QT-L2", itemId: EXPORT_ITEM, itemNameAr: "بند خاضع", qty: "1", unitPrice: "100", taxRatePercent: VAT },
      ],
    });
    check("the quote stores the picked rate, and resolves the 14% line to its rate", quote.status === 201 && quote.body?.lines?.[0]?.taxRateId === exported?.id && quote.body?.lines?.[1]?.taxRateId === vat?.id, JSON.stringify(quote.body?.lines ?? quote.body).slice(0, 300));
    await req("POST", "/sales-quotes/SCN-D79-QT/send", {});
    await req("POST", "/sales-quotes/SCN-D79-QT/accept", {});
    const converted = await req("POST", "/sales-quotes/SCN-D79-QT/convert-to-invoice", {
      id: "SCN-D79-QT-INV", dueDate: "2026-09-23", warehouseId: WH, arAccountId: AR, taxAccountId: OUTPUT_TAX,
      lines: [
        { lineId: "SCN-D79-QT-L1", isStock: false, revenueAccountId: REVENUE },
        { lineId: "SCN-D79-QT-L2", isStock: false, revenueAccountId: REVENUE },
      ],
    });
    check("the quote converts", converted.status === 201, JSON.stringify(converted.body).slice(0, 240));
    const invoice = (await req("GET", "/sales-invoices/SCN-D79-QT-INV")).body;
    check(
      "the converted invoice's lines carry the quote lines' rate ids — the export line is still an export",
      invoice?.lines?.[0]?.taxRateId === exported?.id && invoice?.lines?.[1]?.taxRateId === vat?.id,
      JSON.stringify((invoice?.lines ?? []).map((l: any) => [l.taxRatePercent, l.taxRateId])),
    );
    await req("POST", "/sales-invoices/SCN-D79-QT-INV/cancel", {});

    const purchase = await req("POST", "/purchases/invoices", {
      id: "SCN-D79-PI", supplierId: "SUPP-DEMO-1", date: TODAY, branchId: BRANCH, warehouseId: WH,
      lines: [
        { itemId: null, kind: "expense", description: "خدمة معفاة", qty: "1", unitCost: "100", taxRateId: exempt?.id },
        { itemId: null, kind: "expense", description: "خدمة خاضعة", qty: "1", unitCost: "100", taxRatePercent: VAT },
        { itemId: null, kind: "expense", description: "خدمة بلا ضريبة مسماة", qty: "1", unitCost: "100", taxRatePercent: 0 },
      ],
    });
    check("a purchase invoice is drafted", purchase.status === 201, JSON.stringify(purchase.body).slice(0, 240));
    check(
      "its lines store the picked rate, the one 14% rate, and nothing for the unnamed 0% line",
      JSON.stringify((purchase.body?.lines ?? []).map((l: any) => l.taxRateId)) === JSON.stringify([exempt?.id, vat?.id, null]),
      JSON.stringify((purchase.body?.lines ?? []).map((l: any) => [l.taxRatePercent, l.taxRateId])),
    );
    const cancelled = await req("POST", "/purchases/invoices/SCN-D79-PI/cancel", {});
    check("the draft is cancelled, so nothing is left owed to the supplier", cancelled.status === 200, JSON.stringify(cancelled.body).slice(0, 200));
  });
}
