import type { Ctx } from "./harness.js";

function qs(params: Record<string, string>): string {
  return new URLSearchParams(params).toString();
}

function today(): string {
  return new Date().toISOString().slice(0, 10);
}

async function accountBalance(ctx: Ctx, accountId: string, asOf?: string): Promise<number> {
  const path = asOf ? `/gl/accounts/${accountId}/ledger?asOf=${asOf}` : `/gl/accounts/${accountId}/ledger`;
  const res = await ctx.req("GET", path);
  return ctx.n(res.body?.balance?.balance);
}

/** Executable checks for the accounting module — see docs/scenarios/04-accounting-treasury.md. */
export async function run(ctx: Ctx): Promise<void> {
  await voucherTypesRouteToTheirOwnAccounts_R81(ctx);
  await voucherQueuesAreAServerConcern_R82_R83(ctx);
  await accountRoutingDecidesWherePostingsLand_R61(ctx);
  await ctx.scenario("reconciliation — sub-ledgers vs GL control accounts", async () => {
    const res = await ctx.req("GET", "/reconciliation");
    const rows = ctx.rows(res.body);
    const inventory = rows.find((r: any) => r.key === "inventory");
    const ap = rows.find((r: any) => r.key === "ap");
    const ar = rows.find((r: any) => r.key === "ar");
    ctx.check("reconciliation returns inventory/AP/AR rows", Boolean(inventory && ap && ar), `rows=${JSON.stringify(rows)}`);
    if (inventory) {
      ctx.checkEq("inventory sub-ledger reconciles exactly to GL 1200", ctx.n(inventory.subLedgerBalance), ctx.n(inventory.glBalance));
    }
    if (ap) {
      ctx.checkEq("AP sub-ledger reconciles exactly to GL 2100", ctx.n(ap.subLedgerBalance), ctx.n(ap.glBalance));
    }
    if (ar) {
      const diff = ctx.n(ar.subLedgerBalance) - ctx.n(ar.glBalance);
      ctx.check(
        "D1 — AR sub-ledger stays adrift from GL 1105 (a confirmed collection voucher never moves the invoice's amountPaid)",
        Math.abs(diff) > 0.01,
        `measured diff ${diff.toFixed(2)}`,
      );
    }
  });

  await ctx.scenario("trial balance — total debit equals total credit", async () => {
    const res = await ctx.req("GET", `/financial-reports/trial-balance?${qs({ asOfDate: today() })}`);
    ctx.checkEq("trial balance: total debit = total credit", ctx.n(res.body?.grandTotals?.debit), ctx.n(res.body?.grandTotals?.credit));
  });

  await ctx.scenario("general ledger — total debit equals total credit", async () => {
    const res = await ctx.req("GET", `/financial-reports/general-ledger?${qs({ periodFrom: "2026-01-01", periodTo: today() })}`);
    ctx.checkEq("general ledger: total debit = total credit", ctx.n(res.body?.grandTotals?.debit), ctx.n(res.body?.grandTotals?.credit));
  });

  await ctx.scenario("balance sheet — assets = liabilities + equity, and 1105 classifies as a current asset, not cash", async () => {
    const res = await ctx.req("GET", `/financial-reports/balance-sheet?${qs({ asOfDate: today() })}`);
    const rows = res.body?.rows ?? [];
    const assets = rows.filter((r: any) => r.side === "asset").reduce((s: number, r: any) => s + ctx.n(r.amount), 0);
    const liabilitiesEquity = rows.filter((r: any) => r.side === "liability-equity").reduce((s: number, r: any) => s + ctx.n(r.amount), 0);
    ctx.checkEq("balance sheet: assets = liabilities + equity", assets, liabilitiesEquity);

    const ar = rows.find((r: any) => r.code === "1105");
    ctx.check(
      "account 1105 (ذمم عملاء تجارية) classifies under current assets, not cash — its 11xx prefix matches the cash-code heuristic but the explicit blacklist wins",
      Boolean(ar) && ar.sectionKey === "current-asset",
      `row=${JSON.stringify(ar)}`,
    );
    const cash = rows.find((r: any) => r.code === "1300-1");
    ctx.check("account 1300-1 (صندوق نقدي) classifies as cash", Boolean(cash) && cash.sectionKey === "cash", `row=${JSON.stringify(cash)}`);
  });

  await ctx.scenario("income statement — comparative window matches a direct run of the prior period", async () => {
    const august = await ctx.req(
      "GET",
      `/financial-reports/income-statement?${qs({ periodFrom: "2026-08-01", periodTo: "2026-08-31", compareTo: "previous" })}`,
    );
    const july = await ctx.req(
      "GET",
      `/financial-reports/income-statement?${qs({ periodFrom: "2026-07-01", periodTo: "2026-07-31", compareTo: "previous" })}`,
    );
    ctx.check(
      "NEW DEFECT — /financial-reports/income-statement's comparative column is always zero: it bounds its GL query to [periodFrom, periodTo] " +
        "(financial-reports-routes.ts's loadGlContext), so comparativeRange's prior window — which always starts before periodFrom — finds no entries to sum, " +
        "regardless of real prior-period activity. July 2026 has real activity (see the direct-run amount in the detail), so August's priorAmount should equal it, not 0.",
      Math.abs(ctx.n(august.body?.grandTotals?.priorAmount) - ctx.n(july.body?.grandTotals?.amount)) <= 0.005,
      `August priorAmount=${august.body?.grandTotals?.priorAmount} vs direct July amount=${july.body?.grandTotals?.amount}`,
    );

    // Confirming the bug is route-specific, not domain-wide: /reports/accounting/income-statement
    // (reports-routes.ts) loads the ENTIRE unbounded ledger, so the exact same domain
    // comparativeRange math resolves correctly through that older route.
    const augustUnbounded = await ctx.req(
      "GET",
      `/reports/accounting/income-statement?${qs({ periodFrom: "2026-08-01", periodTo: "2026-08-31", compareTo: "previous" })}`,
    );
    ctx.checkEq(
      "confirming: the unbounded /reports/accounting/income-statement route computes the same comparison correctly",
      ctx.n(augustUnbounded.body?.grandTotals?.priorAmount),
      ctx.n(july.body?.grandTotals?.amount),
    );
  });

  await ctx.scenario("income statement — lastYear mode zero-fills an empty comparison window instead of dropping the row", async () => {
    const res = await ctx.req(
      "GET",
      `/financial-reports/income-statement?${qs({ periodFrom: "2026-08-01", periodTo: "2026-08-31", compareTo: "lastYear" })}`,
    );
    const rows = res.body?.rows ?? [];
    ctx.check("August 2026 has real activity to compare", rows.length > 0, `rows=${rows.length}`);
    ctx.check(
      "the current-window total is nonzero — activity isn't silently dropped",
      ctx.n(res.body?.grandTotals?.amount) !== 0,
      `amount=${res.body?.grandTotals?.amount}`,
    );
    ctx.checkEq("the prior-year (Aug 2025, no activity) total is exactly zero", ctx.n(res.body?.grandTotals?.priorAmount), 0);
    ctx.check(
      "every row active only in the current window still appears, with an explicit zero on the empty side",
      rows.every((r: any) => ctx.n(r.priorAmount) === 0),
      `rows=${JSON.stringify(rows.map((r: any) => r.priorAmount))}`,
    );
  });

  // Both sides of this check land on 0 today regardless of the clamp, because the
  // route bug documented above forces any out-of-bounds comparison window to 0 —
  // it is a real regression guard for the clamp math itself (comparative-period.ts),
  // but only becomes a meaningful proof of the clamp once that route bug is fixed.
  await ctx.scenario("income statement — 29 Feb clamps to 28 Feb in a non-leap comparison year, never rolls into March", async () => {
    const leap = await ctx.req(
      "GET",
      `/financial-reports/income-statement?${qs({ periodFrom: "2028-02-01", periodTo: "2028-02-29", compareTo: "lastYear" })}`,
    );
    const direct = await ctx.req(
      "GET",
      `/financial-reports/income-statement?${qs({ periodFrom: "2027-02-01", periodTo: "2027-02-28", compareTo: "previous" })}`,
    );
    ctx.checkEq(
      "2028-02-29's lastYear comparison equals a direct 2027-02-01..28 run — the leap day clamps, it does not slide into March",
      ctx.n(leap.body?.grandTotals?.priorAmount),
      ctx.n(direct.body?.grandTotals?.amount),
    );
  });

  await ctx.scenario("cash flow — opening balance + net change = closing balance", async () => {
    const res = await ctx.req("GET", `/financial-reports/cash-flow?${qs({ periodFrom: "2026-01-01", periodTo: today(), compareTo: "previous" })}`);
    const rows = res.body?.rows ?? [];
    ctx.check("cash flow returns rows", rows.length > 0, `rows=${rows.length}`);
    const opening = ctx.n(rows[0]?.openingCash);
    const closing = ctx.n(rows[0]?.closingCash);
    const netChange = rows.reduce((s: number, r: any) => s + ctx.n(r.amount), 0);
    ctx.checkEq("cash flow: opening + net change = closing", opening + netChange, closing);
  });

  await ctx.scenario("cash flow — 29 Feb clamps the same way the income statement does", async () => {
    const leap = await ctx.req("GET", `/financial-reports/cash-flow?${qs({ periodFrom: "2028-02-01", periodTo: "2028-02-29", compareTo: "lastYear" })}`);
    const direct = await ctx.req("GET", `/financial-reports/cash-flow?${qs({ periodFrom: "2027-02-01", periodTo: "2027-02-28", compareTo: "previous" })}`);
    ctx.checkEq(
      "2028-02-29's lastYear comparison total equals a direct 2027-02-01..28 run",
      ctx.n(leap.body?.grandTotals?.priorAmount),
      ctx.n(direct.body?.grandTotals?.amount),
    );
  });

  await ctx.scenario("VAT return — output tax minus input tax is the net payable", async () => {
    const res = await ctx.req("GET", `/financial-reports/vat-return?${qs({ periodFrom: "2026-01-01", periodTo: today() })}`);
    const rows = res.body?.rows ?? [];
    ctx.check("VAT return returns rows", rows.length > 0, `rows=${rows.length}`);
    const outputGroup = (res.body?.groups ?? []).find((g: any) => g.key === "output");
    const inputGroup = (res.body?.groups ?? []).find((g: any) => g.key === "input");
    const output = rows.filter((r: any) => r.side === "output").reduce((s: number, r: any) => s + ctx.n(r.tax), 0);
    const input = rows.filter((r: any) => r.side === "input").reduce((s: number, r: any) => s + ctx.n(r.tax), 0);
    ctx.checkEq("output-tax rows sum to the output group's own total", output, ctx.n(outputGroup?.totals?.tax));
    ctx.checkEq("input-tax rows sum to the input group's own total", input, ctx.n(inputGroup?.totals?.tax));
    ctx.check("net VAT payable (output − input) is a real, finite figure", Number.isFinite(output - input), `output=${output} input=${input} net=${output - input}`);
  });

  await ctx.scenario("account ledger — the running balance's last row equals the reported closing balance", async () => {
    const accountId = "1105";
    const periodTo = today();
    const res = await ctx.req("GET", `/financial-reports/account-ledger?${qs({ accountId, periodFrom: "2026-01-01", periodTo })}`);
    const rows = res.body?.rows ?? [];
    ctx.check("account ledger returns at least the opening row", rows.length > 0, `rows=${rows.length}`);
    const lastRow = rows[rows.length - 1];
    const closingFromGl = await accountBalance(ctx, accountId, periodTo);
    ctx.checkEq("account ledger's last running-balance row equals GL 1105's own closing balance", ctx.n(lastRow?.balance), closingFromGl);
  });

  await ctx.scenario("journal entry — reversal never mutates the original, links both sides, and the books still balance", async () => {
    const id = "SCN-JE-REV-1";
    const create = await ctx.req("POST", "/gl/journal-entries", {
      id,
      date: today(),
      memo: "SCN reversal-lifecycle probe",
      lines: [
        { accountId: "1300-1", debit: "300.00", credit: "0.00" },
        { accountId: "4900", debit: "0.00", credit: "300.00" },
      ],
    });
    ctx.check("a balanced entry posts immediately", create.status === 201 && create.body?.status === "posted", `status ${create.status}`);
    const originalLinesBeforeReversal = JSON.stringify(create.body?.lines);

    const reverse = await ctx.req("POST", `/gl/journal-entries/${id}/reverse`, {});
    ctx.check("reverse succeeds", reverse.status === 201, `status ${reverse.status} body ${JSON.stringify(reverse.body).slice(0, 200)}`);
    const original = reverse.body?.original;
    const mirror = reverse.body?.reversal;

    ctx.check(
      "the original entry's own lines are byte-for-byte unchanged by reversal — never mutated",
      JSON.stringify(original?.lines) === originalLinesBeforeReversal,
    );
    ctx.check("the original moves to reversed, never deleted", original?.status === "reversed");
    ctx.check("the mirror entry posts immediately", mirror?.status === "posted");
    ctx.check("the original links forward to its reversal", original?.reversedByEntryId === mirror?.id);
    ctx.check("the reversal links back to the entry it reverses", mirror?.reversesEntryId === original?.id);

    const mirrorCashLine = mirror?.lines?.find((l: any) => l.accountId === "1300-1");
    ctx.checkEq("the mirror swaps the cash line to a credit of the same amount", ctx.n(mirrorCashLine?.credit), 300);
    ctx.checkEq("the mirror's cash line carries no debit", ctx.n(mirrorCashLine?.debit), 0);

    const reagain = await ctx.req("POST", `/gl/journal-entries/${id}/reverse`, {});
    ctx.check(
      "reversing an already-reversed entry is refused, not silently repeated",
      reagain.status === 409 && reagain.body?.error === "JOURNAL_ENTRY_ALREADY_REVERSED",
      `status ${reagain.status} body ${JSON.stringify(reagain.body)}`,
    );

    const tb = await ctx.req("GET", `/financial-reports/trial-balance?${qs({ asOfDate: today() })}`);
    ctx.checkEq("trial balance still balances after the reversal", ctx.n(tb.body?.grandTotals?.debit), ctx.n(tb.body?.grandTotals?.credit));
  });

  await ctx.scenario("journal entry — an unbalanced entry cannot post", async () => {
    const id = "SCN-JE-UNBAL-1";
    const res = await ctx.req("POST", "/gl/journal-entries", {
      id,
      date: today(),
      memo: "SCN unbalanced probe",
      lines: [
        { accountId: "1300-1", debit: "100.00", credit: "0.00" },
        { accountId: "4900", debit: "0.00", credit: "50.00" },
      ],
    });
    ctx.check(
      "an unbalanced entry is refused with UNBALANCED_ENTRY, not a generic failure",
      res.status === 422 && res.body?.error === "UNBALANCED_ENTRY",
      `status ${res.status} body ${JSON.stringify(res.body)}`,
    );
    const fetchBack = await ctx.req("GET", `/gl/journal-entries/${id}`);
    ctx.check("no entry was created for the rejected post", fetchBack.status === 404, `status ${fetchBack.status}`);
  });

  await ctx.scenario(
    "fiscal periods — closed and locked periods refuse posting with a period-specific error; a locked period cannot reopen; locking cannot skip closed",
    async () => {
      const year = new Date().getFullYear();
      const periodsRes = await ctx.req("GET", `/fiscal-periods?${qs({ year: String(year) })}`);
      const periods = ctx.rows(periodsRes.body).length ? ctx.rows(periodsRes.body) : Array.isArray(periodsRes.body) ? periodsRes.body : [];
      // January/February/March, chosen because nothing else in this scenario suite or the demo seed posts a document dated that early in the year.
      const jan = periods.find((p: any) => p.periodNumber === 1);
      const feb = periods.find((p: any) => p.periodNumber === 2);
      const mar = periods.find((p: any) => p.periodNumber === 3);
      ctx.check("the fiscal year has January/February/March periods to test against", Boolean(jan && feb && mar), `periods=${periods.length}`);
      if (!jan || !feb || !mar) return;

      const closeJan = await ctx.req("POST", `/fiscal-periods/${jan.id}/close`, {});
      ctx.check("closing an open period succeeds", closeJan.status === 200 && closeJan.body?.status === "closed", `status ${closeJan.status}`);

      const postIntoClosed = await ctx.req("POST", "/gl/journal-entries", {
        id: "SCN-JE-CLOSED-1",
        date: `${year}-01-15`,
        memo: "SCN closed-period probe",
        lines: [
          { accountId: "1300-1", debit: "10.00", credit: "0.00" },
          { accountId: "4900", debit: "0.00", credit: "10.00" },
        ],
      });
      ctx.check(
        "posting into a closed period is refused with a period-specific error, not a generic failure",
        postIntoClosed.status === 422 &&
          postIntoClosed.body?.error === "PERIOD_NOT_OPEN_FOR_POSTING" &&
          String(postIntoClosed.body?.message).includes("closed"),
        `status ${postIntoClosed.status} body ${JSON.stringify(postIntoClosed.body)}`,
      );

      const reopenJan = await ctx.req("POST", `/fiscal-periods/${jan.id}/reopen`, {});
      ctx.check(
        "reopening the closed period restores it to open",
        reopenJan.status === 200 && reopenJan.body?.status === "open",
        `status ${reopenJan.status} body ${JSON.stringify(reopenJan.body)}`,
      );

      const lockFromOpen = await ctx.req("POST", `/fiscal-periods/${mar.id}/lock`, {});
      ctx.check(
        "locking a period directly from open is refused — it must be closed first",
        lockFromOpen.status === 422 && lockFromOpen.body?.error === "INVALID_PERIOD_TRANSITION",
        `status ${lockFromOpen.status} body ${JSON.stringify(lockFromOpen.body)}`,
      );

      const closeFeb = await ctx.req("POST", `/fiscal-periods/${feb.id}/close`, {});
      ctx.check("closing February succeeds", closeFeb.status === 200 && closeFeb.body?.status === "closed", `status ${closeFeb.status}`);
      const lockFeb = await ctx.req("POST", `/fiscal-periods/${feb.id}/lock`, {});
      ctx.check("locking a closed period succeeds", lockFeb.status === 200 && lockFeb.body?.status === "locked", `status ${lockFeb.status}`);

      const reopenLocked = await ctx.req("POST", `/fiscal-periods/${feb.id}/reopen`, {});
      ctx.check(
        "a locked period cannot be reopened",
        reopenLocked.status === 422 && reopenLocked.body?.error === "INVALID_PERIOD_TRANSITION",
        `status ${reopenLocked.status} body ${JSON.stringify(reopenLocked.body)}`,
      );

      const postIntoLocked = await ctx.req("POST", "/gl/journal-entries", {
        id: "SCN-JE-LOCKED-1",
        date: `${year}-02-15`,
        memo: "SCN locked-period probe",
        lines: [
          { accountId: "1300-1", debit: "10.00", credit: "0.00" },
          { accountId: "4900", debit: "0.00", credit: "10.00" },
        ],
      });
      ctx.check(
        "posting into a locked period is refused too, and the message distinguishes it from closed",
        postIntoLocked.status === 422 &&
          postIntoLocked.body?.error === "PERIOD_NOT_OPEN_FOR_POSTING" &&
          String(postIntoLocked.body?.message).includes("locked"),
        `status ${postIntoLocked.status} body ${JSON.stringify(postIntoLocked.body)}`,
      );
    },
  );

  await ctx.scenario(
    "treasury voucher — a cash payment that would go negative is refused; the same overdraft on a bank account is allowed",
    async () => {
      const cashBefore = await accountBalance(ctx, "1300-1");
      const overCashAmount = (cashBefore + 5000).toFixed(2);
      const cashId = "SCN-VCH-NEGCASH-1";
      await ctx.req("POST", "/vouchers", {
        id: cashId,
        date: today(),
        memo: "SCN cash-negative-guard probe",
        voucherType: "other_expense",
        amount: overCashAmount,
        branchId: "BR-MAIN",
        paymentMethod: "cash",
        treasuryAccountId: "TR-DEMO-CASH",
        treasuryGlAccountId: "1300-1",
        counterpartyGlAccountId: "5900",
      });
      const confirmCash = await ctx.req("POST", `/vouchers/${cashId}/confirm`, {});
      ctx.check(
        "a cash payment beyond the treasury account's balance is refused, not posted",
        confirmCash.status === 422 && confirmCash.body?.error === "CASH_BALANCE_NEGATIVE",
        `status ${confirmCash.status} body ${JSON.stringify(confirmCash.body)}`,
      );

      // A fixed amount, not "current balance + N": 1310 is already deeply
      // negative in this seed's baseline (the bank absorbs every unallocated
      // AP/AR payment), so a balance-relative overage can itself come out
      // negative and fail Money's own "amount must be > 0" validation before
      // the guard is even reached. Any positive payment proves the exemption.
      const bankId = "SCN-VCH-NEGBANK-1";
      await ctx.req("POST", "/vouchers", {
        id: bankId,
        date: today(),
        memo: "SCN bank-overdraft-allowed probe",
        voucherType: "other_expense",
        amount: "50000.00",
        branchId: "BR-MAIN",
        paymentMethod: "bank",
        treasuryAccountId: "TR-DEMO-BANK",
        treasuryGlAccountId: "1310",
        counterpartyGlAccountId: "5900",
      });
      const confirmBank = await ctx.req("POST", `/vouchers/${bankId}/confirm`, {});
      ctx.check(
        "the identical overdraft on a bank account is accepted — the negative-cash guard exempts bank accounts",
        confirmBank.status === 200 && confirmBank.body?.status === "confirmed",
        `status ${confirmBank.status} body ${JSON.stringify(confirmBank.body)}`,
      );
    },
  );

  await ctx.scenario("treasury voucher — a configured approval gate holds a non-admin's confirm as pending", async () => {
    const cfg = await ctx.req("POST", "/workflow/configs", {
      actionType: "TREASURY_VOUCHER_CONFIRM",
      steps: [{ role: "FINANCE_MANAGER", description: "مراجعة سند يتجاوز الحد" }],
    });
    ctx.check("a workflow gate configures on TREASURY_VOUCHER_CONFIRM", cfg.status === 201, `status ${cfg.status} body ${JSON.stringify(cfg.body)}`);

    const voucherId = "SCN-VCH-APPROVAL-1";
    const create = await ctx.req("POST", "/vouchers", {
      id: voucherId,
      date: today(),
      memo: "SCN approval-gate probe",
      voucherType: "customer_collection",
      amount: "100.00",
      branchId: "BR-MAIN",
      paymentMethod: "cash",
      treasuryAccountId: "TR-DEMO-CASH",
      treasuryGlAccountId: "1300-1",
      counterpartyGlAccountId: "1105",
      customerId: "CUST-DEMO-1",
    });
    ctx.check("the draft voucher creates", create.status === 201, `status ${create.status}`);

    // x-permissions deliberately omits "*" so the voucher route's own gateActorRoles() reads x-role-codes instead of bypassing as admin.
    const financeHeaders = { "x-permissions": "treasury.cash_voucher.confirm", "x-role-codes": "FINANCE_MANAGER" };
    const confirm = await ctx.req("POST", `/vouchers/${voucherId}/confirm`, {}, financeHeaders);
    ctx.check(
      "a configured TREASURY_VOUCHER_CONFIRM chain holds a non-admin's confirm بانتظار الموافقة instead of posting it",
      confirm.status === 200 && confirm.body?.held === true && confirm.body?.status === "pending",
      `status ${confirm.status} body ${JSON.stringify(confirm.body)}`,
    );
    ctx.check("the held voucher has posted NO journal entry", !confirm.body?.journalEntryId, JSON.stringify(confirm.body?.journalEntryId));

    const requestId = confirm.body?.workflowRequestId ?? `${voucherId}:confirm`;
    const inbox = await ctx.req("GET", "/workflow/requests");
    ctx.check("the held voucher's request reaches the approvals inbox", ctx.rows(inbox.body).some((r: any) => r.id === requestId), requestId);

    const decide = await ctx.req("POST", `/workflow/requests/${requestId}/decide`, { decision: "approve", comment: "SCN — approved" });
    ctx.check("approving the request succeeds", decide.status === 200 && decide.body?.status === "approved", `status ${decide.status} body ${JSON.stringify(decide.body)}`);

    const after = await ctx.req("GET", `/vouchers/${voucherId}`);
    ctx.check("approving the request POSTS the held voucher", after.body?.status === "confirmed", JSON.stringify(after.body?.status));
    ctx.check("the posted voucher carries its journal entry", !!after.body?.journalEntryId, JSON.stringify(after.body?.journalEntryId));

    // Every later module runs against this same tenant: a scenario-only chain
    // left behind here silently held HR's payroll and advance disbursements.
    const del = await ctx.req("DELETE", `/workflow/configs/${cfg.body?.id}`);
    ctx.check("scenario TREASURY_VOUCHER_CONFIRM config deleted", del.status === 204, `status ${del.status}`);
  });

  await ctx.scenario("cheque — a bounce reverses cleanly and returns the party's control-account balance to its prior value", async () => {
    const underCollectionBefore = await accountBalance(ctx, "1320");
    const bouncedBefore = await accountBalance(ctx, "1360");

    const chequeId = "SCN-CHQ-BOUNCE-1";
    const amount = "500.00";
    const create = await ctx.req("POST", "/cheques", {
      id: chequeId,
      direction: "incoming",
      chequeNumber: "SCN-9000001",
      bankName: "بنك الاختبار",
      issueDate: today(),
      dueDate: today(),
      branchId: "BR-MAIN",
      partyId: "CUST-DEMO-1",
      counterpartyGlAccountId: "1105",
      controlAccounts: { underCollectionAccountId: "1320", bouncedAccountId: "1360" },
      amount,
    });
    ctx.check("the incoming cheque records", create.status === 201, `status ${create.status} body ${JSON.stringify(create.body)}`);

    const deposit = await ctx.req("POST", `/cheques/${chequeId}/deposit`, { bankTreasuryAccountId: "TR-DEMO-BANK" });
    ctx.check("the cheque hands to the bank for collection", deposit.status === 200 && deposit.body?.status === "deposited", `status ${deposit.status}`);

    const bounce = await ctx.req("POST", `/cheques/${chequeId}/bounce`, {});
    ctx.check(
      "bounce transitions the cheque to bounced",
      bounce.status === 200 && bounce.body?.status === "bounced" && bounce.body?.effectiveStatus === "bounced",
      `status ${bounce.status} body ${JSON.stringify(bounce.body)}`,
    );
    ctx.check(
      "bounce posts its own journal entry, distinct from the creation entry",
      Boolean(bounce.body?.bounceJournalEntryId) && bounce.body?.bounceJournalEntryId !== bounce.body?.creationJournalEntryId,
      `bounceJournalEntryId=${bounce.body?.bounceJournalEntryId} creationJournalEntryId=${bounce.body?.creationJournalEntryId}`,
    );

    const underCollectionAfter = await accountBalance(ctx, "1320");
    const bouncedAfter = await accountBalance(ctx, "1360");
    ctx.checkEq(
      "1320 (شيكات تحت التحصيل) returns exactly to its value before this cheque's deposit — the deposit+bounce cycle nets to zero",
      underCollectionAfter,
      underCollectionBefore,
    );
    ctx.checkEq("1360 (شيكات مرتجعة) increases by exactly the bounced cheque's amount", bouncedAfter, bouncedBefore + ctx.n(amount));
  });
}

