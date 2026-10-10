import type { Ctx } from "./harness.js";
import { createSqliteLedgerStore } from "../../packages/persistence/src/index.js";
import { Money } from "../../packages/domain/src/index.js";

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

/** Executable checks for the accounting module — see docs/TESTING.md §8. */
export async function run(ctx: Ctx): Promise<void> {
  await voucherTypesRouteToTheirOwnAccounts_R81(ctx);
  await voucherQueuesAreAServerConcern_R82_R83(ctx);
  await accountRoutingDecidesWherePostingsLand_R61(ctx);
  await everyJournalEntryNamesItsModule_R63(ctx);
  await taxGroupsKeepTheirMembersSeparate_R64(ctx);
  await costCentresCarryTheirOwnColumnsAndImportDepartments_R67(ctx);
  await byItemReportsTieToTheLedger_A7(ctx);
  await theTrialBalanceMovesByExactlyOnePosting(ctx);
  await aPostedToAccountResistsTheEditsThatWouldStrandIt(ctx);
  await aPostedEntryCannotBeEditedOrDeletedThroughAnyRoute(ctx);
  await aLegacyDraftBecomesPostableThroughPUT_D226(ctx);
  await closingAMonthStrandsTheDraftsDatedIntoIt(ctx);
  await aCustomerOpeningBalanceNeverReachesTheControlAccount(ctx);
  await duplicateOpeningBalancePostingsAreReportedAndRepaired_D241(ctx);
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
      ctx.checkEq("AR sub-ledger reconciles exactly to GL 1105", ctx.n(ar.subLedgerBalance), ctx.n(ar.glBalance));
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
      "the income statement's comparative column reports real prior-period activity (D-comparative). loadGlContext used to bound the GL query to " +
        "[periodFrom, periodTo], so comparativeRange's prior window — which always starts before periodFrom — summed an empty set and the column was always zero. " +
        "July 2026 has real activity, so August's priorAmount must equal it.",
      Math.abs(ctx.n(august.body?.grandTotals?.priorAmount) - ctx.n(july.body?.grandTotals?.amount)) <= 0.005,
      `August priorAmount=${august.body?.grandTotals?.priorAmount} vs direct July amount=${july.body?.grandTotals?.amount}`,
    );

    // Confirming the bug is route-specific, not domain-wide: /financial-reports/income-statement
    // (reports-routes.ts) loads the ENTIRE unbounded ledger, so the exact same domain
    // comparativeRange math resolves correctly through that older route.
    const augustUnbounded = await ctx.req(
      "GET",
      `/financial-reports/income-statement?${qs({ periodFrom: "2026-08-01", periodTo: "2026-08-31", compareTo: "previous" })}`,
    );
    ctx.checkEq(
      "confirming: the unbounded /financial-reports/income-statement route computes the same comparison correctly",
      ctx.n(augustUnbounded.body?.grandTotals?.priorAmount),
      ctx.n(july.body?.grandTotals?.amount),
    );
  });

  // February 2024 is the FIRST month of the seeded trading history, so its
  // lastYear comparison (Feb 2023) is genuinely empty — which is the only
  // condition under which zero-filling can be observed at all. It used to read
  // Aug 2026 against Aug 2025; once the tenant carried more than one year of
  // history that comparison window stopped being empty and the check was
  // measuring nothing.
  await ctx.scenario("income statement — lastYear mode zero-fills an empty comparison window instead of dropping the row", async () => {
    const res = await ctx.req(
      "GET",
      `/financial-reports/income-statement?${qs({ periodFrom: "2024-02-01", periodTo: "2024-02-29", compareTo: "lastYear" })}`,
    );
    const rows = res.body?.rows ?? [];
    ctx.check("February 2024 has real activity to compare", rows.length > 0, `rows=${rows.length}`);
    ctx.check(
      "the current-window total is nonzero — activity isn't silently dropped",
      ctx.n(res.body?.grandTotals?.amount) !== 0,
      `amount=${res.body?.grandTotals?.amount}`,
    );
    ctx.checkEq("the prior-year (Feb 2023, before the books open) total is exactly zero", ctx.n(res.body?.grandTotals?.priorAmount), 0);
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

      // The demo month carries real unfinished work (a recurring draft, no depreciation run), so the guided
      // close (D176 C-3) refuses a bare close; this scenario is about the POSTING gate, and closes by override.
      const closeJan = await ctx.req("POST", `/fiscal-periods/${jan.id}/close`, { overrideReason: "SCN: إقفال اختباري فوق فحوص الإقفال المفتوحة" });
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
          String(postIntoClosed.body?.message).includes("مغلقة") &&
          String(postIntoClosed.body?.message).includes(`«يناير ${jan.year}»`) &&
          !/closed|locked/.test(String(postIntoClosed.body?.message)) &&
          !String(postIntoClosed.body?.message).includes(jan.id),
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

      // Closed by a second identity: overriding a LOCK takes a different user from the one who closed the month.
      const closeFeb = await ctx.req(
        "POST",
        `/fiscal-periods/${feb.id}/close`,
        { overrideReason: "SCN: إقفال اختباري فوق فحوص الإقفال المفتوحة" },
        { "x-user-id": "SCN-FEB-CLOSER" },
      );
      ctx.check("closing February succeeds", closeFeb.status === 200 && closeFeb.body?.status === "closed", `status ${closeFeb.status}`);
      const bareLockFeb = await ctx.req("POST", `/fiscal-periods/${feb.id}/lock`, {});
      ctx.check(
        "a bare lock is held to the same pre-close checks as the close — the terminal step is not a way around them",
        bareLockFeb.status === 409 && bareLockFeb.body?.error === "PERIOD_CLOSE_BLOCKED",
        `status ${bareLockFeb.status} body ${JSON.stringify(bareLockFeb.body).slice(0, 160)}`,
      );
      const closerLocksFeb = await ctx.req(
        "POST",
        `/fiscal-periods/${feb.id}/lock`,
        { overrideReason: "SCN: إقفال اختباري فوق فحوص الإقفال المفتوحة" },
        { "x-user-id": "SCN-FEB-CLOSER" },
      );
      ctx.check(
        "the user who closed February may not lock it over a failing check alone",
        closerLocksFeb.status === 403 && closerLocksFeb.body?.error === "PERIOD_LOCK_OVERRIDE_SAME_USER",
        `status ${closerLocksFeb.status} body ${JSON.stringify(closerLocksFeb.body).slice(0, 160)}`,
      );
      const lockFeb = await ctx.req("POST", `/fiscal-periods/${feb.id}/lock`, { overrideReason: "SCN: إقفال اختباري فوق فحوص الإقفال المفتوحة" });
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
          String(postIntoLocked.body?.message).includes("مقفلة") &&
          !String(postIntoLocked.body?.message).includes("مغلقة") &&
          !/closed|locked/.test(String(postIntoLocked.body?.message)),
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
    // The SUBMITTER and the APPROVER are two named people, because they have to
    // be: فصل المهام means the person who raised the request may not decide it,
    // and this scenario used to have USER-ADMIN do both.
    // The clerk holds the approval permissions AND the step's role — the exact
    // "one person can do both" shape the separation check exists to refuse.
    const clerkHeaders = {
      "x-user-id": "SCN-USER-CLERK",
      "x-permissions": "treasury.cash_voucher.confirm,workflow.view,workflow.approve,workflow.reject",
      "x-role-codes": "FINANCE_MANAGER",
    };
    const managerHeaders = { "x-user-id": "SCN-USER-MANAGER", "x-permissions": "workflow.view,workflow.approve,workflow.reject", "x-role-codes": "FINANCE_MANAGER" };
    const confirm = await ctx.req("POST", `/vouchers/${voucherId}/confirm`, {}, clerkHeaders);
    ctx.check(
      "a configured TREASURY_VOUCHER_CONFIRM chain holds a non-admin's confirm بانتظار الموافقة instead of posting it",
      confirm.status === 200 && confirm.body?.held === true && confirm.body?.status === "pending",
      `status ${confirm.status} body ${JSON.stringify(confirm.body)}`,
    );
    ctx.check("the held voucher has posted NO journal entry", !confirm.body?.journalEntryId, JSON.stringify(confirm.body?.journalEntryId));

    const requestId = confirm.body?.workflowRequestId ?? `${voucherId}:confirm`;
    const inbox = await ctx.req("GET", "/workflow/requests");
    ctx.check("the held voucher's request reaches the approvals inbox", ctx.rows(inbox.body).some((r: any) => r.id === requestId), requestId);

    // The control this whole gate exists for: one person holding both the
    // permission and the step role must not be able to approve their own
    // payment. The admin bypass does not lift it either — a bypass skips the
    // ROLE a step names, not the separation the step is there to enforce.
    const selfApprove = await ctx.req("POST", `/workflow/requests/${requestId}/decide`, { decision: "approve", comment: "SCN — self" }, clerkHeaders);
    ctx.check(
      "the submitter cannot approve their own request, even holding the step's role",
      selfApprove.status === 409 && selfApprove.body?.error === "SELF_APPROVAL",
      `status ${selfApprove.status} body ${JSON.stringify(selfApprove.body)}`,
    );
    ctx.check(
      "and the refusal reaches the Arabic approvals inbox in Arabic",
      typeof selfApprove.body?.message === "string" && /[\u0600-\u06FF]/.test(selfApprove.body.message),
      String(selfApprove.body?.message),
    );
    const selfReject = await ctx.req("POST", `/workflow/requests/${requestId}/decide`, { decision: "reject", comment: "SCN — self" }, clerkHeaders);
    ctx.check(
      "nor withdraw it by rejecting it, which would name them the approver of their own document",
      selfReject.status === 409 && selfReject.body?.error === "SELF_APPROVAL",
      `status ${selfReject.status} body ${JSON.stringify(selfReject.body)}`,
    );
    const stillPending = await ctx.req("GET", `/vouchers/${voucherId}`);
    ctx.check("and the refused self-decision left the voucher held, not posted", stillPending.body?.status === "pending", JSON.stringify(stillPending.body?.status));
    const adminSelf = await ctx.req("POST", `/workflow/requests/${requestId}/decide`, { decision: "approve" }, { "x-user-id": "SCN-USER-CLERK" });
    ctx.check(
      "and the admin bypass does not lift it — the same person with \"*\" is still the submitter",
      adminSelf.status === 409 && adminSelf.body?.error === "SELF_APPROVAL",
      `status ${adminSelf.status} body ${JSON.stringify(adminSelf.body)}`,
    );

    const decide = await ctx.req("POST", `/workflow/requests/${requestId}/decide`, { decision: "approve", comment: "SCN — approved" }, managerHeaders);
    ctx.check("a DIFFERENT holder of the step's role approves it", decide.status === 200 && decide.body?.status === "approved", `status ${decide.status} body ${JSON.stringify(decide.body)}`);

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
    const receivableBefore = await accountBalance(ctx, "1105");

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
    ctx.checkEq("1360 (شيكات مرتجعة) does not move — a bounce puts the debt back on the customer's own receivable (D192)", bouncedAfter, bouncedBefore);
    ctx.checkEq("1105 returns exactly to its value before the cheque was received (D192)", await accountBalance(ctx, "1105"), receivableBefore);
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
        // An advance with no project could never be recovered from that
        // project's certificates, so the type refuses to draft without one.
        ...(type === "customer_advance" ? { customerId: "CUST-DEMO-1", projectId: "PRJ-DEMO-1" } : {}),
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
    const all = (await ctx.allRows("/vouchers")) as Array<{ status: string; voucherType: string }>;
    ctx.checkEq("counts.all matches the unfiltered row count", counts.all, all.length);

    for (const status of ["draft", "confirmed", "cancelled"]) {
      const rows = await ctx.allRows(`/vouchers?status=${status}`);
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
      const rows = await ctx.allRows(`/vouchers?type=${type}`);
      ctx.checkEq(`type chip "${type}" counts exactly the rows it shows`, counts[key] ?? 0, rows.length);
    }

    // The queues, split by intent.
    const receipts = (await ctx.allRows("/vouchers?needsAllocation=receipt")) as Array<{
      voucherType: string;
      status: string;
      allocationSummary: { needsAllocation: boolean };
    }>;
    const payments = (await ctx.allRows("/vouchers?needsAllocation=payment")) as Array<{
      voucherType: string;
    }>;
    const any = await ctx.allRows("/vouchers?needsAllocation=any");

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
    // 8 since B-8 added the `control` section (AR/AP/inventory control accounts),
    // which the sub-ledger↔GL reconciliation now reads instead of "1105"/"2100"/"1200";
    // 9 since D229 added `fx`, the exchange-difference accounts.
    ctx.check("and the sections cover the documented set", new Set(slots.map((s: any) => s.section)).size === 9, JSON.stringify([...new Set(slots.map((s: any) => s.section))]));
    ctx.check(
      "including the three control-account slots the reconciliation reads (B-8)",
      ["control.receivable", "control.payable", "control.inventory"].every((k) => slots.some((s) => s.key === k)),
      JSON.stringify(slots.filter((s) => s.key.startsWith("control.")).map((s) => `${s.key}=${s.accountId}`)),
    );

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

/**
 * R6.3 — every posted entry names the module that produced it. The check that
 * matters is that NOTHING falls through to "unknown": an entry whose poster
 * forgot to carry its document type is anonymous the moment you leave the
 * document that made it, and no report would flag it.
 */
export async function everyJournalEntryNamesItsModule_R63(ctx: Ctx): Promise<void> {
  await ctx.scenario("every journal entry names the module that produced it (R6.3)", async () => {
    const entries = (await ctx.allRows("/gl/journal-entries")) as Array<{
      entryNo: string | null;
      memo: string;
      source: string;
      sourceModule: string;
      sourceDocType: string | null;
      sourceDocNumber: string | null;
    }>;
    ctx.check("the ledger has entries to check", entries.length > 0, `${entries.length}`);

    const unknown = entries.filter((e) => e.sourceModule === "unknown");
    ctx.check(
      "no entry falls through to 'unknown' — every poster carries its document type",
      unknown.length === 0,
      JSON.stringify(unknown.map((e) => [e.entryNo, e.memo.slice(0, 30)])),
    );

    // A system entry must never be filed as "manual": that is the column a
    // person is accountable for.
    const misfiled = entries.filter((e) => e.source === "system" && e.sourceModule === "manual");
    ctx.check("no system entry is filed as a manual one", misfiled.length === 0, JSON.stringify(misfiled.map((e) => e.entryNo)));

    const anonymous = entries.filter((e) => e.sourceModule !== "manual" && e.sourceDocType === null);
    ctx.check(
      "every non-manual entry carries the document it came from",
      anonymous.length === 0,
      JSON.stringify(anonymous.slice(0, 5).map((e) => [e.entryNo, e.sourceModule, e.memo.slice(0, 30)])),
    );

    // And the filter returns exactly the entries of that module.
    for (const module of ["sales", "purchases", "inventory", "treasury", "payroll"]) {
      const filtered = (await ctx.allRows(`/gl/journal-entries?sourceModule=${module}`)) as Array<{ sourceModule: string }>;
      const expected = entries.filter((e) => e.sourceModule === module).length;
      ctx.checkEq(`the ${module} filter returns exactly that module's entries`, filtered.length, expected);
      ctx.check(`and nothing else leaks into it`, filtered.every((e) => e.sourceModule === module), module);
    }
  });
}

/**
 * R6.4 — a tax group keeps its members separate. The arithmetic that matters
 * is compounding: a table tax charged on the running total costs more than its
 * own rate, and a group that reported one combined percentage would hide both
 * that and which authority is owed what.
 */
/**
 * D44 / R6.7. The screen used to render the chart-of-accounts headers over
 * cost-centre rows, which is only possible because a cost centre and an account
 * happen to share four field names — so the check below is on the DATA every
 * one of the reference's six columns needs, not on the headers themselves.
 */
export async function costCentresCarryTheirOwnColumnsAndImportDepartments_R67(ctx: Ctx): Promise<void> {
  await ctx.scenario("cost centres carry their own six columns, and can be created from the departments the tenant already keeps (R6.7)", async () => {
    const centres = ctx.rows((await ctx.req("GET", "/cost-centers")).body);
    ctx.check("the tenant has cost centres to look at", centres.length > 0, `centres=${centres.length}`);
    const columnsPresent = centres.every(
      (c: any) =>
        typeof c.code === "string" &&
        typeof c.nameAr === "string" &&
        typeof c.type === "string" &&
        "departmentId" in c &&
        "branchId" in c &&
        "parentId" in c &&
        typeof c.status === "string",
    );
    ctx.check(
      "every row carries code, name, type, what it is linked to, its parent and its status — the six the reference lists (docs/archive/defect-register.md D44)",
      columnsPresent,
      JSON.stringify(centres[0] ?? {}).slice(0, 220),
    );

    const departments = ctx.rows((await ctx.req("GET", "/hr/departments")).body);
    ctx.check("the tenant keeps a department list", departments.length >= 2, `departments=${departments.length}`);

    const importable = ctx.rows((await ctx.req("GET", "/cost-centers/importable-departments")).body);
    ctx.check("and every one of them is offered for import, since none has a cost centre yet", importable.length >= 2, `importable=${importable.length}`);
    ctx.check(
      "each candidate names the code it would take rather than leaving the user to invent one",
      importable.every((d: any) => typeof d.suggestedCode === "string" && d.suggestedCode.startsWith("CC-")),
      JSON.stringify(importable.slice(0, 2)),
    );

    const picked = importable.slice(0, 2).map((d: any) => d.id as string);
    const created = await ctx.req("POST", "/cost-centers/from-departments", { departmentIds: picked });
    ctx.check("the import runs", created.status === 201, `${created.status}: ${JSON.stringify(created.body).slice(0, 220)}`);
    const createdRows = ((created.body?.created ?? []) as any[]);
    ctx.checkEq("one cost centre per department chosen", createdRows.length, picked.length);
    ctx.check(
      "each is a DEPARTMENT-type centre carrying the real department id — a label alone could not stop the next import duplicating it",
      createdRows.every((c: any) => c.type === "department" && picked.includes(c.departmentId)),
      JSON.stringify(createdRows).slice(0, 260),
    );

    const again = await ctx.req("POST", "/cost-centers/from-departments", { departmentIds: picked });
    ctx.checkEq("importing the same departments a second time creates nothing", ((again.body?.created ?? []) as any[]).length, 0);
    ctx.checkEq("and says which ones it left alone", ((again.body?.skipped ?? []) as any[]).length, picked.length);

    const stillImportable = ctx.rows((await ctx.req("GET", "/cost-centers/importable-departments")).body);
    ctx.check(
      "the imported departments are no longer offered",
      stillImportable.every((d: any) => !picked.includes(d.id)),
      `remaining=${stillImportable.map((d: any) => d.id).join(",")}`,
    );

    const after = ctx.rows((await ctx.req("GET", "/cost-centers")).body);
    ctx.checkEq("and the tree really grew by that many centres", after.length, centres.length + picked.length);
  });
}

export async function taxGroupsKeepTheirMembersSeparate_R64(ctx: Ctx): Promise<void> {
  await ctx.scenario("a tax group reports its members separately, and compounds correctly (R6.4)", async () => {
    const groups = ((await ctx.req("GET", "/tax-groups")).body ?? []) as Array<{
      code: string;
      effectivePercent: number;
      components: Array<{ taxRateId: string; ratePercent: number; compounding: boolean; effectivePercent: number }>;
    }>;
    ctx.check("the seed has a tax group to check", groups.length > 0, `${groups.length}`);

    const group = groups.find((g) => g.code === "VAT-TABLE");
    ctx.check("the compounding demo group exists", group !== undefined, JSON.stringify(groups.map((g) => g.code)));
    if (!group) return;

    ctx.checkEq("it has two components, not one melted total", group.components.length, 2);
    const vat = group.components.find((c) => c.taxRateId === "VAT14");
    const table = group.components.find((c) => c.taxRateId === "TABLE5");
    ctx.checkEq("VAT charges on the base, so its effective rate is its own", vat?.effectivePercent, 14);
    // 5% of (100 + 14) = 5.7 — the whole point of the compounding flag.
    ctx.checkEq("the compounding member charges on the running total", table?.effectivePercent, 5.7);
    ctx.checkEq("and the group's effective rate is the sum, not 19", group.effectivePercent, 19.7);

    // A group with no members would apply no tax at all to every line that
    // chose it, silently.
    const empty = await ctx.req("POST", "/tax-groups", {
      id: "SCN-TXG-EMPTY",
      code: "SCN-EMPTY",
      nameAr: "مجموعة فارغة",
      members: [],
    });
    ctx.check("an empty group is refused", empty.status >= 400, `status ${empty.status}`);

    // A member pointing at a rate that does not exist charges less than the
    // group claims to.
    const ghost = await ctx.req("POST", "/tax-groups", {
      id: "SCN-TXG-GHOST",
      code: "SCN-GHOST",
      nameAr: "مجموعة بضريبة وهمية",
      members: [{ taxRateId: "NO-SUCH-RATE", compounding: false }],
    });
    ctx.checkEq("a member pointing at a non-existent rate is refused", ghost.status, 422);

    // The same rate twice would double-charge it with nothing explaining why.
    const dupe = await ctx.req("POST", "/tax-groups", {
      id: "SCN-TXG-DUPE",
      code: "SCN-DUPE",
      nameAr: "مجموعة مكررة",
      members: [
        { taxRateId: "VAT14", compounding: false },
        { taxRateId: "VAT14", compounding: false },
      ],
    });
    ctx.checkEq("the same rate twice in one group is refused", dupe.status, 422);
  });
}

/**
 * A7 — the by-item reports must tie to the ledger exactly, and the difference
 * being zero is the only version of that claim worth making. A reconciliation
 * panel that always reports a difference trains people to ignore it.
 */
export async function byItemReportsTieToTheLedger_A7(ctx: Ctx): Promise<void> {
  await ctx.scenario("the by-item reports reconcile to the GL to the cent (A7)", async () => {
    for (const [path, label] of [
      ["/reports/sales/by-item", "sales"],
      ["/reports/purchases/by-item", "purchases"],
    ] as const) {
      const res = await ctx.req("GET", `${path}?dateFrom=2026-01-01&dateTo=2026-12-31`);
      ctx.check(`${label} by-item runs`, res.status === 200, `status ${res.status}`);
      const recon = res.body?.reconciliation as
        | { reportTotal: number; referenceTotal: number; diff: number; withinTolerance: boolean }
        | null
        | undefined;
      ctx.check(`${label} by-item carries a reconciliation at all`, recon != null, JSON.stringify(res.body).slice(0, 160));
      if (!recon) continue;
      ctx.check(`${label} by-item has something to reconcile`, recon.reportTotal > 0, `${recon.reportTotal}`);
      // Two independent paths to one number: the documents the report sums,
      // and what those documents posted. A difference means one is wrong.
      ctx.checkEq(`${label} by-item ties to the ledger exactly`, recon.reportTotal, recon.referenceTotal);
      ctx.check(`${label} by-item reports itself as reconciled`, recon.withinTolerance, JSON.stringify(recon));
    }

    // The reference must follow the PARAMS, not the report's defaults — a
    // reference frozen on the default period stops matching the moment the
    // user changes the range.
    const narrow = await ctx.req("GET", "/reports/sales/by-item?dateFrom=2026-08-01&dateTo=2026-08-31");
    const wide = await ctx.req("GET", "/reports/sales/by-item?dateFrom=2026-01-01&dateTo=2026-12-31");
    const narrowRef = (narrow.body?.reconciliation as { referenceTotal: number }).referenceTotal;
    const wideRef = (wide.body?.reconciliation as { referenceTotal: number }).referenceTotal;
    ctx.check("the ledger side narrows with the date range", narrowRef <= wideRef, `narrow=${narrowRef} wide=${wideRef}`);
    ctx.checkEq(
      "and the narrowed report still ties",
      (narrow.body?.reconciliation as { reportTotal: number }).reportTotal,
      narrowRef,
    );
  });
}

/**
 * The trial balance is the report the month closes on. Two claims, not one:
 * it foots at a real NON-ZERO set of balances, and one posting moves it by
 * exactly that posting and by nothing else. A check that only ever asserts
 * "debit = credit" is satisfied by a ledger that dropped the entry entirely.
 */
export async function theTrialBalanceMovesByExactlyOnePosting(ctx: Ctx): Promise<void> {
  await ctx.scenario("trial balance — foots at a non-zero balance, and one posting moves it by exactly that amount", async () => {
    const read = async () => {
      const res = await ctx.req("GET", `/financial-reports/trial-balance?${qs({ asOfDate: today() })}`);
      const rows = (res.body?.rows ?? []) as Array<{ accountId: string; debit: number; credit: number }>;
      return {
        debit: ctx.n(res.body?.grandTotals?.debit),
        credit: ctx.n(res.body?.grandTotals?.credit),
        byId: new Map(rows.map((r) => [r.accountId, r])),
      };
    };

    const before = await read();
    ctx.check(
      "the trial balance opens at a NON-ZERO total — a zero-to-zero check survives a dropped posting, a flipped sign and a transposed debit/credit",
      before.debit > 0,
      `${before.debit}`,
    );
    ctx.checkEq("and it foots before the probe posts", before.debit, before.credit);

    const post = await ctx.req("POST", "/gl/journal-entries", {
      id: "SCN-JE-TBMOVE-1",
      date: today(),
      memo: "SCN trial-balance movement probe",
      lines: [
        { accountId: "1300-1", debit: "777.77", credit: "0.00" },
        { accountId: "4900", debit: "0.00", credit: "777.77" },
      ],
    });
    ctx.check("the probe entry posts", post.status === 201, `status ${post.status} body ${JSON.stringify(post.body).slice(0, 160)}`);

    const after = await read();
    ctx.checkEq("the trial balance still foots after it", after.debit, after.credit);
    ctx.checkEq("total debit moved by exactly 777.77", after.debit - before.debit, 777.77);
    ctx.checkEq(
      "1300-1 moved by exactly the debit it was given",
      ctx.n(after.byId.get("1300-1")?.debit) - ctx.n(before.byId.get("1300-1")?.debit),
      777.77,
    );
    ctx.checkEq(
      "4900 moved by exactly the credit it was given",
      ctx.n(after.byId.get("4900")?.credit) - ctx.n(before.byId.get("4900")?.credit),
      777.77,
    );

    // Footing is not enough on its own: an entry that also touched a third
    // account would leave the report balanced and the books wrong.
    const moved = [...after.byId.keys()].filter((id) => {
      const b = before.byId.get(id);
      const a = after.byId.get(id)!;
      return !b || Math.abs(ctx.n(a.debit) - ctx.n(b.debit)) > 0.005 || Math.abs(ctx.n(a.credit) - ctx.n(b.credit)) > 0.005;
    });
    ctx.check(
      "exactly the two accounts the entry named moved, and no third one",
      moved.length === 2 && moved.includes("1300-1") && moved.includes("4900"),
      `moved=${moved.join(",")}`,
    );
  });
}

/**
 * The chart of accounts is edited from a settings screen and the ledger is not
 * in the room. Turning a posted-to account into a header removes it from every
 * report that walks the chart while leaving its balance in the ledger, so the
 * trial balance silently stops footing; re-typing one moves last year to a
 * different statement and changes what the year-end close carries to retained
 * earnings. Both are refused now, and this drives the REAL route to prove the
 * guard is wired rather than merely written.
 */
export async function aPostedToAccountResistsTheEditsThatWouldStrandIt(ctx: Ctx): Promise<void> {
  await ctx.scenario("chart of accounts — an account with posted movements refuses the edits that would strand its balance", async () => {
    const ledger = await ctx.req("GET", "/gl/accounts/1300-1/ledger");
    const balance = ctx.n(ledger.body?.balance?.balance);
    ctx.check("1300-1 carries a NON-ZERO posted balance to protect", Math.abs(balance) > 0, `${balance}`);

    const asHeader = await ctx.req("PATCH", "/accounts/1300-1", { isHeader: true });
    ctx.check(
      "turning a posted-to detail account into a header is refused with ACCOUNT_HAS_POSTINGS",
      asHeader.status === 422 && asHeader.body?.error === "ACCOUNT_HAS_POSTINGS",
      `status ${asHeader.status} body ${JSON.stringify(asHeader.body)}`,
    );
    ctx.check(
      "and the refusal is in Arabic, because it surfaces on an Arabic screen",
      typeof asHeader.body?.message === "string" && /[\u0600-\u06FF]/.test(asHeader.body.message),
      String(asHeader.body?.message),
    );
    const stillDetail = await ctx.req("GET", "/accounts/1300-1");
    ctx.check("a 422 that still wrote the row would be the same hole in a nicer status code", stillDetail.body?.isHeader === false, JSON.stringify(stillDetail.body));

    const retyped = await ctx.req("PATCH", "/accounts/4900", { type: "asset" });
    ctx.check(
      "re-typing a posted-to revenue account as an asset is refused too — it would drop the balance out of the year-end close",
      retyped.status === 422 && retyped.body?.error === "ACCOUNT_HAS_POSTINGS",
      `status ${retyped.status} body ${JSON.stringify(retyped.body)}`,
    );
    const stillRevenue = await ctx.req("GET", "/accounts/4900");
    ctx.check("and 4900 is still a revenue account", stillRevenue.body?.type === "revenue", JSON.stringify(stillRevenue.body));

    // The negative control: the edits that do NOT change what a posted line
    // means must still work, or the guard has simply frozen the chart.
    const renamed = await ctx.req("PATCH", "/accounts/1300-1", { nameAr: "صندوق نقدي — الفرع الرئيسي" });
    ctx.check("renaming a posted-to account still works", renamed.status === 200 && renamed.body?.nameAr === "صندوق نقدي — الفرع الرئيسي", `status ${renamed.status}`);
    const restored = await ctx.req("PATCH", "/accounts/1300-1", { nameAr: stillDetail.body?.nameAr });
    ctx.check("scenario restored the account name", restored.status === 200 && restored.body?.nameAr === stillDetail.body?.nameAr, JSON.stringify(restored.body));
  });
}

/**
 * What makes the books evidence rather than a spreadsheet: once an entry is
 * posted it is corrected by a reversal and by nothing else. This probes every
 * verb a client could reach for and then re-reads the entry, because a route
 * that answered 404 while still having written is the only failure that would
 * matter.
 */
export async function aPostedEntryCannotBeEditedOrDeletedThroughAnyRoute(ctx: Ctx): Promise<void> {
  await ctx.scenario("journal entry — a posted entry cannot be edited or deleted through any route", async () => {
    const id = "SCN-JE-IMMUTABLE-1";
    const create = await ctx.req("POST", "/gl/journal-entries", {
      id,
      date: today(),
      memo: "SCN immutability probe",
      lines: [
        { accountId: "1300-1", debit: "420.69", credit: "0.00" },
        { accountId: "4900", debit: "0.00", credit: "420.69" },
      ],
    });
    ctx.check("the entry posts", create.status === 201 && create.body?.status === "posted", `status ${create.status}`);
    const original = JSON.stringify(create.body);

    // PATCH is not a route at all. PUT and DELETE ARE routes now (D226, editing
    // and deleting a DRAFT) — the immutability guard on a POSTED entry is that
    // they refuse it with 409, not that the route does not exist.
    const patch = await ctx.req("PATCH", `/gl/journal-entries/${id}`, {
      memo: "tampered",
      lines: [
        { accountId: "1300-1", debit: "1.00", credit: "0.00" },
        { accountId: "4900", debit: "0.00", credit: "1.00" },
      ],
    });
    ctx.check("PATCH on a posted entry is not a route at all", patch.status === 404 || patch.status === 405, `status ${patch.status}`);

    for (const method of ["PUT", "DELETE"] as const) {
      // A well-shaped body on purpose — this probes the immutability guard
      // (409, not a validation error).
      const res = await ctx.req(method, `/gl/journal-entries/${id}`, {
        date: today(),
        memo: "tampered",
        lines: [
          { accountId: "1300-1", debit: "1.00", credit: "0.00" },
          { accountId: "4900", debit: "0.00", credit: "1.00" },
        ],
      });
      ctx.check(`${method} on a posted entry is refused (D226 — a draft is editable/deletable, a posted entry is not)`, res.status === 409, `status ${res.status} body ${JSON.stringify(res.body).slice(0, 200)}`);
    }

    const reread = await ctx.req("GET", `/gl/journal-entries/${id}`);
    ctx.check("and the entry is byte-for-byte what it was posted as", JSON.stringify(reread.body) === original, JSON.stringify(reread.body).slice(0, 200));

    // The one legitimate correction, and the proof that the guard above is not
    // simply refusing everything.
    const reverse = await ctx.req("POST", `/gl/journal-entries/${id}/reverse`, {});
    ctx.check("the only correction there is — a reversal — still works", reverse.status === 201, `status ${reverse.status} body ${JSON.stringify(reverse.body).slice(0, 200)}`);
    const mirror = reverse.body?.reversal;
    const mirrorCash = (mirror?.lines ?? []).find((l: any) => l.accountId === "1300-1");
    ctx.checkEq("the mirror credits the cash line by exactly the original debit", ctx.n(mirrorCash?.credit), 420.69);
    ctx.checkEq("and carries no debit on it", ctx.n(mirrorCash?.debit), 0);
    const afterReversal = await ctx.req("GET", `/gl/journal-entries/${id}`);
    ctx.check("the original entry LINES are still untouched — only its status and its forward link changed", JSON.stringify(afterReversal.body?.lines) === JSON.stringify(create.body?.lines), JSON.stringify(afterReversal.body?.lines).slice(0, 200));
    ctx.check("the original is marked reversed, never deleted", afterReversal.body?.status === "reversed", String(afterReversal.body?.status));
  });
}

/**
 * D226. A draft saved BEFORE D205 existed — a party-less line on 1105 — can
 * never post through the normal API, because `createJournalEntry` runs the
 * same D205 check a fresh draft does. So the legacy row is inserted straight
 * through the SQLite {@link LedgerRepository}, on a second connection to the
 * SAME database file the running backend already has open, exactly the way
 * an old books file already holds one.
 */
export async function aLegacyDraftBecomesPostableThroughPUT_D226(ctx: Ctx): Promise<void> {
  await ctx.scenario("journal entry — a legacy party-less draft on 1105 is edited in through PUT, then posts (D226)", async () => {
    const id = "SCN-JE-LEGACY-D226";
    const customerId = "SCN-CUST-D226";

    const customer = await ctx.req("POST", "/customers", { id: customerId, code: "SCN-D226", nameAr: "عميل قديم", openingBalance: "0" });
    ctx.check("a customer exists to name on the legacy line", customer.status === 201, `status ${customer.status}`);

    const legacyLedger = createSqliteLedgerStore(ctx.dbPath);
    await legacyLedger.save({
      id,
      entryNo: null,
      date: today(),
      memo: "قيد يدوي قديم",
      status: "draft",
      source: "manual",
      lines: [
        {
          accountId: "1105", debit: Money.fromMajor("500"), credit: Money.zero(), memo: null, costCenterId: null,
          currency: null, fxRate: null, taxRatePercent: null, projectId: null, costCategory: null, branchId: null, partyId: null,
        },
        {
          accountId: "4100", debit: Money.zero(), credit: Money.fromMajor("500"), memo: null, costCenterId: null,
          currency: null, fxRate: null, taxRatePercent: null, projectId: null, costCategory: null, branchId: null, partyId: null,
        },
      ],
      createdAt: new Date().toISOString(),
      postedAt: null,
      reversesEntryId: null,
      reversedByEntryId: null,
      sourceDocType: null,
      sourceDocId: null,
      sourceDocNumber: null,
    });
    legacyLedger.close();

    const blocked = await ctx.req("POST", `/gl/journal-entries/${id}/post`, {});
    ctx.check(
      "the legacy draft cannot post as saved — D205 still guards it",
      blocked.status === 422 && blocked.body?.error === "PARTY_REQUIRED_ON_CONTROL_ACCOUNT",
      `status ${blocked.status} body ${JSON.stringify(blocked.body).slice(0, 200)}`,
    );

    const edited = await ctx.req("PUT", `/gl/journal-entries/${id}`, {
      date: today(),
      memo: "قيد يدوي قديم",
      lines: [
        { accountId: "1105", debit: "500.00", credit: "0.00", partyId: customerId },
        { accountId: "4100", debit: "0.00", credit: "500.00" },
      ],
    });
    ctx.check(
      "PUT names the missing party and saves the edit, keeping it a draft",
      edited.status === 200 && edited.body?.status === "draft" && edited.body?.entryNo === null,
      `status ${edited.status} body ${JSON.stringify(edited.body).slice(0, 200)}`,
    );

    const posted = await ctx.req("POST", `/gl/journal-entries/${id}/post`, {});
    ctx.check(
      "it posts once the party is named",
      posted.status === 200 && posted.body?.status === "posted",
      `status ${posted.status} body ${JSON.stringify(posted.body).slice(0, 200)}`,
    );

    const recon = await ctx.req("GET", "/reconciliation");
    const ar = ctx.rows(recon.body).find((r: any) => r.key === "ar");
    ctx.checkEq("AR sub-ledger still reconciles exactly to GL 1105", ctx.n(ar?.subLedgerBalance), ctx.n(ar?.glBalance));

    const aging = await ctx.req("GET", "/reports/aging/customers");
    const agingRow = ctx.rows(aging.body).find((r: any) => r.customerId === customerId);
    ctx.checkEq("the customer's aging row carries exactly the once-orphaned 500", ctx.n(agingRow?.total), 500);

    // Cleanup: reverse the probe posting, as the month-end probes above do,
    // so this scenario leaves no permanent residue on the shared demo books.
    if (posted.status === 200) await ctx.req("POST", `/gl/journal-entries/${id}/reverse`, {});
  });
}

/**
 * The close, from the accountant side. Two halves: a closed month must refuse
 * every posting and write nothing, AND the close itself must be safe to press
 * — which is where the finding is. Nothing checks whether unposted work is
 * dated into the month being closed, so pressing إغلاق strands every draft in
 * it: the draft survives, but no route can ever post it again without someone
 * noticing the period has to be reopened.
 */
/**
 * An opening balance is how every migration starts: the shop's existing
 * debtors are typed in on day one. If that figure never reaches the AR control
 * account, the sub-ledger and the GL disagree from the very first day and no
 * amount of correct posting afterwards will close the gap. Guards D142.
 */
export async function aCustomerOpeningBalanceNeverReachesTheControlAccount(ctx: Ctx): Promise<void> {
  await ctx.scenario("opening balances — a customer's opening balance against GL 1105", async () => {
    const id = "SCN-CUST-OPENING";
    const opening = 4250;

    const arBefore = await accountBalance(ctx, "1105");
    const equityBefore = await accountBalance(ctx, "3210");

    const created = await ctx.req("POST", "/customers", {
      id,
      code: "SCN-OPEN-1",
      nameAr: "عميل برصيد افتتاحي",
      openingBalance: `${opening}.00`,
    });
    ctx.check(
      "a customer can be created carrying an opening balance",
      created.status === 201 && ctx.n(created.body?.openingBalance) === opening,
      `status ${created.status} body ${JSON.stringify(created.body).slice(0, 200)}`,
    );
    if (created.status !== 201) return;

    // The sub-ledger DOES count it: the customer's outstanding figure adds the
    // opening balance to the unsettled documents.
    const listed = ctx.rows((await ctx.req("GET", "/customers")).body).find((c: any) => c.id === id);
    ctx.check(
      "the customer's own balance includes the opening figure",
      listed !== undefined && ctx.n(listed.balance ?? listed.outstanding ?? listed.openingBalance) === opening,
      JSON.stringify(listed).slice(0, 220),
    );

    // D142 / guards B-2 — the opening balance used to be held on the customer
    // record only, so the AR sub-ledger exceeded its control account by exactly
    // the opening balances typed in at go-live and nothing ever closed the gap.
    // It moves the control account against أرصدة افتتاحية (3210) instead: the
    // sub-ledger and the GL agree from day one.
    ctx.checkEq("GL 1105 moved by exactly the opening balance", await accountBalance(ctx, "1105"), arBefore + opening);
    ctx.checkEq("and the other side landed in opening-balance equity 3210 as a credit", await accountBalance(ctx, "3210"), equityBefore - opening);

    // D204 — the ladder ages the opening balance too, from the day it posted,
    // so it still ties to 1105 and the owed figure is the customer's row.
    const aging = await ctx.req("GET", "/reports/aging/customers");
    const agingRow = ctx.rows(aging.body).find((r: any) => r.customerId === id);
    ctx.check("D204 — the customer's opening balance is on their aging row", ctx.scaled(agingRow?.total) === ctx.scaled(`${opening}.00`), JSON.stringify(agingRow));
    ctx.check(
      "D204 — and the customer ladder still ties to 1105 to the micro-unit",
      ctx.scaled(aging.body?.reconciliation?.reportTotal) === ctx.scaled(aging.body?.reconciliation?.referenceTotal),
      JSON.stringify(aging.body?.reconciliation),
    );
    const detail = await ctx.req("GET", `/customers/${id}`);
    ctx.check("D204 — what the customer owes is that row, not the opening balance counted twice", ctx.scaled(detail.body?.owed) === ctx.scaled(agingRow?.total), `owed ${detail.body?.owed}`);
    const statement = await ctx.req("GET", `/reports/statements/customers/${id}`);
    ctx.check(
      "D204 — their statement opens with it and closes on the same figure",
      statement.body?.lines?.[0]?.kind === "opening" && ctx.scaled(statement.body?.closing) === ctx.scaled(`${opening}.00`),
      JSON.stringify(statement.body).slice(0, 300),
    );

    /*
     * Found by its SOURCE DOCUMENT, not by a guessable id. The entry key is
     * `CUST-OPEN-JE:<customer>:<uuid>` on purpose: correcting an opening
     * balance posts a NEW delta entry rather than editing the one already on
     * the ledger, so a stable key would have to be overwritten to work — which
     * is exactly what a posted entry must never be.
     */
    const allEntries = await ctx.allRows("/gl/journal-entries");
    const openingRow = allEntries.find(
      (e: any) => e.sourceDocType === "CUSTOMER_OPENING_BALANCE" && e.sourceDocId === id,
    );
    const openingEntry = openingRow
      ? await ctx.req("GET", `/gl/journal-entries/${openingRow.id}`)
      : { status: 404, body: null };
    ctx.check(
      "and the entry behind it is Dr 1105 / Cr 3210, posted against the customer it belongs to",
      openingEntry.status === 200 &&
        (openingEntry.body?.lines ?? []).some((l: any) => l.accountId === "1105" && ctx.n(l.debit) === opening) &&
        (openingEntry.body?.lines ?? []).some((l: any) => l.accountId === "3210" && ctx.n(l.credit) === opening),
      `status ${openingEntry.status} body ${JSON.stringify(openingEntry.body).slice(0, 240)}`,
    );

    // Correcting an opening balance after it was posted moves the control
    // account by the DIFFERENCE, so a typo fixed on the customer screen cannot
    // put the sub-ledger and the GL back out of step.
    const corrected = await ctx.req("PATCH", `/customers/${id}`, { openingBalance: `${opening + 270}.00` });
    ctx.check(
      "the opening balance can be corrected after it was posted",
      corrected.status === 200 && ctx.n(corrected.body?.openingBalance) === opening + 270,
      `status ${corrected.status} body ${JSON.stringify(corrected.body).slice(0, 200)}`,
    );
    ctx.checkEq("and GL 1105 followed the correction, not the whole figure twice", await accountBalance(ctx, "1105"), arBefore + opening + 270);

    // Put it back — the standing entry is reversed and 1105 returns to where it
    // started, or every reconciliation scenario after this one inherits it.
    const cleared = await ctx.req("PATCH", `/customers/${id}`, { openingBalance: "0.00" });
    ctx.check(
      "the opening balance is cleared again so later scenarios start level",
      cleared.status === 200 && ctx.n(cleared.body?.openingBalance) === 0,
      `status ${cleared.status} body ${JSON.stringify(cleared.body).slice(0, 200)}`,
    );
    ctx.checkEq("and GL 1105 is exactly where it started", await accountBalance(ctx, "1105"), arBefore);
    ctx.checkEq("and so is 3210", await accountBalance(ctx, "3210"), equityBefore);
  });

  await ctx.scenario("opening balances — D204: a supplier's opening balance is on the supplier ladder, which still ties to 2100", async () => {
    const id = "SCN-SUPP-OPENING";
    const created = await ctx.req("POST", "/suppliers", { id, code: "SCN-SOPEN-1", nameAr: "مورد برصيد افتتاحي", openingBalance: "1500.00" });
    ctx.check("a supplier can be created carrying an opening balance", created.status === 201, `status ${created.status} ${JSON.stringify(created.body).slice(0, 200)}`);
    if (created.status !== 201) return;
    const aging = await ctx.req("GET", "/reports/aging/suppliers");
    const row = ctx.rows(aging.body).find((r: any) => r.supplierId === id);
    ctx.check("D204 — the opening balance is on the supplier's aging row", ctx.scaled(row?.total) === 1_500_000_000n, JSON.stringify(row));
    ctx.check(
      "D204 — and the supplier ladder still ties to 2100 to the micro-unit",
      ctx.scaled(aging.body?.reconciliation?.reportTotal) === ctx.scaled(aging.body?.reconciliation?.referenceTotal),
      JSON.stringify(aging.body?.reconciliation),
    );
    const detail = await ctx.req("GET", `/suppliers/${id}`);
    ctx.check("D204 — what the suppliers screen says they are owed is that row", ctx.scaled(detail.body?.owed) === 1_500_000_000n, `owed ${detail.body?.owed}`);
    const cleared = await ctx.req("PATCH", `/suppliers/${id}`, { openingBalance: "0.00" });
    ctx.check("the opening balance is cleared again so later scenarios start level", cleared.status === 200, `status ${cleared.status}`);
    const after = ctx.rows((await ctx.req("GET", "/reports/aging/suppliers")).body).find((r: any) => r.supplierId === id);
    ctx.check("and the supplier's row is gone with it", after === undefined || ctx.scaled(after.total) === 0n, JSON.stringify(after));
  });
}

/**
 * D241 — a customer's opening balance posted a second time once the server
 * restarted under the old backfill: the screen posted under one entry id, the
 * backfill looked for a different one and posted the same figure again. The
 * fix unified both paths onto ONE poster with ONE deterministic key, so
 * neither can ever produce this again going forward — this scenario proves
 * the OTHER half: a books file that already carries the duplicate from
 * before the fix still needs a human, permission-gated, audited repair.
 *
 * The duplicate is simulated the only way it can be here: written straight
 * through the SQLite ledger on a second connection to the SAME file the
 * running backend already has open, exactly the shape an old books file
 * already holds — never something today's poster could produce on its own.
 */
export async function duplicateOpeningBalancePostingsAreReportedAndRepaired_D241(ctx: Ctx): Promise<void> {
  await ctx.scenario("opening balances — D241: a duplicate customer/supplier posting is reported and repaired, not silently or by editing", async () => {
    const custId = "SCN-CUST-D241";
    const suppId = "SCN-SUPP-D241";
    const arBefore = await accountBalance(ctx, "1105");
    const apBefore = await accountBalance(ctx, "2100");

    const custCreated = await ctx.req("POST", "/customers", { id: custId, code: "SCN-D241-C", nameAr: "عميل مكرر", openingBalance: "750.00" });
    const suppCreated = await ctx.req("POST", "/suppliers", { id: suppId, code: "SCN-D241-S", nameAr: "مورد مكرر", openingBalance: "300.00" });
    ctx.check("a customer and a supplier exist to duplicate", custCreated.status === 201 && suppCreated.status === 201, `${custCreated.status} ${suppCreated.status}`);
    if (custCreated.status !== 201 || suppCreated.status !== 201) return;

    const blank = { memo: null, costCenterId: null, currency: null, fxRate: null, taxRatePercent: null, projectId: null, costCategory: null, branchId: null, partyId: null };
    const legacyLedger = createSqliteLedgerStore(ctx.dbPath);
    await legacyLedger.save({
      id: "LEGACY-OPEN-JE:SCN-CUST-D241", entryNo: null, date: today(), memo: "قيد شاشة قديم قبل التوحيد (D241)", status: "posted", source: "system",
      createdAt: new Date().toISOString(), postedAt: new Date().toISOString(),
      reversesEntryId: null, reversedByEntryId: null, sourceDocType: "CUSTOMER_OPENING_BALANCE", sourceDocId: custId, sourceDocNumber: null,
      lines: [
        { ...blank, accountId: "1105", debit: Money.fromMajor("750"), credit: Money.zero() },
        { ...blank, accountId: "3210", debit: Money.zero(), credit: Money.fromMajor("750") },
      ],
    });
    await legacyLedger.save({
      id: "LEGACY-OPEN-JE:SCN-SUPP-D241", entryNo: null, date: today(), memo: "قيد شاشة قديم قبل التوحيد (D241)", status: "posted", source: "system",
      createdAt: new Date().toISOString(), postedAt: new Date().toISOString(),
      reversesEntryId: null, reversedByEntryId: null, sourceDocType: "SUPPLIER_OPENING_BALANCE", sourceDocId: suppId, sourceDocNumber: null,
      lines: [
        { ...blank, accountId: "3210", debit: Money.fromMajor("300"), credit: Money.zero() },
        { ...blank, accountId: "2100", debit: Money.zero(), credit: Money.fromMajor("300") },
      ],
    });
    legacyLedger.close();

    ctx.checkEq("1105 now carries the duplicate — 750 posted twice", await accountBalance(ctx, "1105"), arBefore + 1500);
    ctx.checkEq("2100 now carries the duplicate — 300 posted twice", await accountBalance(ctx, "2100"), apBefore - 600);

    const report = await ctx.req("GET", "/gl/opening-balance-duplicates");
    const custRow = ctx.rows(report.body).find((r: any) => r.partyId === custId);
    const suppRow = ctx.rows(report.body).find((r: any) => r.partyId === suppId);
    ctx.check(
      "the exceptions report lists the duplicated customer, with the excess",
      report.status === 200 && custRow?.kind === "customer" && ctx.n(custRow?.wanted) === 750 && ctx.n(custRow?.totalPosted) === 1500 && ctx.n(custRow?.excess) === 750,
      JSON.stringify(custRow),
    );
    ctx.check(
      "and lists the duplicated supplier too — D241 names both",
      suppRow?.kind === "supplier" && ctx.n(suppRow?.wanted) === -300 && ctx.n(suppRow?.totalPosted) === -600 && ctx.n(suppRow?.excess) === -300,
      JSON.stringify(suppRow),
    );

    const custRepair = await ctx.req("POST", `/gl/opening-balance-duplicates/customer/${custId}/repair`, {});
    const suppRepair = await ctx.req("POST", `/gl/opening-balance-duplicates/supplier/${suppId}/repair`, {});
    ctx.check(
      "the repair action posts a reversing entry for exactly the excess",
      custRepair.status === 200 && custRepair.body?.repaired === true && suppRepair.status === 200 && suppRepair.body?.repaired === true,
      `${custRepair.status} ${JSON.stringify(custRepair.body)} / ${suppRepair.status} ${JSON.stringify(suppRepair.body)}`,
    );
    ctx.checkEq("1105 is back to exactly one posting of the opening balance", await accountBalance(ctx, "1105"), arBefore + 750);
    ctx.checkEq("2100 is back to exactly one posting of the opening balance", await accountBalance(ctx, "2100"), apBefore - 300);

    const reversalEntries = (await ctx.allRows("/gl/journal-entries")).filter((e: any) => e.reversesEntryId);
    const custReversal = reversalEntries.find((e: any) => (e.lines ?? []).some((l: any) => l.accountId === "1105" && l.partyId === custId));
    ctx.check(
      "the reversal names the party on the control-account line, even though the duplicate it removes never did (D205's shape)",
      Boolean(custReversal),
      JSON.stringify(reversalEntries.map((e: any) => e.id)),
    );

    const clean = await ctx.req("GET", "/gl/opening-balance-duplicates");
    ctx.check(
      "the exceptions report no longer lists either party",
      ctx.rows(clean.body).every((r: any) => r.partyId !== custId && r.partyId !== suppId),
      JSON.stringify(clean.body),
    );

    const custRepairAgain = await ctx.req("POST", `/gl/opening-balance-duplicates/customer/${custId}/repair`, {});
    ctx.check(
      "idempotent — repairing again reverses nothing extra",
      custRepairAgain.status === 200 && custRepairAgain.body?.repaired === false,
      `status ${custRepairAgain.status} body ${JSON.stringify(custRepairAgain.body)}`,
    );
    ctx.checkEq("and 1105 has not moved again", await accountBalance(ctx, "1105"), arBefore + 750);

    // Clear both back to zero, the reverse-and-repost way (D142/D241), so
    // later scenarios inherit the same AR/AP this one started with.
    const custCleared = await ctx.req("PATCH", `/customers/${custId}`, { openingBalance: "0.00" });
    const suppCleared = await ctx.req("PATCH", `/suppliers/${suppId}`, { openingBalance: "0.00" });
    ctx.check("both are cleared again so later scenarios start level", custCleared.status === 200 && suppCleared.status === 200, `${custCleared.status} ${suppCleared.status}`);
    ctx.checkEq("1105 is exactly where it started", await accountBalance(ctx, "1105"), arBefore);
    ctx.checkEq("2100 is exactly where it started", await accountBalance(ctx, "2100"), apBefore);
  });
}

export async function closingAMonthStrandsTheDraftsDatedIntoIt(ctx: Ctx): Promise<void> {
  await ctx.scenario("fiscal periods — closing a month with an unposted draft dated into it, and what the draft can do afterwards", async () => {
    const year = new Date().getFullYear();
    const periods = ctx.rows((await ctx.req("GET", `/fiscal-periods?${qs({ year: String(year) })}`)).body);
    const march = periods.find((p: any) => p.periodNumber === 3);
    ctx.check("March exists and is the period this scenario borrows", Boolean(march), `periods=${periods.length}`);
    if (!march) return;
    ctx.check("March starts open, as the earlier fiscal-period scenario left it", march.status === "open", String(march.status));

    const draftId = "SCN-JE-STRANDED-DRAFT";
    const draft = await ctx.req("POST", "/gl/journal-entries/draft", {
      id: draftId,
      date: `${year}-03-20`,
      memo: "SCN مصروف مستحق لم يُرحَّل بعد",
      lines: [
        { accountId: "5900", debit: "640.00", credit: "0.00" },
        { accountId: "1300-1", debit: "0.00", credit: "640.00" },
      ],
    });
    ctx.check("a draft dated into March saves without touching the ledger", draft.status === 201 && draft.body?.status === "draft", `status ${draft.status} body ${JSON.stringify(draft.body).slice(0, 160)}`);
    ctx.check("and carries no entry number, because it has not been posted", draft.body?.entryNo === null, String(draft.body?.entryNo));

    // D176 C-3, fixed: this used to assert the close was ACCEPTED in silence. It is now refused, and names the draft.
    const bareClose = await ctx.req("POST", `/fiscal-periods/${march.id}/close`, {});
    const draftsCheck = (bareClose.body?.checklist?.checks ?? []).find((c: any) => c.code === "drafts");
    const strandedJournals = (draftsCheck?.findings ?? []).find((f: any) => f.ref === "journal_entry");
    ctx.check(
      "D176 C-3: the close is REFUSED while unposted work is dated into the month",
      bareClose.status === 409 && bareClose.body?.error === "PERIOD_CLOSE_BLOCKED" && (bareClose.body?.failedChecks ?? []).includes("drafts"),
      `status ${bareClose.status} body ${JSON.stringify(bareClose.body).slice(0, 200)}`,
    );
    ctx.check("and it counts the stranded journal drafts instead of saying nothing", ctx.n(strandedJournals?.count) >= 1, JSON.stringify(draftsCheck).slice(0, 200));
    ctx.check("in Arabic and in English", /[\u0600-\u06FF]/.test(String(bareClose.body?.message)) && typeof bareClose.body?.messageEn === "string");
    ctx.check("and March is still open", (await ctx.req("GET", `/fiscal-periods/${march.id}`)).body?.status === "open");

    const close = await ctx.req("POST", `/fiscal-periods/${march.id}/close`, { overrideReason: "SCN: إقفال اختباري فوق فحوص الإقفال المفتوحة" });
    ctx.check(
      "an override with a reason still closes it — which is how a draft can be stranded on purpose",
      close.status === 200 && close.body?.status === "closed",
      `status ${close.status} body ${JSON.stringify(close.body)}`,
    );

    const postStranded = await ctx.req("POST", `/gl/journal-entries/${draftId}/post`, {});
    ctx.check(
      "posting the stranded draft is refused with the period-specific error",
      postStranded.status === 422 && postStranded.body?.error === "PERIOD_NOT_OPEN_FOR_POSTING",
      `status ${postStranded.status} body ${JSON.stringify(postStranded.body)}`,
    );

    const stillDraft = await ctx.req("GET", `/gl/journal-entries/${draftId}`);
    ctx.check("the refused post left the draft exactly as it was", stillDraft.body?.status === "draft" && stillDraft.body?.entryNo === null, JSON.stringify(stillDraft.body).slice(0, 160));
    ctx.check("and consumed no JE number — the refusal happens before the sequence is touched", stillDraft.body?.postedAt == null, String(stillDraft.body?.postedAt));

    const freshIntoClosed = await ctx.req("POST", "/gl/journal-entries", {
      id: "SCN-JE-LATE-INVOICE",
      date: `${year}-03-25`,
      memo: "SCN فاتورة متأخرة مؤرخة داخل شهر مغلق",
      lines: [
        { accountId: "1300-1", debit: "99.99", credit: "0.00" },
        { accountId: "4900", debit: "0.00", credit: "99.99" },
      ],
    });
    ctx.check("a late document dated into the closed month is refused too", freshIntoClosed.status === 422 && freshIntoClosed.body?.error === "PERIOD_NOT_OPEN_FOR_POSTING", `status ${freshIntoClosed.status}`);
    ctx.check("and nothing at all was written for it", (await ctx.req("GET", "/gl/journal-entries/SCN-JE-LATE-INVOICE")).status === 404);

    const reopen = await ctx.req("POST", `/fiscal-periods/${march.id}/reopen`, {});
    ctx.check("reopening the month restores it to open", reopen.status === 200 && reopen.body?.status === "open", `status ${reopen.status}`);

    const posted = await ctx.req("POST", `/gl/journal-entries/${draftId}/post`, {});
    ctx.check("the SAME draft now posts, back-dated into the reopened month", posted.status === 200 && posted.body?.status === "posted", `status ${posted.status} body ${JSON.stringify(posted.body).slice(0, 160)}`);
    ctx.check("it keeps its original date rather than sliding to today", posted.body?.date === `${year}-03-20`, String(posted.body?.date));
    ctx.check("and only now does it take a JE number", typeof posted.body?.entryNo === "string" && posted.body.entryNo.length > 0, String(posted.body?.entryNo));

    const audit = ctx.rows((await ctx.req("GET", `/audit?entityType=FISCAL_PERIOD&entityId=${march.id}`)).body);
    const reopenEvent = audit.find((e: any) => e.entityId === march.id && e.action === "REOPEN");
    ctx.check(
      "reopening a closed month is on the audit trail — it is the move that lets a closed month be changed after the fact",
      Boolean(reopenEvent),
      JSON.stringify(audit.slice(0, 3)),
    );
    ctx.check("and the trail records what it was reopened FROM", reopenEvent?.details?.previousStatus === "closed", JSON.stringify(reopenEvent?.details));

    // Left as found: the earlier fiscal-period scenario and every later module
    // expect March open.
    const finalState = await ctx.req("GET", `/fiscal-periods/${march.id}`);
    ctx.check("scenario leaves March open, as it found it", finalState.body?.status === "open", String(finalState.body?.status));
  });

  await ctx.scenario("journal entry — the last day of a month is postable, as an instant still on that day in Cairo", async () => {
    // THE DAY A SHOP POSTS MOST IS THE DAY IT COULD NOT POST AT ALL.
    //
    // A fiscal period's `endDate` is a DAY ("2026-08-31") and a document's date
    // is an INSTANT; the range query compared them as strings, and string order
    // puts the instant after the day it belongs to. So `findByDate` matched no
    // period on the last day of every month and every posting failed with «لا
    // توجد فترة مالية تغطي هذا التاريخ» — invisible on the other thirty days,
    // which is why it survived. It surfaced only when the clock rolled onto a
    // 31st and the demo seed itself stopped booting.
    //
    // Asserted here with a full timestamp on purpose: the existing repository
    // test asked with a mid-month DAY, which is exactly the shape that cannot
    // fail.
    //
    // THE INSTANTS ARE CHOSEN TO STILL BE THAT DAY IN CAIRO. The engine keeps
    // refusing instants; the ROUTE narrows one to the tenant's calendar day,
    // and the tenant is Egyptian (Africa/Cairo, +02:00 or +03:00). So
    // `…T23:59:59.999Z` on the 30th is the 1st of the next month here, and
    // asserting it lands on the 30th would only be true of a UTC tenant. The
    // late-in-the-day probes therefore ask at 20:00Z — still the same day in
    // Cairo, still late enough to be a real end-of-day timestamp.
    const year = new Date().getUTCFullYear();
    for (const [label, date] of [
      ["a 31-day month", `${year}-08-31T03:10:33.016Z`],
      ["a 30-day month", `${year}-09-30T20:00:00.000Z`],
      ["the first instant of a period", `${year}-08-01T00:00:00.000Z`],
      ["the last day of the year", `${year}-12-31T20:00:00.000Z`],
    ] as const) {
      const id = `SCN-JE-MONTHEND-${date.slice(5, 10)}`;
      const posted = await ctx.req("POST", "/gl/journal-entries", {
        id,
        date,
        memo: `SCN month-end probe (${label})`,
        lines: [
          { accountId: "1300-1", debit: "10.00", credit: "0.00" },
          { accountId: "4900", debit: "0.00", credit: "10.00" },
        ],
      });
      ctx.check(
        `${label}: an entry dated ${date.slice(0, 10)} posts`,
        posted.status === 201 && posted.body?.status === "posted",
        `status ${posted.status} ${JSON.stringify(posted.body).slice(0, 140)}`,
      );
      if (posted.status === 201) await ctx.req("POST", `/gl/journal-entries/${id}/reverse`, {});
    }
  });
}
