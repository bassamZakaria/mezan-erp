import type { Ctx } from "./harness.js";

/**
 * Executable checks for CRM, Projects, Fixed Assets, Field Sales and
 * Installments — docs/scenarios/06-crm-projects-assets.md as code. Ids the
 * seed owns are read back by their known LEAD-DEMO, OPP-DEMO, PRJ-DEMO,
 * ASSET-DEMO, AST, TRIP-DEMO and IPLAN-DEMO ids; anything this file creates
 * is prefixed `SCN-`.
 */
export async function run(ctx: Ctx): Promise<void> {
  const { scenario, req, rows, n, check, checkEq } = ctx;

  // --- CRM: read-only KPIs against the seeded tenant, before anything below mutates it ---

  await scenario("crm · hub/list KPIs match the seeded leads, opportunities and activities", async () => {
    const leads = rows((await req("GET", "/crm/leads")).body);
    const opportunities = rows((await req("GET", "/crm/opportunities")).body);
    const activities = rows((await req("GET", "/crm/activities")).body);

    checkEq("6 seeded leads", leads.length, 6);
    checkEq("exactly 1 lead is still 'new'", leads.filter((l: any) => l.status === "new").length, 1);
    checkEq("exactly 1 lead per status (new/contacted/qualified/converted/lost/unqualified)",
      new Set(leads.map((l: any) => l.status)).size, 6);

    checkEq("7 seeded opportunities (6 explicit + 1 from LEAD-DEMO-4's conversion)", opportunities.length, 7);
    const open = opportunities.filter((o: any) => o.status === "open");
    checkEq("5 opportunities are open", open.length, 5);
    checkEq("open opportunities' expected value sums to 575,000.00",
      open.reduce((s: number, o: any) => s + n(o.expectedValue), 0), 575000);
    checkEq("all 7 opportunities' expected value sums to 710,000.00",
      opportunities.reduce((s: number, o: any) => s + n(o.expectedValue), 0), 710000);
    const won = opportunities.filter((o: any) => o.status === "won");
    checkEq("exactly 1 won opportunity, valued 95,000.00", won.length, 1);
    checkEq("won value == 95,000.00", won.reduce((s: number, o: any) => s + n(o.expectedValue), 0), 95000);

    checkEq("6 seeded activities", activities.length, 6);
    checkEq("3 pending activities", activities.filter((a: any) => a.status === "pending").length, 3);
    checkEq("2 completed activities", activities.filter((a: any) => a.status === "completed").length, 2);
    checkEq("1 cancelled activity", activities.filter((a: any) => a.status === "cancelled").length, 1);
  });

  // --- CRM: lead status state machine (CRM-11/CRM-12) ---

  await scenario("crm · lead status transitions follow the state machine exactly, terminal statuses accept none", async () => {
    const seeded = await req("GET", "/crm/leads/LEAD-DEMO-1");
    check("LEAD-DEMO-1 seeded 'new'", seeded.body.status === "new");

    const skipped = await req("POST", "/crm/leads/LEAD-DEMO-1/transition", { status: "qualified" });
    checkEq("new → qualified directly (skipping 'contacted') is rejected", skipped.status, 422);
    check("rejected as INVALID_LEAD_TRANSITION", skipped.body?.error === "INVALID_LEAD_TRANSITION");

    const advanced = await req("POST", "/crm/leads/LEAD-DEMO-1/transition", { status: "contacted" });
    checkEq("new → contacted succeeds", advanced.status, 200);
    check("status is now 'contacted'", advanced.body.status === "contacted");

    const terminal = await req("POST", "/crm/leads/LEAD-DEMO-6/transition", { status: "contacted" });
    checkEq("a terminal 'lost' lead accepts no further transition", terminal.status, 422);
  });

  // --- CRM priority 1: conversion creates BOTH a customer and an opportunity, link resolves ---

  await scenario("crm · converting a qualified lead creates a real customer AND opportunity — no dangling reference", async () => {
    const lead = await req("GET", "/crm/leads/LEAD-DEMO-3");
    check("LEAD-DEMO-3 seeded 'qualified', unconverted", lead.body.status === "qualified");
    const company = lead.body.company as string;
    const expectedValue = lead.body.expectedValue as string;

    const converted = await req("POST", "/crm/leads/LEAD-DEMO-3/convert", {
      createCustomer: true,
      customer: { id: "SCN-CUST-LEAD3", code: "SCN-CUST-LEAD3" },
      createOpportunity: true,
      opportunity: {
        id: "SCN-OPP-LEAD3",
        title: "SCN — Lead3 Conversion",
        stageId: "STAGE-LEAD",
        expectedValue,
        probability: 50,
      },
    });
    checkEq("convert succeeds", converted.status, 200);
    check("lead status flips to 'converted'", converted.body.lead.status === "converted");
    check("lead links to the customer it became", converted.body.lead.convertedCustomerId === "SCN-CUST-LEAD3");
    check("lead links to the opportunity it became", converted.body.lead.convertedOpportunityId === "SCN-OPP-LEAD3");

    const opp = await req("GET", "/crm/opportunities/SCN-OPP-LEAD3");
    checkEq("the linked opportunity actually exists", opp.status, 200);
    check("the opportunity's customerId resolves to the customer just created — not a dangling reference",
      opp.body.customerId === "SCN-CUST-LEAD3");
    check("the new opportunity starts 'open'", opp.body.status === "open");
    checkEq("conversion sets probability 50% (not the destination stage's own 10% default)", opp.body.probability, 50);

    const customer = await req("GET", "/customers/SCN-CUST-LEAD3");
    checkEq("the linked customer actually exists — not a dangling reference", customer.status, 200);
    check("the customer's name is the lead's company", customer.body.nameAr === company);

    const reconvert = await req("POST", "/crm/leads/LEAD-DEMO-3/convert", {
      createCustomer: false,
      createOpportunity: false,
    });
    checkEq("a lead already 'converted' cannot be converted again", reconvert.status, 422);
    check("rejected as LEAD_NOT_CONVERTIBLE", reconvert.body?.error === "LEAD_NOT_CONVERTIBLE");
  });

  // --- CRM priority 2: opportunity status follows the destination stage's win/loss flag ---

  await scenario("crm · opportunity status follows its destination stage's type, not an independent field", async () => {
    const opp1 = await req("GET", "/crm/opportunities/OPP-DEMO-1");
    check("OPP-DEMO-1 seeded open", opp1.body.status === "open");

    const won = await req("POST", "/crm/opportunities/OPP-DEMO-1/move-stage", { stageId: "STAGE-WON" });
    checkEq("move to the win stage succeeds", won.status, 200);
    check("status flips to 'won' automatically", won.body.status === "won");
    checkEq("probability adopts the win stage's own 100%", won.body.probability, 100);
    check("closedAt stays null — the route never passes `now` to moveOpportunityStage", won.body.closedAt === null);

    const opp2 = await req("GET", "/crm/opportunities/OPP-DEMO-2");
    check("OPP-DEMO-2 seeded open", opp2.body.status === "open");

    const lost = await req("POST", "/crm/opportunities/OPP-DEMO-2/move-stage", { stageId: "STAGE-LOST" });
    checkEq("move to the loss stage succeeds", lost.status, 200);
    check("status flips to 'lost' automatically", lost.body.status === "lost");
    checkEq("probability adopts the loss stage's own 0%", lost.body.probability, 0);

    const noop = await req("POST", "/crm/opportunities/OPP-DEMO-1/move-stage", { stageId: "STAGE-WON" });
    checkEq("moving to the same stage again still succeeds (no same-stage guard server-side)", noop.status, 200);

    const reopened = await req("POST", "/crm/opportunities/OPP-DEMO-1/move-stage", { stageId: "STAGE-CONTACTED" });
    checkEq("a WON opportunity can still be moved again — the route never checks the CURRENT status before moving (new finding, not in defects.md)",
      reopened.status, 200);
    check("moving a closed deal off the win stage reopens it", reopened.body.status === "open");
  });

  // --- CRM: pipeline stage reorder + win/loss mutual exclusivity ---

  await scenario("crm · pipeline stages: boundary reorder rejected, middle reorder swaps, win/loss stays exclusive", async () => {
    const seeded = rows((await req("GET", "/crm/pipeline-stages")).body).sort((a: any, b: any) => a.order - b.order);
    checkEq("7 seeded stages", seeded.length, 7);
    const first = seeded[0];
    const second = seeded[1];

    const boundary = await req("POST", `/crm/pipeline-stages/${first.id}/move`, { direction: "up" });
    checkEq("moving the first stage up is rejected", boundary.status, 404);

    const moved = await req("POST", `/crm/pipeline-stages/${second.id}/move`, { direction: "up" });
    checkEq("reordering the second stage up succeeds", moved.status, 200);
    const after = rows(moved.body).sort((a: any, b: any) => a.order - b.order);
    check("the second stage is now first", after[0].id === second.id);
    check("the former first stage is now second", after[1].id === first.id);

    const secondWin = await req("POST", "/crm/pipeline-stages", { id: "SCN-STAGE-WIN2", name: "SCN win stage", isWinStage: true });
    checkEq("a second active win stage is rejected", secondWin.status, 422);
    check("rejected as DUPLICATE_PIPELINE_STAGE_WIN", secondWin.body?.error === "DUPLICATE_PIPELINE_STAGE_WIN");

    const created = await req("POST", "/crm/pipeline-stages", { id: "SCN-STAGE-PLAIN", name: "SCN plain stage" });
    checkEq("a plain (non-win/loss) stage creates fine", created.status, 201);
    checkEq("appended at the end of the order (8th stage, order index 7)", created.body.order, 7);
    checkEq("defaults to 50% probability", created.body.defaultProbability, 50);
    check("defaults to open (neither win nor loss)", !created.body.isWinStage && !created.body.isLossStage);
  });

  // --- CRM: activities complete/cancel ---

  await scenario("crm · activities: complete and cancel are terminal, cannot be repeated", async () => {
    const completed = await req("POST", "/crm/activities/ACT-DEMO-1/complete", {});
    checkEq("ACT-DEMO-1 completes", completed.status, 200);
    check("status is 'completed'", completed.body.status === "completed");

    const doubleComplete = await req("POST", "/crm/activities/ACT-DEMO-1/complete", {});
    checkEq("completing an already-completed activity is rejected", doubleComplete.status, 422);
    check("rejected as ACTIVITY_NOT_PENDING", doubleComplete.body?.error === "ACTIVITY_NOT_PENDING");

    const cancelled = await req("POST", "/crm/activities/ACT-DEMO-2/cancel", {});
    checkEq("ACT-DEMO-2 cancels", cancelled.status, 200);
    check("status is 'cancelled'", cancelled.body.status === "cancelled");
  });

  // --- Projects: create validation + D12 (no status-transition guard anywhere) ---

  await scenario("projects · create validates required fields and enforces code uniqueness", async () => {
    const missingName = await req("POST", "/projects", { id: "SCN-PRJ-BAD", code: "SCN-PRJ-BAD" });
    checkEq("missing nameAr rejected at the schema layer", missingName.status, 400);

    const duplicateCode = await req("POST", "/projects", { id: "SCN-PRJ-DUP", code: "TOWER-A", nameAr: "مشروع مكرر" });
    checkEq("a project code already used by PRJ-DEMO-1 is rejected", duplicateCode.status, 409);
    check("rejected as DUPLICATE_PROJECT_CODE", duplicateCode.body?.error === "DUPLICATE_PROJECT_CODE");

    const created = await req("POST", "/projects", { id: "SCN-PRJ-1", code: "SCN-PRJ-1", nameAr: "مشروع اختبار SCN" });
    checkEq("create succeeds", created.status, 201);
    check("new projects always start 'planned'", created.body.status === "planned");
    check("auto-creates a linked cost center 'cc-prj-{id}'", created.body.costCenterId === "cc-prj-SCN-PRJ-1");
  });

  await scenario("projects · D12: the status lifecycle is guarded on the server, and مكتمل/ملغي are terminal", async () => {
    const before3 = await req("GET", "/projects/PRJ-DEMO-3");
    check("PRJ-DEMO-3 seeded 'completed'", before3.body.status === "completed");

    const backward = await req("PATCH", "/projects/PRJ-DEMO-3", { status: "planned" });
    checkEq("D12: completed → planned (a backward move) is refused", backward.status, 409);
    check("refused as INVALID_PROJECT_TRANSITION", backward.body?.error === "INVALID_PROJECT_TRANSITION", JSON.stringify(backward.body));
    check("the refusal reads in Arabic and names both states", /لا يمكن نقل المشروع من "مكتمل" إلى "مخطط"/.test(backward.body?.message ?? ""), backward.body?.message);
    const after3 = await req("GET", "/projects/PRJ-DEMO-3");
    check("D12: the refused move left the status untouched", after3.body.status === "completed", after3.body.status);

    const before5 = await req("GET", "/projects/PRJ-DEMO-5");
    check("PRJ-DEMO-5 seeded 'cancelled'", before5.body.status === "cancelled");

    const jump = await req("PATCH", "/projects/PRJ-DEMO-5", { status: "active" });
    checkEq("D12: cancelled → active (an illegal jump) is refused", jump.status, 409);
    const after5 = await req("GET", "/projects/PRJ-DEMO-5");
    check("D12: the refused jump left the status untouched", after5.body.status === "cancelled", after5.body.status);

    // The legal path still works, and editing other fields on a terminal
    // project must not be blocked by the guard (same status in = same out).
    const legal = await req("PATCH", "/projects/SCN-PRJ-1", { status: "active" });
    checkEq("D12: planned → active is allowed", legal.status, 200);
    check("the status actually changed", legal.body.status === "active", legal.body.status);
    const hold = await req("PATCH", "/projects/SCN-PRJ-1", { status: "on_hold" });
    checkEq("D12: active → on_hold is allowed", hold.status, 200);
    const resume = await req("PATCH", "/projects/SCN-PRJ-1", { status: "active" });
    checkEq("D12: on_hold → active is allowed (a hold is not terminal)", resume.status, 200);

    const rename = await req("PATCH", "/projects/PRJ-DEMO-3", { notes: "ملاحظة بعد الإغلاق" });
    checkEq("D12: a terminal project's other fields are still editable", rename.status, 200);
  });

  // --- Fixed Assets priority 3: straight-line matches category method/life; run posts a balanced entry ---
  // Runs FIRST among the fixed-assets scenarios, before any new asset is created, so the eligible set
  // stays exactly the 6 seeded ASSET-DEMO-* assets and the totals below are exact.

  await scenario("fixed-assets · depreciation run matches each asset's category method/life; posting balances the GL", async () => {
    const run = await req("POST", "/assets/depreciation/runs", { period: "2026-08" });
    checkEq("run created", run.status, 201);
    check("starts 'draft'", run.body.status === "draft");
    checkEq("exactly the 6 seeded active assets are eligible", run.body.lines.length, 6);

    const byAsset = new Map(run.body.lines.map((l: any) => [l.assetId, n(l.amount)]));
    checkEq("ASSET-DEMO-1 (AST-0001): (180,000 − 18,000) / 60", byAsset.get("ASSET-DEMO-1"), 2700);
    checkEq("ASSET-DEMO-2 (AST-0002): (650,000 − 90,000) / 96", byAsset.get("ASSET-DEMO-2"), 5833.333333);
    checkEq("ASSET-DEMO-3 (AST-0003): (420,000 − 63,000) / 96", byAsset.get("ASSET-DEMO-3"), 3718.75);
    checkEq("ASSET-DEMO-4 (AST-0004): (95,000 − 4,750) / 36", byAsset.get("ASSET-DEMO-4"), 2506.944444);
    checkEq("ASSET-DEMO-5 (AST-0005): (36,000 − 1,800) / 36", byAsset.get("ASSET-DEMO-5"), 950);
    checkEq("ASSET-DEMO-6 (AST-0006): (250,000 − 25,000) / 60", byAsset.get("ASSET-DEMO-6"), 3750);
    checkEq("the run's totalAmount is the exact sum of its 6 lines — no rounding leak", n(run.body.totalAmount), 19459.027777);

    const duplicate = await req("POST", "/assets/depreciation/runs", { period: "2026-08" });
    checkEq("a second run for the same period+branch is rejected (AST-19)", duplicate.status, 409);
    check("rejected as DUPLICATE_DEPRECIATION_PERIOD", duplicate.body?.error === "DUPLICATE_DEPRECIATION_PERIOD");

    const posted = await req("POST", `/assets/depreciation/runs/${run.body.id}/post`, {});
    checkEq("posting the draft succeeds", posted.status, 200);
    check("status becomes 'posted'", posted.body.status === "posted");
    check("journal entry id follows DEP-JE:<runId>", posted.body.journalEntryId === `DEP-JE:${run.body.id}`);

    const je = await req("GET", `/gl/journal-entries/${posted.body.journalEntryId}`);
    checkEq("the posted journal entry is fetchable", je.status, 200);
    checkEq("exactly ONE Dr/Cr pair — all 3 categories share the same 5400/1590 accounts, so lines are grouped, not one per asset",
      je.body.lines.length, 2);
    const debitLine = je.body.lines.find((l: any) => l.accountId === "5400");
    const creditLine = je.body.lines.find((l: any) => l.accountId === "1590");
    check("a 5400 (depreciation expense) debit line exists", debitLine !== undefined);
    check("a 1590 (accumulated depreciation) credit line exists", creditLine !== undefined);
    checkEq("Dr 5400 == the run's total", n(debitLine.debit), 19459.027777);
    checkEq("Cr 1590 == the run's total", n(creditLine.credit), 19459.027777);
    checkEq("the entry balances: debit == credit", n(debitLine.debit), n(creditLine.credit));

    const asset1 = await req("GET", "/assets/ASSET-DEMO-1");
    checkEq("AST-0001's accumulated depreciation now 2,700.00", n(asset1.body.accumulatedDepreciation), 2700);
    checkEq("AST-0001's book value == cost − accumulated == 177,300.00",
      n(asset1.body.acquisitionCost) - n(asset1.body.accumulatedDepreciation), 177300);
  });

  // --- Fixed Assets: category + register creation validation (after the priority-3 run, so it can't add extra eligible lines) ---

  await scenario("fixed-assets · category create validates code uniqueness and numeric ranges", async () => {
    const duplicateCode = await req("POST", "/assets/categories", {
      id: "SCN-CAT-DUP", code: "FA-01", nameAr: "تصنيف مكرر", defaultUsefulLifeMonths: 24, defaultSalvagePercent: 10,
    });
    checkEq("a category code already used by FA-01 is rejected", duplicateCode.status, 409);
    check("rejected as DUPLICATE_ASSET_CATEGORY_CODE", duplicateCode.body?.error === "DUPLICATE_ASSET_CATEGORY_CODE");

    const badLife = await req("POST", "/assets/categories", {
      id: "SCN-CAT-BAD", code: "SCN-FA-BAD", nameAr: "سيئ", defaultUsefulLifeMonths: 0, defaultSalvagePercent: 10,
    });
    checkEq("a useful life of 0 is rejected at the schema layer", badLife.status, 400);

    const created = await req("POST", "/assets/categories", {
      id: "SCN-CAT-1", code: "SCN-FA", nameAr: "تصنيف اختبار SCN", defaultUsefulLifeMonths: 24, defaultSalvagePercent: 10,
    });
    checkEq("category create succeeds", created.status, 201);
    check("defaults to the only method that exists, straight_line", created.body.defaultDepreciationMethod === "straight_line");
  });

  await scenario("fixed-assets · asset register: code uniqueness, branch-scope requires a branch, salvage defaults from the category %", async () => {
    const duplicateCode = await req("POST", "/assets", {
      id: "SCN-ASSET-DUP", code: "AST-0001", nameAr: "أصل مكرر", categoryId: "ASSET-CAT-DEMO-1",
      acquisitionDate: "2026-01-01", acquisitionCost: "1000.00",
    });
    checkEq("an asset code already used by AST-0001 is rejected", duplicateCode.status, 409);
    check("rejected as DUPLICATE_ASSET_CODE", duplicateCode.body?.error === "DUPLICATE_ASSET_CODE");

    const missingBranch = await req("POST", "/assets", {
      id: "SCN-ASSET-NOBRANCH", code: "SCN-AST-NB", nameAr: "بلا فرع", categoryId: "ASSET-CAT-DEMO-1",
      scope: "branch", acquisitionDate: "2026-01-01", acquisitionCost: "1000.00",
    });
    checkEq("scope 'branch' without a branchId is rejected (AST-11)", missingBranch.status, 422);
    check("rejected as INVALID_ASSET", missingBranch.body?.error === "INVALID_ASSET");

    const salvage = await req("POST", "/assets", {
      id: "SCN-ASSET-SALV", code: "SCN-AST-SALV", nameAr: "اختبار قيمة متبقية", categoryId: "ASSET-CAT-DEMO-3",
      acquisitionDate: "2026-01-01", acquisitionCost: "20000.00",
    });
    checkEq("create with no explicit salvage value succeeds", salvage.status, 201);
    checkEq("salvage value computed from FA-03's default 5% of 20,000 (AST-12)", n(salvage.body.salvageValue), 1000);
    checkEq("a fresh asset's book value == its full cost (zero depreciation yet)",
      n(salvage.body.acquisitionCost) - n(salvage.body.accumulatedDepreciation), 20000);
  });

  // --- Fixed Assets: accumulated depreciation caps at cost − salvage; posting flips status automatically ---

  await scenario("fixed-assets · accumulated depreciation never exceeds cost minus salvage; a fully-depreciated asset flips status on posting", async () => {
    const created = await req("POST", "/assets", {
      id: "SCN-ASSET-CAP", code: "SCN-AST-CAP", nameAr: "أصل اختبار سقف الإهلاك", categoryId: "ASSET-CAT-DEMO-1",
      acquisitionDate: "2026-07-01", acquisitionCost: "1000.00", salvageValue: "0.00", usefulLifeMonths: 1,
    });
    checkEq("cap-test asset created", created.status, 201);

    const run = await req("POST", "/assets/depreciation/runs", { period: "2026-09" });
    checkEq("a run for the next period is created", run.status, 201);
    const line = run.body.lines.find((l: any) => l.assetId === "SCN-ASSET-CAP");
    check("the cap-test asset is included", line !== undefined);
    checkEq("its due amount is capped at the full depreciable base (1,000 − 0), not more", n(line.amount), 1000);

    const posted = await req("POST", `/assets/depreciation/runs/${run.body.id}/post`, {});
    checkEq("posting succeeds", posted.status, 200);

    const after = await req("GET", "/assets/SCN-ASSET-CAP");
    checkEq("accumulated depreciation caps at exactly the depreciable base, 1,000.00", n(after.body.accumulatedDepreciation), 1000);
    check("status flips to 'fully_depreciated' automatically on posting — no manual action", after.body.status === "fully_depreciated");
    checkEq("book value is exactly 0.00", n(after.body.acquisitionCost) - n(after.body.accumulatedDepreciation), 0);

    const nextRun = await req("POST", "/assets/depreciation/runs", { period: "2026-10" });
    checkEq("a further run still succeeds (other assets remain eligible)", nextRun.status, 201);
    const stillEligible = nextRun.body.lines.some((l: any) => l.assetId === "SCN-ASSET-CAP");
    check("a fully-depreciated asset is excluded from later runs entirely", !stillEligible);
  });

  await scenario("fixed-assets · disposing an asset clears its cost and accumulated depreciation and books the gain or loss (docs/defects.md D13)", async () => {
    const before = (await req("GET", "/assets/ASSET-DEMO-1")).body;
    check("the asset is live before disposal", before?.status !== "disposed", JSON.stringify(before?.status));
    const cost = n(before?.acquisitionCost);
    const accumulated = n(before?.accumulatedDepreciation);
    const bookValue = cost - accumulated;
    check("and carries a real book value to dispose of", bookValue > 0, `cost=${cost} accumulated=${accumulated}`);

    const proceeds = Math.round((bookValue + 500) * 100) / 100;
    const dispose = await req("POST", "/assets/ASSET-DEMO-1/dispose", {
      date: "2026-08-24",
      proceeds: proceeds.toFixed(2),
      proceedsAccountId: "1300-1",
    });
    check("the disposal is accepted", dispose.status === 200, `status ${dispose.status} ${JSON.stringify(dispose.body).slice(0, 250)}`);
    checkEq("it reports the book value it removed", n(dispose.body?.bookValueAtDisposal), bookValue);
    checkEq("and the gain over that book value", n(dispose.body?.gainOrLoss), 500);
    check("the asset is now disposed", dispose.body?.status === "disposed", String(dispose.body?.status));

    const je = (await req("GET", "/gl/journal-entries/DISP-JE:ASSET-DEMO-1")).body;
    const line = (accountId: string) => (je?.lines ?? []).find((l: any) => l.accountId === accountId);
    check("the entry clears the asset's own cost account", n(line("1510")?.credit) === cost, JSON.stringify(je?.lines ?? []).slice(0, 300));
    checkEq("clears its accumulated depreciation", n(line("1590")?.debit), accumulated);
    checkEq("takes the proceeds into the خزنة", n(line("1300-1")?.debit), proceeds);
    checkEq("and books the gain", n(line("4500")?.credit), 500);

    const again = await req("POST", "/assets/ASSET-DEMO-1/dispose", { date: "2026-08-24" });
    check("disposal is terminal — a second one is refused, in Arabic", again.status === 409 && /تم التخلص منه/.test(String(again.body?.message)), `status ${again.status} ${JSON.stringify(again.body).slice(0, 200)}`);
  });

  // --- Field Sales priority 4: the seeded settled trip has a REAL shortage — assert the numbers ---

  await scenario("field-sales · the seeded settled trip's cash and stock variances are real numbers, not merely present", async () => {
    const trips = rows((await req("GET", "/field/van-trips")).body);
    const tripA = trips.find((t: any) => t.tripNo === "TRIP-DEMO-1");
    check("TRIP-DEMO-1 found and settled", tripA?.status === "settled");

    checkEq("expected cash == opening float 1,000 + one 200 cash sale == 1,200.00 exactly",
      n(tripA.settlement.expectedCash), 1200);
    checkEq("counted cash == 950.00 (as seeded)", n(tripA.settlement.countedCash), 950);
    checkEq("cash variance == counted − expected == −250.00 exactly (a real shortage)",
      n(tripA.settlement.cashVariance), -250);

    const item1 = tripA.settlement.stockCounts.find((s: any) => s.itemId === "ITEM-DEMO-1");
    checkEq("ITEM-DEMO-1 expected == 20 loaded", n(item1.expectedQty), 20);
    checkEq("ITEM-DEMO-1 counted == 18", n(item1.countedQty), 18);
    checkEq("ITEM-DEMO-1 variance == counted − loaded == −2 exactly", n(item1.varianceQty), -2);

    const item3 = tripA.settlement.stockCounts.find((s: any) => s.itemId === "ITEM-DEMO-3");
    checkEq("ITEM-DEMO-3 variance == 0 (counted matches loaded, no shortage)", n(item3.varianceQty), 0);
  });

  await scenario("field-sales · settling an ongoing trip live computes the same variance formulas end to end", async () => {
    const trips = rows((await req("GET", "/field/van-trips")).body);
    const tripB = trips.find((t: any) => t.tripNo === "TRIP-DEMO-2");
    check("TRIP-DEMO-2 found and still ongoing", tripB?.status === "ongoing");

    const movement = await req("POST", `/field/van-trips/${tripB.id}/cash-movements`, {
      id: "SCN-VAN-CASHMOVE-1", kind: "sale", amount: "300.00", occurredAt: "2026-08-24T10:00:00.000Z",
    });
    checkEq("cash movement recorded", movement.status, 200);

    // countedCash must not exceed the van treasury's real GL balance (1,550.00 here — 1,500 opening
    // float + 50 left over from TRIP-DEMO-1's own open/settle transfers): settlement returns the
    // counted cash to the source treasury as a real transfer, and the cash guard refuses to take
    // the account negative, so an overage above the real balance would 500 rather than settle.
    const settled = await req("POST", `/field/van-trips/${tripB.id}/settle`, {
      countedCash: "1450.00",
      stockCounts: [{ itemId: "ITEM-DEMO-4", countedQty: "9" }],
    });
    checkEq("settle succeeds", settled.status, 200);
    check("status becomes 'settled'", settled.body.status === "settled");
    checkEq("expected == opening float 1,500 + 300 sale == 1,800.00", n(settled.body.settlement.expectedCash), 1800);
    checkEq("counted == 1,450.00", n(settled.body.settlement.countedCash), 1450);
    checkEq("variance == counted − expected == −350.00 exactly (a real shortage)", n(settled.body.settlement.cashVariance), -350);
    const item4 = settled.body.settlement.stockCounts.find((s: any) => s.itemId === "ITEM-DEMO-4");
    checkEq("ITEM-DEMO-4 variance == counted 9 − loaded 10 == −1 exactly", n(item4.varianceQty), -1);

    const doubleSettle = await req("POST", `/field/van-trips/${tripB.id}/settle`, { countedCash: "0.00", stockCounts: [] });
    checkEq("settling an already-settled trip is rejected", doubleSettle.status, 409);
  });

  await scenario("field-sales · FLD-11: the open route discards the caller's id and never mints a tripNo", async () => {
    const opened = await req("POST", "/field/van-trips", {
      id: "SCN-VANTRIP-FLD11",
      date: "2026-08-24",
      branchId: "BR-MAIN",
      vanWarehouseId: "WH-DEMO-VAN",
      vanTreasuryAccountId: "TR-DEMO-VAN",
      sourceWarehouseId: "WH-MAIN",
      sourceTreasuryAccountId: "TR-DEMO-CASH",
      crew: [{ employeeId: "EMP-DEMO-1", role: "rep" }],
    });
    checkEq("open succeeds", opened.status, 201);
    check("the route ignores the caller-supplied id and mints its own uuid instead (see demo-seed/treasury.ts's own comment on this)",
      opened.body.id !== "SCN-VANTRIP-FLD11");
    check("tripNo stays null — the create form never sends one, so the UI shows the raw id in its place (FLD-11)",
      opened.body.tripNo === null);
  });

  // --- Installments priority 5: schedule sums to exactly the plan total, no rounding leak ---

  await scenario("installments · the schedule's instalments sum to exactly the plan total, no rounding leak on any line", async () => {
    const invoice = await req("GET", "/sales-invoices/INV-DEMO-3");
    checkEq("source invoice fetched", invoice.status, 200);

    const plan = await req("GET", "/installments/plans/IPLAN-DEMO-1");
    checkEq("seeded plan fetched", plan.status, 200);
    checkEq("6 seeded instalment lines", plan.body.lines.length, 6);

    const sumOfLines = plan.body.lines.reduce((s: number, l: any) => s + n(l.amount), 0);
    const downPayment = n(plan.body.lines[0].downPayment);
    checkEq("down payment + all 6 instalments == the source invoice's grand total, exactly (two independently-read figures)",
      downPayment + sumOfLines, n(invoice.body.totals.grandTotal));
    checkEq("each instalment == 939.93 exactly (5,639.58 ÷ 6 divides evenly)", n(plan.body.lines[0].amount), 939.93);
    check("line #1 is 'overdue' (due 2026-08-18, already past)", plan.body.lines[0].status === "overdue");
    check("lines #2-6 are still 'pending'", plan.body.lines.slice(1).every((l: any) => l.status === "pending"));

    const uneven = await req("POST", "/installments/plans", {
      id: "SCN-IPLAN-UNEVEN", date: "2026-09-01", memo: "SCN rounding-leak stress test",
      customerId: "CUST-DEMO-1", sourceInvoiceId: "SCN-INV-ROUNDING", sourceInvoiceNumber: null,
      invoiceTotal: "100.00", downPayment: "0.00", installmentCount: 3, frequency: "MONTHLY", startDate: "2026-09-01",
    });
    checkEq("a plan whose total does NOT divide evenly by its installment count still creates", uneven.status, 201);
    checkEq("3 lines", uneven.body.lines.length, 3);
    const unevenSum = uneven.body.lines.reduce((s: number, l: any) => s + n(l.amount), 0);
    checkEq("the 3 lines still sum to exactly 100.00 — no cent stranded anywhere, including the final line", unevenSum, 100);
    check("the final line is not silently zeroed or short-changed", n(uneven.body.lines[2].amount) > 0);
  });

  // --- Installments priority 5: overdue report lists exactly the late line, no other ---

  await scenario("installments · the overdue report lists exactly the late instalment and no other", async () => {
    const report = await req("GET", "/reports/installments/overdue?asOfDate=2026-08-22");
    checkEq("report responds", report.status, 200);
    const overdueRows = rows(report.body);
    checkEq("exactly 1 overdue line (installment #1 of IPLAN-DEMO-1)", overdueRows.length, 1);
    const row = overdueRows[0];
    check("plan number IP-000001", row.planNo === "IP-000001");
    checkEq("amount == 939.93", n(row.amount), 939.93);
    checkEq("remaining == 939.93 (nothing paid against it)", n(row.remaining), 939.93);
    check("due date 2026-08-18", row.dueDate === "2026-08-18");
    checkEq("days late == 4 (2026-08-22 minus 2026-08-18)", row.daysLate, 4);

    const dayBefore = await req("GET", "/reports/installments/overdue?asOfDate=2026-08-17");
    checkEq("the day before the line's due date, the report is empty — recomputed dynamically from dueDate/status, not from the batch's stored status",
      rows(dayBefore.body).length, 0);
  });

  // --- Installments: an allocated collection reaches the invoice it settles ---

  await scenario("installments · a confirmed, allocated collection voucher moves the source invoice's amountPaid", async () => {
    const voucher = await req("GET", "/vouchers/VCH-DEMO-1");
    checkEq("voucher fetched", voucher.status, 200);
    check("voucher is confirmed", voucher.body.status === "confirmed");
    const allocation = voucher.body.allocations.find((a: any) => a.invoiceId === "INV-DEMO-1");
    check("it is really allocated against INV-DEMO-1", allocation !== undefined);
    check("with a real, non-zero amount", n(allocation.amount) > 0);

    const invoice = await req("GET", "/sales-invoices/INV-DEMO-1");
    checkEq("amountPaid equals what the allocation applied (docs/defects.md D1 — the regression guard)", n(invoice.body.amountPaid), n(allocation.amount));
    check("remainingBalance therefore drops below the grand total",
      n(invoice.body.remainingBalance) < n(invoice.body.totals.grandTotal),
      `remaining=${invoice.body.remainingBalance} grandTotal=${invoice.body.totals.grandTotal}`);
  });

  // --- Installments must-not-do: no route sets a line to 'paid' — do not invent one, assert the gap (INST-08) ---

  await scenario("installments · no route or service anywhere sets an instalment line to 'paid' (docs/scenarios/06 INST-08 — collection is a separate treasury-voucher concern never linked back to a plan line)", async () => {
    const guess = await req("POST", "/installments/plans/IPLAN-DEMO-1/lines/1/pay", {});
    checkEq("no such route is mounted", guess.status, 404);
  });

  // --- Installments: collection follow-ups (create/complete/cancel), a lighter-weight sibling flow ---

  await scenario("installments · collection follow-ups: create, complete with a custom outcome, cancel", async () => {
    const created = await req("POST", "/installments/follow-ups", {
      id: "SCN-FOLLOWUP-1", customerId: "CUST-DEMO-1", type: "CALL", followUpDate: "2026-08-25",
    });
    checkEq("follow-up created", created.status, 201);
    check("starts 'pending'", created.body.status === "pending");
    check("no installmentPlanId link is even possible from this route in this build (INST-14 gap)",
      created.body.installmentPlanId === null);

    const completed = await req("POST", "/installments/follow-ups/SCN-FOLLOWUP-1/complete", {
      outcome: "وعد بالدفع الأسبوع القادم",
    });
    checkEq("completes", completed.status, 200);
    check("the outcome is recorded verbatim", completed.body.outcome === "وعد بالدفع الأسبوع القادم");

    await req("POST", "/installments/follow-ups", {
      id: "SCN-FOLLOWUP-2", customerId: "CUST-DEMO-1", type: "VISIT", followUpDate: "2026-08-26",
    });
    const cancelled = await req("POST", "/installments/follow-ups/SCN-FOLLOWUP-2/cancel", {});
    checkEq("cancels", cancelled.status, 200);
    check("status is 'cancelled'", cancelled.body.status === "cancelled");
  });
}
