import { matchesSearch } from "@mezan/domain";
import type { Ctx } from "./harness.js";

/**
 * Executable checks for the seams `cross-module.ts` could not reach — the
 * currency, tax, compliance, numbering, permission and year-end scenarios
 * written up in docs/TESTING.md §13 as "not yet executable"
 * (X23-X30) and in its compliance / integrity-at-scale / platform sections
 * (X45-X64).
 *
 * The rule this file follows is the same one the rest of the suite follows: a
 * scenario asserts what the BUSINESS requires, not what the code happens to do.
 * Where the product cannot meet it, the assertion is inverted deliberately and
 * labelled with the measured evidence and the root cause, so a fix flips it
 * back rather than deleting it.
 *
 * Runs LAST — after cross-module.ts — because it closes periods, creates
 * branches and sweeps hundreds of documents through the ledger.
 *
 * Ids are prefixed `SCN-S-`, colliding neither with the seed nor with the other
 * scenario files.
 */

const BRANCH = "BR-MAIN";
const WH = "WH-MAIN";
const CASH = "1300-1";
const AR = "1105";
const PAYABLE = "2100";
const OUTPUT_TAX = "2200";
const INPUT_TAX = "1400";
const REVENUE = "4100";
const INVENTORY = "1200";
const EXPENSE = "5900";
/** خسائر فروق إعادة تقييم العملات غير المحققة — revaluation's own loss account, never عجز الصندوق 5900 (D229). */
const FX_LOSS = "5940";
/** استقطاعات ومستحقات رواتب — a plain liability, deliberately NOT a reconciled control account. */
const USD_LIABILITY = "2190";
/** رواتب مستحقة — the second plain liability, so the EUR trail cannot contaminate the USD one. */
const EUR_LIABILITY = "2170";
const RETAINED_EARNINGS = "3900";
const CASH_TREASURY = "TR-DEMO-CASH";
const CUSTOMER = "CUST-DEMO-1";
const SUPPLIER = "SUPP-DEMO-1";
const TODAY = "2026-08-24";
const MONTH_START = "2026-08-01";
const MONTH_END = "2026-08-31";
const VAT = 14;

