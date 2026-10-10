import { openSqliteConnection } from "../../packages/persistence/src/index.js";
import type { Ctx } from "./harness.js";

/**
 * بُعد الفرع (D111, DEC-20) — the branch on the posted journal line.
 *
 * Three claims, each one proved against something independent of the code
 * that makes it: the branch statements add up to the company to the
 * micro-unit, a branch-scoped caller cannot read or write past their grant,
 * and a new document of each major type lands with its branch on the rows
 * SQLite actually holds.
 */
const MAIN = "BR-MAIN";
const ALEX = "BR-ALEX";
const ALEX_WAREHOUSE = "WH-ALEX";
const ALEX_CASH_GL = "1300-ALEX";
const ALEX_TREASURY = "TR-DEMO-CASH-ALEX";
const UNATTRIBUTED = "__unattributed__";
const ITEM = "ITEM-DEMO-1";
const CUSTOMER = "CUST-DEMO-2";
const SUPPLIER = "SUPP-DEMO-1";
const ALEX_GRANT = { "x-branch-grant": ALEX };

type Nets = ReadonlyMap<string, bigint>;

export async function run(ctx: Ctx): Promise<void> {
  const { scenario: it, req, rows, scaled, check, today } = ctx;
  const { sqlite } = openSqliteConnection(ctx.dbPath);

  const branchesOfEntry = (where: string, value: string): (string | null)[] =>
    (
      sqlite
        .prepare(`SELECT l.branch_id AS branchId FROM journal_line l JOIN journal_entry e ON e.id = l.entry_id WHERE ${where} = ?`)
        .all(value) as { branchId: string | null }[]
    ).map((row) => row.branchId);
  const branchesOfDocument = (sourceDocId: string) => branchesOfEntry("e.source_doc_id", sourceDocId);
  const allOn = (branches: readonly (string | null)[], branchId: string | null) =>
    branches.length >= 2 && branches.every((b) => b === branchId);

  const units = (value: unknown): bigint => scaled(value) ?? 0n;
  const netsOf = (body: any, netOf: (row: any) => bigint): Map<string, bigint> =>
    new Map(rows(body).map((row: any) => [String(row.accountId), netOf(row)]));
  const add = (parts: readonly Nets[]): Map<string, bigint> => {
    const total = new Map<string, bigint>();
    for (const part of parts) for (const [account, net] of part) total.set(account, (total.get(account) ?? 0n) + net);
    return total;
  };
  const firstDifference = (whole: Nets, parts: Nets): string | null => {
    for (const account of new Set([...whole.keys(), ...parts.keys()])) {
      const a = whole.get(account) ?? 0n;
      const b = parts.get(account) ?? 0n;
      if (a !== b) return `${account}: company ${a} vs parts ${b}`;
    }
    return null;
  };

  const trialBalance = async (branchId: string, over?: Record<string, string>) => {
    const res = await req("GET", `/financial-reports/trial-balance?asOfDate=${today}&branchId=${encodeURIComponent(branchId)}`, undefined, over);
    return { res, nets: netsOf(res.body, (row) => units(row.debit) - units(row.credit)) };
  };
  const incomeStatement = async (branchId: string, over?: Record<string, string>) => {
    const res = await req(
      "GET",
      `/financial-reports/income-statement?periodFrom=2026-01-01&periodTo=${today}&branchId=${encodeURIComponent(branchId)}`,
      undefined,
      over,
    );
    return { res, nets: netsOf(res.body, (row) => units(row.amount)) };
  };

  await it("branch dimension · the seeded books hold more than one branch and an unattributed bucket", async () => {
    const seededSecondBranch = sqlite.prepare("SELECT COUNT(*) AS n FROM journal_line WHERE branch_id = ?").get(ALEX) as { n: number };
    check(`${ALEX} was seeded with postings — without it every assertion below proves nothing`, seededSecondBranch.n > 0, `${seededSecondBranch.n} lines`);
    if (seededSecondBranch.n === 0) throw new Error(`${ALEX} is absent from the seeded ledger; the demo seed skipped the second branch`);
    const buckets = sqlite
      .prepare("SELECT COALESCE(branch_id, '') AS branchId, COUNT(*) AS lineCount FROM journal_line GROUP BY 1")
      .all() as { branchId: string; lineCount: number }[];
    const named = buckets.filter((b) => b.branchId !== "");
    check("at least two branches carry posted lines", named.length >= 2, JSON.stringify(buckets));
    check("some posted lines carry no branch at all", buckets.some((b) => b.branchId === "" && b.lineCount > 0), JSON.stringify(buckets));
    const registered = new Set(rows((await req("GET", "/branches")).body).map((b: any) => b.id));
    check("every branch on a posted line is a branch in the register", named.every((b) => registered.has(b.branchId)), JSON.stringify(named));
  });

  await it("branch dimension · company = Σ branches + غير مخصص, to the micro-unit", async () => {
    const branchIds: string[] = rows((await req("GET", "/branches")).body).map((b: any) => String(b.id));

    const companyTb = await trialBalance("");
    check("the company trial balance answers", companyTb.res.ok && companyTb.nets.size > 0, `status ${companyTb.res.status}`);
    const tbParts = add([...(await Promise.all(branchIds.map((id) => trialBalance(id)))).map((p) => p.nets), (await trialBalance(UNATTRIBUTED)).nets]);
    const tbDiff = firstDifference(companyTb.nets, tbParts);
    check("trial balance: every account's company net equals its branches plus the unattributed bucket", tbDiff === null, tbDiff ?? "");
    const tbUnattributedColumn = netsOf(companyTb.res.body, (row) => units(row.unattributed));
    const tbColumnDiff = firstDifference((await trialBalance(UNATTRIBUTED)).nets, tbUnattributedColumn);
    check("trial balance: the «غير مخصص» column is the unattributed statement itself", tbColumnDiff === null, tbColumnDiff ?? "");
    check(
      "trial balance: a second branch actually holds something",
      [...(await trialBalance(ALEX)).nets.values()].some((net) => net !== 0n),
    );

    const companyIs = await incomeStatement("");
    check("the company income statement answers", companyIs.res.ok && companyIs.nets.size > 0, `status ${companyIs.res.status}`);
    const isParts = add([...(await Promise.all(branchIds.map((id) => incomeStatement(id)))).map((p) => p.nets), (await incomeStatement(UNATTRIBUTED)).nets]);
    const isDiff = firstDifference(companyIs.nets, isParts);
    check("income statement: every line's company figure equals its branches plus the unattributed bucket", isDiff === null, isDiff ?? "");
    const sum = (nets: Nets) => [...nets.values()].reduce((total, net) => total + net, 0n);
    check("income statement: net income adds up the same way", sum(companyIs.nets) === sum(isParts), `${sum(companyIs.nets)} vs ${sum(isParts)}`);
  });

  await it("branch dimension · a branch-scoped caller is narrowed on every read and refused on every write past the grant", async () => {
    const own = add([(await trialBalance(ALEX)).nets, (await trialBalance(UNATTRIBUTED)).nets]);
    const scopedAll = await trialBalance("", ALEX_GRANT);
    const scopedDiff = firstDifference(scopedAll.nets, own);
    check("the scoped trial balance is its own branch plus the unattributed bucket, nothing else", scopedDiff === null, scopedDiff ?? "");

    const foreign = await trialBalance(MAIN, ALEX_GRANT);
    check("asking for another branch by id returns none of its figures", [...foreign.nets.values()].every((net) => net === 0n), `status ${foreign.res.status}`);

    const widened = await trialBalance("", { ...ALEX_GRANT, "x-branch-scope": "*" });
    const widenedDiff = firstDifference(widened.nets, own);
    check("an `x-branch-scope: *` header does not widen the grant", widenedDiff === null, widenedDiff ?? "");
    const unattributedOnly = (await trialBalance(UNATTRIBUTED)).nets;
    const narrowedElsewhere = await trialBalance("", { ...ALEX_GRANT, "x-branch-scope": MAIN });
    check(
      "nor does naming the other branch in the header: the answer never grows past the grant",
      firstDifference(narrowedElsewhere.nets, own) === null || firstDifference(narrowedElsewhere.nets, unattributedOnly) === null,
      `status ${narrowedElsewhere.res.status}`,
    );

    const scopedIs = await incomeStatement(MAIN, ALEX_GRANT);
    check("the scoped income statement shows nothing of another branch", [...scopedIs.nets.values()].every((net) => net === 0n));

    const mainOnlyEntries = new Set(
      (
        sqlite
          .prepare(
            "SELECT COALESCE(e.entry_no, e.id) AS entryNo FROM journal_entry e JOIN journal_line l ON l.entry_id = e.id GROUP BY e.id HAVING COUNT(*) = SUM(CASE WHEN l.branch_id = ? THEN 1 ELSE 0 END)",
          )
          .all(MAIN) as { entryNo: string }[]
      ).map((row) => row.entryNo),
    );
    const scopedLedger = await req("GET", `/financial-reports/general-ledger?periodFrom=2026-01-01&periodTo=${today}`, undefined, ALEX_GRANT);
    const leaked = rows(scopedLedger.body).filter((row: any) => mainOnlyEntries.has(row.entryNo));
    check("the scoped general ledger answers", scopedLedger.ok && rows(scopedLedger.body).length > 0, `status ${scopedLedger.status}`);
    check("and lists no line of another branch's entries", leaked.length === 0, `${leaked.length} leaked rows`);

    const vat = await req("GET", "/financial-reports/vat-return", undefined, ALEX_GRANT);
    check("the company-wide VAT return is refused to a scoped caller", vat.status === 403 && vat.body?.error === "COMPANY_WIDE_REPORT", `status ${vat.status}`);
    check("with an Arabic reason", typeof vat.body?.message === "string" && /[؀-ۿ]/.test(vat.body.message));
    const reconciliation = await req("GET", "/reconciliation", undefined, ALEX_GRANT);
    check("so is the sub-ledger reconciliation", reconciliation.status === 403, `status ${reconciliation.status}`);

    const narrowedAdmin = { "x-branch-scope": MAIN };
    const adminVat = await req("GET", "/financial-reports/vat-return", undefined, narrowedAdmin);
    check("but an all-branches user who only picked a branch in the shell still gets the VAT return", adminVat.status === 200, `status ${adminVat.status}`);
    const adminReconciliation = await req("GET", "/reconciliation", undefined, narrowedAdmin);
    check("and the reconciliation", adminReconciliation.status === 200, `status ${adminReconciliation.status}`);

    const journal = (id: string, branchId: string) => ({
      id,
      date: today,
      memo: "قيد اختبار بُعد الفرع",
      source: "manual",
      lines: [
        { accountId: "5200", debit: "10.00", credit: "0", branchId },
        { accountId: ALEX_CASH_GL, debit: "0", credit: "10.00", branchId },
      ],
    });
    const outOfScope = await req("POST", "/gl/journal-entries", journal("SCN-BR-JE-FOREIGN", MAIN), ALEX_GRANT);
    check("a scoped caller cannot post a journal line on another branch", outOfScope.status === 403 && outOfScope.body?.error === "BRANCH_OUT_OF_SCOPE", `status ${outOfScope.status} ${JSON.stringify(outOfScope.body).slice(0, 160)}`);
    check("and nothing was written", branchesOfEntry("e.id", "SCN-BR-JE-FOREIGN").length === 0);
    const template = await req(
      "POST",
      "/gl/recurring/templates",
      {
        id: "SCN-BR-RJT-FOREIGN",
        nameAr: "قالب على فرع آخر",
        memo: "قالب اختبار بُعد الفرع",
        frequency: "monthly",
        dayOfPeriod: 1,
        yearlyMonth: null,
        startDate: today,
        endDate: null,
        autoReverseNextPeriod: false,
        lines: journal("unused", MAIN).lines,
      },
      ALEX_GRANT,
    );
    check("nor save a recurring template that would post there every month", template.status === 403 && template.body?.error === "BRANCH_OUT_OF_SCOPE", `status ${template.status} ${JSON.stringify(template.body).slice(0, 160)}`);
    const schedule = { frequency: "monthly", dayOfPeriod: 1, yearlyMonth: null, startDate: today, endDate: null, autoReverseNextPeriod: false };
    const mainEntryId = (
      sqlite
        .prepare("SELECT e.id AS id FROM journal_entry e JOIN journal_line l ON l.entry_id = e.id WHERE e.status = 'posted' GROUP BY e.id HAVING COUNT(*) = SUM(CASE WHEN l.branch_id = ? THEN 1 ELSE 0 END) LIMIT 1")
        .get(MAIN) as { id: string } | undefined
    )?.id;
    const copied = await req("POST", `/gl/recurring/templates/from-entry/${encodeURIComponent(mainEntryId ?? "")}`, { id: "SCN-BR-RJT-COPIED", nameAr: "قالب منسوخ من فرع آخر", ...schedule }, ALEX_GRANT);
    check("nor copy another branch's entry into a template", mainEntryId !== undefined && copied.status === 403 && copied.body?.error === "BRANCH_OUT_OF_SCOPE", `entry ${mainEntryId} status ${copied.status} ${JSON.stringify(copied.body).slice(0, 160)}`);
    const phantomTemplate = await req("POST", "/gl/recurring/templates", { id: "SCN-BR-RJT-PHANTOM", nameAr: "قالب على فرع غير موجود", memo: "قالب اختبار بُعد الفرع", ...schedule, lines: journal("unused", "BR-NOWHERE").lines });
    check("and nobody can save a template on a branch that does not exist", phantomTemplate.status === 422 && phantomTemplate.body?.error === "BRANCH_NOT_FOUND", `status ${phantomTemplate.status} ${JSON.stringify(phantomTemplate.body).slice(0, 160)}`);
    const phantom = await req("POST", "/gl/journal-entries", journal("SCN-BR-JE-PHANTOM", "BR-NOWHERE"));
    check("nobody can post a journal line on a branch that does not exist", phantom.status === 422 && phantom.body?.error === "BRANCH_NOT_FOUND", `status ${phantom.status} ${JSON.stringify(phantom.body).slice(0, 160)}`);
  });

  await it("branch dimension · a new document of each major type lands with its branch on the journal lines", async () => {
    const purchase = await req("POST", "/purchases/invoices", {
      id: "SCN-BR-PI",
      supplierId: SUPPLIER,
      date: today,
      branchId: ALEX,
      warehouseId: ALEX_WAREHOUSE,
      currency: "EGP",
      lines: [{ itemId: ITEM, qty: "5", unitCost: "140", kind: "inventory", taxRatePercent: 14 }],
    });
    const purchaseConfirm = await req("POST", "/purchases/invoices/SCN-BR-PI/confirm", {});
    check("purchase invoice confirms", purchase.status === 201 && purchaseConfirm.ok, `${purchase.status}/${purchaseConfirm.status} ${JSON.stringify(purchaseConfirm.body).slice(0, 160)}`);
    check("purchase invoice: every line carries the invoice's branch", allOn(branchesOfDocument("SCN-BR-PI"), ALEX), JSON.stringify(branchesOfDocument("SCN-BR-PI")));

    const purchaseNumber = (await req("GET", "/purchases/invoices/SCN-BR-PI")).body?.number ?? null;
    const purchaseReturn = await req("POST", "/purchase-returns", {
      id: "SCN-BR-PRT",
      date: today,
      memo: "مرتجع مشتريات فرع الإسكندرية",
      lines: [
        {
          itemId: ITEM,
          warehouseId: ALEX_WAREHOUSE,
          supplierId: SUPPLIER,
          sourceInvoiceId: "SCN-BR-PI",
          sourceInvoiceNumber: purchaseNumber,
          reason: "OTHER",
          availableQty: "5",
          qty: "1",
          unitCost: "140",
          taxAmount: "19.60",
          taxRatePercent: 14,
          branchId: MAIN,
        },
      ],
    });
    const purchaseReturnConfirm = await req("POST", "/purchase-returns/SCN-BR-PRT/confirm", {});
    check("purchase return confirms", purchaseReturn.status === 201 && purchaseReturnConfirm.ok, `${purchaseReturn.status}/${purchaseReturnConfirm.status} ${JSON.stringify(purchaseReturnConfirm.body).slice(0, 160)}`);
    check("purchase return: every line carries its source invoice's branch", allOn(branchesOfDocument("SCN-BR-PRT"), ALEX), JSON.stringify(branchesOfDocument("SCN-BR-PRT")));

    const sale = await req("POST", "/sales-invoices", {
      id: "SCN-BR-INV",
      date: today,
      dueDate: today,
      customerId: CUSTOMER,
      customerNameAr: "مؤسسة النور للمقاولات",
      warehouseId: ALEX_WAREHOUSE,
      branchId: ALEX,
      currency: "EGP",
      arAccountId: "1105",
      taxAccountId: "2200",
      lines: [
        {
          lineId: "SCN-BR-INV-L1",
          itemId: ITEM,
          itemNameAr: "أرز أبيض 5 كجم",
          isStock: true,
          qty: "2",
          unitPrice: "210",
          taxRatePercent: 14,
          revenueAccountId: "4100",
          cogsAccountId: "5100",
          inventoryAccountId: "1200",
        },
      ],
    });
    const saleConfirm = await req("POST", "/sales-invoices/SCN-BR-INV/confirm", {});
    check("sales invoice confirms", sale.status === 201 && saleConfirm.ok, `${sale.status}/${saleConfirm.status} ${JSON.stringify(saleConfirm.body).slice(0, 160)}`);
    check("sales invoice: every line carries the invoice's branch", allOn(branchesOfDocument("SCN-BR-INV"), ALEX), JSON.stringify(branchesOfDocument("SCN-BR-INV")));

    const salesReturn = await req("POST", "/sales-returns/from-invoice", {
      id: "SCN-BR-SRT",
      date: today,
      sourceInvoiceId: "SCN-BR-INV",
      warehouseId: ALEX_WAREHOUSE,
      reason: "OTHER",
      requested: [{ itemId: ITEM, qty: "1" }],
    });
    const salesReturnConfirm = await req("POST", "/sales-returns/SCN-BR-SRT/confirm", {});
    check("sales return confirms", salesReturn.status === 201 && salesReturnConfirm.ok, `${salesReturn.status}/${salesReturnConfirm.status} ${JSON.stringify(salesReturnConfirm.body).slice(0, 160)}`);
    check("sales return: every line carries its source invoice's branch", allOn(branchesOfDocument("SCN-BR-SRT"), ALEX), JSON.stringify(branchesOfDocument("SCN-BR-SRT")));

    const voucher = await req("POST", "/vouchers", {
      id: "SCN-BR-VCH",
      date: today,
      memo: "تحصيل نقدي بفرع الإسكندرية",
      voucherType: "customer_collection",
      amount: "100.00",
      branchId: ALEX,
      paymentMethod: "cash",
      treasuryAccountId: ALEX_TREASURY,
      treasuryGlAccountId: ALEX_CASH_GL,
      counterpartyGlAccountId: "1105",
      customerId: CUSTOMER,
    });
    const voucherConfirm = await req("POST", "/vouchers/SCN-BR-VCH/confirm", {});
    check("treasury voucher confirms", voucher.status === 201 && voucherConfirm.ok, `${voucher.status}/${voucherConfirm.status} ${JSON.stringify(voucherConfirm.body).slice(0, 160)}`);
    check("treasury voucher: both legs carry the voucher's branch", allOn(branchesOfDocument("SCN-BR-VCH"), ALEX), JSON.stringify(branchesOfDocument("SCN-BR-VCH")));

    const adjustmentDraft = await req("POST", "/inventory/stock-adjustments/draft", {
      id: "SCN-BR-ADJ",
      date: today,
      lines: [{ itemId: ITEM, warehouseId: ALEX_WAREHOUSE, reason: "OTHER", direction: "IN", qty: "3", unitCost: "140" }],
    });
    const adjustmentConfirm = await req("POST", "/inventory/stock-adjustments/SCN-BR-ADJ/confirm", {});
    check("stock adjustment confirms", adjustmentDraft.status === 201 && adjustmentConfirm.ok, `${adjustmentDraft.status}/${adjustmentConfirm.status} ${JSON.stringify(adjustmentConfirm.body).slice(0, 160)}`);
    check("stock adjustment: every line carries the branch of the warehouse it moved", allOn(branchesOfDocument("SCN-BR-ADJ"), ALEX), JSON.stringify(branchesOfDocument("SCN-BR-ADJ")));

    const cheque = await req("POST", "/cheques", {
      id: "SCN-BR-CHQ",
      direction: "incoming",
      chequeNumber: "SCN-BR-7700001",
      bankName: "بنك الاختبار",
      issueDate: today,
      dueDate: today,
      branchId: ALEX,
      partyId: CUSTOMER,
      counterpartyGlAccountId: "1105",
      controlAccounts: { underCollectionAccountId: "1320", bouncedAccountId: "1360" },
      amount: "50.00",
    });
    check("cheque records", cheque.status === 201, `${cheque.status} ${JSON.stringify(cheque.body).slice(0, 160)}`);
    check("cheque: the creation entry carries the cheque's branch", allOn(branchesOfDocument("SCN-BR-CHQ"), ALEX), JSON.stringify(branchesOfDocument("SCN-BR-CHQ")));
    await req("POST", "/cheques/SCN-BR-CHQ/deposit", { bankTreasuryAccountId: "TR-DEMO-BANK" });
    const bounce = await req("POST", "/cheques/SCN-BR-CHQ/bounce", {});
    check("cheque bounces", bounce.ok, `${bounce.status} ${JSON.stringify(bounce.body).slice(0, 160)}`);
    const chequeLines = branchesOfDocument("SCN-BR-CHQ");
    check("cheque: the bounce entry carries it too", chequeLines.length === 4 && chequeLines.every((b) => b === ALEX), JSON.stringify(chequeLines));

    const manual = await req("POST", "/gl/journal-entries", {
      id: "SCN-BR-JE-COMPANY",
      date: today,
      memo: "قيد على مستوى المنشأة بلا فرع",
      source: "manual",
      lines: [
        { accountId: "5200", debit: "25.00", credit: "0" },
        { accountId: "1310", debit: "0", credit: "25.00" },
      ],
    });
    check("a company-level manual journal posts", manual.status === 201, `${manual.status} ${JSON.stringify(manual.body).slice(0, 160)}`);
    check("and stays unattributed rather than borrowing a branch", allOn(branchesOfEntry("e.id", "SCN-BR-JE-COMPANY"), null));

    const companyAfter = await trialBalance("");
    const branchIds: string[] = rows((await req("GET", "/branches")).body).map((b: any) => String(b.id));
    const partsAfter = add([...(await Promise.all(branchIds.map((id) => trialBalance(id)))).map((p) => p.nets), (await trialBalance(UNATTRIBUTED)).nets]);
    const diffAfter = firstDifference(companyAfter.nets, partsAfter);
    check("and the identity still holds after all of them", diffAfter === null, diffAfter ?? "");
  });

  sqlite.close();
}