/**
 * R8.1 — the voucher TYPE decides which GL account it posts against, not the
 * request body. Each case deliberately names a wrong account and asserts the
 * server overrode it: a partner's drawing booked as an expense, or a tax
 * payment booked as rent, is a misstatement no report would flag.
 */
export async function voucherTypesRouteToTheirOwnAccounts_R81(ctx: Ctx): Promise<void> {
  await ctx.scenario("voucher types post to the account their type fixes, not the one the caller sends (R8.1)", async () => {
    const treasuries = ((await ctx.req("GET", "/treasury-accounts")).body ?? []) as Array<{
      id: string;
      glAccountId: string | null;
    }>;
    const treasury = treasuries.find((t) => t.glAccountId !== null);
    ctx.check("a treasury account with a GL account exists", treasury !== undefined, JSON.stringify(treasuries));
    if (!treasury) return;

    const cases = [
      { type: "capital_injection", account: "3100", why: "a partner's injection is equity, never income" },
      { type: "capital_withdrawal", account: "3200", why: "a drawing is contra-equity, never an expense" },
      { type: "tax_payment", account: "2200", why: "a tax payment settles the VAT payable, never an expense" },

      { type: "customer_advance", account: "2160", why: "an advance is owed back — a liability, never revenue" },
    ];

    for (const { type, account, why } of cases) {
      const id = `SCN-VCH-R81-${type}`;
      const created = await ctx.req("POST", "/vouchers", {
        id,
        date: "2026-08-26",
        voucherType: type,
        amount: "500",
        branchId: "BR-MAIN",
        paymentMethod: "cash",
        treasuryAccountId: treasury.id,
        treasuryGlAccountId: treasury.glAccountId,
        // Deliberately wrong. The server must not take it.
        counterpartyGlAccountId: "9999-WRONG",
        ...(type === "customer_advance" ? { customerId: "CUST-DEMO-1" } : {}),
      });
      ctx.check(`${type} — voucher drafts`, created.status === 201, JSON.stringify(created.body));
      ctx.checkEq(`${type} — routed to ${account}: ${why}`, created.body?.counterpartyGlAccountId, account);

      const confirmed = await ctx.req("POST", `/vouchers/${id}/confirm`, {});
      ctx.check(`${type} — confirms`, confirmed.status === 200, JSON.stringify(confirmed.body));
    }

    /**
     * The other half of the rule: `other_income` and `other_expense` are
     * catch-alls, so an account the caller DOES name must survive — an
     * employee-advance disbursement rides on `other_expense` to reach the
     * 1160 advances asset account. The type only supplies a default.
     */
    const openTyped = await ctx.req("POST", "/vouchers", {
      id: "SCN-VCH-R81-open",
      date: "2026-08-26",
      voucherType: "other_expense",
      amount: "250",
      branchId: "BR-MAIN",
      paymentMethod: "cash",
      treasuryAccountId: treasury.id,
      treasuryGlAccountId: treasury.glAccountId,
      counterpartyGlAccountId: "1160",
    });
    ctx.checkEq("other_expense keeps the account the caller named — it is a catch-all", openTyped.body?.counterpartyGlAccountId, "1160");

    const defaulted = await ctx.req("POST", "/vouchers", {
      id: "SCN-VCH-R81-default",
      date: "2026-08-26",
      voucherType: "other_expense",
      amount: "250",
      branchId: "BR-MAIN",
      paymentMethod: "cash",
      treasuryAccountId: treasury.id,
      treasuryGlAccountId: treasury.glAccountId,
    });
    ctx.checkEq("and falls back to 5910 when the caller names none", defaulted.body?.counterpartyGlAccountId, "5910");

    // And the resulting entries balance, so the routing did not just relabel
    // one side of a broken posting.
    const entries = ((await ctx.req("GET", "/gl/journal-entries")).body ?? []) as Array<{
      memo?: string;
      lines: Array<{ accountId: string; debit: string; credit: string }>;
    }>;
    const routed = entries.filter((e) => e.lines.some((l) => ["3100", "3200", "2200", "4910", "5910", "2160"].includes(l.accountId)));
    ctx.check("the routed vouchers produced journal entries", routed.length > 0, `${routed.length}`);
    for (const entry of routed) {
      ctx.checkEq(
        `"${(entry.memo ?? "").slice(0, 26)}" balances`,
        entry.lines.reduce((sum, l) => sum + ctx.n(l.debit), 0),
        entry.lines.reduce((sum, l) => sum + ctx.n(l.credit), 0),
      );
    }
  });
}

