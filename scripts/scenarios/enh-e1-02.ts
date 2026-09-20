import type { ScenarioFragment } from "./fragments.js";

/**
 * Cash-runway forecast (ENH-E1-02) — the branch filter and the low-cash event.
 *
 * Both were review findings: the forecast answered company-wide figures to a
 * caller granted one branch, and its alert wrote notifications directly without
 * ever reaching the event bus, so no tenant rule could subscribe to it.
 */
export const scenario: ScenarioFragment = {
  smokePaths: ["/cash-forecast?horizon=30&overdue=today"],

  async run(ctx) {
    const { scenario: it, req, rows, n, check, checkEq } = ctx;

    await it("cash forecast · the caller's own branch grant narrows it, and a request cannot widen past it", async () => {
      const all = (await req("GET", "/cash-forecast?horizon=90&overdue=today")).body;
      check("the unfiltered forecast reports itself as company-wide", all?.branchNarrowed === false, JSON.stringify(all?.branchNarrowed));
      check("every opening account carries its branch", (all?.openingAccounts ?? []).every((a: any) => typeof a.branchId === "string"));

      const scoped = (await req("GET", "/cash-forecast?horizon=90&overdue=today", undefined, { "x-branch-grant": "BR-MAIN" })).body;
      check("a branch-granted caller is told the view is narrowed", scoped?.branchNarrowed === true);
      check(
        "every opening account it sees belongs to that branch",
        (scoped?.openingAccounts ?? []).every((a: any) => a.branchId === "BR-MAIN"),
      );

      const foreign = (await req("GET", "/cash-forecast?horizon=90&overdue=today&branchId=BR-MAIN", undefined, { "x-branch-grant": "BR-ALEX" })).body;
      checkEq("asking for a branch outside the grant yields nothing, never that branch", (foreign?.openingAccounts ?? []).length, 0);
      checkEq("and no items with it", (foreign?.items ?? []).length, 0);

      const unattributed = (await req("GET", "/cash-forecast?horizon=90&overdue=today&branchId=__unattributed__")).body;
      check(
        "the unattributed bucket holds only items no branch owns",
        (unattributed?.items ?? []).every((i: any) => i.branchId === null),
      );
    });

    await it("cash forecast · a branch view never moves the tenant-wide threshold or its alert", async () => {
      const before = (await req("GET", "/cash-forecast?horizon=90&overdue=today")).body;
      const narrowed = (await req("GET", "/cash-forecast?horizon=30&overdue=today", undefined, { "x-branch-grant": "BR-MAIN" })).body;
      const after = (await req("GET", "/cash-forecast?horizon=90&overdue=today")).body;
      check("the alert is the same before and after a narrowed read", JSON.stringify(before?.alert ?? null) === JSON.stringify(after?.alert ?? null));
      checkEq("the threshold is unchanged", n(after?.threshold?.amount), n(before?.threshold?.amount));
      check("the narrowed read still reports the tenant's own alert", JSON.stringify(narrowed?.alert ?? null) === JSON.stringify(after?.alert ?? null));
    });

    await it("cash forecast · the low-cash alert is a catalogued event a rule can subscribe to", async () => {
      const events = rows((await req("GET", "/notification-rules/events")).body);
      const codes = events.map((e: any) => e.code);
      check("CASH_FORECAST_LOW is in the event catalog", codes.includes("CASH_FORECAST_LOW"), `${codes.length} events`);
      const definition = events.find((e: any) => e.code === "CASH_FORECAST_LOW");
      check("it is filed under treasury", definition?.category === "treasury", String(definition?.category));
      check("with an Arabic label", typeof definition?.labelAr === "string" && definition.labelAr.length > 0);

      const triggers = (await req("GET", "/notification-rules/triggers")).body?.triggers ?? [];
      const trigger = triggers.find((t: any) => t.code === "CASH_FORECAST_LOW");
      check("and the rule builder is told this build actually raises it", trigger?.emitted === true, JSON.stringify(trigger));

      const created = await req("POST", "/notification-rules", {
        id: "SCN-E102-RULE",
        name: "تنبيه سيولة",
        eventCode: "CASH_FORECAST_LOW",
        recipientType: "user",
        recipientValue: "USER-ADMIN",
        channels: ["in_app"],
        titleAr: "سيولة",
        bodyAr: "{crossingDate} · {threshold} · {lowestBalance}",
      });
      check("and a rule may actually be saved against it", created.status === 201 || created.status === 200, `${created.status} ${JSON.stringify(created.body).slice(0, 160)}`);
      if (created.status === 201 || created.status === 200) await req("DELETE", "/notification-rules/SCN-E102-RULE");
    });
  },
};
