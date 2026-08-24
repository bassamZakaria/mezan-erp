import type { Ctx } from "./harness.js";

/**
 * Executable checks for the Settings / Platform Administration module — see
 * docs/scenarios/07-platform-settings.md.
 *
 * The seed's only real login is USER-ADMIN, whose `x-permissions: "*"`
 * satisfies `hasAdminRole` in every actor-role check across this codebase —
 * NOT just `x-permissions`, but also a bare `x-role-codes: "*"` (the harness's
 * own default header). Every non-admin actor below therefore overrides BOTH
 * headers explicitly; leaving `x-role-codes` at its "*" default silently
 * re-admits the admin bypass.
 */

function nonAdmin(userId: string, permissions: string, roleCode = "SCN_NONE"): Record<string, string> {
  return { "x-user-id": userId, "x-permissions": permissions, "x-role-codes": roleCode };
}

function branchScoped(branchId: string): Record<string, string> {
  return { "x-branch-scope": branchId };
}

async function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

export async function run(ctx: Ctx): Promise<void> {
  const { req, rows, check } = ctx;

  // ---------------------------------------------------------------------
  // Setup — a real non-admin submitter and a real non-admin approver, plus
  // a dedicated workflow chain on SALES_RETURN_CONFIRM (the seed only
  // configures SALES_INVOICE_CONFIRM / PURCHASE_INVOICE_CONFIRM, and — see
  // the "gate wiring" scenario below — SALES_INVOICE_CONFIRM's seeded chain
  // turns out to have no effect at all, so it can't carry this test).
  // ---------------------------------------------------------------------
  let approverRoleId = "";
  let submitterUserId = "";
  let approverUserId = "";

  let scnReturnConfigId = "";
  await ctx.scenario("platform / setup — SCN approver role, users, workflow chain", async () => {
    const role = await req("POST", "/roles", {
      code: "SCN_APPROVER",
      name: "SCN Approver",
      description: "scenario-only role for platform.ts approvals testing",
      permissions: ["workflow.view", "workflow.approve", "workflow.reject"],
    });
    check("create SCN_APPROVER role", role.status === 201, `${role.status}: ${JSON.stringify(role.body)}`);
    approverRoleId = role.body?.id ?? "";

    const submitter = await req("POST", "/users", {
      fullName: "SCN Submitter", email: "scn-submitter@example.test", phone: null,
      roleId: approverRoleId, isCompanyAdmin: false, employeeId: null,
      branchScope: "*", warehouseScope: "*", status: "active", password: "SCN-password-1",
    });
    check("create SCN submitter user", submitter.status === 201, `${submitter.status}: ${JSON.stringify(submitter.body)}`);
    submitterUserId = submitter.body?.id ?? "";

    const approver = await req("POST", "/users", {
      fullName: "SCN Approver", email: "scn-approver@example.test", phone: null,
      roleId: approverRoleId, isCompanyAdmin: false, employeeId: null,
      branchScope: "*", warehouseScope: "*", status: "active", password: "SCN-password-1",
    });
    check("create SCN approver user", approver.status === 201, `${approver.status}: ${JSON.stringify(approver.body)}`);
    approverUserId = approver.body?.id ?? "";

    const cfg = await req("POST", "/workflow/configs", {
      actionType: "SALES_RETURN_CONFIRM",
      steps: [{ role: "SCN_APPROVER", description: "SCN scenario approval step" }],
    });
    check("create SALES_RETURN_CONFIRM workflow config", cfg.status === 201, `${cfg.status}: ${JSON.stringify(cfg.body)}`);
    scnReturnConfigId = cfg.body?.id ?? "";
  });

  const invoice = (await req("GET", "/sales-invoices/INV-DEMO-1")).body;
  const returnLine = invoice.lines[0];

  function submitterHeaders(): Record<string, string> {
    return nonAdmin(submitterUserId, "sales.return.view_own,sales.return.create,sales.return.confirm,workflow.view", "SCN_SUBMITTER_ROLE");
  }
  function approverHeaders(): Record<string, string> {
    return nonAdmin(approverUserId, "workflow.view,workflow.approve,workflow.reject", "SCN_APPROVER");
  }

  async function submitPendingReturn(id: string): Promise<{ documentId: string; workflowRequestId: string }> {
    const create = await req("POST", "/sales-returns", {
      id, date: "2026-08-22", memo: `SCN approvals test ${id}`,
      lines: [{
        itemId: returnLine.itemId, warehouseId: invoice.warehouseId, customerId: invoice.customerId,
        sourceInvoiceId: invoice.id, sourceInvoiceNumber: invoice.docNo, reason: "DEFECTIVE",
        availableQty: "1", qty: "1", unitPrice: returnLine.unitPrice, unitCost: returnLine.unitPrice, taxAmount: "0",
      }],
    }, submitterHeaders());
    check(`${id} — create draft`, create.status === 201, `${create.status}: ${JSON.stringify(create.body)}`);

    const confirm = await req("POST", `/sales-returns/${id}/confirm`, {}, submitterHeaders());
    check(`${id} — confirm held pending (non-admin submitter, gate configured)`, confirm.status === 200 && confirm.body?.document?.status === "pending" && confirm.body?.held === true, `${confirm.status}: ${JSON.stringify(confirm.body)}`);
    return { documentId: id, workflowRequestId: confirm.body?.document?.workflowRequestId ?? "" };
  }

  // ---------------------------------------------------------------------
  // F9 regression proof (342b5b9): a held document's workflowRequestId now
  // resolves to a real row in /workflow/requests. Before that commit it did
  // not — the gate built the request in memory and discarded it.
  // ---------------------------------------------------------------------
  let approveOutcome: { documentId: string; workflowRequestId: string } | undefined;

  await ctx.scenario("platform / approvals — outcome 1: approve", async () => {
    approveOutcome = await submitPendingReturn("SCN-RET-APPROVE");
    check("workflowRequestId is present on the held document", approveOutcome.workflowRequestId.length > 0, approveOutcome.workflowRequestId);

    const list = await req("GET", "/workflow/requests", undefined, {});
    const persisted = rows(list.body).find((r: any) => r.id === approveOutcome!.workflowRequestId);
    check("F9 — held document's workflowRequestId resolves to a row in /workflow/requests", !!persisted, `not found among ${rows(list.body).length} requests`);
    check("F9 — persisted request is pending, step role SCN_APPROVER", persisted?.status === "pending" && persisted?.steps?.[0]?.role === "SCN_APPROVER", JSON.stringify(persisted));
    check("F9 — persisted request records the real non-admin submitter", persisted?.submittedBy === submitterUserId, persisted?.submittedBy);

    const pendingForApprover = await req("GET", "/workflow/requests/pending", undefined, approverHeaders());
    check("request appears in the SCN_APPROVER role holder's pending inbox", rows(pendingForApprover.body).some((r: any) => r.id === approveOutcome!.workflowRequestId), JSON.stringify(rows(pendingForApprover.body).map((r: any) => r.id)));

    const decide = await req("POST", `/workflow/requests/${approveOutcome.workflowRequestId}/decide`, { decision: "approve", comment: "SCN — reviewed and approved" }, approverHeaders());
    check("non-admin approve decision succeeds", decide.status === 200 && decide.body?.status === "approved", `${decide.status}: ${JSON.stringify(decide.body)}`);
    const lastDecision = decide.body?.decisions?.at(-1);
    check("audit trail records WHO decided (real approver actorId, not bypass)", lastDecision?.kind === "approve" && lastDecision?.actorId === approverUserId, JSON.stringify(lastDecision));
    check("audit trail records WHEN it was decided (updatedAt is a fresh timestamp)", typeof decide.body?.updatedAt === "string" && Date.now() - new Date(decide.body.updatedAt).getTime() < 60_000, decide.body?.updatedAt);

    const stillPending = await req("GET", "/workflow/requests/pending", undefined, approverHeaders());
    check("approved request leaves the approver's pending inbox", !rows(stillPending.body).some((r: any) => r.id === approveOutcome!.workflowRequestId), JSON.stringify(rows(stillPending.body).map((r: any) => r.id)));

    const doc = await req("GET", `/sales-returns/${approveOutcome.documentId}`, undefined, {});
    check("an approved request actually posts its held document", doc.body?.status === "confirmed", `document status is "${doc.body?.status}"`);
    check("the posted document carries the journal entry its confirm produced", typeof doc.body?.journalEntryId === "string" && doc.body.journalEntryId.length > 0, JSON.stringify(doc.body?.journalEntryId));

    const reconfirm = await req("POST", `/sales-returns/${approveOutcome.documentId}/confirm`, {}, submitterHeaders());
    check("a document already posted by its approval cannot be confirmed a second time", reconfirm.status === 409, `${reconfirm.status}: ${JSON.stringify(reconfirm.body)}`);
  });

  // ---------------------------------------------------------------------
  // Outcome 2: reject — must not post.
  // ---------------------------------------------------------------------
  await ctx.scenario("platform / approvals — outcome 2: reject", async () => {
    const outcome = await submitPendingReturn("SCN-RET-REJECT");

    const decide = await req("POST", `/workflow/requests/${outcome.workflowRequestId}/decide`, { decision: "reject", comment: "SCN — missing supporting documents" }, approverHeaders());
    check("non-admin reject decision succeeds", decide.status === 200 && decide.body?.status === "rejected", `${decide.status}: ${JSON.stringify(decide.body)}`);
    const lastDecision = decide.body?.decisions?.at(-1);
    check("reject records the real approver as actor, kind reject (not bypass)", lastDecision?.kind === "reject" && lastDecision?.actorId === approverUserId, JSON.stringify(lastDecision));

    const pending = await req("GET", "/workflow/requests/pending", undefined, approverHeaders());
    check("rejected request is terminal — absent from every pending inbox", !rows(pending.body).some((r: any) => r.id === outcome.workflowRequestId), JSON.stringify(rows(pending.body).map((r: any) => r.id)));

    const doc = await req("GET", `/sales-returns/${outcome.documentId}`, undefined, {});
    check("a rejected document must not post", doc.body?.status !== "confirmed", doc.body?.status);
    check("a rejected document is handed back to its submitter as a draft", doc.body?.status === "draft", doc.body?.status);

    const reconfirm = await req("POST", `/sales-returns/${outcome.documentId}/confirm`, {}, submitterHeaders());
    check("re-confirming a rejected document is refused, not silently re-submitted", reconfirm.status === 409 && reconfirm.body?.error === "APPROVAL_REQUEST_REJECTED", `${reconfirm.status}: ${JSON.stringify(reconfirm.body)}`);
  });

  // ---------------------------------------------------------------------
  // Outcome 3: request modification — should return the document editable
  // to its submitter.
  // ---------------------------------------------------------------------
  await ctx.scenario("platform / approvals — outcome 3: request modification", async () => {
    const outcome = await submitPendingReturn("SCN-RET-MODIFY");

    const decide = await req("POST", `/workflow/requests/${outcome.workflowRequestId}/decide`, { decision: "request_modification", comment: "SCN — add shipment details" }, approverHeaders());
    check("non-admin request-modification decision succeeds", decide.status === 200 && decide.body?.status === "modification_requested", `${decide.status}: ${JSON.stringify(decide.body)}`);
    const lastDecision = decide.body?.decisions?.at(-1);
    check("request-modification records the real approver as actor", lastDecision?.kind === "request_modification" && lastDecision?.actorId === approverUserId, JSON.stringify(lastDecision));

    const doc = await req("GET", `/sales-returns/${outcome.documentId}`, undefined, {});
    check("a modification-requested document returns editable (draft) to its submitter", doc.body?.status === "draft", `document status is "${doc.body?.status}"`);

    const mine = await req("GET", "/workflow/requests/mine", undefined, submitterHeaders());
    check("the submitter can at least see their own bounced-back request via /workflow/requests/mine", rows(mine.body).some((r: any) => r.id === outcome.workflowRequestId), JSON.stringify(rows(mine.body).map((r: any) => r.id)));
  });

  // ---------------------------------------------------------------------
  // D8 — an admin bypasses the step's ROLE, never the decision itself.
  // ---------------------------------------------------------------------
  await ctx.scenario("platform / approvals — D8: an admin's reject rejects", async () => {
    const outcome = await submitPendingReturn("SCN-RET-D8");

    const decide = await req("POST", `/workflow/requests/${outcome.workflowRequestId}/decide`, { decision: "reject", comment: "D8 probe — admin rejects someone else's step" }, {});
    check("D8 — an admin clicking reject on someone else's pending request REJECTS it", decide.status === 200 && decide.body?.status === "rejected", `${decide.status}: ${JSON.stringify(decide.body)}`);
    const lastDecision = decide.body?.decisions?.at(-1);
    check("D8 — the recorded decision kind is the one the admin chose", lastDecision?.kind === "reject" && lastDecision?.actorId === "USER-ADMIN", JSON.stringify(lastDecision));

    const doc = await req("GET", `/sales-returns/${outcome.documentId}`, undefined, {});
    check("D8 — the admin-rejected document did not post", doc.body?.status === "draft", doc.body?.status);
  });

  // An admin approving still bypasses every remaining step.
  await ctx.scenario("platform / approvals — an admin's approve still bypasses the chain", async () => {
    const outcome = await submitPendingReturn("SCN-RET-ADMIN-OK");
    const decide = await req("POST", `/workflow/requests/${outcome.workflowRequestId}/decide`, { decision: "approve", comment: "admin bypass" }, {});
    check("admin approve grants the whole request", decide.status === 200 && decide.body?.status === "approved", `${decide.status}: ${JSON.stringify(decide.body)}`);
    const doc = await req("GET", `/sales-returns/${outcome.documentId}`, undefined, {});
    check("the admin-approved document posts", doc.body?.status === "confirmed", doc.body?.status);
  });

  // ---------------------------------------------------------------------
  // SALES_INVOICE_CONFIRM has a seeded workflow config (role SUPERVISOR),
  // but SalesInvoiceService is never given a `workflow` dependency in
  // create-backend.ts — the gate is never even evaluated for sales invoices.
  // ---------------------------------------------------------------------
  await ctx.scenario("platform / approvals — SALES_INVOICE_CONFIRM gate wiring", async () => {
    const create = await req("POST", "/sales-invoices", {
      id: "SCN-INV-GATE-CHECK", date: "2026-08-22", dueDate: "2026-08-22",
      customerId: invoice.customerId, customerNameAr: invoice.customerNameAr,
      warehouseId: invoice.warehouseId, branchId: invoice.branchId,
      currency: "EGP", arAccountId: invoice.arAccountId, taxAccountId: invoice.taxAccountId,
      lines: [{
        lineId: "L1", itemId: returnLine.itemId, itemNameAr: returnLine.itemNameAr, isStock: returnLine.isStock,
        qty: "1", unitPrice: returnLine.unitPrice, taxRatePercent: returnLine.taxRatePercent,
        revenueAccountId: returnLine.revenueAccountId, cogsAccountId: returnLine.cogsAccountId, inventoryAccountId: returnLine.inventoryAccountId,
      }],
    }, nonAdmin("SCN-USER-SALESREP", "sales.invoice.view_own,sales.invoice.create,sales.invoice.confirm", "SCN_SALESREP"));
    check("create a draft sales invoice as a non-SUPERVISOR non-admin", create.status === 201, `${create.status}: ${JSON.stringify(create.body)}`);

    const confirm = await req("POST", "/sales-invoices/SCN-INV-GATE-CHECK/confirm", {}, nonAdmin("SCN-USER-SALESREP", "sales.invoice.view_own,sales.invoice.create,sales.invoice.confirm", "SCN_SALESREP"));
    check(
      "SALES_INVOICE_CONFIRM's configured approval chain holds a non-SUPERVISOR submitter's confirm pending",
      confirm.body?.status === "pending",
      `confirm returned status "${confirm.body?.status}"`,
    );
  });

  // ---------------------------------------------------------------------
  // D5 — nothing ever calls EtaService.enqueue, so /eta/submissions can
  // never have a row.
  // ---------------------------------------------------------------------
  await ctx.scenario("platform / D5 — ETA submission queue has no producer", async () => {
    const submissions = await req("GET", "/eta/submissions", undefined, {});
    check("D5 — /eta/submissions is always empty (no route/event bridge ever calls EtaService.enqueue)", submissions.status === 200 && rows(submissions.body).length === 0, `${submissions.status}: ${JSON.stringify(submissions.body)}`);
  });

  // ---------------------------------------------------------------------
  // Permissions — a user without the guarding permission is refused with
  // 403, not merely "admin succeeds".
  // ---------------------------------------------------------------------
  await ctx.scenario("platform / permissions — 403 without the guarding permission", async () => {
    const noPerm = nonAdmin("SCN-USER-NOPERM", "", "SCN_NONE");

    const rolesList = await req("GET", "/roles", undefined, noPerm);
    check("GET /roles refused without admin.roles.view", rolesList.status === 403, `${rolesList.status}: ${JSON.stringify(rolesList.body)}`);

    const usersList = await req("GET", "/users", undefined, noPerm);
    check("GET /users refused without admin.users.view", usersList.status === 403, `${usersList.status}: ${JSON.stringify(usersList.body)}`);

    const webhooksCreate = await req("POST", "/webhooks", { name: "SCN-should-be-refused", targetUrl: "http://127.0.0.1:39298/x", events: ["SALES_INVOICE_CONFIRMED"] }, noPerm);
    check("POST /webhooks refused without admin.settings.edit", webhooksCreate.status === 403, `${webhooksCreate.status}: ${JSON.stringify(webhooksCreate.body)}`);

    const auditList = await req("GET", "/audit", undefined, noPerm);
    check("GET /audit refused without audit.logs.view", auditList.status === 403, `${auditList.status}: ${JSON.stringify(auditList.body)}`);

    const sequencesEdit = await req("PATCH", "/sequences/BOM", { prefix: "SCN-BOM-" }, nonAdmin("SCN-USER-SEQVIEWER", "admin.sequences.view", "SCN_NONE"));
    check("PATCH /sequences/:code refused with view-only admin.sequences.view", sequencesEdit.status === 403, `${sequencesEdit.status}: ${JSON.stringify(sequencesEdit.body)}`);

    const decideNoPerm = await req("POST", `/workflow/requests/${approveOutcome!.workflowRequestId}/decide`, { decision: "approve" }, nonAdmin("SCN-USER-NOWORKFLOW", "", "SCN_NONE"));
    check("POST /workflow/requests/:id/decide refused without workflow.view", decideNoPerm.status === 403, `${decideNoPerm.status}: ${JSON.stringify(decideNoPerm.body)}`);
  });

  // ---------------------------------------------------------------------
  // Webhooks
  // ---------------------------------------------------------------------
  await ctx.scenario("platform / webhooks — only emitted events may be subscribed", async () => {
    const events = await req("GET", "/webhooks/events", undefined, {});
    const codes = new Set((events.body?.events ?? []).map((e: any) => e.code));
    check("exactly 5 events are offered as deliverable", codes.size === 5, [...codes].join(","));
    for (const c of ["SALES_INVOICE_CONFIRMED", "SALES_INVOICE_VOIDED", "SALES_RETURN_CONFIRMED", "PURCHASE_RETURN_CONFIRMED", "PURCHASE_RETURN_VOIDED"]) {
      check(`"${c}" is offered as deliverable`, codes.has(c), [...codes].join(","));
    }

    const refused = await req("POST", "/webhooks", {
      name: "SCN-non-emitted", targetUrl: "http://127.0.0.1:39298/x", events: ["CHEQUE_BOUNCED"],
    }, {});
    check("subscribing to a catalogued-but-never-emitted event is refused with 422 INVALID_WEBHOOK", refused.status === 422 && refused.body?.error === "INVALID_WEBHOOK", `${refused.status}: ${JSON.stringify(refused.body)}`);
  });

  await ctx.scenario("platform / webhooks — bounded retries, no rollback on the triggering document", async () => {
    const webhook = await req("POST", "/webhooks", {
      name: "SCN-loopback-unreachable", targetUrl: "http://127.0.0.1:39298/scn/probe", events: ["PURCHASE_RETURN_CONFIRMED"],
    }, {});
    check("create a webhook targeting an unreachable loopback port", webhook.status === 201, `${webhook.status}: ${JSON.stringify(webhook.body)}`);
    const webhookId = webhook.body?.id;

    const sourceInvoice = await req("GET", "/purchases/invoices/PI-DEMO-2", undefined, {});
    const sourceLine = sourceInvoice.body.lines[0];
    const create = await req("POST", "/purchase-returns", {
      id: "SCN-PRET-WEBHOOK", date: "2026-08-22", memo: "SCN webhook bounded-retry probe",
      lines: [{
        itemId: sourceLine.itemId, warehouseId: sourceInvoice.body.warehouseId, supplierId: sourceInvoice.body.supplierId,
        sourceInvoiceId: sourceInvoice.body.id, sourceInvoiceNumber: sourceInvoice.body.number,
        reason: "DEFECTIVE", availableQty: "1", qty: "1", unitCost: sourceLine.unitCost, taxAmount: "0",
      }],
    }, {});
    check("create the triggering purchase return", create.status === 201, `${create.status}: ${JSON.stringify(create.body)}`);

    const confirm = await req("POST", "/purchase-returns/SCN-PRET-WEBHOOK/confirm", {}, {});
    check("the triggering document confirms even though its webhook target is unreachable", confirm.status === 200 && confirm.body?.document?.status === "confirmed", `${confirm.status}: ${JSON.stringify(confirm.body)}`);

    let deliveries: any[] = [];
    for (let i = 0; i < 20; i++) {
      await sleep(400);
      const d = await req("GET", `/webhooks/${webhookId}/deliveries`, undefined, {});
      deliveries = rows(d.body).filter((x: any) => x.eventCode === "PURCHASE_RETURN_CONFIRMED");
      if (deliveries.length >= 3) break;
    }
    check("delivery retries are bounded at exactly 3 attempts", deliveries.length === 3, `${deliveries.length} rows`);
    check("every attempt failed against the unreachable loopback target", deliveries.every((d: any) => d.success === false && d.statusCode === null), JSON.stringify(deliveries.map((d: any) => ({ success: d.success, statusCode: d.statusCode }))));
    const finalAttempt = deliveries.find((d: any) => (d.errorMessage ?? "").includes("attempt 3/3"));
    check("the final attempt's error message says it gave up", !!finalAttempt && (finalAttempt.errorMessage ?? "").includes("giving up"), finalAttempt?.errorMessage);

    const docAfter = await req("GET", "/purchase-returns/SCN-PRET-WEBHOOK", undefined, {});
    check("the confirmed document is still confirmed after retries exhaust — no rollback from a failing webhook", docAfter.body?.status === "confirmed", docAfter.body?.status);
  });

  // ---------------------------------------------------------------------
  // Numbering sequences — a prefix change affects the next document only,
  // never renumbers history.
  // ---------------------------------------------------------------------
  await ctx.scenario("platform / numbering sequences — prefix change affects next document only", async () => {
    const before = await req("GET", "/sequences/SALES_INVOICE", undefined, {});
    const currentValue = before.body.currentValue;

    const patch = await req("PATCH", "/sequences/SALES_INVOICE", { prefix: "SCN-SI-" }, {});
    check("prefix change accepted", patch.status === 200 && patch.body?.prefix === "SCN-SI-", `${patch.status}: ${JSON.stringify(patch.body)}`);
    check("the counter itself is untouched by a prefix change", patch.body?.currentValue === currentValue, `${patch.body?.currentValue} vs ${currentValue}`);
    check("the preview recomputes against the SAME counter value under the new prefix", patch.body?.nextNumber === `SCN-SI-${String(currentValue + 1).padStart(patch.body?.padLength ?? 6, "0")}`, patch.body?.nextNumber);

    const oldInvoice = await req("GET", "/sales-invoices/INV-DEMO-1", undefined, {});
    check("an existing confirmed invoice's docNo is unchanged by the prefix change", oldInvoice.body?.docNo === "INV-000001", oldInvoice.body?.docNo);

    const newInvoiceLine = invoice.lines[1] ?? invoice.lines[0];
    const create = await req("POST", "/sales-invoices", {
      id: "SCN-INV-NEW-PREFIX", date: "2026-08-22", dueDate: "2026-08-22",
      customerId: invoice.customerId, customerNameAr: invoice.customerNameAr,
      warehouseId: invoice.warehouseId, branchId: invoice.branchId,
      currency: "EGP", arAccountId: invoice.arAccountId, taxAccountId: invoice.taxAccountId,
      lines: [{
        lineId: "L1", itemId: newInvoiceLine.itemId, itemNameAr: newInvoiceLine.itemNameAr, isStock: newInvoiceLine.isStock,
        qty: "1", unitPrice: newInvoiceLine.unitPrice, taxRatePercent: newInvoiceLine.taxRatePercent,
        revenueAccountId: newInvoiceLine.revenueAccountId, cogsAccountId: newInvoiceLine.cogsAccountId, inventoryAccountId: newInvoiceLine.inventoryAccountId,
      }],
    }, {});
    check("create a new invoice", create.status === 201, `${create.status}: ${JSON.stringify(create.body)}`);
    const confirmNew = await req("POST", "/sales-invoices/SCN-INV-NEW-PREFIX/confirm", {}, {});
    check("a brand-new document carries the new prefix", (confirmNew.body?.docNo ?? "").startsWith("SCN-SI-"), confirmNew.body?.docNo);
  });

  await ctx.scenario("platform / numbering sequences — RBAC: view vs edit", async () => {
    const viewer = nonAdmin("SCN-USER-SEQVIEWER-2", "admin.sequences.view", "SCN_NONE");
    const list = await req("GET", "/sequences", undefined, viewer);
    check("a view-only actor can list sequences", list.status === 200, list.status);

    const patch = await req("PATCH", "/sequences/BOM", { prefix: "SCN-BOM-" }, viewer);
    check("a view-only actor is refused PATCH with 403", patch.status === 403, `${patch.status}: ${JSON.stringify(patch.body)}`);

    const counterAdjust = await req("POST", "/sequences/BOM/counter", { value: 999, confirm: true }, nonAdmin("SCN-USER-SEQEDITOR", "admin.sequences.edit", "SCN_NONE"));
    check("admin.sequences.edit alone (without .reset) is refused the counter-adjust endpoint", counterAdjust.status === 403, `${counterAdjust.status}: ${JSON.stringify(counterAdjust.body)}`);
  });

  // ---------------------------------------------------------------------
  // Audit — sensitive action with the right actor and branch; branch
  // filtering excludes other branches; branchless historical rows are
  // visible only unfiltered.
  // ---------------------------------------------------------------------
  await ctx.scenario("platform / audit — actor, branch, and the branch filter", async () => {
    const whMain = await req("POST", "/webhooks", { name: "SCN-audit-branch-main", targetUrl: "http://127.0.0.1:39298/a", events: ["SALES_INVOICE_VOIDED"] }, branchScoped("BR-MAIN"));
    check("register webhook A scoped to BR-MAIN", whMain.status === 201, whMain.status);

    const whOther = await req("POST", "/webhooks", { name: "SCN-audit-branch-other", targetUrl: "http://127.0.0.1:39298/b", events: ["SALES_INVOICE_VOIDED"] }, branchScoped("SCN-BR-OTHER"));
    check("register webhook B scoped to SCN-BR-OTHER", whOther.status === 201, whOther.status);

    const whUnscoped = await req("POST", "/webhooks", { name: "SCN-audit-branchless", targetUrl: "http://127.0.0.1:39298/c", events: ["SALES_INVOICE_VOIDED"] }, {});
    check("register webhook C with no branch scope (ALL_SCOPE → branchId null)", whUnscoped.status === 201, whUnscoped.status);

    const filteredMain = await req("GET", "/audit?module=webhooks&action=REGISTERED&branchId=BR-MAIN", undefined, {});
    const namesMain = filteredMain.body.events.map((e: any) => e.details?.name);
    check("branch filter BR-MAIN includes A", namesMain.includes("SCN-audit-branch-main"), namesMain.join(","));
    check("the right actor is recorded on A's row", filteredMain.body.events.find((e: any) => e.details?.name === "SCN-audit-branch-main")?.actor === "USER-ADMIN", JSON.stringify(filteredMain.body.events[0]));
    check("the right branch is recorded on A's row", filteredMain.body.events.find((e: any) => e.details?.name === "SCN-audit-branch-main")?.branchId === "BR-MAIN", JSON.stringify(filteredMain.body.events[0]));
    check("branch filter BR-MAIN excludes B (a different branch)", !namesMain.includes("SCN-audit-branch-other"), namesMain.join(","));
    check("branch filter BR-MAIN excludes C (no branch at all)", !namesMain.includes("SCN-audit-branchless"), namesMain.join(","));

    const filteredOther = await req("GET", "/audit?module=webhooks&action=REGISTERED&branchId=SCN-BR-OTHER", undefined, {});
    const namesOther = filteredOther.body.events.map((e: any) => e.details?.name);
    check("branch filter SCN-BR-OTHER includes only B", namesOther.includes("SCN-audit-branch-other") && !namesOther.includes("SCN-audit-branch-main") && !namesOther.includes("SCN-audit-branchless"), namesOther.join(","));

    const unfiltered = await req("GET", "/audit?module=webhooks&action=REGISTERED", undefined, {});
    const namesUnfiltered = unfiltered.body.events.map((e: any) => e.details?.name);
    check("unfiltered view includes the branchless row C", namesUnfiltered.includes("SCN-audit-branchless"), namesUnfiltered.join(","));
    check("unfiltered view also includes A and B", namesUnfiltered.includes("SCN-audit-branch-main") && namesUnfiltered.includes("SCN-audit-branch-other"), namesUnfiltered.join(","));

    const anyBranchFilter = await req("GET", "/audit?module=webhooks&action=REGISTERED&branchId=BR-MAIN", undefined, {});
    check("a branchless historical row never appears under ANY specific-branch filter", !anyBranchFilter.body.events.some((e: any) => e.branchId === null), JSON.stringify(anyBranchFilter.body.events.map((e: any) => e.branchId)));
  });

  // ---------------------------------------------------------------------
  // D16 — the data-migration commit gate is all-or-nothing per file, and
  // rows equivalent to the shipped employees.xlsx fixture (a required
  // column blank on every row) reject even the otherwise-valid ones.
  // ---------------------------------------------------------------------
  await ctx.scenario("platform / data migration — all-or-nothing commit gate (D16)", async () => {
    const deptRows = [
      { code: "SCN-SALES", nameAr: "المبيعات" },
      { code: "SCN-FIN", nameAr: "المالية" },
      { code: "SCN-SALES", nameAr: "مبيعات مكررة" },
    ];
    const preview = await req("POST", "/data-migration/departments/preview", { rows: deptRows }, {});
    check("preview reports 2 valid rows out of 3", preview.body?.validCount === 2 && preview.body?.errors?.length === 1, JSON.stringify(preview.body));

    const commitWithErrors = await req("POST", "/data-migration/departments/commit", { rows: deptRows }, {});
    check("the commit gate is all-or-nothing — 2 clean rows cannot commit while 1 row in the same file errors", commitWithErrors.status === 200 && commitWithErrors.body?.createdIds === undefined && commitWithErrors.body?.errors?.length === 1, JSON.stringify(commitWithErrors.body));

    const cleanRows = deptRows.slice(0, 2);
    const commitClean = await req("POST", "/data-migration/departments/commit", { rows: cleanRows }, {});
    check("removing the bad row lets the clean rows commit", commitClean.status === 201 && commitClean.body?.createdIds?.length === 2, JSON.stringify(commitClean.body));

    const employeeRows = [
      { code: "SCN-E-101", nameAr: "موظف واحد", departmentCode: "SCN-SALES", hireDate: "" },
      { code: "SCN-E-102", nameAr: "موظف اثنان", departmentCode: "SCN-FIN", hireDate: "" },
      { code: "SCN-E-103", nameAr: "موظف ثلاثة", departmentCode: "SCN-NOPE", hireDate: "" },
    ];
    const empPreview = await req("POST", "/data-migration/employees/preview", { rows: employeeRows }, {});
    check("D16 — a required column blank on every row rejects ALL rows, not a 2-of-3 partial success", empPreview.body?.validCount === 0 && empPreview.body?.errors?.length === 3, JSON.stringify(empPreview.body));
    const thirdRowReasons: string[] = empPreview.body?.errors?.find((e: any) => e.rowNumber === 3)?.reasons ?? [];
    check("D16 — the third row carries BOTH the hire-date and unknown-department reasons", thirdRowReasons.some((r) => r.includes("تاريخ التعيين")) && thirdRowReasons.some((r) => r.includes("SCN-NOPE")), JSON.stringify(thirdRowReasons));
  });

  // ---------------------------------------------------------------------
  // Light seed-sanity coverage.
  // ---------------------------------------------------------------------
  await ctx.scenario("platform / seed sanity", async () => {
    const apiKeys = await req("GET", "/api-keys", undefined, {});
    check("3 seeded API keys, 1 revoked", rows(apiKeys.body).length === 3 && rows(apiKeys.body).filter((k: any) => k.revokedAt).length === 1, JSON.stringify(rows(apiKeys.body).map((k: any) => ({ name: k.name, revoked: !!k.revokedAt }))));

    const notificationRules = await req("GET", "/notification-rules", undefined, {});
    check("4 seeded notification rules, 1 inactive", rows(notificationRules.body).length === 4 && rows(notificationRules.body).filter((r: any) => !r.active).length === 1, JSON.stringify(rows(notificationRules.body).map((r: any) => ({ id: r.id, active: r.active }))));

    const workflowConfigs = await req("GET", "/workflow/configs", undefined, {});
    const seededConfigCount = rows(workflowConfigs.body).filter((c: any) => c.actionType === "SALES_INVOICE_CONFIRM" || c.actionType === "PURCHASE_INVOICE_CONFIRM").length;
    check("2 seeded workflow configs (SALES/PURCHASE invoice confirm)", seededConfigCount === 2, seededConfigCount);
  });

  // ---------------------------------------------------------------------
  // Teardown — every later module runs against this same tenant, so the
  // scenario-only approval chain must not outlive this file: it silently held
  // the sales module's own returns بانتظار الموافقة and hid what they assert.
  // ---------------------------------------------------------------------
  await ctx.scenario("platform / teardown — remove the scenario-only approval chain", async () => {
    const del = await req("DELETE", `/workflow/configs/${scnReturnConfigId}`, undefined, {});
    check("scenario SALES_RETURN_CONFIRM config deleted", del.status === 204, `${del.status}: ${JSON.stringify(del.body)}`);
    const configs = await req("GET", "/workflow/configs", undefined, {});
    check("no SALES_RETURN_CONFIRM chain is left behind", !rows(configs.body).some((c: any) => c.actionType === "SALES_RETURN_CONFIRM"), JSON.stringify(rows(configs.body).map((c: any) => c.actionType)));
  });
}