/**
 * R8.2 / R8.3 — the voucher list's chip counts and its needs-allocation queues
 * are computed server-side over every voucher, and each chip counts exactly
 * the rows it would show. The queues are split by intent because collecting
 * from customers and paying suppliers are two different people's work.
 */
export async function voucherQueuesAreAServerConcern_R82_R83(ctx: Ctx): Promise<void> {
  await ctx.scenario("voucher chip counts and needs-allocation queues agree with the rows (R8.2, R8.3)", async () => {
    const counts = ((await ctx.req("GET", "/vouchers/counts")).body ?? {}) as Record<string, number>;
    const all = ((await ctx.req("GET", "/vouchers")).body ?? []) as Array<{ status: string; voucherType: string }>;
    ctx.checkEq("counts.all matches the unfiltered row count", counts.all, all.length);

    for (const status of ["draft", "confirmed", "cancelled"]) {
      const rows = ((await ctx.req("GET", `/vouchers?status=${status}`)).body ?? []) as unknown[];
      ctx.checkEq(`chip "${status}" counts exactly the rows it shows`, counts[status] ?? 0, rows.length);
    }

    // EVERY type is counted, including the ones with no vouchers — a type
    // filter that lists only used types cannot answer "does this type have
    // any?", which is the question a treasurer asks.
    const typeKeys = Object.keys(counts).filter((k) => k.startsWith("type:"));
    ctx.checkEq("all 11 voucher types are counted, used or not", typeKeys.length, 11);
    ctx.check("and some of them are legitimately zero", typeKeys.some((k) => counts[k] === 0), JSON.stringify(counts));
    for (const key of typeKeys) {
      const type = key.slice("type:".length);
      const rows = ((await ctx.req("GET", `/vouchers?type=${type}`)).body ?? []) as unknown[];
      ctx.checkEq(`type chip "${type}" counts exactly the rows it shows`, counts[key] ?? 0, rows.length);
    }

    // The queues, split by intent.
    const receipts = ((await ctx.req("GET", "/vouchers?needsAllocation=receipt")).body ?? []) as Array<{
      voucherType: string;
      status: string;
      allocationSummary: { needsAllocation: boolean };
    }>;
    const payments = ((await ctx.req("GET", "/vouchers?needsAllocation=payment")).body ?? []) as Array<{
      voucherType: string;
    }>;
    const any = ((await ctx.req("GET", "/vouchers?needsAllocation=any")).body ?? []) as unknown[];

    ctx.check("the receipt queue is not empty — an empty queue proves nothing", receipts.length > 0, `${receipts.length}`);
    ctx.check("the payment queue is not empty", payments.length > 0, `${payments.length}`);
    ctx.checkEq("counts.needs_allocation_receipt matches its queue", counts.needs_allocation_receipt ?? 0, receipts.length);
    ctx.checkEq("counts.needs_allocation_payment matches its queue", counts.needs_allocation_payment ?? 0, payments.length);
    ctx.checkEq("and the two intents partition the combined queue", receipts.length + payments.length, any.length);

    for (const row of receipts) {
      ctx.check("every receipt in the queue is confirmed and still unapplied", row.status === "confirmed" && row.allocationSummary.needsAllocation, JSON.stringify(row));
      ctx.check("and it is a money-IN type", row.voucherType === "customer_collection", row.voucherType);
    }
    for (const row of payments) {
      ctx.check("every payment in the queue is a money-OUT type", row.voucherType === "supplier_payment", row.voucherType);
    }
  });
}

