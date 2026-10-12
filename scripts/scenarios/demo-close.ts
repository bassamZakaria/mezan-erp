import type { Ctx } from "./harness.js";

const CLEAN_MONTHS = ["01", "02", "03", "04", "05", "06", "07"] as const;
const LIVE_MONTH = "08";
const LIVE_MONTH_BLOCKERS = ["bank_statements", "depreciation", "drafts", "fx_revaluation", "recurring_journals"];
const periodId = (month: string) => `fp-2026-${month}`;

/**
 * الإقفال الموجَّه على بيانات العرض — what the demo tenant ships with, read
 * BEFORE any other suite touches it: January to July closed clean — payroll
 * paid, the recurring entry posted, every asset depreciated, the bank statement
 * finalized, no override anywhere — and the live month refused for reasons
 * that are really there.
 *
 * It then reopens January to July. Every suite after this one was written to
 * post into those months — back-dated entries, a month closed and reopened, a
 * VAT window filed — and each closes and reopens what it needs itself. The
 * sealed summaries asserted here are append-only, so reopening erases nothing.
 */
export async function run(ctx: Ctx): Promise<void> {
  const { scenario, req, rows, check, checkEq } = ctx;
  const same = (label: string, actual: unknown, expected: unknown) => check(label, actual === expected, `${JSON.stringify(actual)} ≠ ${JSON.stringify(expected)}`);
  const statusOf = async (month: string) => (await req("GET", `/fiscal-periods/${periodId(month)}`)).body?.status;
  const checklistOf = async (month: string) => (await req("GET", `/period-close/${periodId(month)}/checks`)).body;
  const summariesOf = async (month: string) => rows((await req("GET", `/period-close/${periodId(month)}/summaries`)).body);

  await scenario("demo close · January to July are closed clean: every check passes and no close carries an override", async () => {
    for (const month of CLEAN_MONTHS) {
      same(`2026-${month} is closed`, await statusOf(month), "closed");
      const checklist = await checklistOf(month);
      checkEq(`2026-${month}: the checklist covers all ten checks`, (checklist?.checks ?? []).length, 10);
      check(`2026-${month}: nothing blocks it`, (checklist?.blocking ?? ["?"]).length === 0, JSON.stringify(checklist?.blocking));
      check(
        `2026-${month}: no check is unavailable or failing`,
        (checklist?.checks ?? []).every((c: any) => c.status === "pass" || c.status === "not_applicable"),
        JSON.stringify((checklist?.checks ?? []).filter((c: any) => c.status !== "pass" && c.status !== "not_applicable").map((c: any) => c.code)),
      );
      const ties = (checklist?.checks ?? []).find((c: any) => c.code === "subledger_ties");
      check(
        `2026-${month}: inventory, receivables and payables tie at the month end to the micro-unit`,
        ["inventory", "ar", "ap"].every((key) => ties?.findings?.some((f: any) => f.ref === key && f.passed && f.amount === "0.000000" && f.asOfDate.startsWith(`2026-${month}`))),
        JSON.stringify(ties?.findings?.map((f: any) => [f.ref, f.amount, f.asOfDate])),
      );
      const bank = (checklist?.checks ?? []).find((c: any) => c.code === "bank_statements");
      check(`2026-${month}: its bank statement is finalized and covers the month`, bank?.status === "pass" && (bank?.findings ?? []).length > 0, JSON.stringify(bank?.findings));
      const depreciation = (checklist?.checks ?? []).find((c: any) => c.code === "depreciation");
      check(`2026-${month}: every asset is in a posted depreciation run`, depreciation?.status === "pass" && (depreciation?.findings ?? []).length > 0, JSON.stringify(depreciation?.findings));

      const summaries = await summariesOf(month);
      checkEq(`2026-${month}: it was closed once`, summaries.length, 1);
      check(`2026-${month}: with no override reason`, summaries[0]?.overrideReason === null, JSON.stringify(summaries[0]?.overrideReason));
      check(`2026-${month}: and no failed check on the sealed summary`, (summaries[0]?.failedChecks ?? ["?"]).length === 0, JSON.stringify(summaries[0]?.failedChecks));
      check(`2026-${month}: the summary's seal is intact and in the audit trail`, summaries[0]?.sealValid === true, JSON.stringify(summaries[0]?.sealValid));
      check(`2026-${month}: the sealed trial balance balances`, summaries[0]?.closingDebit === summaries[0]?.closingCredit, `${summaries[0]?.closingDebit} / ${summaries[0]?.closingCredit}`);
    }
  });

  await scenario("demo close · August is open and refuses to close on its real blockers", async () => {
    same("August is open", await statusOf(LIVE_MONTH), "open");
    const refused = await req("POST", `/fiscal-periods/${periodId(LIVE_MONTH)}/close`, {});
    checkEq("a close with no override is refused", refused.status, 409);
    same("with the blocked code", refused.body?.error, "PERIOD_CLOSE_BLOCKED");
    check("in Arabic, naming the month", String(refused.body?.message ?? "").includes("أغسطس 2026"), String(refused.body?.message));
    check(
      "for the unfinished work that is really there: drafts, bank statements, revaluation, the recurring entry, depreciation",
      JSON.stringify([...(refused.body?.failedChecks ?? [])].sort()) === JSON.stringify(LIVE_MONTH_BLOCKERS),
      JSON.stringify(refused.body?.failedChecks),
    );
    const bank = ((await checklistOf(LIVE_MONTH))?.checks ?? []).find((c: any) => c.code === "bank_statements");
    const statement = (bank?.findings ?? []).find((f: any) => f.ref === "BSTMT-DEMO-1");
    const unmatched = rows((await req("GET", "/bank-statements/BSTMT-DEMO-1")).body?.lines).filter((line: any) => line.status !== "matched").length;
    check("August's bank statement is on file with lines nobody has matched yet", unmatched > 0, `unmatched ${unmatched}`);
    same("the checklist names it as an unreconciled statement", statement?.state, "unreconciled");
    checkEq("and counts exactly the lines still to match", statement?.count, unmatched);
    same("which is a blocker, not a note", statement?.passed, false);
    same("August is still open", await statusOf(LIVE_MONTH), "open");
    checkEq("and nothing was sealed for it", (await summariesOf(LIVE_MONTH)).length, 0);
  });

  await scenario("demo close · January to July are reopened for the suites that post into them; their sealed summaries stay", async () => {
    for (const month of CLEAN_MONTHS) {
      const reopened = await req("POST", `/fiscal-periods/${periodId(month)}/reopen`, {});
      check(`2026-${month} reopens`, reopened.status === 200 && reopened.body?.status === "open", `status ${reopened.status}`);
      check(`2026-${month}: its close is still on record`, (await summariesOf(month)).length === 1, "summary missing after reopen");
    }
  });
}