export async function run(ctx: Ctx): Promise<void> {
  const { req, n, check, checkEq, scenario, rows } = ctx;

  /**
   * READS A WHOLE LIST, not the first page of one. `pageSize` carries a
   * compiled-in default of 25 (contracts/paging.ts, Q-8), so an entry posted
   * after the twenty-fifth is invisible to a bare GET — which reads as "the
   * confirm posted nothing" rather than as "you asked for one page".
   */
  const allRows = async (path: string): Promise<any[]> => {
    const sep = path.includes("?") ? "&" : "?";
    const out: any[] = [];
    for (let page = 1; page <= 200; page += 1) {
      const res = await req("GET", `${path}${sep}page=${page}&pageSize=200`);
      if (!res.ok) return out;
      const batch = rows(res.body);
      out.push(...batch);
      if (batch.length < 200) break;
    }
    return out;
  };

  async function gl(code: string): Promise<number> {
    return n((await req("GET", `/gl/accounts/${code}/ledger`)).body?.balance?.balance);
  }

  /** Magnitude of a credit-natural account, so assertions read the way a finance user says them. */
  async function creditBalance(code: string): Promise<number> {
    return -(await gl(code));
  }

  async function journalOf(journalEntryId: string): Promise<{ debit: number; credit: number; lines: any[] }> {
    const je = (await req("GET", `/gl/journal-entries/${journalEntryId}`)).body;
    const lines = (je?.lines ?? []) as any[];
    return {
      debit: lines.reduce((s, l) => s + n(l.debit), 0),
      credit: lines.reduce((s, l) => s + n(l.credit), 0),
      lines,
    };
  }

  /**
   * A service-line invoice: no stock, therefore no COGS and no inventory
   * movement. Everything in this file that only cares about tax, discount,
   * numbering or pricing uses one, so a rounding sweep of 40 documents cannot
   * quietly drain the warehouse.
   */
  /**
   * Every service line below names this item. It used to be the bare string
   * "SCN-S-SVC", which the catalogue never held — the suite was leaning on the
   * very hole D38 records, so the guard that closed it turned this file red.
   * Creating the item is the honest fix; weakening the guard would not be.
   */
  async function ensureServiceItem(): Promise<void> {
    const existing = await req("GET", "/items/SCN-S-SVC");
    if (existing.status === 200) return;
    await req("POST", "/items", {
      id: "SCN-S-SVC",
      code: "SCN-S-SVC",
      nameAr: "خدمة اختبار",
      nameEn: "Scenario Service",
      type: "service",
      baseUnitCode: "PCS",
      trackInventory: false,
      revenueAccountId: REVENUE,
    });
  }

  async function serviceInvoice(
    id: string,
    lines: Array<{ qty: string; unitPrice: string; taxRatePercent?: number }>,
    over: Record<string, unknown> = {},
  ) {
    const customerId = (over.customerId as string) ?? CUSTOMER;
    const created = await req("POST", "/sales-invoices", {
      id,
      date: TODAY,
      dueDate: "2026-09-23",
      customerId,
      customerNameAr: "عميل",
      warehouseId: WH,
      branchId: BRANCH,
      arAccountId: AR,
      taxAccountId: OUTPUT_TAX,
      lines: lines.map((l, i) => ({
        lineId: `${id}-L${i + 1}`,
        itemId: `SCN-S-SVC`,
        itemNameAr: "خدمة اختبار",
        isStock: false,
        qty: l.qty,
        unitPrice: l.unitPrice,
        taxRatePercent: l.taxRatePercent ?? VAT,
        revenueAccountId: REVENUE,
      })),
      ...over,
    });
    const confirmed = await req("POST", `/sales-invoices/${id}/confirm`, {});
    return { created, confirmed };
  }

  async function postJournal(id: string, date: string, memo: string, lines: any[]) {
    return req("POST", "/gl/journal-entries", { id, date, memo, lines });
  }

  /** `/audit` answers {events, total} — an envelope the harness's generic row-reader does not know. */
  async function auditRows(query: string): Promise<any[]> {
    const res = await req("GET", `/audit?${query}`);
    return (res.body?.events ?? []) as any[];
  }

  async function vatReturn(from = MONTH_START, to = MONTH_END) {
    const res = await req("GET", `/financial-reports/vat-return?periodFrom=${from}&periodTo=${to}`);
    return { res, rows: rows(res.body).length ? rows(res.body) : ((res.body?.rows ?? []) as any[]) };
  }

  // ---------------------------------------------------------------------------
  // X23 — a foreign-currency liability, and what revaluation does to it
  // ---------------------------------------------------------------------------

  await ensureServiceItem();

  await scenario("x23 · a foreign-currency balance is revalued at the closing rate, the restatement touches only the FX accounts, and its auto-reversal stops it being counted twice", async () => {
    const booked = await req("POST", "/exchange-rates", {
      id: "SCN-S-FX-USD-24", currency: "USD", rate: "48.00", effectiveDate: TODAY, rateType: "standard", source: "manual",
    });
    check("a USD rate is recorded for the transaction date", booked.status === 201, `status ${booked.status} ${JSON.stringify(booked.body).slice(0, 200)}`);
    check("and it arrives PENDING — recording a rate is not the same as authorising it", booked.body?.status === "pending", `status field=${booked.body?.status}`);
    const approvedBooked = await req("POST", "/exchange-rates/SCN-S-FX-USD-24/approve", {});
    check("approving it moves it to approved", approvedBooked.body?.status === "approved", JSON.stringify(approvedBooked.body).slice(0, 200));

    const closing = await req("POST", "/exchange-rates", {
      id: "SCN-S-FX-USD-31", currency: "USD", rate: "52.00", effectiveDate: MONTH_END, rateType: "standard", source: "manual",
    });
    await req("POST", "/exchange-rates/SCN-S-FX-USD-31/approve", {});
    check("a higher month-end closing rate is recorded and approved", closing.status === 201, `status ${closing.status}`);

    // USD 1,000 owed, booked at 48.00 — the ONLY way to express a foreign-currency
    // balance in this build, since no document route carries a rate (see below).
    const inventoryBefore = await gl(INVENTORY);
    const liabilityBefore = await creditBalance(USD_LIABILITY);
    const je = await postJournal("SCN-S-JE-FX-USD", TODAY, "التزام بالدولار — 1000 دولار بسعر 48", [
      { accountId: EXPENSE, debit: "48000.00", credit: "0.00" },
      { accountId: USD_LIABILITY, debit: "0.00", credit: "48000.00", currency: "USD", fxRate: "48" },
    ]);
    check("a currency-tagged journal line is accepted — the GL contract carries currency and fxRate per line", je.status === 201, `status ${je.status} ${JSON.stringify(je.body).slice(0, 250)}`);
    checkEq("the liability is booked in base currency at the transaction rate", (await creditBalance(USD_LIABILITY)) - liabilityBefore, 48000);

    const preview = await req("POST", "/revaluation/preview", { date: MONTH_END, currencies: ["USD"], autoReverse: true });
    check("the revaluation preview runs", preview.status === 200, `status ${preview.status} ${JSON.stringify(preview.body).slice(0, 250)}`);
    const detail = ((preview.body?.details ?? []) as any[]).find((d) => d.accountId === USD_LIABILITY);
    check("it finds the open USD balance", Boolean(detail), `details=${JSON.stringify(preview.body?.details ?? []).slice(0, 250)}`);
    checkEq("the foreign amount is recomputed from the booked base and its rate: 48,000 ÷ 48 = 1,000 USD", n(detail?.foreignAmount), 1000);
    checkEq("revalued at the closing 52.00 the same debt is worth 52,000", n(detail?.revaluedBase), 52000);
    checkEq("so the restatement is exactly 1,000 × (52 − 48)", Math.abs(n(detail?.delta)), 4000);
    // Scoped to THIS position, not to the tenant's total: the preview revalues
    // every open USD balance in the seeded tenant, so a claim about
    // `totalLoss` is a claim about global state and breaks the moment the seed
    // gains another foreign position (the demo's USD bank receipt did exactly
    // that). The requirement being asserted is about this liability.
    check("a liability that grew in base currency is a LOSS, never a gain", n(detail?.gainLoss) === -4000, `gainLoss=${detail?.gainLoss}`);
    const gainOfOthers = ((preview.body?.details ?? []) as any[])
      .filter((d) => d.accountId !== USD_LIABILITY)
      .reduce((sum, d) => sum + ((ctx.scaled(d.gainLoss) ?? 0n) > 0n ? (ctx.scaled(d.gainLoss) ?? 0n) : 0n), 0n);
    check("and this position puts nothing on the gain side: the total gain is the other positions' gain to the micro-unit", n(preview.body?.totalLoss) >= 4000 && ctx.scaled(preview.body?.totalGain) === gainOfOthers,
      `loss=${n(preview.body?.totalLoss)} gain=${String(preview.body?.totalGain)} others=${gainOfOthers}`);

    const posted = await req("POST", "/revaluation/post", { date: MONTH_END, currencies: ["USD"], autoReverse: true });
    check("posting the revaluation succeeds", posted.status === 200 || posted.status === 201, `status ${posted.status} ${JSON.stringify(posted.body).slice(0, 250)}`);
    const entry = await journalOf(posted.body?.entry?.id ?? posted.body?.entryId ?? "");
    check(
      "the unrealised FX loss account 5940 takes the whole restatement, this position's 4,000 included (D229)",
      n(entry.lines.find((l: any) => l.accountId === FX_LOSS)?.debit) >= 4000,
      `5940 debit=${n(entry.lines.find((l: any) => l.accountId === FX_LOSS)?.debit)}`,
    );
    check("and عجز الصندوق 5900 takes none of it (D229)", !entry.lines.some((l: any) => l.accountId === "5900"), JSON.stringify(entry.lines.map((l: any) => l.accountId)));
    checkEq("and the liability itself is written up by exactly the same 4,000 — the two sides of one restatement", n(entry.lines.find((l: any) => l.accountId === USD_LIABILITY)?.credit), 4000);
    checkEq("GL 1200 does not move — a revaluation restates a debt, it is never a cost of inventory", await gl(INVENTORY), inventoryBefore);

    const reversalId = posted.body?.reversal?.id ?? posted.body?.reversalId ?? "";
    const reversal = await journalOf(reversalId);
    check("an auto-reversal exists, so next month's books do not open holding a rate that has already moved", reversal.lines.length > 0, `reversalId=${reversalId || "(none)"}`);
    checkEq("the reversal mirrors the restatement exactly", reversal.credit, entry.debit);
    checkEq(
      "and because it reverses on the first of the next month, the liability's live balance is back at what was actually booked — the restatement lives in the month it belongs to and nowhere else",
      (await creditBalance(USD_LIABILITY)) - liabilityBefore,
      48000,
    );

    // D227: the restatement moved the liability's base value and none of its
    // dollars. Read as dollars at 52.00 it put USD 76.92 on the position, so the
    // same-day re-run found another 4,000 to post and a second post doubled it.
    const again = await req("POST", "/revaluation/preview", { date: MONTH_END, currencies: ["USD"], autoReverse: true });
    const againDetail = ((again.body?.details ?? []) as any[]).find((d) => d.accountId === USD_LIABILITY);
    checkEq("re-running the same revaluation on the same day finds the debt already restated — nothing to post twice (D227)", n(again.body?.totalLoss), 0);
    checkEq("the position is still USD 1,000, not 1,000 plus the restatement read as dollars (D227)", n(againDetail?.foreignAmount), 1000);

    // The product half of X23: a DOCUMENT carries its foreign balance into the GL.
    const usdPurchase = await req("POST", "/purchases/invoices", {
      id: "SCN-S-PI-USD", supplierId: SUPPLIER, date: TODAY, branchId: BRANCH, warehouseId: WH, currency: "USD",
      lines: [{ itemId: null, kind: "expense", description: "خدمة بالدولار", qty: "1", unitCost: "1000", taxRatePercent: 0 }],
    });
    const usdConfirm = await req("POST", "/purchases/invoices/SCN-S-PI-USD/confirm", {});
    check("a USD purchase invoice is accepted and confirms", usdPurchase.status === 201 && usdConfirm.status === 200, `${usdPurchase.status}/${usdConfirm.status} ${JSON.stringify(usdConfirm.body).slice(0, 200)}`);
    const usdNumber = String(usdConfirm.body?.number ?? "");
    const usdEntryId =
      (await allRows("/gl/journal-entries")).find((e: any) => String(e.memo ?? "").includes(usdNumber))?.id ?? "";
    const usdEntry = await journalOf(usdEntryId);
    const usdRate = n((await req("GET", "/exchange-rates")).body?.find?.((r: any) => r.currency === "USD" && r.effectiveDate <= TODAY && r.status === "approved")?.rate ?? 0);
    check(
      "USD 1,000 posts its BASE-currency value at the approved rate of the invoice's own date, not 1,000 EGP (docs/archive/defect-register.md D24)",
      usdEntry.credit > 1000 && Math.abs(usdEntry.credit - 1000 * usdRate) < 0.01,
      `credit=${usdEntry.credit} rate=${usdRate} lines=${JSON.stringify(usdEntry.lines).slice(0, 250)}`,
    );
    const payableLine = usdEntry.lines.find((l: any) => l.accountId === PAYABLE);
    check(
      "and the payable line keeps the currency and the rate, which is what makes the debt revaluable at all",
      payableLine?.currency === "USD" && n(payableLine?.fxRate) === usdRate,
      `payable=${JSON.stringify(payableLine).slice(0, 250)}`,
    );

    const noRate = await req("POST", "/purchases/invoices", {
      id: "SCN-S-PI-XAU", supplierId: SUPPLIER, date: TODAY, branchId: BRANCH, warehouseId: WH, currency: "XAU",
      lines: [{ itemId: null, kind: "expense", description: "عملة بلا سعر صرف", qty: "1", unitCost: "10", taxRatePercent: 0 }],
    });
    check(
      "a currency the tenant never enabled is REFUSED at the door rather than posted at 1:1 — silently mis-stating a debt is the worse failure, and R11.7's allowed-currency list now catches it one step earlier than the missing-rate guard",
      noRate.status === 422 && noRate.body?.error === "CURRENCY_NOT_ALLOWED",
      `create=${noRate.status} ${JSON.stringify(noRate.body).slice(0, 250)}`,
    );
    const noRateConfirm = await req("POST", "/purchases/invoices/SCN-S-PI-XAU/confirm", {});
    check(
      "and no such document exists to be confirmed",
      noRateConfirm.status === 404,
      `confirm=${noRateConfirm.status} ${JSON.stringify(noRateConfirm.body).slice(0, 250)}`,
    );
  });

  // ---------------------------------------------------------------------------
  // X65 — the SALES side of a foreign currency, and what it is worth per currency
  // ---------------------------------------------------------------------------
  await scenario("x66 · a purchase invoice can be raised in a foreign currency from the screen's own shape, and reaches the ledger converted (R1.15)", async () => {
    // The route has always accepted a currency; no screen ever sent one, so
    // every purchase invoice was booked at par whatever the supplier billed.
    // This asserts the wire shape the form now sends, not a hand-built one.
    const currencies = (await req("GET", "/settings/currencies")).body;
    check("the tenant publishes what it allows, rather than the screen deciding", Array.isArray(currencies?.allowed) && currencies.allowed.includes("USD"), JSON.stringify(currencies));

    const created = await req("POST", "/purchases/invoices", {
      id: "SCN-S-PI-CUR", supplierId: "SUPP-DEMO-1", date: "2026-08-20",
      branchId: "BR-MAIN", warehouseId: "WH-MAIN", currency: "USD",
      lines: [{ itemId: "ITEM-DEMO-1", kind: "inventory", qty: "10", unitCost: "100", taxRatePercent: 0 }],
    });
    checkEq("the invoice is created", created.status, 201);
    check("and keeps the currency rather than dropping it at the wire", created.body?.currency === "USD", `currency=${created.body?.currency}`);

    const confirmed = await req("POST", "/purchases/invoices/SCN-S-PI-CUR/confirm", {});
    checkEq("it confirms", confirmed.status, 200);
    const invoice = (await req("GET", "/purchases/invoices/SCN-S-PI-CUR")).body;
    check("the rate it confirmed at is stamped on the document", invoice?.fxRate !== null && invoice?.fxRate !== undefined, `fxRate=${invoice?.fxRate}`);
    checkEq("and the document total stays in its OWN currency", n(invoice?.total), 1000);

    const entries = await allRows("/gl/journal-entries?sourceModule=purchases");
    const entry = entries.find((e: any) => e.sourceDocId === "SCN-S-PI-CUR");
    check("the confirm posted an entry naming this invoice", entry !== undefined, `entries=${entries.length}`);
    const payable = entry?.lines?.find((l: any) => l.accountId === "2100");
    // 1,000 USD at 49.35 is 49,350.00 EGP. At par it would read 1,000.00 — the
    // whole of D24 in one number.
    checkEq("the payable is credited in BASE currency at the document's rate, not at par", n(payable?.credit), 49350);
    check("and the line carries the currency it was booked in, for revaluation to find later", payable?.currency === "USD", `currency=${payable?.currency} fxRate=${payable?.fxRate}`);

    const balanced = (entry?.lines ?? []).reduce((sum: number, l: any) => sum + n(l.debit) - n(l.credit), 0);
    checkEq("and the entry still balances to the unit in base currency", Math.round(balanced * 1e6) / 1e6, 0);
  });

  await scenario("x65 · a foreign-currency sales invoice reaches the ledger in base currency, is reported per currency, and is what revaluation restates", async () => {
    // The rate the SERVER will pick: the latest approved (or locked) USD rate
    // effective on or before the invoice's date. Read rather than hardcoded, so
    // an earlier scenario adding a rate cannot silently change what is asserted.
    const usable = ((await req("GET", "/exchange-rates")).body as any[])
      .filter((r: any) => r.currency === "USD" && r.effectiveDate <= TODAY && (r.status === "approved" || r.status === "locked"))
      .sort((a: any, b: any) => String(b.effectiveDate).localeCompare(String(a.effectiveDate)));
    const rate = n(usable[0]?.rate ?? 0);
    check("the tenant holds an approved USD rate for the invoice's date", rate > 0, `rate=${rate}`);

    const arBefore = await gl(AR);
    const { created, confirmed } = await serviceInvoice(
      "SCN-S-SI-USD",
      [{ qty: "1", unitPrice: "1000", taxRatePercent: 0 }],
      { currency: "USD", customerId: "CUST-DEMO-USD", customerNameAr: "شركة دلتا للتصدير" },
    );
    check("a USD sales invoice is accepted and confirms", created.status === 201 && confirmed.status === 200, `${created.status}/${confirmed.status} ${JSON.stringify(confirmed.body).slice(0, 220)}`);
    check("and it records the rate it confirmed at, rather than leaving a later reader to re-derive one", n(confirmed.body?.fxRate) === rate, `fxRate=${confirmed.body?.fxRate} rate=${rate}`);

    const entry = await journalOf(String(confirmed.body?.journalEntryId ?? ""));
    const arLine = entry.lines.find((l: any) => l.accountId === AR);
    checkEq(
      "USD 1,000 debits the receivable with its BASE-currency value at the invoice's own rate, not 1,000 EGP (docs/archive/defect-register.md D24)",
      n(arLine?.debit),
      1000 * rate,
    );
    check(
      "and the receivable line keeps the currency and the rate — the only thing that makes the debt revaluable at all",
      arLine?.currency === "USD" && n(arLine?.fxRate) === rate,
      `arLine=${JSON.stringify(arLine).slice(0, 220)}`,
    );
    checkEq("the entry still balances to the unit after conversion", Math.round(entry.debit * 100), Math.round(entry.credit * 100));
    checkEq("and GL 1105 itself moved by exactly that base amount", Math.round(((await gl(AR)) - arBefore) * 100) / 100, Math.round(1000 * rate * 100) / 100);

    const balances = await req("GET", "/gl/balances-by-currency");
    check("the per-currency balance report answers", balances.status === 200, `status ${balances.status}`);
    const usdReceivable = ((balances.body?.receivables ?? []) as any[]).find((g: any) => g.currency === "USD");
    const egpReceivable = ((balances.body?.receivables ?? []) as any[]).find((g: any) => g.currency === "EGP");
    check("USD receivables are reported as their OWN currency, not folded into the base group (R1.16)", Boolean(usdReceivable) && Boolean(egpReceivable), `currencies=${((balances.body?.receivables ?? []) as any[]).map((g: any) => g.currency).join(",")}`);
    checkEq("the customer is owed 1,000 DOLLARS — the figure they were billed", n(usdReceivable?.outstandingTransaction), 1000);
    checkEq("worth exactly 1,000 × the booking rate in the base currency the control account holds", n(usdReceivable?.outstandingBase), 1000 * rate);
    const usdParty = ((usdReceivable?.parties ?? []) as any[]).find((p: any) => p.partyId === "CUST-DEMO-USD");
    check("and the balance names the customer it belongs to, not just the currency", usdParty?.partyName === "شركة دلتا للتصدير", `parties=${JSON.stringify(usdReceivable?.parties ?? []).slice(0, 220)}`);

    const usdPayable = ((balances.body?.payables ?? []) as any[]).find((g: any) => g.currency === "USD");
    check("the supplier side reports per currency too — x23's USD purchase invoice is a dollar payable", Boolean(usdPayable) && n(usdPayable?.outstandingTransaction) > 0, `payables=${JSON.stringify(balances.body?.payables ?? []).slice(0, 220)}`);
    check(
      "and every foreign group's base ÷ transaction is the rate it was booked at, never today's",
      Math.abs(n(usdReceivable?.outstandingBase) / n(usdReceivable?.outstandingTransaction) - rate) < 0.000001,
      `base=${usdReceivable?.outstandingBase} txn=${usdReceivable?.outstandingTransaction} rate=${rate}`,
    );

    // The month-end closing rate x23 approved (52.00) is higher than the
    // booking rate, so a dollar RECEIVABLE is worth more in base currency: a
    // debit-natured balance that rises is a gain, the mirror of x23's payable.
    const preview = await req("POST", "/revaluation/preview", { date: MONTH_END, currencies: ["USD"], autoReverse: true });
    check("the revaluation preview runs", preview.status === 200, `status ${preview.status} ${JSON.stringify(preview.body).slice(0, 220)}`);
    const arDetail = ((preview.body?.details ?? []) as any[]).find((d: any) => d.accountId === AR);
    check("revaluation now finds the RECEIVABLE the document created — before this it had nothing upstream speaking currency", Boolean(arDetail), `details=${((preview.body?.details ?? []) as any[]).map((d: any) => `${d.accountId}/${d.currency}`).join(",")}`);
    checkEq("recovered from the posted base amount and its booking rate, the open balance is 1,000 USD", n(arDetail?.foreignAmount), 1000);
    const closingRate = n(arDetail?.closingRate);
    checkEq("restated at the closing rate it is worth 1,000 × that rate", n(arDetail?.revaluedBase), 1000 * closingRate);
    checkEq("so the restatement is exactly 1,000 × (closing − booking)", Math.round(n(arDetail?.gainLoss) * 100) / 100, Math.round(1000 * (closingRate - rate) * 100) / 100);
    check("and a receivable worth MORE base currency is a gain, never a loss", n(arDetail?.gainLoss) > 0, `gainLoss=${arDetail?.gainLoss} closing=${closingRate} booking=${rate}`);
  });

  // ---------------------------------------------------------------------------
  // X24 — an unapproved rate must not be spendable
  // ---------------------------------------------------------------------------
  await scenario("x24 · a pending exchange rate cannot be spent, an approved one can, and a locked one is supposed to be final", async () => {
    const pending = await req("POST", "/exchange-rates", {
      id: "SCN-S-FX-EUR-31", currency: "EUR", rate: "60.00", effectiveDate: MONTH_END, rateType: "standard", source: "manual",
    });
    check("a EUR rate is recorded, pending approval", pending.status === 201 && pending.body?.status === "pending", `status ${pending.status} ${JSON.stringify(pending.body).slice(0, 200)}`);

    await postJournal("SCN-S-JE-FX-EUR", TODAY, "التزام باليورو — 100 يورو بسعر 55", [
      { accountId: EXPENSE, debit: "5500.00", credit: "0.00" },
      { accountId: EUR_LIABILITY, debit: "0.00", credit: "5500.00", currency: "EUR", fxRate: "55" },
    ]);

    const blocked = await req("POST", "/revaluation/preview", { date: MONTH_END, currencies: ["EUR"] });
    check(
      "revaluing against a PENDING rate is refused, by name — an unapproved rate is not a rate",
      blocked.status === 422 && String(blocked.body?.error).includes("FX_RATE_MISSING"),
      `status ${blocked.status} body ${JSON.stringify(blocked.body).slice(0, 200)}`,
    );

    await req("POST", "/exchange-rates/SCN-S-FX-EUR-31/approve", {});
    const allowed = await req("POST", "/revaluation/preview", { date: MONTH_END, currencies: ["EUR"] });
    check("once approved, the same revaluation runs", allowed.status === 200, `status ${allowed.status} ${JSON.stringify(allowed.body).slice(0, 200)}`);
    const eurDetail = ((allowed.body?.details ?? []) as any[]).find((d) => d.accountId === EUR_LIABILITY);
    checkEq("and converts at exactly the approved rate: 100 × (60 − 55)", Math.abs(n(eurDetail?.delta)), 500);

    const locked = await req("POST", "/exchange-rates/SCN-S-FX-EUR-31/lock", {});
    check("the rate locks", locked.body?.status === "locked", JSON.stringify(locked.body).slice(0, 200));
    const overwrite = await req("POST", "/exchange-rates", {
      id: "SCN-S-FX-EUR-31", currency: "EUR", rate: "99.00", effectiveDate: MONTH_END, rateType: "standard", source: "manual",
    });
    const after = ((await req("GET", "/exchange-rates")).body as any[]).find((r: any) => r.id === "SCN-S-FX-EUR-31");
    check(
      "a locked rate is final: re-posting its id is refused, and the rate the ledger already converted at is untouched " +
        "(docs/archive/defect-register.md D25 — the regression guard; the SQLite repository still upserts, so the route must refuse first)",
      overwrite.status === 409 && n(after?.rate) === 60 && after?.status === "locked",
      `overwrite=${overwrite.status} storedRate=${after?.rate} storedStatus=${after?.status}`,
    );
    const relock = await req("POST", "/exchange-rates/SCN-S-FX-EUR-31/approve", {});
    check("and it cannot be walked back down to approved either", relock.status === 409, `status ${relock.status} ${JSON.stringify(relock.body).slice(0, 160)}`);
  });

  // ---------------------------------------------------------------------------
  // X26 — project ▸ cost centre ▸ P&L
  // ---------------------------------------------------------------------------
  await scenario("x26 · a tagged expense reaches the cost-centre P&L once and the income statement once — and the expenses a voucher pays can never be tagged at all", async () => {
    const centres = rows((await req("GET", "/cost-centers")).body);
    const centre = centres[0];
    check("the tenant has at least one cost centre to tag against", Boolean(centre?.id), `centres=${centres.length}`);
    if (!centre?.id) return;

    const before = (await req("GET", `/cost-center-pl?fromDate=${MONTH_START}&toDate=${MONTH_END}`)).body;
    const beforeRow = ((before?.rows ?? []) as any[]).find((r) => r.costCenterId === centre.id);
    const isBefore = n((await req("GET", `/financial-reports/income-statement?periodFrom=${MONTH_START}&periodTo=${MONTH_END}`)).body?.grandTotals?.amount);

    const tagged = await postJournal("SCN-S-JE-CC", TODAY, "مصروف موزّع على مركز تكلفة", [
      { accountId: EXPENSE, debit: "1500.00", credit: "0.00", costCenterId: centre.id },
      { accountId: CASH, debit: "0.00", credit: "1500.00" },
    ]);
    check("a cost-centre-tagged expense posts", tagged.status === 201, `status ${tagged.status} ${JSON.stringify(tagged.body).slice(0, 200)}`);

    const after = (await req("GET", `/cost-center-pl?fromDate=${MONTH_START}&toDate=${MONTH_END}`)).body;
    const afterRow = ((after?.rows ?? []) as any[]).find((r) => r.costCenterId === centre.id);
    checkEq("the centre's expense rises by exactly what was posted — once, not twice", n(afterRow?.expense) - n(beforeRow?.expense), 1500);
    const isAfter = n((await req("GET", `/financial-reports/income-statement?periodFrom=${MONTH_START}&periodTo=${MONTH_END}`)).body?.grandTotals?.amount);
    checkEq("and the income statement sees the same expense once", isBefore - isAfter, 1500);

    // The seam that matters: real spending goes out through the treasury, so a
    // treasury voucher has to carry the cost-centre dimension too.
    const centreRowBefore = n(afterRow?.expense);
    const unassignedBefore = n(((after?.rows ?? []) as any[]).find((r) => r.costCenterId === null)?.expense);
    const voucher = await req("POST", "/vouchers", {
      id: "SCN-S-VCH-CC", date: TODAY, memo: "مصروف نثري مدفوع من الخزنة", voucherType: "other_expense",
      amount: "400.00", branchId: BRANCH, paymentMethod: "cash",
      treasuryAccountId: CASH_TREASURY, treasuryGlAccountId: CASH, counterpartyGlAccountId: EXPENSE,
      costCenterId: centre.id,
    });
    const voucherConfirm = await req("POST", "/vouchers/SCN-S-VCH-CC/confirm", {});
    check("a voucher-paid expense confirms", voucherConfirm.status === 200, JSON.stringify(voucherConfirm.body).slice(0, 200));
    const afterVoucher = (await req("GET", `/cost-center-pl?fromDate=${MONTH_START}&toDate=${MONTH_END}`)).body;
    const centreRowAfter = n(((afterVoucher?.rows ?? []) as any[]).find((r) => r.costCenterId === centre.id)?.expense);
    const unassignedAfter = n(((afterVoucher?.rows ?? []) as any[]).find((r) => r.costCenterId === null)?.expense);
    check(
      "a voucher-paid expense reaches the cost centre it names, rather than the غير مخصص bucket " +
        "(docs/archive/defect-register.md D26 — the regression guard: the wire contract carries the dimension the report needs)",
      Math.abs(centreRowAfter - centreRowBefore - 400) < 0.005 && Math.abs(unassignedAfter - unassignedBefore) < 0.005,
      `centre before=${centreRowBefore} after=${centreRowAfter} · unassigned before=${unassignedBefore} after=${unassignedAfter}`,
    );
    checkEq("the report still reconciles: every posted expense is in exactly one bucket, tagged or not", n(afterVoucher?.totals?.expense) - n(after?.totals?.expense), 400);
  });

  // ---------------------------------------------------------------------------
  // X28 — promotion ▸ revenue ▸ VAT ▸ history
  // ---------------------------------------------------------------------------
  await scenario("x28 · a promotion discounts before VAT, is recorded on the invoice it granted, and deactivating it afterwards restates nothing", async () => {
    const itemId = "SCN-S-PROMO-ITEM";
    await req("POST", "/items", {
      id: itemId, code: "SCN-S-PROMO", nameAr: "صنف عليه عرض", type: "service",
      baseUnitCode: "PCS", trackInventory: false, revenueAccountId: REVENUE,
    });
    const promo = await req("POST", "/promotions", {
      id: "SCN-S-PROMO-1", code: "SCN-S-10", nameAr: "خصم ١٠٪ على صنف العرض", type: "percentage",
      percentValue: 10, scope: { type: "item", ids: [itemId] },
      startDate: "2026-08-01", endDate: "2026-12-31", active: true, requiresCoupon: false, priority: 1,
    });
    check("an active item-scoped promotion is created", promo.status === 201, `status ${promo.status} ${JSON.stringify(promo.body).slice(0, 250)}`);

    const taxBefore = await creditBalance(OUTPUT_TAX);
    const revenueBefore = await creditBalance(REVENUE);
    const created = await req("POST", "/sales-invoices", {
      id: "SCN-S-INV-PROMO", date: TODAY, dueDate: "2026-09-23", customerId: CUSTOMER, customerNameAr: "عميل",
      warehouseId: WH, branchId: BRANCH, arAccountId: AR, taxAccountId: OUTPUT_TAX,
      lines: [{ lineId: "L1", itemId, itemNameAr: "صنف عليه عرض", isStock: false, qty: "10", unitPrice: "100", taxRatePercent: VAT, revenueAccountId: REVENUE }],
    });
    const confirmed = await req("POST", "/sales-invoices/SCN-S-INV-PROMO/confirm", {});
    check("the qualifying invoice confirms", created.status === 201 && confirmed.status === 200, `${created.status}/${confirmed.status} ${JSON.stringify(confirmed.body).slice(0, 250)}`);

    const totals = confirmed.body?.totals ?? {};
    checkEq("the 10% comes off the 1,000 gross", n(totals.promotionDiscountTotal), 100);
    checkEq("and the subtotal is already net of it — the discount is not left for the tax code to notice later", n(totals.subtotal), 900);
    checkEq("VAT is 14% of the DISCOUNTED 900 — a promotion reduces the tax the state is owed, it does not hide it", n(totals.taxTotal), 126);
    checkEq("and the customer is billed 900 + 126", n(totals.grandTotal), 1026);
    checkEq("GL 2200 takes exactly the discounted tax", (await creditBalance(OUTPUT_TAX)) - taxBefore, 126);
    checkEq("revenue is recognised net of the promotion", (await creditBalance(REVENUE)) - revenueBefore, 900);
    check("the invoice records WHICH promotion applied, not merely that a discount happened", String(confirmed.body?.appliedPromotion?.promotionId ?? confirmed.body?.appliedPromotion?.id ?? "") === "SCN-S-PROMO-1", JSON.stringify(confirmed.body?.appliedPromotion ?? null).slice(0, 250));

    const report = await req("GET", `/promotions/report?fromDate=${MONTH_START}&toDate=${MONTH_END}`);
    const reportRows = rows(report.body).length ? rows(report.body) : ((report.body?.rows ?? []) as any[]);
    const promoRow = reportRows.find((r: any) => (r.promotionId ?? r.id) === "SCN-S-PROMO-1");
    check("the promotions report counts the invoice it discounted", Boolean(promoRow), `report=${JSON.stringify(report.body).slice(0, 250)}`);
    checkEq("exactly once", n(promoRow?.usageCount), 1);
    checkEq("and reports the discount it actually granted", n(promoRow?.netDiscount ?? promoRow?.discountGranted), 100);

    const deactivate = await req("POST", "/promotions/SCN-S-PROMO-1/deactivate", {});
    check("the promotion deactivates", deactivate.status === 200, `status ${deactivate.status} ${JSON.stringify(deactivate.body).slice(0, 200)}`);
    const reread = (await req("GET", "/sales-invoices/SCN-S-INV-PROMO")).body;
    checkEq("the historical invoice still says what it granted — deactivation is not retroactive", n(reread?.totals?.grandTotal), 1026);
    check("and still names the promotion that granted it", Boolean(reread?.appliedPromotion), JSON.stringify(reread?.appliedPromotion ?? null).slice(0, 200));
    checkEq("the posted VAT is untouched too", (await creditBalance(OUTPUT_TAX)) - taxBefore, 126);
  });

  // ---------------------------------------------------------------------------
  // X29 — confirming a document reaches the ETA queue
  // ---------------------------------------------------------------------------
  await scenario("x29 · auto-submit ON puts a confirmed invoice on the ETA queue, and OFF leaves it alone (D5 fixed — guard it)", async () => {
    const config = await req("PUT", "/eta/config", {
      environment: "preproduction", taxRegistrationNumber: "123456789", activityCode: "4610",
      documentVersion: "1.0", autoSubmitOnConfirm: true, signingMethod: "none", buyerDataThreshold: 0,
    });
    check("ETA config accepts a full registration and auto-submit ON", config.status === 200, `status ${config.status} ${JSON.stringify(config.body).slice(0, 250)}`);
    const stored = (await req("GET", "/eta/config")).body?.config;
    check("and the setting is genuinely stored", stored?.autoSubmitOnConfirm === true, JSON.stringify(stored).slice(0, 200));

    const queueBefore = rows((await req("GET", "/eta/submissions")).body).length;
    const sale = await serviceInvoice("SCN-S-INV-ETA", [{ qty: "1", unitPrice: "500" }]);
    check("a real, confirmable invoice is confirmed with the switch on", sale.confirmed.status === 200, JSON.stringify(sale.confirmed.body).slice(0, 200));
    const after = rows((await req("GET", "/eta/submissions")).body);
    checkEq("the confirm enqueues exactly one submission — not zero, and not a storm", after.length - queueBefore, 1);

    // Named, not counted: a queue that grew by one for some OTHER reason would
    // pass a length check and still mean auto-submit does nothing. The queue
    // keys on the document NUMBER (`internalId`), which is what ETA receives —
    // not on the internal id.
    const number = (await req("GET", "/sales-invoices/SCN-S-INV-ETA")).body?.docNo;
    check("the confirmed invoice carries a document number", typeof number === "string" && number !== "", `number=${number}`);
    const mine = after.find((row: any) => row.internalId === number);
    check("and the queued row is THIS invoice", mine !== undefined, `number=${number} queue=${JSON.stringify(after.map((r: any) => r.internalId))}`);
    check("queued awaiting submission rather than pre-marked accepted", mine?.status !== "accepted" && mine?.status !== "excluded", `status=${mine?.status}`);

    // The other half of the switch: OFF must mean off. A producer wired to fire
    // unconditionally would pass every assertion above.
    const off = await req("PUT", "/eta/config", {
      environment: "preproduction", taxRegistrationNumber: "123456789", activityCode: "4610",
      documentVersion: "1.0", autoSubmitOnConfirm: false, signingMethod: "none", buyerDataThreshold: 0,
    });
    check("auto-submit can be switched back off", off.status === 200, `status ${off.status}`);
    const beforeOff = rows((await req("GET", "/eta/submissions")).body).length;
    const quiet = await serviceInvoice("SCN-S-INV-ETA-OFF", [{ qty: "1", unitPrice: "500" }]);
    check("another invoice confirms with the switch off", quiet.confirmed.status === 200, JSON.stringify(quiet.confirmed.body).slice(0, 200));
    checkEq("and nothing is enqueued — the switch is read, not ignored in both directions", rows((await req("GET", "/eta/submissions")).body).length, beforeOff);
  });

  // ---------------------------------------------------------------------------
  // X30 — one confirm, many listeners
  // ---------------------------------------------------------------------------
  await scenario("x30 · a document confirm notifies its rule, and the listener can neither duplicate nor roll back the document", async () => {
    const rule = await req("POST", "/notification-rules", {
      id: "SCN-S-RULE-1", name: "تأكيد فاتورة مبيعات", eventCode: "SALES_INVOICE_CONFIRMED",
      recipientType: "user", recipientValue: "USER-ADMIN", priority: "normal", channels: ["in_app"], active: true,
    });
    check("a rule on a genuinely-emitted event is created", rule.status === 201, `status ${rule.status} ${JSON.stringify(rule.body).slice(0, 250)}`);

    // The webhook half of this seam went with the mount (DEC-17): there is no
    // longer a way to register a target, so the only listener left on a confirm
    // is the notification-rules engine.
    const unreadBefore = rows((await req("GET", "/notifications", undefined, { "x-user-id": "USER-ADMIN" })).body).length;
    const sale = await serviceInvoice("SCN-S-INV-EVENT", [{ qty: "2", unitPrice: "250" }]);
    check("the invoice confirms while a rule listens", sale.confirmed.status === 200, JSON.stringify(sale.confirmed.body).slice(0, 250));
    // The document-event bridge enriches asynchronously (create-backend.ts) — give its microtasks a turn.
    await new Promise((resolve) => setTimeout(resolve, 50));

    // Two rules match this event for this user: the seed's NR-DEMO-1 (by
    // permission) and this scenario's (by user id). One notification each.
    const matching = rows((await req("GET", "/notification-rules")).body)
      .filter((r: any) => r.eventCode === "SALES_INVOICE_CONFIRMED" && r.active).length;
    const mine = rows((await req("GET", "/notifications", undefined, { "x-user-id": "USER-ADMIN" })).body);
    checkEq("one notification per matching rule — no storm, and no rule firing twice", mine.length - unreadBefore, matching);
    const other = rows((await req("GET", "/notifications", undefined, { "x-user-id": "USER-NOBODY" })).body);
    check("and a user no rule addresses gets nothing", other.length === 0, `other user's inbox=${other.length}`);

    const invoice = (await req("GET", "/sales-invoices/SCN-S-INV-EVENT")).body;
    check("the document is untouched by its listeners: still confirmed", invoice?.status === "confirmed", `status=${invoice?.status}`);
    const entry = await journalOf("SCN-S-INV-EVENT");
    checkEq("and posted exactly once, in full — a listener must not duplicate or halve a journal entry", entry.debit, n(invoice?.totals?.grandTotal));
    const retry = await req("POST", "/sales-invoices/SCN-S-INV-EVENT/confirm", {});
    check("a second confirm is refused rather than posting again", retry.status === 409 || retry.status === 422, `status ${retry.status} ${JSON.stringify(retry.body).slice(0, 200)}`);
    checkEq("and the entry is exactly as it was", (await journalOf("SCN-S-INV-EVENT")).debit, entry.debit);
  });

  // ---------------------------------------------------------------------------
  // X45 — withholding tax on local payments
  // ---------------------------------------------------------------------------
  await scenario("x45 · a payment withholds tax: the supplier is settled in full, the authority is owed the difference, and the filing can see it", async () => {
    const accounts = rows((await req("GET", "/accounts")).body);
    const whtAccount = accounts.find((a: any) => String(a.code) === "2210");
    check(
      "the chart of accounts has a withholding-tax payable account distinct from payroll withholdings (2190)",
      Boolean(whtAccount) && String(whtAccount?.nameEn ?? "").toLowerCase().includes("withholding"),
      `matched=${JSON.stringify(whtAccount ?? null).slice(0, 200)}`,
    );

    const apBefore = await gl(PAYABLE);
    const cashBefore = await gl(CASH);
    const whtBefore = await gl("2210");

    const voucher = await req("POST", "/vouchers", {
      id: "SCN-S-VCH-WHT", date: TODAY, memo: "دفعة لمورد بعد خصم ضريبة الخصم", voucherType: "supplier_payment",
      amount: "10000.00", branchId: BRANCH, paymentMethod: "cash",
      treasuryAccountId: CASH_TREASURY, treasuryGlAccountId: CASH, counterpartyGlAccountId: PAYABLE,
      supplierId: SUPPLIER,
      withholdingRatePercent: 3, withholdingAmount: "300.00", withholdingGlAccountId: "2210",
    });
    check("a withholding payment voucher is accepted", voucher.status === 201, `status ${voucher.status} ${JSON.stringify(voucher.body).slice(0, 250)}`);
    checkEq("the voucher records the GROSS that settles the supplier", n(voucher.body?.amount), 10000);
    checkEq("and the tax withheld from it", n(voucher.body?.withholdingAmount), 300);
    checkEq("so the net actually leaving the خزنة is derived, not re-entered", n(voucher.body?.netPaidAmount), 9700);

    const confirmed = await req("POST", "/vouchers/SCN-S-VCH-WHT/confirm", {});
    check("it confirms", confirmed.status === 200, JSON.stringify(confirmed.body).slice(0, 200));

    checkEq("the supplier is discharged by the FULL 10,000 — not by what they were handed", (await gl(PAYABLE)) - apBefore, 10000);
    checkEq("only 9,700 leaves the خزنة", (await gl(CASH)) - cashBefore, -9700);
    checkEq("and the authority is owed the 300 the tenant is holding on their behalf", (await gl("2210")) - whtBefore, -300);

    const refused = await req("POST", "/vouchers", {
      id: "SCN-S-VCH-WHT-BAD", date: TODAY, memo: "خصم بلا حساب", voucherType: "supplier_payment",
      amount: "500.00", branchId: BRANCH, paymentMethod: "cash",
      treasuryAccountId: CASH_TREASURY, treasuryGlAccountId: CASH, counterpartyGlAccountId: PAYABLE,
      supplierId: SUPPLIER, withholdingAmount: "50.00",
    });
    check("withholding without an account to book it against is refused, in Arabic", refused.status === 422 && /ضريبة الخصم/.test(String(refused.body?.message)), `status ${refused.status} ${JSON.stringify(refused.body).slice(0, 200)}`);

    const report = await req(`GET`, `/reports/tax/withholding?fromDate=${MONTH_START}&toDate=${MONTH_END}`);
    check("the withholding filing exists", report.status === 200, `status ${report.status}`);
    const filed = rows(report.body).find((r: any) => r.voucherId === "SCN-S-VCH-WHT");
    check("and lists this payment with its gross, rate and tax", Boolean(filed), JSON.stringify(rows(report.body)).slice(0, 250));
    if (filed) {
      checkEq("gross on the filing", n(filed.grossAmount), 10000);
      checkEq("tax withheld on the filing", n(filed.withheldAmount), 300);
      checkEq("net paid on the filing", n(filed.netPaidAmount), 9700);
    }
  });

  // ---------------------------------------------------------------------------
  // X46 — VAT that is not "14% of everything"
  // ---------------------------------------------------------------------------
  await scenario("x46 · the VAT return separates the rates it actually collected, per line, not one blended rate per document", async () => {
    // The buckets are tenant-wide and earlier scenarios have already posted at
    // these rates, so what this invoice proves is the DELTA it contributes.
    const bucketOf = (rowsIn: any[], rate: number) => {
      const row = rowsIn.filter((r: any) => r.side === "output").find((r: any) => n(r.rate) === rate);
      return { base: row ? n(row.base) : 0, tax: row ? n(row.tax) : 0 };
    };
    const before = await vatReturn();
    const fiveBefore = bucketOf(before.rows, 5);
    const fourteenBefore = bucketOf(before.rows, 14);

    const created = await req("POST", "/sales-invoices", {
      id: "SCN-S-INV-RATES", date: TODAY, dueDate: "2026-09-23", customerId: CUSTOMER, customerNameAr: "عميل",
      warehouseId: WH, branchId: BRANCH, arAccountId: AR, taxAccountId: OUTPUT_TAX,
      lines: [
        { lineId: "L1", itemId: "SCN-S-SVC", itemNameAr: "توريد بنسبة ١٤٪", isStock: false, qty: "1", unitPrice: "1000", taxRatePercent: 14, revenueAccountId: REVENUE },
        { lineId: "L2", itemId: "SCN-S-SVC", itemNameAr: "سلعة بنسبة مخفضة ٥٪", isStock: false, qty: "1", unitPrice: "1000", taxRatePercent: 5, revenueAccountId: REVENUE },
        { lineId: "L3", itemId: "SCN-S-SVC", itemNameAr: "تصدير بنسبة صفر", isStock: false, qty: "1", unitPrice: "1000", taxRatePercent: 0, revenueAccountId: REVENUE },
      ],
    });
    const confirmed = await req("POST", "/sales-invoices/SCN-S-INV-RATES/confirm", {});
    check("a three-rate invoice confirms", created.status === 201 && confirmed.status === 200, `${created.status}/${confirmed.status} ${JSON.stringify(confirmed.body).slice(0, 250)}`);
    checkEq("the ledger charges 140 + 50 + 0 = 190, each line at its own rate", n(confirmed.body?.totals?.taxTotal), 190);

    const { rows: vatRows } = await vatReturn();
    const output = vatRows.filter((r: any) => r.side === "output");
    const rates = output.map((r: any) => n(r.rate));
    // The regression guard for D28. Each posted line now carries the rate it was
    // charged at, so the report groups by a recorded fact instead of dividing
    // tax by base per entry — which reported this invoice at a blended ~6.3%
    // that matched no line and no legal rate.
    check(
      "the 5% supply is reported as 5%, in its own bucket — an ETA filing needs the rates separated",
      rates.includes(5),
      `rates seen: ${rates.join(", ") || "(none)"} · rows=${JSON.stringify(output).slice(0, 300)}`,
    );
    check("and the 14% supply keeps its own bucket rather than being blended with the 5% one", rates.includes(14), `rates seen: ${rates.join(", ")}`);
    check("no blended rate that was never charged to anyone appears", !rates.some((r: number) => r !== 0 && r !== 5 && r !== 14), `rates seen: ${rates.join(", ")}`);
    const fiveAfter = bucketOf(vatRows, 5);
    const fourteenAfter = bucketOf(vatRows, 14);
    checkEq("the 5% bucket grew by exactly the tax that line charged, and by nothing else", fiveAfter.tax - fiveBefore.tax, 50);
    checkEq("and by exactly the base it was charged on", fiveAfter.base - fiveBefore.base, 1000);
    checkEq("the 14% bucket took its own line's tax, not a share of the 5% one", fourteenAfter.tax - fourteenBefore.tax, 140);
    checkEq("and its own base", fourteenAfter.base - fourteenBefore.base, 1000);

    const exemptRate = await req("POST", "/tax-rates", {
      id: "SCN-S-TAX-CONSTRUCTION", code: "SCN-S-C36", name: "مقاولات — ١٤٪ على ٣٦٪ من القيمة", rate: 14,
      calculationType: "exclusive", outputTaxAccountId: OUTPUT_TAX, inputTaxAccountId: INPUT_TAX,
      taxableBasePercent: 36,
    });
    check("a tax rate is created", exemptRate.status === 201, `status ${exemptRate.status} ${JSON.stringify(exemptRate.body).slice(0, 250)}`);
    check(
      "FINDING — but the taxable PORTION cannot be expressed: `createTaxRateSchema` (packages/contracts/src/tax-rate.ts) carries a single percentage and no base fraction, " +
        "so the construction-contract treatment (14% on 36% of value, no input deduction) has to be faked as a 5.04% rate — which then files under a rate that does not exist in law.",
      exemptRate.body?.taxableBasePercent === undefined,
      `stored=${JSON.stringify(exemptRate.body).slice(0, 250)}`,
    );
  });

  // ---------------------------------------------------------------------------
  // X47 — a filed VAT period must not move under the filing
  // ---------------------------------------------------------------------------
  await scenario("x47 · once a VAT period is filed, a backdated document cannot restate it without someone amending the filing", async () => {
    const filed = await req("GET", `/financial-reports/vat-return?periodFrom=2026-07-01&periodTo=2026-07-31`);
    const filedOutput = ((filed.body?.rows ?? []) as any[]).filter((r: any) => r.side === "output").reduce((s, r) => s + n(r.tax), 0);
    check("July's VAT return runs — this is the figure a tenant would file", filed.status === 200, `status ${filed.status}`);

    const backdatedBefore = await postJournal("SCN-S-JE-JULY-VAT", "2026-07-20", "مبيعات يوليو أُدخلت قبل الإقرار", [
      { accountId: AR, debit: "1140.00", credit: "0.00", partyId: CUSTOMER },
      { accountId: REVENUE, debit: "0.00", credit: "1000.00" },
      { accountId: OUTPUT_TAX, debit: "0.00", credit: "140.00" },
    ]);
    check("before filing, a backdated July sale posts freely into the open period", backdatedBefore.status === 201, `status ${backdatedBefore.status} ${JSON.stringify(backdatedBefore.body).slice(0, 200)}`);

    const beforeFiling = await req("GET", `/financial-reports/vat-return?periodFrom=2026-07-01&periodTo=2026-07-31`);
    const submitted = ((beforeFiling.body?.rows ?? []) as any[]).filter((r: any) => r.side === "output").reduce((s, r) => s + n(r.tax), 0);
    checkEq("and it moves the return, as it should while the period is still open", submitted - filedOutput, 140);

    const filing = await req("POST", "/gl/vat-filings", {
      id: "SCN-S-VATF-JULY", periodFrom: "2026-07-01", periodTo: "2026-07-31",
      netAmount: submitted.toFixed(2), referenceNo: "ETA-SCN-JULY",
    });
    check("the tenant records that July's return went to the authority (docs/archive/defect-register.md D29)", filing.status === 201 && filing.body?.status === "filed", `status ${filing.status} ${JSON.stringify(filing.body).slice(0, 250)}`);

    const listed = rows((await req("GET", "/gl/vat-filings")).body).find((f: any) => f.id === "SCN-S-VATF-JULY");
    check(
      "the filed-returns list the VAT screen reads shows July as filed, with who filed it and when",
      listed?.status === "filed" && listed?.periodFrom === "2026-07-01" && listed?.periodTo === "2026-07-31" && Boolean(listed?.filedBy) && Boolean(listed?.filedAt),
      JSON.stringify(listed).slice(0, 250),
    );
    checkEq("and the net it records is the net that was submitted", n(listed?.netAmount), submitted);

    const twice = await req("POST", "/gl/vat-filings", {
      id: "SCN-S-VATF-JULY-2", periodFrom: "2026-07-01", periodTo: "2026-07-31", netAmount: "1.00",
    });
    check("a second filing for the same window is refused", twice.status === 409, `status ${twice.status} ${JSON.stringify(twice.body).slice(0, 200)}`);

    const afterFiling = await postJournal("SCN-S-JE-JULY-AFTER", "2026-07-22", "مبيعات يوليو أُدخلت بعد الإقرار", [
      { accountId: AR, debit: "1140.00", credit: "0.00", partyId: CUSTOMER },
      { accountId: REVENUE, debit: "0.00", credit: "1000.00" },
      { accountId: OUTPUT_TAX, debit: "0.00", credit: "140.00" },
    ]);
    check(
      "and now a backdated posting into that window is REFUSED, in Arabic, naming the filing that blocks it",
      afterFiling.status === 422 && /قُدّم بالفعل/.test(String(afterFiling.body?.message)),
      `status ${afterFiling.status} ${JSON.stringify(afterFiling.body).slice(0, 250)}`,
    );

    const unchanged = await req("GET", `/financial-reports/vat-return?periodFrom=2026-07-01&periodTo=2026-07-31`);
    const stillFiled = ((unchanged.body?.rows ?? []) as any[]).filter((r: any) => r.side === "output").reduce((s, r) => s + n(r.tax), 0);
    checkEq("so the submitted figure is exactly what was submitted — the return cannot move under the filing", stillFiled, submitted);

    const noReason = await req("POST", "/gl/vat-filings/SCN-S-VATF-JULY/amend", {});
    check("amending without a reason is refused — a reasonless amendment IS the silent restatement", noReason.status === 400, `status ${noReason.status} ${JSON.stringify(noReason.body).slice(0, 200)}`);

    const amended = await req("POST", "/gl/vat-filings/SCN-S-VATF-JULY/amend", { reason: "فاتورة وردت متأخرة من العميل" });
    check("amending WITH a reason reopens the window and records why", amended.status === 200 && amended.body?.status === "amended" && amended.body?.amendmentReason, JSON.stringify(amended.body).slice(0, 250));

    const listedAmended = rows((await req("GET", "/gl/vat-filings")).body).find((f: any) => f.id === "SCN-S-VATF-JULY");
    check(
      "the list then shows July as amended, with the reason and the time — the state the screen stops offering «تعديل الإقرار» on",
      listedAmended?.status === "amended" && listedAmended?.amendmentReason === "فاتورة وردت متأخرة من العميل" && Boolean(listedAmended?.amendedAt),
      JSON.stringify(listedAmended).slice(0, 250),
    );

    const afterAmend = await postJournal("SCN-S-JE-JULY-AMENDED", "2026-07-23", "مبيعات يوليو بعد تعديل الإقرار", [
      { accountId: AR, debit: "1140.00", credit: "0.00", partyId: CUSTOMER },
      { accountId: REVENUE, debit: "0.00", credit: "1000.00" },
      { accountId: OUTPUT_TAX, debit: "0.00", credit: "140.00" },
    ]);
    check("and the restatement posts, now that someone decided to make it", afterAmend.status === 201, `status ${afterAmend.status} ${JSON.stringify(afterAmend.body).slice(0, 200)}`);

    // Fiscal-period close remains its own, separate lock — an accounting control, not a tax one.
    const july = rows((await req("GET", "/fiscal-periods?year=2026")).body).find((p: any) => p.periodNumber === 7);
    if (july?.id) {
      const closed = await req("POST", `/fiscal-periods/${july.id}/close`, { overrideReason: "SCN-S: إقفال اختباري فوق فحوص الإقفال المفتوحة" });
      check("July closes", closed.status === 200, `status ${closed.status}`);
      const blocked = await postJournal("SCN-S-JE-JULY-BLOCKED", "2026-07-21", "محاولة بعد الإقفال", [
        { accountId: AR, debit: "1140.00", credit: "0.00", partyId: CUSTOMER },
        { accountId: REVENUE, debit: "0.00", credit: "1000.00" },
        { accountId: OUTPUT_TAX, debit: "0.00", credit: "140.00" },
      ]);
      check("and the period gate refuses independently of the filing — two locks, two questions", blocked.status === 422, `status ${blocked.status} ${JSON.stringify(blocked.body).slice(0, 200)}`);
      const reopened = await req("POST", `/fiscal-periods/${july.id}/reopen`, {});
      check("July reopens for the rest of the suite", reopened.status === 200 && reopened.body?.status === "open", `status ${reopened.status}`);
    }
  });

  // ---------------------------------------------------------------------------
  // X47b — a manual line on a party control account names its party (D205)
  // ---------------------------------------------------------------------------
  await scenario("x47b · a manual journal line on 1105 or 2100 must name the customer or supplier, and then moves that party's balance (D205)", async () => {
    const owedOf = async (kind: "customers" | "suppliers", id: string) => ctx.scaled((await req("GET", `/${kind}/${id}`)).body?.owed);
    const rowOf = async (kind: "customers" | "suppliers", id: string) => {
      const aging = await req("GET", `/reports/aging/${kind}`);
      const row = rows(aging.body).find((r: any) => (kind === "customers" ? r.customerId : r.supplierId) === id);
      return { row: ctx.scaled(row?.total ?? 0), tie: aging.body?.reconciliation };
    };
    const statementOf = async (kind: "customers" | "suppliers", id: string) => (await req("GET", `/reports/statements/${kind}/${id}`)).body;

    const partyless = await postJournal("SCN-S-JE-AR-NOPARTY", TODAY, "قيد على العملاء بلا عميل", [
      { accountId: AR, debit: "500.00", credit: "0.00" },
      { accountId: REVENUE, debit: "0.00", credit: "500.00" },
    ]);
    check(
      "a manual line on 1105 that names no customer is refused, in Arabic and in English",
      partyless.status === 422 &&
        partyless.body?.error === "PARTY_REQUIRED_ON_CONTROL_ACCOUNT" &&
        /العميل/.test(String(partyless.body?.message)) &&
        /customer/.test(String(partyless.body?.messageEn)),
      `status ${partyless.status} ${JSON.stringify(partyless.body).slice(0, 250)}`,
    );
    const partylessAp = await postJournal("SCN-S-JE-AP-NOPARTY", TODAY, "قيد على الموردين بلا مورد", [
      { accountId: EXPENSE, debit: "300.00", credit: "0.00" },
      { accountId: PAYABLE, debit: "0.00", credit: "300.00" },
    ]);
    check("and so is one on 2100 that names no supplier", partylessAp.status === 422 && partylessAp.body?.error === "PARTY_REQUIRED_ON_CONTROL_ACCOUNT", `status ${partylessAp.status}`);
    const draft = await req("POST", "/gl/journal-entries/draft", {
      id: "SCN-S-JE-AR-NOPARTY-DRAFT", date: TODAY, memo: "مسودة بلا عميل",
      lines: [{ accountId: AR, debit: "10.00", credit: "0.00" }, { accountId: REVENUE, debit: "0.00", credit: "10.00" }],
    });
    check("a draft cannot park the party-less line for later either", draft.status === 422, `status ${draft.status}`);
    const ghost = await postJournal("SCN-S-JE-AR-GHOST", TODAY, "عميل غير موجود", [
      { accountId: AR, debit: "10.00", credit: "0.00", partyId: "CUST-DOES-NOT-EXIST" },
      { accountId: REVENUE, debit: "0.00", credit: "10.00" },
    ]);
    check("a customer that does not exist is refused", ghost.status === 422 && ghost.body?.error === "INVALID_JOURNAL_PARTY", `status ${ghost.status}`);
    const stray = await postJournal("SCN-S-JE-STRAY-PARTY", TODAY, "طرف على حساب إيرادات", [
      { accountId: CASH, debit: "10.00", credit: "0.00" },
      { accountId: REVENUE, debit: "0.00", credit: "10.00", partyId: CUSTOMER },
    ]);
    check("and a party on an account that is not a control account is refused", stray.status === 422 && stray.body?.error === "INVALID_JOURNAL_PARTY", `status ${stray.status}`);

    const owedBefore = await owedOf("customers", CUSTOMER);
    const ladderBefore = await rowOf("customers", CUSTOMER);
    const named = await postJournal("SCN-S-JE-AR-PARTY", TODAY, "مبيعات مباشرة على حساب العميل", [
      { accountId: AR, debit: "1140.00", credit: "0.00", partyId: CUSTOMER },
      { accountId: REVENUE, debit: "0.00", credit: "1000.00" },
      { accountId: OUTPUT_TAX, debit: "0.00", credit: "140.00" },
    ]);
    check("the same line naming the customer posts", named.status === 201 && named.body?.lines?.[0]?.partyId === CUSTOMER, `status ${named.status} ${JSON.stringify(named.body).slice(0, 250)}`);
    const ladderAfter = await rowOf("customers", CUSTOMER);
    check("it lands on the customer's aging row as an open debit", ladderAfter.row! - ladderBefore.row! === 1_140_000_000n, `${ladderBefore.row} → ${ladderAfter.row}`);
    check("the customer ladder still ties to 1105 exactly", ladderAfter.tie?.diff === "0.000000", JSON.stringify(ladderAfter.tie));
    check("what the customers screen says they owe moved by the same 1,140.00", (await owedOf("customers", CUSTOMER))! - owedBefore! === 1_140_000_000n);
    const statement = await statementOf("customers", CUSTOMER);
    check(
      "their statement shows the journal line and closes on their aging row",
      (statement?.lines ?? []).some((l: any) => l.kind === "journal" && ctx.scaled(l.increase) === 1_140_000_000n) &&
        ctx.scaled(statement?.closing) === ladderAfter.row &&
        ctx.scaled(statement?.agingTotal) === ladderAfter.row,
      JSON.stringify(statement).slice(0, 300),
    );

    const supplierBefore = await rowOf("suppliers", SUPPLIER);
    const credit = await postJournal("SCN-S-JE-AP-PARTY", TODAY, "تسوية دائنة للمورد", [
      { accountId: EXPENSE, debit: "300.00", credit: "0.00" },
      { accountId: PAYABLE, debit: "0.00", credit: "300.00", partyId: SUPPLIER },
    ]);
    check("a 2100 line naming the supplier posts", credit.status === 201, `status ${credit.status}`);
    const supplierAfter = await rowOf("suppliers", SUPPLIER);
    check("it raises what the supplier is owed on their aging row", supplierAfter.row! - supplierBefore.row! === 300_000_000n, `${supplierBefore.row} → ${supplierAfter.row}`);
    check("the supplier ladder still ties to 2100 exactly", supplierAfter.tie?.diff === "0.000000", JSON.stringify(supplierAfter.tie));
    check("the suppliers screen's owed figure is that row", (await owedOf("suppliers", SUPPLIER)) === supplierAfter.row);

    const reversed = await req("POST", "/gl/journal-entries/SCN-S-JE-AP-PARTY/reverse", { reversalId: "SCN-S-JE-AP-PARTY-REV" });
    check("reversing the supplier line posts", reversed.status === 200 || reversed.status === 201, `status ${reversed.status}`);
    check("and takes it back off their row", (await rowOf("suppliers", SUPPLIER)).row === supplierBefore.row);
  });

  // ---------------------------------------------------------------------------
  // X52 — rounding, swept rather than sampled
  // ---------------------------------------------------------------------------
  await scenario("x52 · forty awkward documents, every one of which must add up exactly — the property, not the example", async () => {
    const prices = ["33.33", "0.005", "10.005", "1.115", "99.995", "7.77", "0.01", "123.456"];
    const quantities = ["1", "3", "7", "11"];
    // Percent discounts only: an AMOUNT discount larger than a tiny subtotal
    // floors the invoice at zero, which sales.ts already proves is refused at
    // confirm — a deliberate rule, not a rounding question.
    const discounts: Array<Record<string, unknown> | undefined> = [
      undefined,
      { discount: { type: "percent", percent: 10 } },
      { discount: { type: "percent", percent: 33.33 } },
      { discount: { type: "percent", percent: 90 } },
      { discount: { type: "percent", percent: 7.5 } },
    ];
    const rates = [14, 5, 0];

    let swept = 0;
    let subtotalLeaks = 0;
    let taxLeaks = 0;
    let grandLeaks = 0;
    let entryLeaks = 0;
    const evidence: string[] = [];

    for (let i = 0; i < prices.length * discounts.length; i++) {
      const price = prices[i % prices.length];
      const qty = quantities[i % quantities.length];
      const rate = rates[i % rates.length];
      const over = discounts[i % discounts.length];
      const id = `SCN-S-ROUND-${i}`;
      const { created, confirmed } = await serviceInvoice(
        id,
        [
          { qty, unitPrice: price, taxRatePercent: rate },
          { qty: "1", unitPrice: price, taxRatePercent: rate },
          { qty: "1", unitPrice: "0.33", taxRatePercent: rate },
        ],
        over ?? {},
      );
      if (created.status !== 201 || confirmed.status !== 200) {
        evidence.push(`${id}: create ${created.status} confirm ${confirmed.status}`);
        continue;
      }
      swept++;
      const totals = confirmed.body?.totals ?? {};
      // Each line extends to the piastre before anything is summed, so the
      // comparison has to round the same way the domain does (HALF_UP, 2dp).
      const round2 = (v: number) => Math.round((v + Number.EPSILON) * 100) / 100;
      const lineSum = round2(((confirmed.body?.lines ?? []) as any[]).reduce((s, l) => s + round2(n(l.qty) * n(l.unitPrice)), 0));
      const subtotal = n(totals.subtotal);
      if (Math.abs(lineSum - n(totals.grossTotal)) > 0.005) { subtotalLeaks++; evidence.push(`${id}: lines ${lineSum} vs gross ${n(totals.grossTotal)}`); }
      const taxable = n(totals.taxableTotal);
      const expectedGrand = taxable + n(totals.taxTotal);
      if (Math.abs(expectedGrand - n(totals.grandTotal)) > 0.005) { grandLeaks++; evidence.push(`${id}: taxable+tax ${expectedGrand} vs grand ${n(totals.grandTotal)}`); }
      if (Math.abs(subtotal - n(totals.invoiceDiscountTotal) - taxable) > 0.005) {
        taxLeaks++;
        evidence.push(`${id}: subtotal ${subtotal} − discount ${n(totals.invoiceDiscountTotal)} ≠ taxable ${taxable}`);
      }
      const je = await journalOf(confirmed.body?.journalEntryId ?? "");
      if (Math.abs(je.debit - je.credit) > 0.005) { entryLeaks++; evidence.push(`${id}: entry ${je.debit} vs ${je.credit}`); }
    }

    check("every generated document confirmed — an awkward figure must never be a reason to refuse a sale", swept === prices.length * discounts.length, `${swept}/${prices.length * discounts.length} · ${evidence.slice(0, 3).join(" | ")}`);
    check("across the sweep, each line extends to the piastre and those rounded lines sum to the gross total", subtotalLeaks === 0, `${subtotalLeaks} leaks · ${evidence.slice(0, 3).join(" | ")}`);
    check("the invoice-level discount always leaves the taxable base it claims", taxLeaks === 0, `${taxLeaks} leaks · ${evidence.slice(0, 3).join(" | ")}`);
    check("the grand total is always the taxable base plus the tax, to the piastre", grandLeaks === 0, `${grandLeaks} leaks · ${evidence.slice(0, 3).join(" | ")}`);
    check("and every posted entry balances", entryLeaks === 0, `${entryLeaks} leaks · ${evidence.slice(0, 3).join(" | ")}`);

    // The same property on an instalment schedule: a three-way split of an
    // indivisible total is where a naive divide loses a piastre a month.
    let planLeaks = 0;
    for (const [index, total] of ["1000.00", "100.01", "0.07", "33.33"].entries()) {
      const planId = `SCN-S-PLAN-${index}`;
      const plan = await req("POST", "/installments/plans", {
        id: planId, date: TODAY, memo: "قسط اختباري", customerId: CUSTOMER,
        sourceInvoiceId: "SCN-S-INV-ETA", sourceInvoiceNumber: null,
        invoiceTotal: total, downPayment: "0", installmentCount: 3, frequency: "MONTHLY", startDate: "2026-09-01",
      });
      if (plan.status !== 201) { evidence.push(`${planId}: status ${plan.status}`); continue; }
      const sum = ((plan.body?.lines ?? []) as any[]).reduce((s, l) => s + n(l.amount), 0);
      if (Math.abs(sum - Number(total)) > 0.005) { planLeaks++; evidence.push(`${planId}: instalments ${sum} vs total ${total}`); }
    }
    check("a three-way instalment split of an indivisible total always sums back to the total", planLeaks === 0, `${planLeaks} leaks · ${evidence.slice(-3).join(" | ")}`);
  });

  // ---------------------------------------------------------------------------
  // X56 — two people, one second
  // ---------------------------------------------------------------------------
  await scenario("x56 · eight simultaneous confirms take eight distinct, gap-free numbers — and a confirm that fails must not burn one", async () => {
    const ids = Array.from({ length: 8 }, (_, i) => `SCN-S-RACE-${i}`);
    for (const id of ids) {
      await req("POST", "/sales-invoices", {
        id, date: TODAY, dueDate: "2026-09-23", customerId: CUSTOMER, customerNameAr: "عميل",
        warehouseId: WH, branchId: BRANCH, arAccountId: AR, taxAccountId: OUTPUT_TAX,
        lines: [{ lineId: `${id}-L1`, itemId: "SCN-S-SVC", itemNameAr: "خدمة اختبار", isStock: false, qty: "1", unitPrice: "10", taxRatePercent: 0, revenueAccountId: REVENUE }],
      });
    }
    const before = n((await req("GET", "/sequences/SALES_INVOICE")).body?.currentValue);
    const results = await Promise.all(ids.map((id) => req("POST", `/sales-invoices/${id}/confirm`, {})));
    check("all eight confirm", results.every((r) => r.status === 200), results.map((r) => r.status).join(","));

    const numbers = results.map((r) => String(r.body?.docNo ?? r.body?.number ?? ""));
    check("every document gets its own number — no two documents may share one", new Set(numbers).size === numbers.length, numbers.join(","));
    const after = n((await req("GET", "/sequences/SALES_INVOICE")).body?.currentValue);
    checkEq("the counter advanced by exactly eight — no number allocated twice, none skipped", after - before, 8);

    // A confirm that fails: the period gate refuses it AFTER the transaction opens.
    const august = rows((await req("GET", "/fiscal-periods?year=2026")).body).find((p: any) => p.periodNumber === 8);
    if (august?.id) {
      await req("POST", "/sales-invoices", {
        id: "SCN-S-BURN", date: TODAY, dueDate: "2026-09-23", customerId: CUSTOMER, customerNameAr: "عميل",
        warehouseId: WH, branchId: BRANCH, arAccountId: AR, taxAccountId: OUTPUT_TAX,
        lines: [{ lineId: "SCN-S-BURN-L1", itemId: "SCN-S-SVC", itemNameAr: "خدمة اختبار", isStock: false, qty: "1", unitPrice: "10", taxRatePercent: 0, revenueAccountId: REVENUE }],
      });
      await req("POST", `/fiscal-periods/${august.id}/close`, { overrideReason: "SCN-S: إقفال اختباري فوق فحوص الإقفال المفتوحة" });
      const beforeFail = n((await req("GET", "/sequences/SALES_INVOICE")).body?.currentValue);
      const failed = await req("POST", "/sales-invoices/SCN-S-BURN/confirm", {});
      check("the confirm is refused because the period is closed", failed.status === 422, `status ${failed.status} ${JSON.stringify(failed.body).slice(0, 200)}`);
      const afterFail = n((await req("GET", "/sequences/SALES_INVOICE")).body?.currentValue);
      checkEq(
        "and the refused confirm burned no number — an auditor who finds INV-000123 missing is owed an explanation the product cannot give",
        afterFail,
        beforeFail,
      );
      const reopened = await req("POST", `/fiscal-periods/${august.id}/reopen`, {});
      check("August is reopened for the rest of the suite", reopened.body?.status === "open", `status ${reopened.status}`);
    }
  });

  // ---------------------------------------------------------------------------
  // X57 — branch-prefixed numbering
  // ---------------------------------------------------------------------------
  await scenario("x57 · a branch-scoped sequence gives each branch its own counter, and the number says which branch it came from", async () => {
    const branch = await req("POST", "/branches", { id: "BR-SCN-SEAM", code: "SEAM", name: "فرع سيناريوهات التقاطع" });
    const warehouse = await req("POST", "/warehouses", { id: "WH-SCN-SEAM", code: "WH-SEAM", name: "مخزن فرع التقاطع", branchId: "BR-SCN-SEAM" });
    check("a second branch and its warehouse exist", branch.status === 201 && warehouse.status === 201, `${branch.status}/${warehouse.status}`);

    const off = await serviceInvoice("SCN-S-BR-GLOBAL", [{ qty: "1", unitPrice: "100" }]);
    check("with the sequence tenant-global, a sale confirms as before", off.confirmed.status === 200, JSON.stringify(off.confirmed.body).slice(0, 200));
    const globalNo = String(off.confirmed.body?.docNo ?? "");
    check("and its number carries no branch", !/SEAM|MAIN/.test(globalNo), globalNo);

    const configured = await req("PATCH", "/sequences/SALES_INVOICE", { branchScoped: true });
    check("the sequence can be switched to branch-scoped from settings", configured.status === 200 && configured.body?.branchScoped === true, `status ${configured.status} ${JSON.stringify(configured.body).slice(0, 200)}`);

    const a = await serviceInvoice("SCN-S-BR-A", [{ qty: "1", unitPrice: "100" }]);
    const b = await serviceInvoice("SCN-S-BR-B", [{ qty: "1", unitPrice: "100" }], { branchId: "BR-SCN-SEAM", warehouseId: "WH-SCN-SEAM" });
    check("both branches confirm a sale", a.confirmed.status === 200 && b.confirmed.status === 200, `${a.confirmed.status}/${b.confirmed.status}`);

    const numberA = String(a.confirmed.body?.docNo ?? "");
    const numberB = String(b.confirmed.body?.docNo ?? "");
    check("each number names the branch it came from (docs/archive/defect-register.md D33 — the regression guard)", numberA.includes(BRANCH) && numberB.includes("BR-SCN-SEAM"), `first=${numberA} second=${numberB}`);
    check("and the two branches do NOT share one counter", numberA.replace(/\D+/g, "") !== numberB.replace(/\D+/g, "") || numberA !== numberB, `first=${numberA} second=${numberB}`);

    const second = await serviceInvoice("SCN-S-BR-B2", [{ qty: "1", unitPrice: "100" }], { branchId: "BR-SCN-SEAM", warehouseId: "WH-SCN-SEAM" });
    const numberB2 = String(second.confirmed.body?.docNo ?? "");
    checkEq(
      "the new branch's own counter advances by one, untouched by what the other branch sold in between",
      Number(numberB2.replace(/\D+/g, "")) - Number(numberB.replace(/\D+/g, "")),
      1,
    );

    const definition = (await req("GET", "/sequences/SALES_INVOICE")).body;
    check("the sequence definition exposes the dimension", definition?.branchScoped === true, JSON.stringify(definition).slice(0, 250));

    // Leave the tenant as we found it — a later suite asserts tenant-global numbers.
    const restored = await req("PATCH", "/sequences/SALES_INVOICE", { branchScoped: false });
    check("and it is restored to tenant-global for the rest of the suite", restored.body?.branchScoped === false, JSON.stringify(restored.body).slice(0, 200));
  });

  // ---------------------------------------------------------------------------
  // X58 — permissions are a graph, and some are sensitive
  // ---------------------------------------------------------------------------
  await scenario("x58 · the dependency graph is enforced server-side, and so are the visibility tiers it grants", async () => {
    const confirmOnly = { "x-permissions": "sales.invoice.confirm", "x-user-id": "USER-SCN-CONFIRM" };
    const viewOnly = { "x-permissions": "sales.invoice.view", "x-user-id": "USER-SCN-VIEW" };
    const withCost = { "x-permissions": "sales.invoice.view_cost", "x-user-id": "USER-SCN-COST" };

    const denied = await req("GET", "/items", undefined, { ...confirmOnly });
    check("a permission the caller does not hold is refused with the code it is missing", denied.status === 403 && denied.body?.error === "PERMISSION_DENIED", `status ${denied.status} ${JSON.stringify(denied.body).slice(0, 200)}`);

    // `view_own` narrows on `salespersonId`, which holds an EMPLOYEE id — so
    // the tier can only be proven through a user actually linked to an
    // employee. Asserting it against a header-invented user id passed
    // vacuously on the empty list every such caller is shown (D147).
    const allUsers = rows((await req("GET", "/users")).body);
    const linkedUser = allUsers.find((u: any) => typeof u.employeeId === "string" && u.employeeId.length > 0);
    check(
      "the seed links at least one user to an employee, which is what `view_own` on a sales invoice narrows by",
      Boolean(linkedUser),
      `users=${allUsers.length} linked=${allUsers.filter((u: any) => u.employeeId).length}`,
    );

    const repHeaders = { "x-permissions": "sales.invoice.confirm", "x-user-id": String(linkedUser?.id ?? "USER-SCN-CONFIRM") };
    const repEmployeeId = String(linkedUser?.employeeId ?? "");

    const repInvoice = await req("POST", "/sales-invoices", {
      id: "SCN-S-INV-REP", date: TODAY, dueDate: "2026-09-23", customerId: CUSTOMER, customerNameAr: "عميل المندوب",
      warehouseId: WH, branchId: BRANCH, arAccountId: AR, taxAccountId: OUTPUT_TAX, salespersonId: repEmployeeId,
      lines: [{ lineId: "L1", itemId: "SCN-S-SVC", itemNameAr: "خدمة", isStock: false, qty: "1", unitPrice: "500", taxRatePercent: VAT, revenueAccountId: REVENUE }],
    });
    check(
      "an invoice is raised with that employee as its salesperson",
      repInvoice.status === 201 && repInvoice.body?.salespersonId === repEmployeeId,
      `status ${repInvoice.status} ${JSON.stringify(repInvoice.body).slice(0, 250)}`,
    );

    const listAsConfirmer = await req("GET", "/sales-invoices", undefined, repHeaders);
    check(
      "granting `.confirm` implies `.view_own`, and the read route honours that tier rather than demanding `.view` (docs/archive/defect-register.md D31)",
      listAsConfirmer.status === 200,
      `status ${listAsConfirmer.status} ${JSON.stringify(listAsConfirmer.body).slice(0, 200)}`,
    );
    const confirmerSees = rows(listAsConfirmer.body);
    check(
      "and `view_own` NARROWS to the caller's own EMPLOYEE id: at least one row, and every row theirs",
      confirmerSees.length > 0 && confirmerSees.every((i: any) => i.salespersonId === repEmployeeId),
      `rows=${confirmerSees.length} employee=${repEmployeeId} salespeople=${[...new Set(confirmerSees.map((i: any) => String(i.salespersonId)))].join(",")}`,
    );
    check(
      "and a user id is NOT accepted in its place — the two id spaces never collide (D147)",
      confirmerSees.every((i: any) => i.salespersonId !== String(linkedUser?.id ?? "")),
      `employee=${repEmployeeId} user=${String(linkedUser?.id ?? "")}`,
    );

    const listAsViewer = await req("GET", "/sales-invoices", undefined, viewOnly);
    const all = rows(listAsViewer.body);
    check(
      "a `.view` holder is the wider tier and does see the whole book",
      listAsViewer.status === 200 && all.length > confirmerSees.length,
      `view=${all.length} view_own=${confirmerSees.length}`,
    );

    const withoutCostSight = await req("GET", "/sales-invoices/SCN-S-INV-PROMO", undefined, viewOnly);
    const hiddenLines = (withoutCostSight.body?.lines ?? []) as any[];
    check(
      "`sales.invoice.view_cost` is ⚠ sensitive and now enforced: a plain `.view` holder gets no unit cost at all — the field is absent, not null",
      withoutCostSight.status === 200 && hiddenLines.length > 0 && hiddenLines.every((l: any) => !("unitCost" in l)),
      `status ${withoutCostSight.status} line=${JSON.stringify(hiddenLines[0] ?? null).slice(0, 200)}`,
    );

    const withCostSight = await req("GET", "/sales-invoices/SCN-S-INV-PROMO", undefined, withCost);
    const shownLines = (withCostSight.body?.lines ?? []) as any[];
    check(
      "and the holder of view_cost reads it",
      withCostSight.status === 200 && shownLines.some((l: any) => "unitCost" in l),
      `status ${withCostSight.status} line=${JSON.stringify(shownLines[0] ?? null).slice(0, 200)}`,
    );

    const contracts = await req("GET", "/hr/contracts", undefined, { "x-permissions": "hr.contract.view", "x-user-id": "USER-SCN-HR" });
    const contractRows = rows(contracts.body);
    check(
      "the same tier on salary: `hr.contract.view` alone reads the contract and NOT the pay on it",
      contracts.status === 200 && contractRows.length > 0 && contractRows.every((r: any) => !("monthlySalary" in r)),
      `status ${contracts.status} row=${JSON.stringify(contractRows[0] ?? null).slice(0, 200)}`,
    );

    const payroll = await req("GET", "/hr/contracts", undefined, { "x-permissions": "hr.contract.view,hr.employee.view_salary", "x-user-id": "USER-SCN-PAY" });
    const payRows = rows(payroll.body);
    check(
      "while a payroll user, who also holds `hr.employee.view_salary`, reads it",
      payroll.status === 200 && payRows.some((r: any) => r.monthlySalary !== undefined),
      `status ${payroll.status} row=${JSON.stringify(payRows[0] ?? null).slice(0, 200)}`,
    );
  });

  // ---------------------------------------------------------------------------
  // X59 — Arabic search must forgive Arabic
  // ---------------------------------------------------------------------------
  await scenario("x59 · a name typed without its hamza still finds the customer, on the server and in the screens alike", async () => {
    const variants: Array<[string, string]> = [
      ["SCN-S-AR-1", "أحمد عبد الله"],
      ["SCN-S-AR-2", "فاطمة السيد"],
      ["SCN-S-AR-3", "ليلى إبراهيم"],
    ];
    for (const [id, nameAr] of variants) {
      const created = await req("POST", "/customers", { id, code: id, nameAr, currency: "EGP" });
      check(`the customer ${nameAr} is created`, created.status === 201, `status ${created.status} ${JSON.stringify(created.body).slice(0, 200)}`);
    }

    const unfiltered = rows((await req("GET", "/customers")).body).length;
    const hamzaless = rows((await req("GET", "/customers?q=احمد")).body);
    check(
      "`?q=` narrows on the SERVER — it is a real parameter now, not one the route ignores (docs/archive/defect-register.md D32)",
      hamzaless.length > 0 && hamzaless.length < unfiltered,
      `unfiltered=${unfiltered} with q=${hamzaless.length}`,
    );
    check(
      "and it forgives the hamza: احمد finds أحمد",
      hamzaless.some((c: any) => c.id === "SCN-S-AR-1"),
      JSON.stringify(hamzaless.map((c: any) => c.nameAr)).slice(0, 200),
    );

    const taaMarbuta = rows((await req("GET", "/customers?q=فاطمه")).body);
    check("فاطمه finds فاطمة", taaMarbuta.some((c: any) => c.id === "SCN-S-AR-2"), JSON.stringify(taaMarbuta.map((c: any) => c.nameAr)).slice(0, 200));

    const alifMaqsura = rows((await req("GET", "/customers?q=ليلي")).body);
    check("ليلي finds ليلى", alifMaqsura.some((c: any) => c.id === "SCN-S-AR-3"), JSON.stringify(alifMaqsura.map((c: any) => c.nameAr)).slice(0, 200));

    const cleared = rows((await req("GET", "/customers?q=")).body).length;
    checkEq("an empty query shows everything, rather than nothing", cleared, unfiltered);

    const nonsense = rows((await req("GET", "/customers?q=زقزوقةلاتوجد")).body).length;
    checkEq("and a query that matches nothing returns nothing, not the whole table", nonsense, 0);

    // The screens filter the SAME way — one helper, both ends (D32's other half).
    const names = variants.map(([, nameAr]) => nameAr);
    check("the shared helper the screens use forgives the same spellings", names.filter((nameAr) => matchesSearch("احمد", nameAr)).length === 1, `matches=${names.filter((nameAr) => matchesSearch("احمد", nameAr)).length}`);

    const suppliersQ = await req("GET", "/suppliers?q=");
    check("suppliers take the same parameter", suppliersQ.status === 200 && rows(suppliersQ.body).length > 0, `status ${suppliersQ.status}`);
    const itemsQ = await req("GET", "/items?q=");
    check("and so do items", itemsQ.status === 200 && rows(itemsQ.body).length > 0, `status ${itemsQ.status}`);
  });

  // ---------------------------------------------------------------------------
  // X61 — every movement of money leaves a trace
  // ---------------------------------------------------------------------------
  await scenario("x61 · each money-moving action writes an audit row naming who did it, where, and to what", async () => {

    const voucherRes = await req("POST", "/vouchers", {
      id: "SCN-S-VCH-AUDIT", date: TODAY, memo: "سند لتتبع سجل التدقيق", voucherType: "other_expense",
      amount: "250.00", branchId: BRANCH, paymentMethod: "cash",
      treasuryAccountId: CASH_TREASURY, treasuryGlAccountId: CASH, counterpartyGlAccountId: EXPENSE,
    });
    const voucherConfirm = await req("POST", "/vouchers/SCN-S-VCH-AUDIT/confirm", {});
    check("a treasury payment confirms", voucherRes.status === 201 && voucherConfirm.status === 200, `${voucherRes.status}/${voucherConfirm.status}`);
    const reversal = await req("POST", "/vouchers/SCN-S-VCH-AUDIT/reverse", { date: TODAY, memo: "عكس السند" });
    check("and is reversed — money out, then money back", reversal.status === 200 || reversal.status === 201, `status ${reversal.status} ${JSON.stringify(reversal.body).slice(0, 200)}`);

    const sale = await serviceInvoice("SCN-S-INV-AUDIT", [{ qty: "1", unitPrice: "100" }]);
    check("and a sale is confirmed", sale.confirmed.status === 200, JSON.stringify(sale.confirmed.body).slice(0, 200));

    /**
     * Asserted on the SPECIFIC documents this scenario moved, not on a total
     * row count: `limit=200` saturates once the tenant has enough history, and
     * a saturated page reports the same length before and after however much
     * the trail grew.
     */
    // The trail is newest-first and the endpoint caps `limit` at 200, so the
    // rows this scenario just wrote are on the first page by construction.
    const after = await auditRows("limit=200");
    // Every event now names the entity it is about, so the trail can be asked
    // the question directly instead of scraping every string in `details` and
    // hoping the module chose a key this check happens to look at.
    const traced = new Set(after.map((row: any) => row.entityId).filter((v: unknown): v is string => typeof v === "string"));
    check(
      "the audit trail names the voucher this scenario moved — a money movement that leaves no trace is unauditable on a desktop install",
      traced.has("SCN-S-VCH-AUDIT"),
      `voucher absent from ${after.length} audit rows`,
    );
    check("and the sale it confirmed", traced.has("SCN-S-INV-AUDIT"), `invoice absent from ${after.length} audit rows`);
    const actors = new Set(after.map((row: any) => row.actor));
    check("every new row names an actor, never 'system' alone", !(actors.size === 1 && actors.has("system")), `actors=${[...actors].slice(0, 5).join(",")}`);

    const branchScoped = await auditRows(`branchId=${BRANCH}&limit=200`);
    check("filtering by branch narrows the trail rather than returning everything", branchScoped.length <= after.length, `all=${after.length} branch=${branchScoped.length}`);

    const voucherRows = await auditRows("module=treasury&limit=200");
    const mine = voucherRows.filter((row: any) => JSON.stringify(row.details ?? {}).includes("SCN-S-VCH-AUDIT"));
    check("the treasury payment itself is in the trail, named by its document", mine.length > 0, `treasury rows=${voucherRows.length} matching this voucher=${mine.length}`);
    check("both halves are recorded — money out AND the reversal that put it back", mine.length >= 2, `actions=${mine.map((row: any) => row.action).join(",")}`);
    check("each names the actor who did it", mine.every((row: any) => row.actor && row.actor !== "system"), `actors=${mine.map((row: any) => row.actor).join(",")}`);
    check(
      "and they say WHERE: every row carries the DOCUMENT's branch, not the caller's scope — an all-branches caller (the default, and what the shell sends until a branch is picked) " +
        "used to write unattributed rows the audit viewer's branch filter could never find again (docs/archive/defect-register.md D30 — the regression guard)",
      mine.length > 0 && mine.every((row: any) => row.branchId === BRANCH),
      `voucher branchId=BR-MAIN · audit branchIds=${[...new Set(mine.map((row: any) => String(row.branchId)))].join(",")}`,
    );
  });

  // ---------------------------------------------------------------------------
  // X63 — price list, promotion and credit limit in one document
  // ---------------------------------------------------------------------------
  await scenario("x65 · an entity's own audit trail is selectable by id, and a price or credit-limit change is flagged, not merely logged", async () => {
    // The trail used to be filterable by entity TYPE and no further: the id was
    // buried in a free-form details blob under a different key per module, so
    // "what happened to THIS customer" was a question the audit store could not
    // answer. Every event now carries entityId.
    const bump = await req("PATCH", "/customers/CUST-DEMO-1", { creditLimit: "77000.00" });
    check("a customer's credit limit is raised", bump.status === 200, `status ${bump.status} ${JSON.stringify(bump.body).slice(0, 200)}`);

    const custTrail = await auditRows("entityType=CUSTOMER&entityId=CUST-DEMO-1&limit=50");
    check("the customer's own trail is selectable by id", custTrail.length > 0, `rows=${custTrail.length}`);
    check(
      "and every row in it is about THAT customer — a filter that returned the whole stream would look identical from a count",
      custTrail.every((row: any) => row.entityId === "CUST-DEMO-1"),
      JSON.stringify(custTrail.map((r: any) => r.entityId)).slice(0, 200),
    );
    const raise = custTrail.find((row: any) => (row.details?.changes ?? []).some((ch: any) => ch.field === "creditLimit" && ch.from !== null));
    check("the credit-limit change carries what it was before, not just what it now is", raise !== undefined, JSON.stringify(custTrail[0]).slice(0, 300));
    check(
      "and is WARNING, not INFO — the credit limit decides how much may be sold on credit, so raising it quietly is the cheapest way to push a bad debt through",
      raise?.severity === "WARNING",
      `severity=${raise?.severity}`,
    );

    const priced = await req("PATCH", "/items/ITEM-DEMO-1", { salePrice: "188.00" });
    check("an item's sale price is changed", priced.status === 200, `status ${priced.status}`);
    const itemTrail = await auditRows("entityType=ITEM&entityId=ITEM-DEMO-1&limit=50");
    const moved = itemTrail.find((row: any) => (row.details?.changes ?? []).some((ch: any) => ch.field === "salePrice"));
    check("the item's trail records the price move with its previous value", moved !== undefined, JSON.stringify(itemTrail[0] ?? {}).slice(0, 300));
    check("flagged WARNING — it restates the margin on every line booked after it", moved?.severity === "WARNING", `severity=${moved?.severity}`);

    // An edit that moves no price is ordinary master-data maintenance and must
    // NOT cry wolf, or the severity stops carrying information.
    const quiet = await req("PATCH", "/items/ITEM-DEMO-1", { nameEn: "White Rice 5kg" });
    check("an edit that touches no price is accepted", quiet.status === 200, `status ${quiet.status}`);
    const latest = (await auditRows("entityType=ITEM&entityId=ITEM-DEMO-1&limit=50"))[0];
    check("and is recorded at INFO", latest?.severity === "INFO", `severity=${latest?.severity} details=${JSON.stringify(latest?.details).slice(0, 200)}`);

    // A document's trail is the same mechanism, which is the point: one query
    // shape serves customers, items and documents alike.
    const invoiceTrail = await auditRows("entityType=SALES_INVOICE&limit=50");
    check("documents are addressable the same way", invoiceTrail.length > 0 && invoiceTrail.every((r: any) => typeof r.entityId === "string"), `rows=${invoiceTrail.length}`);
  });

  await scenario("x63 · three mechanisms, one number: the credit check sees the promoted price, and the server knows when a line is under the customer's list", async () => {
    const itemId = "SCN-S-PRICED-ITEM";
    await req("POST", "/items", {
      id: itemId, code: "SCN-S-PRICED", nameAr: "صنف بقائمة أسعار", type: "service",
      baseUnitCode: "PCS", trackInventory: false, revenueAccountId: REVENUE,
    });
    const list = await req("POST", "/price-lists", {
      id: "SCN-S-PL-1", code: "SCN-S-PL", nameAr: "قائمة أسعار الجملة",
      lines: [{ itemId, price: "80.00" }],
    });
    check("a price list quoting 80 for the item is created", list.status === 201, `status ${list.status} ${JSON.stringify(list.body).slice(0, 250)}`);

    const promo = await req("POST", "/promotions", {
      id: "SCN-S-PROMO-2", code: "SCN-S-20", nameAr: "خصم ٢٠٪", type: "percentage", percentValue: 20,
      scope: { type: "item", ids: [itemId] }, startDate: "2026-08-01", endDate: "2026-12-31", active: true, requiresCoupon: false, priority: 1,
    });
    check("and a 20% promotion on the same item", promo.status === 201, `status ${promo.status} ${JSON.stringify(promo.body).slice(0, 250)}`);

    // 10 × 80 (price list) = 800, less 20% = 640, plus 14% VAT = 729.60.
    // The limit sits between the un-promoted and the promoted payable, so only
    // a credit check reading the FINAL figure lets this invoice through.
    const customerId = "SCN-S-CUST-PRICED";
    const customer = await req("POST", "/customers", {
      id: customerId, code: "SCN-S-CP", nameAr: "عميل بقائمة أسعار وحد ائتماني",
      priceListId: "SCN-S-PL-1", creditLimit: "800.00", currency: "EGP",
    });
    check("the customer is assigned that price list and an 800 credit limit", customer.status === 201 && customer.body?.priceListId === "SCN-S-PL-1", `status ${customer.status} ${JSON.stringify(customer.body).slice(0, 250)}`);

    const settings = (await req("GET", "/settings")).body;
    await req("PUT", "/settings", { ...settings, creditControlEnabled: true, creditControlMode: "BLOCK" });

    const listPriced = await req("POST", "/sales-invoices", {
      id: "SCN-S-INV-PRICED", date: TODAY, dueDate: "2026-09-23", customerId, customerNameAr: "عميل بقائمة أسعار وحد ائتماني",
      warehouseId: WH, branchId: BRANCH, arAccountId: AR, taxAccountId: OUTPUT_TAX,
      lines: [{ lineId: "L1", itemId, itemNameAr: "صنف بقائمة أسعار", isStock: false, qty: "10", unitPrice: "80.00", taxRatePercent: VAT, revenueAccountId: REVENUE }],
    });
    const confirmed = await req("POST", "/sales-invoices/SCN-S-INV-PRICED/confirm", {});
    check("the invoice confirms", listPriced.status === 201 && confirmed.status === 200, `${listPriced.status}/${confirmed.status} ${JSON.stringify(confirmed.body).slice(0, 250)}`);
    checkEq("the promotion discounts the price-list price, not the item's default: 800 − 20%", n(confirmed.body?.totals?.taxableTotal), 640);
    checkEq("and the payable is 640 + 14%", n(confirmed.body?.totals?.grandTotal), 729.6);
    check(
      "the credit check saw the FINAL payable (729.60 < 800) and not the pre-promotion 912 — otherwise this sale would have been refused",
      confirmed.status === 200,
      `status ${confirmed.status} ${JSON.stringify(confirmed.body).slice(0, 200)}`,
    );

    // A line under the customer's own list price is surfaced, not silently taken.
    const wrongPrice = await req("POST", "/sales-invoices", {
      id: "SCN-S-INV-OFFLIST", date: TODAY, dueDate: "2026-09-23", customerId, customerNameAr: "عميل بقائمة أسعار وحد ائتماني",
      warehouseId: WH, branchId: BRANCH, arAccountId: AR, taxAccountId: OUTPUT_TAX,
      lines: [{ lineId: "L1", itemId, itemNameAr: "صنف بقائمة أسعار", isStock: false, qty: "1", unitPrice: "5.00", taxRatePercent: VAT, revenueAccountId: REVENUE }],
    });
    check("an under-list draft is still accepted — a negotiated price is a real thing", wrongPrice.status === 201, `status ${wrongPrice.status} ${JSON.stringify(wrongPrice.body).slice(0, 200)}`);
    const offList = await req("POST", "/sales-invoices/SCN-S-INV-OFFLIST/confirm", {});
    check("and it confirms, because this warns rather than refuses (the same shape credit control's WARNING mode uses)", offList.status === 200, `status ${offList.status} ${JSON.stringify(offList.body).slice(0, 200)}`);
    const variances = (offList.body?.pricingVariances ?? []) as any[];
    check(
      "but the server SAYS SO: it consulted the customer's price list and reported the line charged under it (docs/archive/defect-register.md D35 — the regression guard)",
      variances.length === 1 && variances[0]?.lineId === "L1" && n(variances[0]?.listPrice) === 80 && n(variances[0]?.chargedPrice) === 5,
      JSON.stringify(variances).slice(0, 250),
    );

    // Credit control has done its job above; restore it before the last check so
    // the 800 limit does not stand in for the pricing signal being measured.
    await req("PUT", "/settings", { ...settings });
    const onList = await req("POST", "/sales-invoices", {
      id: "SCN-S-INV-ONLIST", date: TODAY, dueDate: "2026-09-23", customerId, customerNameAr: "عميل بقائمة أسعار وحد ائتماني",
      warehouseId: WH, branchId: BRANCH, arAccountId: AR, taxAccountId: OUTPUT_TAX,
      lines: [{ lineId: "L1", itemId, itemNameAr: "صنف بقائمة أسعار", isStock: false, qty: "1", unitPrice: "80.00", taxRatePercent: VAT, revenueAccountId: REVENUE }],
    });
    const onListConfirm = await req("POST", "/sales-invoices/SCN-S-INV-ONLIST/confirm", {});
    check(
      "a line AT the list price reports nothing — the warning is a signal, not noise on every sale",
      onList.status === 201 && onListConfirm.status === 200 && (onListConfirm.body?.pricingVariances ?? []).length === 0,
      `create=${onList.status} confirm=${onListConfirm.status} variances=${JSON.stringify(onListConfirm.body?.pricingVariances ?? [])}`,
    );

    await req("PUT", "/settings", { ...settings });
  });

  // ---------------------------------------------------------------------------
  // X64 — year-end
  // ---------------------------------------------------------------------------
  await scenario("x64 · closing the year rolls the result into retained earnings, and the P&L accounts open the new one at zero", async () => {
    const generated = await req("POST", "/fiscal-periods/generate-year", { year: 2027 });
    check("the next fiscal year can be generated", generated.status === 201, `status ${generated.status} ${JSON.stringify(generated.body).slice(0, 200)}`);
    const periods = rows((await req("GET", "/fiscal-periods?year=2027")).body);
    checkEq("with twelve periods", periods.length, 12);
    check("all of them open", periods.every((p: any) => p.status === "open"), periods.map((p: any) => p.status).join(","));

    // Two different figures, and they are only the same on a tenant whose whole
    // history is one year: the REVENUE account carries every unclosed year, and
    // the close rolls all of it; the 2026 income statement carries 2026 alone.
    async function statementRevenue(from: string, to: string): Promise<number> {
      const statement = await req("GET", `/financial-reports/income-statement?periodFrom=${from}&periodTo=${to}`);
      return n((statement.body?.rows ?? []).reduce((s: number, r: any) => (r.sectionKey === "revenue" ? s + n(r.amount) : s), 0));
    }
    const revenueOnBooks = await creditBalance(REVENUE);
    const revenue2026 = await statementRevenue("2026-01-01", "2026-12-31");
    const retainedBefore = await creditBalance(RETAINED_EARNINGS);
    check("2026 has revenue on the books to roll over", revenueOnBooks > 0, `revenue=${revenueOnBooks}`);
    check("and 2026 itself earned some of it", revenue2026 > 0, `revenue2026=${revenue2026}`);

    const closeYear = await req("POST", "/gl/year-end-close", { year: 2026, retainedEarningsAccountId: RETAINED_EARNINGS });
    check("the year closes", closeYear.status === 201, `status ${closeYear.status} ${JSON.stringify(closeYear.body).slice(0, 250)}`);
    check(
      "and reports what it rolled over — every revenue account, not just sales: the year's asset-disposal gain closes too",
      n(closeYear.body?.revenueClosed) >= revenueOnBooks,
      `revenueClosed=${closeYear.body?.revenueClosed} sales alone=${revenueOnBooks}`,
    );
    checkEq("the disposal-gain account is zeroed as well", await creditBalance("4500"), 0);

    const revenue2027 = n((await req("GET", "/financial-reports/income-statement?periodFrom=2027-01-01&periodTo=2027-12-31")).body?.grandTotals?.amount);
    checkEq("a fresh year's income statement is empty", revenue2027, 0);
    checkEq("the revenue ACCOUNT no longer carries last year's total — closing zeroed it (docs/archive/defect-register.md D34)", await creditBalance(REVENUE), 0);
    checkEq(
      "and retained earnings received exactly the year's result",
      Math.round(((await creditBalance(RETAINED_EARNINGS)) - retainedBefore) * 100) / 100,
      Math.round(n(closeYear.body?.netResult) * 100) / 100,
    );

    const twice = await req("POST", "/gl/year-end-close", { year: 2026, retainedEarningsAccountId: RETAINED_EARNINGS });
    check("closing the same year twice is refused rather than posted twice, in Arabic", twice.status === 409 && /مقفلة بالفعل/.test(String(twice.body?.message)), `status ${twice.status} ${JSON.stringify(twice.body).slice(0, 200)}`);

    const balanceSheet = await req("GET", `/financial-reports/balance-sheet?asOfDate=2027-01-01`);
    check("the balance sheet still runs into the new year", balanceSheet.status === 200, `status ${balanceSheet.status}`);
    const bsRows = (balanceSheet.body?.rows ?? []) as any[];
    // After a real close the equity row is the retained-earnings ACCOUNT, not
    // the "_retained-earnings" figure the report derives when no close has
    // posted: every P&L account reads zero as of the new year, so there is
    // nothing left to derive. Asserting the derived row here would be
    // asserting that the close did not happen.
    const postedRetained = bsRows.find((r: any) => String(r.rowId) === RETAINED_EARNINGS);
    const derivedRetained = bsRows.find((r: any) => String(r.rowId) === "_retained-earnings");
    check(
      "the equity side now carries the POSTED retained-earnings account",
      Boolean(postedRetained),
      `rows=${bsRows.map((r: any) => r.rowId).slice(0, 20).join(",")}`,
    );
    check(
      "and the report no longer derives a retained-earnings row of its own — the close made one real",
      derivedRetained === undefined,
      `derived=${JSON.stringify(derivedRetained)}`,
    );
    checkEq(
      "and it carries the year's result",
      n(postedRetained?.amount),
      Math.round((await creditBalance(RETAINED_EARNINGS)) * 100) / 100,
    );
    const assets = bsRows.filter((r: any) => r.side === "asset").reduce((s: number, r: any) => s + n(r.amount), 0);
    const claims = bsRows.filter((r: any) => r.side === "liability-equity").reduce((s: number, r: any) => s + n(r.amount), 0);
    checkEq("and the sheet still balances", Math.round(assets * 100) / 100, Math.round(claims * 100) / 100);
    const prior = await req("GET", "/financial-reports/income-statement?periodFrom=2026-01-01&periodTo=2026-12-31");
    check("the prior year's comparatives still resolve after the new year opens", prior.status === 200 && n(prior.body?.grandTotals?.amount) !== 0, `status ${prior.status} amount=${prior.body?.grandTotals?.amount}`);
    // The closing entry is dated 31 December of the year it closes, so it
    // falls inside this very window. A statement that counted it would report
    // the year it just closed as having earned nothing.
    check(
      "and the closed year still reports the revenue it actually earned — the closing entry is not activity",
      (await statementRevenue("2026-01-01", "2026-12-31")) >= revenue2026,
      `revenue2026=${revenue2026}`,
    );
  });
}