/**
 * R6.1 — the account-routing table must actually decide where a posting
 * lands. A settings screen that stores a preference nothing reads is the
 * defect this codebase keeps finding, so the check overrides a slot and then
 * confirms the LEDGER moved.
 */
export async function accountRoutingDecidesWherePostingsLand_R61(ctx: Ctx): Promise<void> {
  await ctx.scenario("the account-routing table changes where a posting actually lands (R6.1)", async () => {
    const initial = await ctx.req("GET", "/accounting/account-routing");
    ctx.check("the routing table loads", initial.status === 200, JSON.stringify(initial.body).slice(0, 200));
    const slots = (initial.body?.slots ?? []) as Array<{ key: string; accountId: string; defaultAccountId: string; overridden: boolean }>;

    // Every slot is listed and resolved, not just the overridden ones — a
    // screen showing only what you changed cannot tell you where things post.
    ctx.check("every slot is listed with a resolved account", slots.length > 0 && slots.every((s) => s.accountId !== ""), `${slots.length} slots`);
    ctx.check("and the sections cover the documented set", new Set(slots.map((s: any) => s.section)).size === 7, JSON.stringify([...new Set(slots.map((s: any) => s.section))]));

    const damage = slots.find((s) => s.key === "inventory_adjustment.DAMAGE");
    ctx.check("the damage-adjustment slot exists", damage !== undefined, JSON.stringify(slots.map((s) => s.key)).slice(0, 200));
    if (!damage) return;

    const unknown = await ctx.req("PUT", "/accounting/account-routing", { overrides: { "not.a.slot": "1200" } });
    ctx.checkEq("an unknown routing key is refused rather than silently stored", unknown.status, 422);

    // Point damage at the shortage account instead, then post a damage
    // adjustment and read the entry back.
    const changed = await ctx.req("PUT", "/accounting/account-routing", { overrides: { "inventory_adjustment.DAMAGE": "5073" } });
    ctx.check("the override saves", changed.status === 200, JSON.stringify(changed.body).slice(0, 200));

    const { draft, confirm } = await draftAndConfirmAdjustment(ctx, "SCN-ADJ-R61", "DAMAGE");
    ctx.check("a damage adjustment drafts", draft.status === 201, JSON.stringify(draft.body));
    ctx.check("and confirms", confirm.status === 200, JSON.stringify(confirm.body));

    const je = await ctx.req("GET", "/gl/journal-entries/SCN-ADJ-R61");
    const lines = (je.body?.lines ?? []) as Array<{ accountId: string }>;
    ctx.check(
      "the damage posted to the OVERRIDDEN account, not its shipped default",
      lines.some((l) => l.accountId === "5073") && !lines.some((l) => l.accountId === damage.defaultAccountId),
      JSON.stringify(lines.map((l) => l.accountId)),
    );

    // And clearing the override puts it back, so the default is a real
    // fallback rather than a one-way door.
    const cleared = await ctx.req("PUT", "/accounting/account-routing", { overrides: { "inventory_adjustment.DAMAGE": null } });
    const back = ((cleared.body?.slots ?? []) as Array<{ key: string; accountId: string; overridden: boolean }>).find(
      (s) => s.key === "inventory_adjustment.DAMAGE",
    );
    ctx.checkEq("clearing the override restores the shipped default", back?.accountId, damage.defaultAccountId);
    ctx.check("and the slot no longer reads as overridden", back?.overridden === false, JSON.stringify(back));
  });
}

async function draftAndConfirmAdjustment(ctx: Ctx, id: string, reason: string) {
  const draft = await ctx.req("POST", "/inventory/stock-adjustments/draft", {
    id,
    date: "2026-08-26",
    memo: `routing check ${reason}`,
    lines: [{ itemId: "ITEM-DEMO-1", warehouseId: "WH-MAIN", reason, direction: "OUT", qty: "1" }],
  });
  const confirm = await ctx.req("POST", `/inventory/stock-adjustments/${id}/confirm`, {});
  return { draft, confirm };
}
