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
  // D5 — confirming a sales invoice queues it for the ETA.
  // ---------------------------------------------------------------------
  await ctx.scenario("platform / D5 — a confirmed sales invoice reaches the ETA queue", async () => {
    const submissions = await req("GET", "/eta/submissions", undefined, {});
    const queued = rows(submissions.body);
    check("D5 — /eta/submissions has rows: a confirmed invoice now produces one", submissions.status === 200 && queued.length > 0, `${submissions.status}: ${queued.length} rows`);

    const confirmed = rows((await req("GET", "/sales-invoices", undefined, {})).body).filter(
      (i: any) => i.status !== "draft" && i.status !== "pending" && i.status !== "cancelled",
    );
    check("D5 — every live sales invoice is queued exactly once", queued.length === confirmed.length, `queued=${queued.length} live invoices=${confirmed.length}`);
    check("D5 — a queued submission starts جاهز", queued.every((s: any) => s.status === "ready"), JSON.stringify(queued.map((s: any) => s.status)));
    check("D5 — the queue keys each row by the invoice's own document number", queued.every((s: any) => confirmed.some((i: any) => (i.docNo ?? i.id) === s.internalId)), JSON.stringify(queued.map((s: any) => s.internalId)));
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
  await settingsPoliciesAreLive(ctx);

  await ctx.scenario("platform / teardown — remove the scenario-only approval chain", async () => {
    const del = await req("DELETE", `/workflow/configs/${scnReturnConfigId}`, undefined, {});
    check("scenario SALES_RETURN_CONFIRM config deleted", del.status === 204, `${del.status}: ${JSON.stringify(del.body)}`);
    const configs = await req("GET", "/workflow/configs", undefined, {});
    check("no SALES_RETURN_CONFIRM chain is left behind", !rows(configs.body).some((c: any) => c.actionType === "SALES_RETURN_CONFIRM"), JSON.stringify(rows(configs.body).map((c: any) => c.actionType)));
  });
}

/**
 * R11.2 — the سياسة المخزون switches govern behaviour, not just their own row
 * in the settings table. Each check below flips one switch through the same
 * PUT /settings the screen calls and then drives the document the switch
 * claims to govern. Every position this touches is returned to where it
 * started, because every later module runs against this same tenant.
 */
async function settingsPoliciesAreLive(ctx: Ctx): Promise<void> {
  const { req, check, checkEq, scenario } = ctx;

  const ITEM = "SCN-SET-STOCK";
  const WAREHOUSE = "WH-MAIN";

  async function settings() {
    return (await req("GET", "/settings")).body;
  }
  async function setPolicy(patch: Record<string, unknown>) {
    return req("PUT", "/settings", { ...(await settings()), ...patch });
  }
  async function adjust(id: string, direction: "IN" | "OUT", qty: string, unitCost?: string) {
    await req("POST", "/inventory/stock-adjustments/draft", {
      id,
      date: "2026-08-24",
      lines: [{ itemId: ITEM, warehouseId: WAREHOUSE, reason: "OTHER", direction, qty, ...(unitCost ? { unitCost } : {}) }],
    });
    return req("POST", `/inventory/stock-adjustments/${id}/confirm`, {});
  }
  async function onHand(): Promise<number> {
    const res = await req("GET", `/inventory/balance?itemId=${ITEM}&warehouseId=${WAREHOUSE}`);
    return ctx.n(res.body?.onHand);
  }

  await scenario("settings / سياسة المخزون — السماح بالمخزون السالب is read by the stock ledger, not just stored", async () => {
    const created = await req("POST", "/items", {
      id: ITEM,
      code: "SCN-SET-STOCK",
      nameAr: "صنف اختبار سياسة المخزون",
      type: "stock",
      baseUnitCode: "PCS",
      trackInventory: true,
      revenueAccountId: "4100",
      cogsAccountId: "5100",
      inventoryAccountId: "1200",
    });
    check("policy-test item created", created.status === 201, `${created.status}: ${JSON.stringify(created.body).slice(0, 160)}`);
    const opened = await adjust("SCN-SET-ADJ-IN", "IN", "10", "100");
    check("10 units opened at 100 each", opened.status === 200, JSON.stringify(opened.body).slice(0, 160));

    const off = await settings();
    check("السماح بالمخزون السالب is off to begin with", off?.allowNegativeStock === false, JSON.stringify(off?.allowNegativeStock));
    const refused = await adjust("SCN-SET-ADJ-OVER-1", "OUT", "15");
    check("issuing 15 of 10 is refused while the switch is off", refused.status !== 200, `status ${refused.status}`);
    checkEq("and the position is untouched by the refused attempt", await onHand(), 10);

    const on = await setPolicy({ allowNegativeStock: true });
    check("the switch turns on and persists", on.status === 200 && on.body?.allowNegativeStock === true, `status ${on.status}`);
    const allowed = await adjust("SCN-SET-ADJ-OVER-2", "OUT", "15");
    check("the SAME issue now posts — the ledger read the live setting", allowed.status === 200, JSON.stringify(allowed.body).slice(0, 200));
    checkEq("the position is genuinely negative, not silently clamped to zero", await onHand(), -5);

    const restored = await adjust("SCN-SET-ADJ-BACK", "IN", "5", "100");
    check("the position is brought back to zero", restored.status === 200, JSON.stringify(restored.body).slice(0, 160));
    checkEq("on-hand is back to zero for every later module", await onHand(), 0);
    const back = await setPolicy({ allowNegativeStock: false });
    check("the switch is restored to off", back.status === 200 && back.body?.allowNegativeStock === false, `status ${back.status}`);
  });

  await scenario("settings / سياسة المخزون — السماح بالطلبات المؤجلة licenses a SALE only, never an adjustment", async () => {
    const on = await setPolicy({ allowBackorder: true, allowNegativeStock: false });
    check("back-orders on, negative stock still off", on.status === 200 && on.body?.allowBackorder === true && on.body?.allowNegativeStock === false, `status ${on.status}`);

    const refused = await adjust("SCN-SET-ADJ-BO", "OUT", "3");
    check("a stock adjustment is STILL refused — a back-order is not a licence to write stock off", refused.status !== 200, `status ${refused.status}`);
    checkEq("and the position stays at zero", await onHand(), 0);

    const invoice = await req("POST", "/sales-invoices", {
      id: "SCN-SET-INV-BO",
      date: "2026-08-24",
      dueDate: "2026-09-23",
      customerId: "CUST-DEMO-1",
      customerNameAr: "شركة الأمل للتجارة",
      warehouseId: WAREHOUSE,
      branchId: "BR-MAIN",
      currency: "EGP",
      arAccountId: "1105",
      taxAccountId: "2200",
      lines: [
        {
          lineId: "SCN-SET-INV-BO-L1",
          itemId: ITEM,
          itemNameAr: "صنف اختبار سياسة المخزون",
          isStock: true,
          qty: "3",
          unitPrice: "150",
          taxRatePercent: 14,
          revenueAccountId: "4100",
          cogsAccountId: "5100",
          inventoryAccountId: "1200",
        },
      ],
    });
    check("a sale of 3 against an empty position drafts", invoice.status === 201, JSON.stringify(invoice.body).slice(0, 200));
    const confirmed = await req("POST", "/sales-invoices/SCN-SET-INV-BO/confirm", {});
    check("and CONFIRMS, because a back-order is exactly what the tenant asked for", confirmed.status === 200 && confirmed.body?.status === "confirmed", JSON.stringify(confirmed.body).slice(0, 200));
    checkEq("the shortfall is recorded as a negative position, not hidden", await onHand(), -3);

    const restored = await adjust("SCN-SET-ADJ-BO-BACK", "IN", "3", "0");
    check("goods arrive and clear the back-order", restored.status === 200, JSON.stringify(restored.body).slice(0, 160));
    checkEq("the position is level again", await onHand(), 0);

    const back = await setPolicy({ allowBackorder: false });
    check("back-orders restored to off", back.status === 200 && back.body?.allowBackorder === false, `status ${back.status}`);
    const refusedAgain = await req("POST", "/sales-invoices", {
      id: "SCN-SET-INV-BO-2",
      date: "2026-08-24",
      dueDate: "2026-09-23",
      customerId: "CUST-DEMO-1",
      customerNameAr: "شركة الأمل للتجارة",
      warehouseId: WAREHOUSE,
      branchId: "BR-MAIN",
      currency: "EGP",
      arAccountId: "1105",
      taxAccountId: "2200",
      lines: [
        {
          lineId: "SCN-SET-INV-BO-2-L1",
          itemId: ITEM,
          itemNameAr: "صنف اختبار سياسة المخزون",
          isStock: true,
          qty: "3",
          unitPrice: "150",
          taxRatePercent: 14,
          revenueAccountId: "4100",
          cogsAccountId: "5100",
          inventoryAccountId: "1200",
        },
      ],
    });
    const stillRefused = await req("POST", "/sales-invoices/SCN-SET-INV-BO-2/confirm", {});
    check("with the switch off the same sale is refused again", refusedAgain.status === 201 && stillRefused.status !== 200, `draft ${refusedAgain.status} confirm ${stillRefused.status}`);
    checkEq("and the position is still level", await onHand(), 0);
  });

  await scenario("settings / سياسة المخزون — مخصص هبوط المخزون الراكد drives the write-down batch's own bands", async () => {
    const seeded = await settings();
    const off = await setPolicy({ agingWritedownEnabled: false });
    check("the provision can be switched off", off.status === 200 && off.body?.agingWritedownEnabled === false, `status ${off.status}`);
    const disabled = await req("POST", "/inventory/writedown-runs", { period: "2026-07" });
    check("the batch refuses to run while the provision is switched off", disabled.status === 422 && disabled.body?.error === "AGING_WRITEDOWN_DISABLED", `${disabled.status}: ${JSON.stringify(disabled.body).slice(0, 160)}`);

    const on = await setPolicy({ agingWritedownEnabled: true, agingWritedownMonths: 1, agingWritedownRatePercent: 12.5 });
    check("the provision is switched on at 12.5% after 1 idle month", on.status === 200 && on.body?.agingWritedownRatePercent === 12.5, `status ${on.status}`);

    const run = await req("POST", "/inventory/writedown-runs", { period: "2026-07" });
    check("the batch now produces a draft run", run.status === 201, `${run.status}: ${JSON.stringify(run.body).slice(0, 200)}`);
    const rates = (run.body?.lines ?? []).map((l: any) => l.writedownRateBps);
    check(
      "and every line carries the TENANT's 1,250 bps, not the shipped 1,000/2,500/5,000 bands",
      rates.length > 0 && rates.every((r: number) => r === 1_250),
      JSON.stringify(rates.slice(0, 8)),
    );

    const restore = await setPolicy({
      agingWritedownEnabled: seeded?.agingWritedownEnabled,
      agingWritedownMonths: seeded?.agingWritedownMonths,
      agingWritedownRatePercent: seeded?.agingWritedownRatePercent,
    });
    check("the tenant's own provision settings are put back", restore.status === 200 && restore.body?.agingWritedownRatePercent === seeded?.agingWritedownRatePercent, `status ${restore.status}`);
  });

  await scenario("settings / سياسة المخزون — توليد أرقام الدفعات تلقائيًا stamps a batch a receiver left blank", async () => {
    const batchItem = "SCN-SET-BATCH";
    const created = await req("POST", "/items", {
      id: batchItem,
      code: "SCN-SET-BATCH",
      nameAr: "صنف اختبار الدفعات",
      type: "stock",
      baseUnitCode: "PCS",
      trackInventory: true,
      trackBatches: true,
      revenueAccountId: "4100",
      cogsAccountId: "5100",
      inventoryAccountId: "1200",
    });
    check("a batch-tracked item exists", created.status === 201, `${created.status}: ${JSON.stringify(created.body).slice(0, 160)}`);
    check("and it really tracks batches", created.body?.trackBatches === true, JSON.stringify(created.body?.trackBatches));

    const line = { itemId: batchItem, qty: "4", unitCost: "50" };
    const blank = await req("POST", "/purchases/receipts", {
      id: "SCN-SET-GRN-1",
      date: "2026-08-24",
      supplierId: "SUPP-DEMO-1",
      warehouseId: WAREHOUSE,
      lines: [line],
    });
    check("a receipt with no batch entered is accepted while the switch is off", blank.status === 201, `${blank.status}: ${JSON.stringify(blank.body).slice(0, 200)}`);
    check("and its batch stays blank — nothing was invented", blank.body?.lines?.[0]?.batchNo === null, JSON.stringify(blank.body?.lines?.[0]?.batchNo));

    const on = await setPolicy({ autoGenerateBatchNumbers: true });
    check("auto batch numbers switched on", on.status === 200 && on.body?.autoGenerateBatchNumbers === true, `status ${on.status}`);

    const stamped = await req("POST", "/purchases/receipts", {
      id: "SCN-SET-GRN-2",
      date: "2026-08-24",
      supplierId: "SUPP-DEMO-1",
      warehouseId: WAREHOUSE,
      lines: [line],
    });
    check("the next receipt drafts", stamped.status === 201, `${stamped.status}: ${JSON.stringify(stamped.body).slice(0, 200)}`);
    const batchNo = stamped.body?.lines?.[0]?.batchNo;
    check("and its blank batch was stamped from the receipt's own number", typeof batchNo === "string" && batchNo === `${stamped.body?.number}-01`, JSON.stringify(batchNo));

    const back = await setPolicy({ autoGenerateBatchNumbers: false });
    check("auto batch numbers restored to off", back.status === 200 && back.body?.autoGenerateBatchNumbers === false, `status ${back.status}`);
  });
}
