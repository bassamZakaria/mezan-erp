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

  await ctx.scenario("treasury voucher — a configured approval gate should hold a non-admin's confirm as pending", async () => {
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
      "NEW DEFECT — TREASURY_VOUCHER_CONFIRM's workflow gate is wired to a config that is always empty: a non-admin's confirm is granted and posted immediately instead of held pending. " +
        "Root cause: packages/backend/src/create-backend.ts's `vouchers:` options object (feeding createVouchersRoutes) never sets `resolveGateConfig`, so VoucherService's " +
        "`createDocumentWorkflowGate(deps.resolveGateConfig ?? (() => null))` always falls back to the no-op resolver — every configured chain on TREASURY_VOUCHER_CONFIRM is silently ignored. " +
        "(The sibling `resolveGateConfig` at that file's HR-treasury-disbursement construction is a red herring — it wires a DIFFERENT service.)",
      confirm.status === 200 && confirm.body?.held === true && confirm.body?.status === "pending",
      `status ${confirm.status} body ${JSON.stringify(confirm.body)}`,
    );

    // Leave the tenant consistent regardless of which way the assertion above went.
    const after = await ctx.req("GET", `/vouchers/${voucherId}`);
    if (after.body?.status !== "confirmed" && after.body?.status !== "cancelled") {
      await ctx.req("POST", `/vouchers/${voucherId}/confirm`, {});
    }
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
