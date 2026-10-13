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
    const created = await req("POST", "/items", { id: "SCN-E-UNREGISTERED", code: "SCN-E-UNREG", nameAr: "صنف بلا كود لدى المصلحة", type: "stock", baseUnitCode: "PCS", trackInventory: true });
    check("a new item is created", created.status === 201, JSON.stringify(created.body).slice(0, 200));
    const before = await req("GET", "/eta/item-mappings?unmapped=1");
    const target = rows(before.body).find((row: any) => row.itemId === "SCN-E-UNREGISTERED");
    check("a new item starts unregistered and the unmapped filter lists it", !!target, JSON.stringify(before.body).slice(0, 200));
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
  await zeroPercentIsNeverInferred_D79(ctx);
  await taxIsRoundedPerLine_D79(ctx);
  await postedLineTaxIsClassified_D79(ctx);
}

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
    check("the line with no stored rate keeps the old neutral V004 in the payload", subTypes[2] === "V004", JSON.stringify(subTypes));
    const classification = (queued?.prevalidation ?? []).filter((f: any) => f.code === "TAX_SUBTYPE_NOT_MAPPED");
    check(
      "but it may not REACH the authority: the tenant holds a specific 0% classification, so the unnamed line is a blocking finding",
      classification.length === 1 && classification[0]?.severity === "blocking" && queued?.hasBlockingFindings === true,
      JSON.stringify(classification).slice(0, 300),
    );
    check("the finding tells the user, in Arabic, to pick the rate on the document line", /[\u0600-\u06FF]/.test(String(classification[0]?.messageAr ?? "")) && classification[0]?.fixScreen === "source_document", JSON.stringify(classification[0] ?? null).slice(0, 300));

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

  await scenario("d79d · a consumer e-receipt files each named 0% line by its rate, is refused for a line that names none, and the refund of the exempt line stays exempt", async () => {
    const customer = await req("POST", "/customers", {
      id: CONSUMER, code: CONSUMER, nameAr: "عميل نقدي (D79)", paymentTermsDays: 0, currency: "EGP",
      openingBalance: "0", active: true, creditLimit: "0", taxExempt: false, etaBuyerType: "individual",
    });
    check("a walk-in customer with no tax number exists", customer.status === 201, JSON.stringify(customer.body).slice(0, 200));
    await req("PUT", `/eta/item-mappings/${EXEMPT_ITEM}`, { etaCodeType: "EGS", etaItemCode: "EG-SCN-E-0010" });

    await req("POST", "/sales-invoices", zeroRatedSale("SCN-D79-B2C-UNNAMED", CONSUMER));
    const unready = await req("POST", "/sales-invoices/SCN-D79-B2C-UNNAMED/confirm", {});
    check("a consumer sale with an unnamed 0% line still confirms — the books are not held hostage to the filing", unready.status === 200 && unready.body?.status === "confirmed", JSON.stringify(unready.body).slice(0, 240));
    check(
      "but it gets NO e-receipt: the unnamed line could be exempt or export, so it is not filed as not-subject by default",
      unready.body?.etaReceipt === null && unready.body?.etaReceiptError?.code === "ETA_RECEIPT_NOT_READY",
      JSON.stringify({ etaReceipt: unready.body?.etaReceipt ?? null, etaReceiptError: unready.body?.etaReceiptError ?? null }).slice(0, 300),
    );
    check("the refusal says, in Arabic, that the 0% line names no rate", String(unready.body?.etaReceiptError?.message ?? "").includes("ضريبة البند بنسبة 0% غير مسماة"), String(unready.body?.etaReceiptError?.message ?? ""));
    const unissued = await req("GET", `/eta/receipts/${encodeURIComponent(unready.body?.docNo ?? "")}`);
    check("and no receipt was stored under its number", unissued.status === 404, `status ${unissued.status}`);

    const named = zeroRatedSale("SCN-D79-B2C", CONSUMER);
    await req("POST", "/sales-invoices", { ...named, lines: named.lines.slice(0, 2) });
    const confirmed = await req("POST", "/sales-invoices/SCN-D79-B2C/confirm", {});
    check("the consumer sale whose 0% lines each name a rate confirms with its receipt", confirmed.status === 200 && Boolean(confirmed.body?.etaReceipt?.receiptNo), JSON.stringify(confirmed.body).slice(0, 240));
    const receipt = (await req("GET", `/eta/receipts/${encodeURIComponent(confirmed.body?.etaReceipt?.receiptNo ?? "")}`)).body;
    const subTypes = subTypesOf(receipt?.submission?.payload?.itemData);
    check("the receipt files the exempt line V003", subTypes[0] === "V003", JSON.stringify(subTypes));
    check("the receipt files the export line V001", subTypes[1] === "V001", JSON.stringify(subTypes));
    check("and nothing on it is filed V004", subTypes.length === 2 && !subTypes.includes("V004"), JSON.stringify(subTypes));

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
    check("the exempt row carries what the three scenario sales and the return left at the exempt rate", n(row(`output-0-${exempt?.id}`)?.base) === 500, JSON.stringify(row(`output-0-${exempt?.id}`) ?? null));
    check("the export row carries the three sales' export lines", n(row(`output-0-${exported?.id}`)?.base) === 900, JSON.stringify(row(`output-0-${exported?.id}`) ?? null));
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

export async function zeroPercentIsNeverInferred_D79(ctx: Ctx): Promise<void> {
  const { req, n, check, scenario, rows, scaled } = ctx;
  const TOWER_CONTRACT = "CTR-DEMO-1";

  const listed = rows((await req("GET", "/tax-rates")).body);
  const exempt = listed.find((r: any) => r.etaSubType === "V003" && r.rate === 0);
  const exported = listed.find((r: any) => r.etaSubType === "V001" && r.rate === 0);

  const draft = (id: string, over: Record<string, unknown>, line: Record<string, unknown>) =>
    req("POST", "/sales-invoices", {
      id, date: TODAY, dueDate: "2026-09-23", customerId: CUSTOMER, customerNameAr: "عميل", warehouseId: WH, branchId: BRANCH,
      arAccountId: AR, taxAccountId: OUTPUT_TAX, ...over,
      lines: [{ lineId: `${id}-L1`, itemId: "ITEM-DEMO-10", itemNameAr: "خدمة", isStock: false, qty: "1", unitPrice: "100", revenueAccountId: REVENUE, ...line }],
    });
  const taxOf = (res: any) => JSON.stringify([res.body?.lines?.[0]?.taxRatePercent, res.body?.lines?.[0]?.taxRateId]);

  await scenario("d79g · the system «غير خاضع» rate is named in one case only, a sale with VAT off; an exempt customer names the rate on its card or none; a release is not a supply; a 0% a user enters still names no rate", async () => {
    const NOT_SUBJECT = "SYS-NOT-SUBJECT";
    const system = listed.find((r: any) => r.id === NOT_SUBJECT);
    check("every tenant holds the system «غير خاضع» rate: 0%, V004, active, marked as the system's", system?.rate === 0 && system?.etaSubType === "V004" && system?.status === "active" && system?.isSystem === true && system?.name === "غير خاضع", JSON.stringify(system ?? null));
    const locked = await req("PATCH", `/tax-rates/${NOT_SUBJECT}`, { status: "inactive" });
    check("and it cannot be edited or deactivated: 409 TAX_RATE_SYSTEM_LOCKED, in Arabic", locked.status === 409 && locked.body?.error === "TAX_RATE_SYSTEM_LOCKED" && /[\u0600-\u06FF]/.test(String(locked.body?.message ?? "")), `${locked.status} ${JSON.stringify(locked.body).slice(0, 200)}`);

    const retired = await req("PATCH", `/tax-rates/${exported?.id}`, { status: "inactive" });
    check("the export rate is deactivated, though documents reference it", retired.status === 200 && retired.body?.status === "inactive", JSON.stringify(retired.body).slice(0, 200));
    const activeZero = rows((await req("GET", "/tax-rates")).body).filter((r: any) => r.rate === 0 && r.status === "active");
    check(
      "the tenant now holds exactly one 0% rate of its own, «معفى», beside the system's",
      activeZero.length === 2 && activeZero.some((r: any) => r.id === exempt?.id) && activeZero.some((r: any) => r.id === NOT_SUBJECT),
      JSON.stringify(activeZero.map((r: any) => r.id)),
    );

    const claimed = await draft("SCN-D79-ONE-CLAIMED", { customerId: CUSTOMER, customerTaxExempt: true }, { taxRatePercent: VAT });
    const vatRate = listed.find((r: any) => r.rate === VAT && r.status === "active");
    check(
      "a request CLAIMING exemption for a customer who is not exempt is not believed: the line is taxed at 14% under the VAT rate and the invoice is not marked exempt",
      claimed.status === 201 && taxOf(claimed) === JSON.stringify([VAT, vatRate?.id]) && claimed.body?.customerTaxExempt === false,
      `${claimed.status} ${taxOf(claimed)} customerTaxExempt=${claimed.body?.customerTaxExempt}`,
    );
    await req("POST", "/sales-invoices/SCN-D79-ONE-CLAIMED/cancel", {});

    const UNCARDED = "SCN-D79-EXEMPT-NO-RATE";
    const uncarded = await req("POST", "/customers", {
      id: UNCARDED, code: UNCARDED, nameAr: "جهة معفاة بلا ضريبة إعفاء (سيناريو)", taxNumber: "311222333", etaBuyerType: "business", taxExempt: true,
    });
    check("an exempt business customer is created with no exemption rate on its card", uncarded.status === 201 && uncarded.body?.taxExempt === true && uncarded.body?.taxExemptionRateId === null, JSON.stringify(uncarded.body).slice(0, 200));
    const taxedCard = await req("PATCH", `/customers/${UNCARDED}`, { taxExemptionRateId: vatRate?.id });
    check(
      "the card refuses a 14% rate as the exemption rate, in Arabic — only an active 0% rate is one",
      taxedCard.status === 422 && taxedCard.body?.error === "CUSTOMER_EXEMPTION_RATE_INVALID" && /[\u0600-\u06FF]/.test(String(taxedCard.body?.message ?? "")),
      `${taxedCard.status} ${JSON.stringify(taxedCard.body).slice(0, 200)}`,
    );
    const notExemptCard = await req("PATCH", `/customers/${CUSTOMER}`, { taxExemptionRateId: exempt?.id });
    check(
      "and refuses any exemption rate on a customer who is not exempt",
      notExemptCard.status === 422 && notExemptCard.body?.error === "CUSTOMER_EXEMPTION_RATE_WITHOUT_EXEMPTION",
      `${notExemptCard.status} ${JSON.stringify(notExemptCard.body).slice(0, 200)}`,
    );
    const exemptUncarded = await draft("SCN-D79-ONE-EXEMPT-NONE", { customerId: UNCARDED, customerTaxExempt: false }, { taxRatePercent: VAT });
    check(
      "an exempt customer with no exemption rate is drafted at 0% naming NO rate — round 3 named «غير خاضع» here and filed an exempt sale as not subject",
      exemptUncarded.status === 201 && taxOf(exemptUncarded) === "[0,null]" && exemptUncarded.body?.customerTaxExempt === true,
      `${exemptUncarded.status} ${taxOf(exemptUncarded)}`,
    );

    const carded = (await req("GET", "/customers/CUST-DEMO-4")).body;
    check("the seeded exempt customer carries «معفى» as its exemption rate", carded?.taxExempt === true && carded?.taxExemptionRateId === exempt?.id, JSON.stringify([carded?.taxExempt, carded?.taxExemptionRateId]));
    const exemptCustomer = await draft("SCN-D79-ONE-EXEMPT-CUST", { customerId: "CUST-DEMO-4" }, { taxRatePercent: VAT });
    check(
      "an exempt customer's sale is drafted at 0% under the rate on the customer's card — the tenant's own declaration, not a guess",
      exemptCustomer.status === 201 && taxOf(exemptCustomer) === JSON.stringify([0, exempt?.id]),
      `${exemptCustomer.status} ${taxOf(exemptCustomer)}`,
    );

    const settings = (await req("GET", "/settings")).body;
    const off = await req("PUT", "/settings", { ...settings, taxEnabled: false });
    check("VAT is switched off", off.status === 200 && off.body?.taxEnabled === false, `status ${off.status}`);
    const vatOff = await draft("SCN-D79-ONE-VAT-OFF", {}, { taxRatePercent: VAT });
    const restored = await req("PUT", "/settings", { ...settings, taxEnabled: true });
    check("VAT is switched back on", restored.status === 200 && restored.body?.taxEnabled === true, `status ${restored.status}`);
    check("a sale raised with VAT off is drafted at 0% under «غير خاضع»", vatOff.status === 201 && taxOf(vatOff) === JSON.stringify([0, NOT_SUBJECT]), `${vatOff.status} ${taxOf(vatOff)}`);

    const unnamed = await draft("SCN-D79-ONE-UNNAMED", {}, { taxRatePercent: 0 });
    check("a 0% line a USER entered without a rate stores none — neither «معفى» nor the system's rate is read off the percent", unnamed.status === 201 && taxOf(unnamed) === "[0,null]", `${unnamed.status} ${taxOf(unnamed)}`);

    const picked = await draft("SCN-D79-ONE-PICKED", {}, { taxRateId: exempt?.id });
    check("a line that NAMES «معفى» stores it", picked.status === 201 && picked.body?.lines?.[0]?.taxRateId === exempt?.id, `${picked.status} ${taxOf(picked)}`);

    const refused = await draft("SCN-D79-ONE-RETIRED", {}, { taxRateId: exported?.id });
    check("and the deactivated export rate cannot be put on a new line", refused.status === 422 && refused.body?.error === "TAX_RATE_INACTIVE", `${refused.status} ${JSON.stringify(refused.body).slice(0, 160)}`);
    check("the refusal names the rate, not its id", String(refused.body?.message ?? "").includes(String(exported?.name)), String(refused.body?.message));

    const filed = await req("POST", "/sales-invoices/SCN-D79-ONE-UNNAMED/confirm", {});
    check("the unnamed 0% sale confirms", filed.status === 200, JSON.stringify(filed.body).slice(0, 200));
    const queued = rows((await req("GET", "/eta/submissions")).body).find((s: any) => s.internalId === (filed.body?.invoice?.docNo ?? filed.body?.docNo));
    const payload = queued ? (await req("GET", `/eta/submissions/${queued.id}`)).body?.payload : null;
    check(
      "its e-invoice does NOT file the line under the one 0% rate the tenant holds — «معفى» V003 is never read off the percent",
      String(payload?.invoiceLines?.[0]?.taxableItems?.[0]?.subType) === "V004",
      JSON.stringify(payload?.invoiceLines?.[0]?.taxableItems ?? null).slice(0, 200),
    );
    const unclassified = (queued?.prevalidation ?? []).filter((f: any) => f.code === "TAX_SUBTYPE_NOT_MAPPED");
    check(
      "and one specific 0% classification is enough to block it from the authority until its rate is named",
      unclassified.length === 1 && unclassified[0]?.severity === "blocking" && queued?.hasBlockingFindings === true,
      JSON.stringify(unclassified).slice(0, 300),
    );

    const stuckFiled = await req("POST", "/sales-invoices/SCN-D79-ONE-EXEMPT-NONE/confirm", {});
    check("the uncarded exempt customer's sale still confirms and posts", stuckFiled.status === 200, JSON.stringify(stuckFiled.body).slice(0, 200));
    await ctx.drain();
    const stuckNo = stuckFiled.body?.invoice?.docNo ?? stuckFiled.body?.docNo;
    const stuckQueued = rows((await req("GET", "/eta/submissions?pageSize=500")).body).find((s: any) => s.internalId === stuckNo);
    const stuckFindings = (stuckQueued?.prevalidation ?? []).filter((f: any) => f.code === "TAX_SUBTYPE_NOT_MAPPED");
    check(
      "its e-invoice is BLOCKED from the authority until the line is classified — it is not filed V004 by default",
      stuckFindings.length === 1 && stuckFindings[0]?.severity === "blocking" && stuckQueued?.hasBlockingFindings === true,
      JSON.stringify(stuckQueued?.prevalidation ?? stuckQueued ?? null).slice(0, 300),
    );
    check(
      "and the finding's Arabic hint names both ways out: the classify action on the posted invoice, and the exemption rate on the customer card",
      String(stuckFindings[0]?.fixHintAr ?? "").includes("تصنيف ضريبة البند") && String(stuckFindings[0]?.fixHintAr ?? "").includes("بطاقة العميل"),
      String(stuckFindings[0]?.fixHintAr ?? ""),
    );

    const exemptFiled = await req("POST", "/sales-invoices/SCN-D79-ONE-EXEMPT-CUST/confirm", {});
    check("the carded exempt customer's sale confirms", exemptFiled.status === 200, JSON.stringify(exemptFiled.body).slice(0, 200));
    await ctx.drain();
    const exemptNo = exemptFiled.body?.invoice?.docNo ?? exemptFiled.body?.docNo;
    const exemptQueued = rows((await req("GET", "/eta/submissions?pageSize=500")).body).find((s: any) => s.internalId === exemptNo);
    const exemptPayload = exemptQueued ? (await req("GET", `/eta/submissions/${exemptQueued.id}`)).body?.payload : null;
    const exemptLines = exemptPayload?.invoiceLines ?? exemptPayload?.itemData;
    check(
      "its e-document — a receipt, the customer being a consumer — files the line under the card's rate's own sub-type, V003, because the line NAMES that rate",
      String(exemptLines?.[0]?.taxableItems?.[0]?.subType) === String(exempt?.etaSubType) && exempt?.etaSubType === "V003",
      JSON.stringify(exemptLines?.[0]?.taxableItems ?? exemptQueued ?? null).slice(0, 200),
    );
    check(
      "the confirm was not answered ETA_RECEIPT_NOT_READY, as a consumer sale with an unnamed 0% line is",
      !exemptFiled.body?.etaReceiptError,
      JSON.stringify(exemptFiled.body?.etaReceiptError ?? null).slice(0, 200),
    );
    check(
      "and it is NOT blocked from the authority — the finding the unnamed line carries is not on it",
      Boolean(exemptQueued) && (exemptQueued?.prevalidation ?? []).every((f: any) => f.code !== "TAX_SUBTYPE_NOT_MAPPED"),
      JSON.stringify(exemptQueued?.prevalidation ?? null).slice(0, 300),
    );
    const journal = (await req("GET", `/gl/journal-entries/${exemptFiled.body?.invoice?.journalEntryId ?? exemptFiled.body?.journalEntryId}`)).body;
    const revenueLine = (journal?.lines ?? []).find((l: any) => l.accountId === REVENUE);
    check("the posted revenue line carries the card's rate, so the ledger alone can say what the sale was", revenueLine?.taxRateId === exempt?.id && revenueLine?.taxRatePercent === 0, JSON.stringify(revenueLine ?? journal ?? null).slice(0, 200));
    const vatRows = rows((await req("GET", `/financial-reports/vat-return?periodFrom=${TODAY}&periodTo=${TODAY}`)).body);
    const exemptRow = vatRows.find((r: any) => r.side === "output" && r.taxRateId === exempt?.id);
    check("and the VAT return reports it on the row named for that rate, apart from the unnamed 0% row", exemptRow?.taxRateName === exempt?.name && n(exemptRow?.base) >= 100 && n(exemptRow?.tax) === 0, JSON.stringify(vatRows.filter((r: any) => r.side === "output")).slice(0, 300));
    for (const id of ["SCN-D79-ONE-VAT-OFF", "SCN-D79-ONE-PICKED"]) {
      await req("POST", `/sales-invoices/${id}/cancel`, {});
    }

    const release = await req(
      "POST",
      "/contracting/retention/releases",
      { id: "SCN-D79-REL", contractId: TOWER_CONTRACT, kind: "provisional", date: "2026-09-02", amount: "100.00", notes: "إفراج جزئي (سيناريو D79)" },
      { "x-user-id": "SCN-D79-MAKER" },
    );
    check("a retention release is drafted against a contract that really holds retention", release.status === 201, JSON.stringify(release.body).slice(0, 200));
    const released = await req("POST", "/contracting/retention/releases/SCN-D79-REL/release", { approvedBy: "SCN-D79-APPROVER" });
    check("and released by a second person", released.status === 200 && Boolean(released.body?.invoiceId), JSON.stringify(released.body).slice(0, 240));
    const releaseInvoice = (await req("GET", `/sales-invoices/${released.body?.invoiceId}`)).body;
    check(
      "the document the release raised is confirmed and makes no tax classification claim: one 0% line naming no rate — a release is a receivable reclass, not a supply",
      releaseInvoice?.status === "confirmed" && (releaseInvoice?.lines ?? []).length === 1 && releaseInvoice.lines[0].taxRatePercent === 0 && releaseInvoice.lines[0].taxRateId === null,
      `${releaseInvoice?.status} ${JSON.stringify((releaseInvoice?.lines ?? []).map((l: any) => [l.taxRatePercent, l.taxRateId]))}`,
    );
    const releaseJournal = (await req("GET", `/gl/journal-entries/${releaseInvoice?.journalEntryId}`)).body;
    const releaseLines = (releaseJournal?.lines ?? []) as any[];
    const releaseDebit = releaseLines.reduce((sum, l) => sum + (scaled(l.debit) ?? 0n), 0n);
    const releaseCredit = releaseLines.reduce((sum, l) => sum + (scaled(l.credit) ?? 0n), 0n);
    check(
      "its journal ties: Dr receivables 100.00 / Cr the retention account 100.00, two lines, no VAT line and no tax rate on either",
      releaseLines.length === 2 && releaseDebit === 100_000_000n && releaseCredit === 100_000_000n &&
        releaseLines.some((l) => l.accountId === AR && scaled(l.debit) === 100_000_000n) &&
        releaseLines.every((l) => l.accountId !== OUTPUT_TAX && (l.taxRateId ?? null) === null),
      JSON.stringify(releaseLines.map((l) => [l.accountId, l.debit, l.credit, l.taxRatePercent, l.taxRateId])),
    );
    const releaseDayVat = rows((await req("GET", "/financial-reports/vat-return?periodFrom=2026-09-02&periodTo=2026-09-02")).body);
    check("the VAT return for the release day reports nothing — not a 0% supply, not a negative purchase", releaseDayVat.length === 0, JSON.stringify(releaseDayVat).slice(0, 300));
    await ctx.drain();
    const releaseQueued = rows((await req("GET", "/eta/submissions?pageSize=500")).body).filter((s: any) => s.internalId === releaseInvoice?.docNo);
    check(
      "and the release is NOT filed with the authority: it produces no ETA submission at all (D79 round 4 — it was queued as a 100.00 V004 supply)",
      Boolean(releaseInvoice?.docNo) && releaseQueued.length === 0,
      JSON.stringify(releaseQueued.map((s: any) => [s.id, s.status, s.documentType])).slice(0, 300),
    );

    const reactivated = await req("PATCH", `/tax-rates/${exported?.id}`, { status: "active" });
    check("the export rate is active again, as the seed left it", reactivated.status === 200 && reactivated.body?.status === "active", JSON.stringify(reactivated.body).slice(0, 200));
  });

  await scenario("d79h · a rate stored lines name keeps its percent and sub-type; a quote accepted under a rate still converts after it is deactivated", async () => {
    const vat = listed.find((r: any) => r.rate === VAT && r.status === "active");
    const percent = await req("PATCH", `/tax-rates/${vat?.id}`, { rate: 15 });
    check("changing a referenced rate's percent is refused 409", percent.status === 409 && percent.body?.error === "TAX_RATE_IN_USE", `${percent.status} ${JSON.stringify(percent.body).slice(0, 160)}`);
    check("with an Arabic message and an English one telling the user what to do instead", /[؀-ۿ]/.test(String(percent.body?.message ?? "")) && /new tax rate/i.test(String(percent.body?.messageEn ?? "")), JSON.stringify(percent.body).slice(0, 300));
    const subType = await req("PATCH", `/tax-rates/${exempt?.id}`, { etaSubType: "V001" });
    check("changing a referenced rate's ETA sub-type is refused 409 — exempt cannot become export under filed documents", subType.status === 409 && subType.body?.error === "TAX_RATE_IN_USE", `${subType.status}`);
    const still = rows((await req("GET", "/tax-rates")).body);
    check("neither rate changed", still.find((r: any) => r.id === vat?.id)?.rate === VAT && still.find((r: any) => r.id === exempt?.id)?.etaSubType === "V003");

    await req("POST", "/tax-rates", { id: "SCN-D79-FREE", code: "SCN-D79-FREE", name: "نسبة تجريبية (سيناريو)", rate: 3, etaSubType: "V009" });
    const free = await req("PATCH", "/tax-rates/SCN-D79-FREE", { rate: 4 });
    check("a rate nothing references is still editable", free.status === 200 && free.body?.rate === 4, `${free.status} ${JSON.stringify(free.body).slice(0, 120)}`);

    const quote = await req("POST", "/sales-quotes", {
      id: "SCN-D79-QT-OLD", date: TODAY, expiryDate: "2026-09-23", customerId: CUSTOMER, customerNameAr: "عميل", branchId: BRANCH,
      lines: [{ lineId: "SCN-D79-QT-OLD-L1", itemId: "ITEM-DEMO-10", itemNameAr: "خدمة", qty: "1", unitPrice: "100", taxRateId: "SCN-D79-FREE" }],
    });
    check("a quote is raised under that rate", quote.status === 201 && quote.body?.lines?.[0]?.taxRateId === "SCN-D79-FREE", JSON.stringify(quote.body?.lines ?? quote.body).slice(0, 200));
    await req("POST", "/sales-quotes/SCN-D79-QT-OLD/send", {});
    await req("POST", "/sales-quotes/SCN-D79-QT-OLD/accept", {});
    const lockedNow = await req("PATCH", "/tax-rates/SCN-D79-FREE", { rate: 9 });
    check("the quote now references the rate, so its percent is fixed", lockedNow.status === 409, `${lockedNow.status}`);
    const retired = await req("PATCH", "/tax-rates/SCN-D79-FREE", { status: "inactive" });
    check("but it can still be deactivated", retired.status === 200 && retired.body?.status === "inactive", `${retired.status}`);

    const converted = await req("POST", "/sales-quotes/SCN-D79-QT-OLD/convert-to-invoice", {
      id: "SCN-D79-QT-OLD-INV", dueDate: "2026-09-23", warehouseId: WH, arAccountId: AR, taxAccountId: OUTPUT_TAX,
      lines: [{ lineId: "SCN-D79-QT-OLD-L1", isStock: false, revenueAccountId: REVENUE }],
    });
    check("the accepted quote still converts — it is not a dead end", converted.status === 201, `${converted.status} ${JSON.stringify(converted.body).slice(0, 200)}`);
    const invoice = (await req("GET", "/sales-invoices/SCN-D79-QT-OLD-INV")).body;
    check(
      "and the invoice line carries the quoted rate and the quoted percent, not a repriced one",
      invoice?.lines?.[0]?.taxRateId === "SCN-D79-FREE" && invoice?.lines?.[0]?.taxRatePercent === 4,
      JSON.stringify((invoice?.lines ?? []).map((l: any) => [l.taxRatePercent, l.taxRateId])),
    );
    await req("POST", "/sales-invoices/SCN-D79-QT-OLD-INV/cancel", {});
  });

  await scenario("d79i · an item sold on two lines at two rates is returned line by line — one line's return does not use up the other's", async () => {
    const vat = listed.find((r: any) => r.rate === VAT && r.status === "active");
    const sale = await req("POST", "/sales-invoices", {
      id: "SCN-D79-TWO", date: TODAY, dueDate: "2026-09-23", customerId: CUSTOMER, customerNameAr: "عميل", warehouseId: WH, branchId: BRANCH,
      arAccountId: AR, taxAccountId: OUTPUT_TAX,
      lines: [
        { lineId: "SCN-D79-TWO-L1", itemId: "ITEM-DEMO-10", itemNameAr: "خدمة خاضعة", isStock: false, qty: "2", unitPrice: "100", taxRateId: vat?.id, revenueAccountId: REVENUE },
        { lineId: "SCN-D79-TWO-L2", itemId: "ITEM-DEMO-10", itemNameAr: "خدمة معفاة", isStock: false, qty: "2", unitPrice: "100", taxRateId: exempt?.id, revenueAccountId: REVENUE },
      ],
    });
    check("the sale is drafted with one item on two lines", sale.status === 201, JSON.stringify(sale.body).slice(0, 200));
    const confirmed = await req("POST", "/sales-invoices/SCN-D79-TWO/confirm", {});
    check("and confirms", confirmed.status === 200, JSON.stringify(confirmed.body).slice(0, 200));

    const returnOf = (id: string, sourceLineId: string, qty: string) =>
      req("POST", "/sales-returns/from-invoice", {
        id, date: TODAY, memo: "مرتجع سطر محدد (سيناريو D79)", warehouseId: WH, sourceInvoiceId: "SCN-D79-TWO", reason: "DEFECTIVE",
        requested: [{ itemId: "ITEM-DEMO-10", sourceLineId, qty }],
      });
    const taxed = await returnOf("SCN-D79-TWO-RET1", "SCN-D79-TWO-L1", "2");
    check(
      "the whole taxed line comes back under the 14% rate with its 28.00 of VAT",
      taxed.status === 201 && taxed.body?.lines?.[0]?.taxRateId === vat?.id && n(taxed.body?.lines?.[0]?.taxAmount) === 28,
      JSON.stringify(taxed.body?.lines ?? taxed.body).slice(0, 240),
    );
    const taxedConfirmed = await req("POST", "/sales-returns/SCN-D79-TWO-RET1/confirm", {});
    check("and its return confirms", taxedConfirmed.status === 200, JSON.stringify(taxedConfirmed.body).slice(0, 200));

    const exemptLine = await returnOf("SCN-D79-TWO-RET2", "SCN-D79-TWO-L2", "2");
    check(
      "the exempt line is STILL fully returnable — the first return counted against its own line, not against the item",
      exemptLine.status === 201 && exemptLine.body?.lines?.[0]?.taxRateId === exempt?.id && n(exemptLine.body?.lines?.[0]?.taxAmount) === 0,
      `${exemptLine.status} ${JSON.stringify(exemptLine.body?.lines ?? exemptLine.body).slice(0, 240)}`,
    );
    const exemptConfirmed = await req("POST", "/sales-returns/SCN-D79-TWO-RET2/confirm", {});
    check("and its return confirms", exemptConfirmed.status === 200, JSON.stringify(exemptConfirmed.body).slice(0, 200));

    const again = await returnOf("SCN-D79-TWO-RET3", "SCN-D79-TWO-L2", "1");
    const againConfirmed = again.status === 201 ? await req("POST", "/sales-returns/SCN-D79-TWO-RET3/confirm", {}) : again;
    check(
      "and neither line can be returned a second time",
      again.status !== 201 || againConfirmed.status !== 200,
      `draft ${again.status} confirm ${againConfirmed.status} ${JSON.stringify(againConfirmed.body).slice(0, 200)}`,
    );
  });

  await scenario("d79j · one return cannot take an invoice line twice, two drafts against a line cannot both confirm, and a line the invoice does not carry is refused by name", async () => {
    const { scaled } = ctx;
    const window = `periodFrom=2020-01-01&periodTo=${ctx.today}`;
    const net = async (accountId: string): Promise<bigint> => {
      const totals = (await req("GET", `/financial-reports/account-ledger?accountId=${accountId}&${window}`)).body?.grandTotals;
      return (scaled(totals?.debit) ?? 0n) - (scaled(totals?.credit) ?? 0n);
    };
    const pounds = (major: number): bigint => BigInt(major * 100) * 10_000n;
    const ARABIC = /[\u0600-\u06FF]/;
    const vat = listed.find((r: any) => r.rate === VAT && r.status === "active");

    const sale = await req("POST", "/sales-invoices", {
      id: "SCN-D79-SUM", date: TODAY, dueDate: "2026-09-23", customerId: CUSTOMER, customerNameAr: "عميل", warehouseId: WH, branchId: BRANCH,
      arAccountId: AR, taxAccountId: OUTPUT_TAX,
      lines: [{ lineId: "SCN-D79-SUM-L1", itemId: "ITEM-DEMO-10", itemNameAr: "خدمة", isStock: false, qty: "3", unitPrice: "100", taxRateId: vat?.id, revenueAccountId: REVENUE }],
    });
    const saleConfirmed = sale.status === 201 ? await req("POST", "/sales-invoices/SCN-D79-SUM/confirm", {}) : sale;
    check("three units are sold on one line at 14%", saleConfirmed.status === 200, `${sale.status}/${saleConfirmed.status} ${JSON.stringify(saleConfirmed.body).slice(0, 200)}`);
    const arBefore = await net(AR);
    const vatBefore = await net(OUTPUT_TAX);

    const fromInvoice = (id: string, requested: unknown[]) =>
      req("POST", "/sales-returns/from-invoice", { id, date: TODAY, memo: "مرتجع (سيناريو D79j)", warehouseId: WH, sourceInvoiceId: "SCN-D79-SUM", reason: "DEFECTIVE", requested });
    const l1 = (qty: string) => ({ itemId: "ITEM-DEMO-10", sourceLineId: "SCN-D79-SUM-L1", qty });

    const twice = await fromInvoice("SCN-D79-SUM-TWICE", [l1("3"), l1("3")]);
    check("«مرتجع من فاتورة» naming the line twice — 3 + 3 against 3 sold — is refused 422", twice.status === 422, `${twice.status} ${JSON.stringify(twice.body).slice(0, 200)}`);
    check("the refusal is in Arabic and states the total it added up", ARABIC.test(String(twice.body?.message ?? "")) && String(twice.body?.message ?? "").includes("6.000000"), String(twice.body?.message));

    const raw = (qty: string) => ({
      itemId: "ITEM-DEMO-10", warehouseId: WH, customerId: CUSTOMER, sourceInvoiceId: "SCN-D79-SUM", sourceInvoiceNumber: null, sourceLineId: "SCN-D79-SUM-L1",
      reason: "DEFECTIVE", availableQty: "3", qty, unitPrice: "100", unitCost: "0", taxAmount: "0",
    });
    const twiceRaw = await req("POST", "/sales-returns", { id: "SCN-D79-SUM-TWICE-RAW", date: TODAY, memo: "", lines: [raw("3"), raw("3")] });
    check("the raw POST / shape naming the line twice is refused too", twiceRaw.status === 422, `${twiceRaw.status} ${JSON.stringify(twiceRaw.body).slice(0, 200)}`);

    const foreign = await fromInvoice("SCN-D79-SUM-FOREIGN", [l1("1"), { itemId: "ITEM-DEMO-10", sourceLineId: "SCN-D79-NO-SUCH-LINE", qty: "1" }]);
    check(
      "a requested line the invoice does not carry refuses the whole return as RETURN_LINE_NOT_ON_INVOICE, in Arabic — it is not dropped while the rest is drafted",
      foreign.status === 422 && foreign.body?.error === "RETURN_LINE_NOT_ON_INVOICE" && ARABIC.test(String(foreign.body?.message ?? "")),
      `${foreign.status} ${JSON.stringify(foreign.body).slice(0, 200)}`,
    );
    const foreignRaw = await req("POST", "/sales-returns", { id: "SCN-D79-SUM-FOREIGN-RAW", date: TODAY, memo: "", lines: [{ ...raw("1"), sourceLineId: "SCN-D79-NO-SUCH-LINE" }] });
    check("on POST / the same line id answers the same code, not «exceeds available (0)»", foreignRaw.status === 422 && foreignRaw.body?.error === "RETURN_LINE_NOT_ON_INVOICE", `${foreignRaw.status} ${JSON.stringify(foreignRaw.body).slice(0, 200)}`);
    check("nothing has moved AR or 2200 so far", (await net(AR)) === arBefore && (await net(OUTPUT_TAX)) === vatBefore, `ar ${(await net(AR)) - arBefore} vat ${(await net(OUTPUT_TAX)) - vatBefore}`);

    const draftA = await fromInvoice("SCN-D79-SUM-A", [l1("3")]);
    const draftB = await fromInvoice("SCN-D79-SUM-B", [l1("3")]);
    check("two drafts are raised against the same line, each for all three", draftA.status === 201 && draftB.status === 201, `${draftA.status}/${draftB.status}`);
    const confirmA = await req("POST", "/sales-returns/SCN-D79-SUM-A/confirm", {});
    check("the first confirms", confirmA.status === 200, JSON.stringify(confirmA.body).slice(0, 200));
    const confirmB = await req("POST", "/sales-returns/SCN-D79-SUM-B/confirm", {});
    check("the second is refused at confirm — what is returnable is read again from posted documents", confirmB.status === 422 && ARABIC.test(String(confirmB.body?.message ?? "")), `${confirmB.status} ${JSON.stringify(confirmB.body).slice(0, 200)}`);
    check("and stays a draft", (await req("GET", "/sales-returns/SCN-D79-SUM-B")).body?.status === "draft");
    const arMoved = (await net(AR)) - arBefore;
    const vatMoved = (await net(OUTPUT_TAX)) - vatBefore;
    check("AR was credited once: 300.00 + 42.00", arMoved === -pounds(342), `moved ${arMoved} (scaled 1e-6)`);
    check("and 2200 was reversed once: 42.00", vatMoved === pounds(42), `moved ${vatMoved} (scaled 1e-6)`);
    await req("POST", "/sales-returns/SCN-D79-SUM-B/cancel", {});

    const balances = await Promise.all(
      ["ITEM-DEMO-2", "ITEM-DEMO-3", "ITEM-DEMO-4"].map(async (itemId) => ({ itemId, ...(await req("GET", `/inventory/balance?itemId=${itemId}&warehouseId=${WH}`)).body })),
    );
    const exact = balances.find((b: any) => {
      const onHand = scaled(b.onHand);
      const average = scaled(b.averageCost);
      const value = scaled(b.totalValue);
      return onHand !== null && average !== null && value !== null && onHand > 0n && average % 10_000n === 0n && onHand * average === value * 1_000_000n;
    });
    check("a seeded stock item stands at a whole-piastre average, so buying and returning at that cost leaves its position as found", Boolean(exact), JSON.stringify(balances.map((b: any) => [b.itemId, b.onHand, b.averageCost, b.totalValue])));
    if (!exact) return;
    const SUPPLIER = "SUPP-DEMO-1";
    const AP = "2100";
    const INPUT_TAX = "1400";
    const onHandOf = async (): Promise<bigint> => scaled((await req("GET", `/inventory/balance?itemId=${exact.itemId}&warehouseId=${WH}`)).body?.onHand) ?? 0n;
    const purchase = await req("POST", "/purchases/invoices", {
      id: "SCN-D79-SUM-PI", supplierId: SUPPLIER, date: TODAY, dueDate: "2026-09-23", branchId: BRANCH, warehouseId: WH,
      lines: [{ itemId: exact.itemId, kind: "inventory", qty: "3", unitCost: String(exact.averageCost), taxRateId: vat?.id }],
    });
    const purchaseConfirmed = purchase.status === 201 ? await req("POST", "/purchases/invoices/SCN-D79-SUM-PI/confirm", {}) : purchase;
    check("three units are bought on one line at 14%", purchaseConfirmed.status === 200, `${purchase.status}/${purchaseConfirmed.status} ${JSON.stringify(purchaseConfirmed.body).slice(0, 200)}`);
    const apBefore = await net(AP);
    const inputBefore = await net(INPUT_TAX);
    const stockBefore = await onHandOf();
    const lineCost = (scaled(exact.averageCost) ?? 0n) * 3n;
    const lineTax = (lineCost * 14n) / 100n;

    const back = (qty: string) => ({ itemId: exact.itemId, warehouseId: WH, supplierId: SUPPLIER, sourceInvoiceId: "SCN-D79-SUM-PI", sourceInvoiceNumber: null, sourceLineId: "0", reason: "DEFECTIVE", qty });
    const purchaseReturn = (id: string, lines: unknown[]) => req("POST", "/purchase-returns", { id, date: TODAY, memo: "مرتجع مشتريات (سيناريو D79j)", lines });
    const twiceBack = await purchaseReturn("SCN-D79-SUM-PR-TWICE", [back("3"), back("3")]);
    check("a purchase return naming the line twice is refused 422, sending no cost, tax or returnable quantity of its own", twiceBack.status === 422, `${twiceBack.status} ${JSON.stringify(twiceBack.body).slice(0, 200)}`);
    const foreignBack = await purchaseReturn("SCN-D79-SUM-PR-FOREIGN", [{ ...back("1"), sourceLineId: "9" }]);
    check("a purchase line the invoice does not carry answers RETURN_LINE_NOT_ON_INVOICE", foreignBack.status === 422 && foreignBack.body?.error === "RETURN_LINE_NOT_ON_INVOICE", `${foreignBack.status} ${JSON.stringify(foreignBack.body).slice(0, 200)}`);
    const backA = await purchaseReturn("SCN-D79-SUM-PR-A", [back("3")]);
    const backB = await purchaseReturn("SCN-D79-SUM-PR-B", [back("3")]);
    check("two purchase-return drafts are raised against the same line", backA.status === 201 && backB.status === 201, `${backA.status}/${backB.status} ${JSON.stringify(backA.body).slice(0, 160)}`);
    check("the server read the line's own tax off the invoice", scaled(backA.body?.lines?.[0]?.taxAmount) === lineTax, `${backA.body?.lines?.[0]?.taxAmount} vs ${lineTax}`);
    const backAConfirmed = await req("POST", "/purchase-returns/SCN-D79-SUM-PR-A/confirm", {});
    const backBConfirmed = await req("POST", "/purchase-returns/SCN-D79-SUM-PR-B/confirm", {});
    check("only the first confirms", backAConfirmed.status === 200 && backBConfirmed.status === 422, `${backAConfirmed.status}/${backBConfirmed.status} ${JSON.stringify(backBConfirmed.body).slice(0, 200)}`);
    check("stock left once: three units", stockBefore - (await onHandOf()) === 3_000_000n, `moved ${stockBefore - (await onHandOf())}`);
    check("AP was debited once: the line and its tax", (await net(AP)) - apBefore === lineCost + lineTax, `moved ${(await net(AP)) - apBefore} vs ${lineCost + lineTax}`);
    check("and 1400 was reversed once", (await net(INPUT_TAX)) - inputBefore === -lineTax, `moved ${(await net(INPUT_TAX)) - inputBefore} vs ${-lineTax}`);
    await req("POST", "/purchase-returns/SCN-D79-SUM-PR-B/cancel", {});
  });
}

export async function vatReturnInputBaseTiesToItsTax_D79(ctx: Ctx): Promise<void> {
  const { req, n, check, rows, scaled } = ctx;
  const window = `periodFrom=2020-01-01&periodTo=${ctx.today}`;
  const inputRows = rows((await req("GET", `/financial-reports/vat-return?${window}`)).body).filter((r: any) => r.side === "input");
  const taxed = inputRows.filter((r: any) => n(r.rate) > 0);
  check("D79 seeded tenant · the VAT return has a taxed input row to check", taxed.length > 0, JSON.stringify(inputRows).slice(0, 200));
  for (const row of taxed) {
    const expected = (n(row.base) * n(row.rate)) / 100;
    check(
      `D79 seeded tenant · input row ${row.rowId}: base × ${row.rate}% is its tax, within the per-line rounding`,
      n(row.base) > 0 && Math.abs(expected - n(row.tax)) <= 1,
      `base ${row.base} × ${row.rate}% = ${expected.toFixed(2)} vs tax ${row.tax}`,
    );
  }
  const ledger = (await req("GET", `/financial-reports/account-ledger?accountId=1400&${window}`)).body;
  const debit = scaled(ledger?.grandTotals?.debit);
  const credit = scaled(ledger?.grandTotals?.credit);
  const reported = inputRows.reduce((sum: bigint, r: any) => sum + (scaled(r.tax) ?? 0n), 0n);
  check(
    "D79 seeded tenant · the input tax the return reports is exactly what GL 1400 moved",
    debit !== null && credit !== null && reported === debit - credit,
    `return ${Number(reported) / 1e6} vs ledger ${debit === null || credit === null ? "?" : Number(debit - credit) / 1e6}`,
  );
}

const BILLINGS = "2165";
const RECLASSIFICATION_DOC_TYPES: ReadonlySet<string> = new Set(["REVENUE_RECOGNITION_RUN", "YEAR_END_CLOSE"]);
const SCALE = 1_000_000n;
const PIASTRE = 10_000n;

function toPiastre(numerator: bigint, denominator: bigint): bigint {
  return ((numerator * 2n + denominator * PIASTRE) / (denominator * PIASTRE * 2n)) * PIASTRE;
}

function taxOnLine(qty: bigint, unitPrice: bigint, ratePercent: number): bigint {
  const extended = toPiastre(qty * unitPrice, SCALE);
  return toPiastre(extended * BigInt(Math.round(ratePercent * 1_000_000)), 100n * SCALE);
}

async function postedEntries(ctx: Ctx, toDate: string): Promise<any[]> {
  const entries: any[] = [];
  for (let page = 1; ; page += 1) {
    const batch = ctx.rows((await ctx.req("GET", `/gl/journal-entries?fromDate=2020-01-01&toDate=${toDate}&page=${page}&pageSize=200`)).body);
    entries.push(...batch.filter((e: any) => e.status === "posted" || e.status === "reversed"));
    if (batch.length < 200) return entries;
  }
}

export async function vatReturnOutputBaseTiesToItsTax_D79(ctx: Ctx): Promise<void> {
  const { req, n, check, rows, scaled } = ctx;
  const window = `periodFrom=2020-01-01&periodTo=${ctx.today}`;
  const outputRows = rows((await req("GET", `/financial-reports/vat-return?${window}`)).body).filter((r: any) => r.side === "output");
  const taxed = outputRows.filter((r: any) => n(r.rate) > 0);
  check("D79 seeded tenant · the VAT return has a taxed output row to check", taxed.length > 0, JSON.stringify(outputRows).slice(0, 200));

  const entries = await postedEntries(ctx, ctx.today);
  const accounts = rows((await req("GET", "/accounts")).body);
  const baseAccounts = new Set<string>([BILLINGS, ...accounts.filter((a: any) => a.type === "revenue").map((a: any) => String(a.id))]);
  check("D79 seeded tenant · the chart names its revenue accounts", baseAccounts.size > 1, `${baseAccounts.size} base accounts`);

  const taxByRow = new Map<string, bigint>();
  const taxByDocument = new Map<string, Map<string, bigint>>();
  let ledgerBase = 0n;
  for (const entry of entries) {
    for (const line of entry.lines ?? []) {
      if (line.accountId === OUTPUT_TAX) {
        const key = `${line.taxRatePercent ?? ""}|${line.taxRateId ?? ""}`;
        const moved = (scaled(line.credit) ?? 0n) - (scaled(line.debit) ?? 0n);
        taxByRow.set(key, (taxByRow.get(key) ?? 0n) + moved);
        const ofDocument = taxByDocument.get(`${entry.sourceDocType}|${entry.sourceDocId}`) ?? new Map<string, bigint>();
        ofDocument.set(key, (ofDocument.get(key) ?? 0n) + moved);
        taxByDocument.set(`${entry.sourceDocType}|${entry.sourceDocId}`, ofDocument);
      }
      if (RECLASSIFICATION_DOC_TYPES.has(String(entry.sourceDocType)) || !baseAccounts.has(String(line.accountId))) continue;
      ledgerBase += (scaled(line.credit) ?? 0n) - (scaled(line.debit) ?? 0n);
    }
  }
  const reportedBase = outputRows.reduce((sum: bigint, r: any) => sum + (scaled(r.base) ?? 0n), 0n);
  check(
    "D79 seeded tenant · the output base the return reports, 0% rows included, is exactly what revenue and the billings liability moved",
    reportedBase === ledgerBase,
    `return ${reportedBase} vs ledger ${ledgerBase} (scaled 1e-6), gap ${reportedBase - ledgerBase}`,
  );
  const recognised = entries.filter((e: any) => e.sourceDocType === "REVENUE_RECOGNITION_RUN").length;
  check("D79 seeded tenant · and the tenant holds a recognition run, so the tie-out is exercised against one", recognised > 0, `${recognised} recognition entries`);

  for (const row of taxed) {
    const posted = taxByRow.get(`${row.rate}|${row.taxRateId ?? ""}`) ?? null;
    check(
      `D79 seeded tenant · output row ${row.rowId}: its tax is exactly what GL 2200 carries under that rate — no tolerance`,
      posted !== null && scaled(row.tax) === posted,
      `return ${row.tax} vs ledger ${posted} (scaled 1e-6)`,
    );
  }

  const invoices = (await ctx.allRows("/sales-invoices")).filter((i: any) => ["confirmed", "partially_paid", "paid"].includes(String(i.status)));
  const noDiscount = (discount: any) => !discount || (scaled(discount.amount ?? "0") ?? 0n) === 0n && Number(discount.percent ?? 0) === 0;
  const pricedPlainly = (invoice: any) =>
    !invoice.taxInclusive && !invoice.fxRate && !invoice.appliedPromotion && !invoice.customerTaxExempt && noDiscount(invoice.discount) &&
    invoice.lines.every((l: any) => Number(l.discountPercent ?? 0) === 0 && (scaled(l.discountAmount ?? "0") ?? 0n) === 0n);
  let rederived = 0;
  let totalled = 0;
  let foreign = 0;
  const mismatched: string[] = [];
  for (const invoice of invoices) {
    const postedByKey = taxByDocument.get(`SALES_INVOICE|${invoice.id}`) ?? new Map<string, bigint>();
    const postedTotal = [...postedByKey.values()].reduce((sum, v) => sum + v, 0n);
    if (invoice.fxRate) {
      foreign += 1;
      continue;
    }
    if (!pricedPlainly(invoice)) {
      totalled += 1;
      if (postedTotal !== scaled(invoice.totals?.taxTotal)) mismatched.push(`${invoice.docNo}: posted ${postedTotal} vs document ${invoice.totals?.taxTotal}`);
      continue;
    }
    rederived += 1;
    const expectedByKey = new Map<string, bigint>();
    for (const line of invoice.lines) {
      const tax = taxOnLine(scaled(line.qty) ?? 0n, scaled(line.unitPrice) ?? 0n, Number(line.taxRatePercent));
      if (tax === 0n) continue;
      const key = `${line.taxRatePercent}|${line.taxRateId ?? ""}`;
      expectedByKey.set(key, (expectedByKey.get(key) ?? 0n) + tax);
    }
    const keys = new Set([...expectedByKey.keys(), ...postedByKey.keys()]);
    for (const key of keys) {
      if ((expectedByKey.get(key) ?? 0n) !== (postedByKey.get(key) ?? 0n)) {
        mismatched.push(`${invoice.docNo} [${key}]: lines give ${expectedByKey.get(key) ?? 0n} vs posted ${postedByKey.get(key) ?? 0n}`);
      }
    }
  }
  check(
    "D79 seeded tenant · every sales invoice priced without discounts posts, per rate, EXACTLY the sum of its lines' own piastre-rounded tax; every other base-currency invoice posts exactly its document tax",
    mismatched.length === 0 && rederived > 0,
    `${rederived} re-derived line by line, ${totalled} held to the document total, ${foreign} foreign-currency left to D203's own check; mismatches: ${mismatched.slice(0, 5).join(" · ") || "none"}`,
  );
  const ledger = (await req("GET", `/financial-reports/account-ledger?accountId=${OUTPUT_TAX}&${window}`)).body;
  const debit = scaled(ledger?.grandTotals?.debit);
  const credit = scaled(ledger?.grandTotals?.credit);
  const reported = outputRows.reduce((sum: bigint, r: any) => sum + (scaled(r.tax) ?? 0n), 0n);
  check(
    "D79 seeded tenant · the output tax the return reports is exactly what GL 2200 moved",
    debit !== null && credit !== null && reported === credit - debit,
    `return ${reported} vs ledger ${debit === null || credit === null ? "?" : credit - debit} (scaled 1e-6)`,
  );
}

export async function taxIsRoundedPerLine_D79(ctx: Ctx): Promise<void> {
  const { req, check, scenario, rows, scaled } = ctx;
  await scenario("d79i · tax is rounded on each line and then summed: three lines of 0.25 at 14% post 0.12, exactly, on the ledger and on the VAT return", async () => {
    const vat = rows((await req("GET", "/tax-rates")).body).find((r: any) => r.rate === VAT && r.status === "active");
    const outputRow = async () => rows((await req("GET", `/financial-reports/vat-return?periodFrom=${TODAY}&periodTo=${TODAY}`)).body).find((r: any) => r.side === "output" && r.taxRateId === vat?.id);
    const before = await outputRow();
    const created = await req("POST", "/sales-invoices", {
      id: "SCN-D79-ROUND", date: TODAY, dueDate: "2026-09-23", customerId: CUSTOMER, customerNameAr: "عميل", warehouseId: WH, branchId: BRANCH,
      arAccountId: AR, taxAccountId: OUTPUT_TAX,
      lines: ["L1", "L2", "L3"].map((lineId) => ({ lineId: `SCN-D79-ROUND-${lineId}`, itemId: "ITEM-DEMO-10", itemNameAr: "خدمة", isStock: false, qty: "1", unitPrice: "0.25", taxRateId: vat?.id, revenueAccountId: REVENUE })),
    });
    check("an invoice of three 0.25 lines at 14% is drafted", created.status === 201, JSON.stringify(created.body).slice(0, 200));
    const confirmed = await req("POST", "/sales-invoices/SCN-D79-ROUND/confirm", {});
    check("and confirms", confirmed.status === 200, JSON.stringify(confirmed.body).slice(0, 200));
    const perLine = taxOnLine(1_000_000n, 250_000n, VAT);
    check("each line's own tax is 0.04 — 0.035 rounded up to the piastre", perLine === 40_000n, `${perLine}`);
    const entry = (await req("GET", `/gl/journal-entries/${confirmed.body?.invoice?.journalEntryId ?? confirmed.body?.journalEntryId}`)).body;
    const taxLines = (entry?.lines ?? []).filter((l: any) => l.accountId === OUTPUT_TAX);
    check(
      "the entry credits 2200 with 0.12 — three times the line's tax, not 14% of the 0.75 total (0.105)",
      taxLines.length === 1 && scaled(taxLines[0].credit) === 3n * perLine && 3n * perLine === 120_000n,
      JSON.stringify(taxLines.map((l: any) => [l.credit, l.taxRatePercent, l.taxRateId])),
    );
    const after = await outputRow();
    const moved = (key: "base" | "tax") => (scaled(after?.[key]) ?? 0n) - (scaled(before?.[key]) ?? 0n);
    check("the VAT return's 14% row moved by exactly 0.75 of base and 0.12 of tax", moved("base") === 750_000n && moved("tax") === 120_000n, `base ${moved("base")} tax ${moved("tax")} (scaled 1e-6)`);
  });
}

export async function postedLineTaxIsClassified_D79(ctx: Ctx): Promise<void> {
  const { req, check, scenario, rows, scaled } = ctx;
  await scenario("d79j · a posted line that named no rate is classified: NULL → a rate at its own percent, on the line and the ledger, audited; never rate → rate, never another percent", async () => {
    const listed = rows((await req("GET", "/tax-rates")).body);
    const exempt = listed.find((r: any) => r.etaSubType === "V003" && r.rate === 0 && r.status === "active");
    const exported = listed.find((r: any) => r.etaSubType === "V001" && r.rate === 0 && r.status === "active");
    const vat = listed.find((r: any) => r.rate === VAT && r.status === "active");
    const STUCK = "SCN-D79-ONE-EXEMPT-NONE";
    const LINE = `${STUCK}-L1`;
    const classify = (lineId: string, body: unknown, over?: Record<string, string>) => req("POST", `/sales-invoices/${STUCK}/lines/${lineId}/classify-tax`, body, over);
    const read = async () => {
      const invoice = (await req("GET", `/sales-invoices/${STUCK}`)).body;
      const entry = (await req("GET", `/gl/journal-entries/${invoice?.journalEntryId}`)).body;
      return { invoice, entry, money: JSON.stringify((entry?.lines ?? []).map((l: any) => [l.accountId, l.debit, l.credit, l.taxRatePercent])) };
    };
    const before = await read();
    check("the sale d79g left blocked is posted and its line names no rate", before.invoice?.status === "confirmed" && before.invoice?.lines?.[0]?.taxRateId === null, JSON.stringify(before.invoice?.lines?.map((l: any) => [l.taxRatePercent, l.taxRateId])));
    const trialBefore = (await req("GET", "/financial-reports/trial-balance")).body?.grandTotals;

    const forbidden = await classify(LINE, { taxRateId: exempt?.id }, { "x-user-id": "SCN-D79-CLERK", "x-permissions": "sales.invoice.view,sales.invoice.confirm,sales.invoice.void" });
    check("viewing, confirming and voiding invoices do not carry the right to classify: 403", forbidden.status === 403, `${forbidden.status}`);
    const taxed = await classify(LINE, { taxRateId: vat?.id });
    check(
      "a 0% line cannot be classified under the 14% rate — 422, in Arabic; classification never changes the tax",
      taxed.status === 422 && taxed.body?.error === "TAX_RATE_CLASSIFICATION_PERCENT_MISMATCH" && /[\u0600-\u06FF]/.test(String(taxed.body?.message ?? "")),
      `${taxed.status} ${JSON.stringify(taxed.body).slice(0, 200)}`,
    );
    check("and both refusals wrote nothing", (await read()).money === before.money && (await read()).invoice?.lines?.[0]?.taxRateId === null);

    const done = await classify(LINE, { taxRateId: exempt?.id });
    check(
      "naming «معفى» is accepted: one line, one journal line, and the queued e-invoice is rebuilt",
      done.status === 200 && JSON.stringify(done.body?.lineIds) === JSON.stringify([LINE]) && done.body?.journalLinesNamed === 1 && done.body?.filing === "requeued",
      `${done.status} ${JSON.stringify(done.body).slice(0, 240)}`,
    );
    const after = await read();
    check("the invoice line now names the rate at the same 0%", after.invoice?.lines?.[0]?.taxRateId === exempt?.id && after.invoice?.lines?.[0]?.taxRatePercent === 0, JSON.stringify(after.invoice?.lines?.map((l: any) => [l.taxRatePercent, l.taxRateId])));
    check("its revenue journal line carries the rate", (after.entry?.lines ?? []).filter((l: any) => l.taxRatePercent === 0).every((l: any) => l.taxRateId === exempt?.id), JSON.stringify((after.entry?.lines ?? []).map((l: any) => [l.accountId, l.taxRatePercent, l.taxRateId])));
    check("no account, amount, percent, date, number or status moved on the entry", after.money === before.money && after.entry?.date === before.entry?.date && after.entry?.entryNo === before.entry?.entryNo && after.entry?.status === before.entry?.status, `${after.money} vs ${before.money}`);
    check("the invoice's totals are what they were", JSON.stringify(after.invoice?.totals) === JSON.stringify(before.invoice?.totals), JSON.stringify(after.invoice?.totals));
    const trialAfter = (await req("GET", "/financial-reports/trial-balance")).body?.grandTotals;
    check("and the trial balance did not move by a micro-unit", scaled(trialAfter?.debit) === scaled(trialBefore?.debit) && scaled(trialAfter?.credit) === scaled(trialBefore?.credit), JSON.stringify([trialBefore, trialAfter]));

    await ctx.drain();
    const queued = rows((await req("GET", "/eta/submissions?pageSize=500")).body).find((s: any) => s.internalId === after.invoice?.docNo);
    check(
      "the e-invoice's blocking finding is gone and it is ready to send",
      queued?.status === "ready" && queued?.hasBlockingFindings === false && (queued?.prevalidation ?? []).every((f: any) => f.code !== "TAX_SUBTYPE_NOT_MAPPED"),
      JSON.stringify([queued?.status, queued?.prevalidation]).slice(0, 300),
    );
    const payload = queued ? (await req("GET", `/eta/submissions/${queued.id}`)).body?.payload : null;
    check("and files the line under the rate's own sub-type, V003", String(payload?.invoiceLines?.[0]?.taxableItems?.[0]?.subType) === "V003", JSON.stringify(payload?.invoiceLines?.[0]?.taxableItems ?? null).slice(0, 200));

    const moved = await classify(LINE, { taxRateId: exported?.id });
    check("the line cannot then be moved to «تصدير»: 409 TAX_RATE_ALREADY_CLASSIFIED", moved.status === 409 && moved.body?.error === "TAX_RATE_ALREADY_CLASSIFIED", `${moved.status} ${JSON.stringify(moved.body).slice(0, 160)}`);
    check("and still names «معفى»", (await read()).invoice?.lines?.[0]?.taxRateId === exempt?.id);

    const trail = rows((await req("GET", `/audit?stream=sensitive&entityType=SALES_INVOICE&entityId=${STUCK}&action=CLASSIFY_LINE_TAX`)).body);
    check(
      "the audit trail holds one row: who, which line, and the tax before and after",
      trail.length === 1 && trail[0]?.actor === "USER-ADMIN" && trail[0]?.details?.before?.taxRateId === null && trail[0]?.details?.after?.taxRateId === exempt?.id && JSON.stringify(trail[0]?.details?.lineIds) === JSON.stringify([LINE]),
      JSON.stringify(trail).slice(0, 300),
    );

    const quote = await req("POST", "/sales-quotes", {
      id: "SCN-D79-QT-NULL", date: TODAY, expiryDate: "2026-09-23", customerId: CUSTOMER, customerNameAr: "عميل", branchId: BRANCH,
      lines: [
        { lineId: "SCN-D79-QT-NULL-L1", itemId: "ITEM-DEMO-10", itemNameAr: "خدمة", qty: "1", unitPrice: "100", taxRatePercent: VAT, taxRateId: null },
        { lineId: "SCN-D79-QT-NULL-L2", itemId: "ITEM-DEMO-10", itemNameAr: "خدمة", qty: "1", unitPrice: "100", taxRatePercent: 0, taxRateId: null },
      ],
    });
    check("a quote whose lines name no rate is raised, as an old quote already holds them", quote.status === 201 && JSON.stringify((quote.body?.lines ?? []).map((l: any) => l.taxRateId)) === "[null,null]", JSON.stringify(quote.body?.lines ?? quote.body).slice(0, 200));
    await req("POST", "/sales-quotes/SCN-D79-QT-NULL/send", {});
    await req("POST", "/sales-quotes/SCN-D79-QT-NULL/accept", {});
    const convert = (lines: unknown[]) => req("POST", "/sales-quotes/SCN-D79-QT-NULL/convert-to-invoice", { id: "SCN-D79-QT-NULL-INV", dueDate: "2026-09-23", warehouseId: WH, arAccountId: AR, taxAccountId: OUTPUT_TAX, lines });
    const repriced = await convert([
      { lineId: "SCN-D79-QT-NULL-L1", isStock: false, revenueAccountId: REVENUE, taxRateId: exempt?.id },
      { lineId: "SCN-D79-QT-NULL-L2", isStock: false, revenueAccountId: REVENUE },
    ]);
    check("converting it cannot name a 0% rate on its 14% line: 422, and no invoice is raised", repriced.status === 422 && (await req("GET", "/sales-invoices/SCN-D79-QT-NULL-INV")).status === 404, `${repriced.status} ${JSON.stringify(repriced.body).slice(0, 160)}`);
    const converted = await convert([
      { lineId: "SCN-D79-QT-NULL-L1", isStock: false, revenueAccountId: REVENUE, taxRateId: vat?.id },
      { lineId: "SCN-D79-QT-NULL-L2", isStock: false, revenueAccountId: REVENUE, taxRateId: exempt?.id },
    ]);
    const invoice = (await req("GET", "/sales-invoices/SCN-D79-QT-NULL-INV")).body;
    check(
      "converting it MAY name each line's rate at the line's own percent — the invoice is drafted with both named, never stuck",
      converted.status === 201 && JSON.stringify((invoice?.lines ?? []).map((l: any) => [l.taxRatePercent, l.taxRateId])) === JSON.stringify([[VAT, vat?.id], [0, exempt?.id]]),
      `${converted.status} ${JSON.stringify((invoice?.lines ?? []).map((l: any) => [l.taxRatePercent, l.taxRateId]))}`,
    );
    await req("POST", "/sales-invoices/SCN-D79-QT-NULL-INV/cancel", {});
  });
}
