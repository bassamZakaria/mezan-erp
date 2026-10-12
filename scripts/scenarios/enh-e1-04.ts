import type { ScenarioFragment } from "./fragments.js";

const SEEDED_PERIOD = "fp-2026-08";
const YEAR = 2019;
const DRAFT_DATE = `${YEAR}-06-15`;
const DRAFT_ID = "SCN-PC-DRAFT-1";
const OVERRIDE_DRAFT_ID = "SCN-PC-DRAFT-2";
const REASON = "SCN-PC: إقفال يونيو قبل ترحيل قيد التسوية باعتماد المدير المالي";
const CLOSER_ONLY = { "x-user-id": "SCN-PC-CLOSER", "x-permissions": "accounting.period.close,accounting.period.reopen" };

export const scenario: ScenarioFragment = {
  smokePaths: [`/period-close/${SEEDED_PERIOD}/checks`, `/period-close/${SEEDED_PERIOD}/summaries`],

  async run(ctx) {
    const { scenario: it, req, rows, n, check, checkEq } = ctx;
    const same = (label: string, actual: unknown, expected: unknown) => check(label, actual === expected, `${JSON.stringify(actual)} ≠ ${JSON.stringify(expected)}`);

    const generated = await req("POST", "/fiscal-periods/generate-year", { year: YEAR });
    const june = rows((await req("GET", `/fiscal-periods?year=${YEAR}`)).body).find((p: any) => p.periodNumber === 6);
    check(`fiscal year ${YEAR} exists for this suite`, (generated.status === 201 || generated.status === 409) && Boolean(june?.id), `status ${generated.status}`);
    if (!june?.id) return;
    const PERIOD: string = june.id;

    const checklist = async () => (await req("GET", `/period-close/${PERIOD}/checks`)).body;
    const checkOf = (body: any, code: string) => (body?.checks ?? []).find((c: any) => c.code === code);
    const journalDrafts = (body: any) => n((checkOf(body, "drafts")?.findings ?? []).find((f: any) => f.ref === "journal_entry")?.count ?? 0);
    const periodStatus = async () => (await req("GET", `/fiscal-periods/${PERIOD}`)).body?.status;
    const draftJournal = (id: string) =>
      req("POST", "/gl/journal-entries/draft", {
        id,
        date: DRAFT_DATE,
        memo: "SCN-PC قيد تسوية لم يُرحَّل",
        lines: [
          { accountId: "5910", debit: "75.00", credit: "0.00" },
          { accountId: "2170", debit: "0.00", credit: "75.00" },
        ],
      });

    await it("guided close · the checklist is computed by the server and a failing check refuses the close", async () => {
      const seeded = (await req("GET", `/period-close/${SEEDED_PERIOD}/checks`)).body;
      check(
        "on the demo tenant a real month shows failing and passing checks side by side",
        (seeded?.blocking ?? []).length > 0 && (seeded?.checks ?? []).some((c: any) => c.status === "pass"),
        JSON.stringify(seeded?.blocking),
      );

      const before = await checklist();
      check("the borrowed month starts with nothing blocking it", (before?.blocking ?? ["?"]).length === 0, JSON.stringify(before?.blocking));
      same("June starts open", await periodStatus(), "open");
      checkEq("the checklist covers all ten checks", (before?.checks ?? []).length, 10);
      check("the trial balance check passes on posted data", checkOf(before, "trial_balance")?.status === "pass", JSON.stringify(checkOf(before, "trial_balance")));
      check(
        "every sub-ledger /reconciliation proves is listed and tied",
        checkOf(before, "subledger_ties")?.status === "pass" && ["inventory", "ar", "ap"].every((key) => checkOf(before, "subledger_ties").findings.some((f: any) => f.ref === key && f.passed)),
        JSON.stringify(checkOf(before, "subledger_ties")?.findings?.map((f: any) => f.ref)),
      );
      const reconciliation = (await req("GET", "/reconciliation")).body;
      checkEq("and it is the same row set /reconciliation serves", checkOf(before, "subledger_ties").findings.length, rows(reconciliation).length);

      const draftsBefore = journalDrafts(before);
      checkEq("a draft dated in June is created", (await draftJournal(DRAFT_ID)).status, 201);
      const withDraft = await checklist();
      checkEq("the drafts check counts it", journalDrafts(withDraft) - draftsBefore, 1);
      check("and points at the journals screen", checkOf(withDraft, "drafts")?.findings?.[0]?.fix === "journals", JSON.stringify(checkOf(withDraft, "drafts")?.findings?.[0]));

      const refused = await req("POST", `/fiscal-periods/${PERIOD}/close`, {});
      checkEq("a bare close is refused", refused.status, 409);
      check("as a blocked close that names the drafts check", refused.body?.error === "PERIOD_CLOSE_BLOCKED" && (refused.body?.failedChecks ?? []).includes("drafts"), JSON.stringify(refused.body).slice(0, 200));
      check("in Arabic and in English", /[؀-ۿ]/.test(String(refused.body?.message)) && typeof refused.body?.messageEn === "string");
      check(
        "naming the month «يونيو 2019», never the period's id",
        String(refused.body?.message).includes(`«يونيو ${YEAR}»`) && String(refused.body?.messageEn).includes(`June ${YEAR}`) && !`${refused.body?.message} ${refused.body?.messageEn}`.includes(PERIOD),
        String(refused.body?.message),
      );
      same("and June is still open", await periodStatus(), "open");

      const forged = await req("POST", `/fiscal-periods/${PERIOD}/close`, { blocking: [], failedChecks: [], checks: [] });
      checkEq("a body that supplies its own verdict is rejected outright", forged.status, 400);
      same("and June is still open after it", await periodStatus(), "open");
    });

    await it("guided close · an override needs its own permission, and a reason", async () => {
      const noPermission = await req("POST", `/fiscal-periods/${PERIOD}/close`, { overrideReason: REASON }, CLOSER_ONLY);
      checkEq("a closer without the override permission is refused even with a reason", noPermission.status, 403);
      check("with the override-specific refusal", noPermission.body?.error === "PERIOD_CLOSE_OVERRIDE_NOT_PERMITTED", JSON.stringify(noPermission.body).slice(0, 160));
      same("and is told they may not override", noPermission.body?.checklist?.canOverride, false);
      const tooShort = await req("POST", `/fiscal-periods/${PERIOD}/close`, { overrideReason: "ok" });
      checkEq("a reason too short to be one is rejected", tooShort.status, 400);
      same("June is still open", await periodStatus(), "open");
    });

    await it("guided close · the close is allowed once the failing checks are fixed, and leaves a sealed summary", async () => {
      checkEq("the scenario's own draft is deleted", (await req("DELETE", `/gl/journal-entries/${DRAFT_ID}`)).status < 300 ? 1 : 0, 1);
      const clear = await checklist();
      check("nothing blocks June any more", (clear?.blocking ?? ["?"]).length === 0, JSON.stringify(clear?.blocking));
      same("the drafts check is green", checkOf(clear, "drafts")?.status, "pass");

      const summariesBefore = rows((await req("GET", `/period-close/${PERIOD}/summaries`)).body).length;
      const closed = await req("POST", `/fiscal-periods/${PERIOD}/close`, {}, CLOSER_ONLY);
      check("a closer with no override permission now closes it with a bare request", closed.status === 200 && closed.body?.status === "closed", `status ${closed.status} ${JSON.stringify(closed.body).slice(0, 160)}`);

      const summaries = rows((await req("GET", `/period-close/${PERIOD}/summaries`)).body);
      checkEq("the close wrote exactly one summary", summaries.length - summariesBefore, 1);
      const latest = summaries[0];
      check("sealed with a SHA-256", /^[0-9a-f]{64}$/.test(String(latest?.sha256)), String(latest?.sha256));
      same("naming who closed it", latest?.closedBy, "SCN-PC-CLOSER");
      same("with no override recorded", latest?.overrideReason, null);
      checkEq("and a balanced trial-balance snapshot", n(latest?.closingDebit), n(latest?.closingCredit));

      const trail = rows((await req("GET", `/audit?entityType=FISCAL_PERIOD&entityId=${PERIOD}`)).body);
      const closes = trail.filter((e: any) => e.action === "CLOSE");
      checkEq("the clean close is audited as exactly one CLOSE", closes.length, 1);
      same("that carries no override", closes[0]?.details?.overridden, false);
      same("and the very seal the summary holds", closes[0]?.details?.sha256, latest?.sha256);
      same("the summary's seal verifies on read", latest?.sealValid, true);

      const reopened = await req("POST", `/fiscal-periods/${PERIOD}/reopen`, {});
      check("June is reopened", reopened.status === 200 && reopened.body?.status === "open", `status ${reopened.status}`);
    });

    await it("guided close · an override with a reason closes over a failing check and is audited; the lock is held to the same checks", async () => {
      checkEq("a second draft dated in June is created", (await draftJournal(OVERRIDE_DRAFT_ID)).status, 201);
      checkEq("which blocks the close again", (await req("POST", `/fiscal-periods/${PERIOD}/close`, {})).status, 409);

      const overridden = await req("POST", `/fiscal-periods/${PERIOD}/close`, { overrideReason: REASON });
      check("the override closes June", overridden.status === 200 && overridden.body?.status === "closed", `status ${overridden.status} ${JSON.stringify(overridden.body).slice(0, 160)}`);

      const trail = rows((await req("GET", `/audit?entityType=FISCAL_PERIOD&entityId=${PERIOD}`)).body);
      const overrides = trail.filter((e: any) => e.action === "CLOSE" && e.details?.overridden === true);
      checkEq("the override is on the audit trail exactly once, as the CLOSE event itself", overrides.length, 1);
      const event = overrides[0];
      same("as a WARNING", event?.severity, "WARNING");
      check("naming the failed checks", Array.isArray(event?.details?.failedChecks) && event.details.failedChecks.includes("drafts"), JSON.stringify(event?.details));
      same("and the reason given", event?.details?.reason, REASON);
      const sealed = rows((await req("GET", `/period-close/${PERIOD}/summaries`)).body)[0];
      same("the summary keeps the reason too", sealed?.overrideReason, REASON);
      same("and its seal is the one the audit event recorded", event?.details?.sha256, sealed?.sha256);

      const lock = await req("POST", `/fiscal-periods/${PERIOD}/lock`, {});
      checkEq("a bare lock of the overridden month is refused — the terminal step is no way around the checks", lock.status, 409);
      const closerLocks = await req("POST", `/fiscal-periods/${PERIOD}/lock`, { overrideReason: REASON });
      checkEq("the user who closed it may not lock it over the failing check alone", closerLocks.status, 403);
      const ties = checkOf(await checklist(), "subledger_ties");
      check(
        "every sub-ledger tie is stated as of the month's own last day",
        (ties?.findings ?? []).length > 0 && ties.findings.every((f: any) => f.asOfDate === `${YEAR}-06-30`),
        JSON.stringify((ties?.findings ?? []).map((f: any) => f.asOfDate)),
      );
      check(
        "refused as needing a second person, in Arabic and English",
        closerLocks.body?.error === "PERIOD_LOCK_OVERRIDE_SAME_USER" && /[\u0600-\u06FF]/.test(String(closerLocks.body?.message)) && typeof closerLocks.body?.messageEn === "string",
        JSON.stringify(closerLocks.body).slice(0, 200),
      );
      same("and June is still only closed", await periodStatus(), "closed");
    });

    await it("guided close · the tenant is left as it was found", async () => {
      const reopened = await req("POST", `/fiscal-periods/${PERIOD}/reopen`, {});
      check("June is reopened", reopened.status === 200 && reopened.body?.status === "open", `status ${reopened.status}`);
      checkEq("the override scenario's draft is deleted", (await req("DELETE", `/gl/journal-entries/${OVERRIDE_DRAFT_ID}`)).status < 300 ? 1 : 0, 1);
      same("June ends open", await periodStatus(), "open");
    });
  },
};
