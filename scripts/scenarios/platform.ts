import type { Ctx } from "./harness.js";
/**
 * The seed's PIN, imported rather than typed out. It was hardcoded as "1234"
 * here while the seed moved to six digits and the wire contract began
 * requiring `/^\d{6}$/`, so every sign-in in this file 400'd on validation and
 * took the whole authentication section down with it.
 */
import { SEED_ADMIN_PIN } from "../../packages/backend/src/seed.js";

/**
 * Executable checks for the Settings / Platform Administration module — see
 * docs/TESTING.md §11.
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
  const { req, rows, check, checkEq } = ctx;

  // ---------------------------------------------------------------------
  // The identity a request carries is the SERVER's, not the caller's.
  // Every route used to fall back to a resolver that read `x-permissions`
  // off the request, so a client declared its own authority — and the LAN
  // mount binds 0.0.0.0, which put that on the shop wifi.
  // ---------------------------------------------------------------------
  await ctx.scenario("a request cannot declare its own permissions", async () => {
    const forged = await ctx.app.fetch(
      new Request("http://scenario/settings", { headers: { "x-permissions": "*", "x-user-id": "attacker" } }),
    );
    check("declaring x-permissions: * is refused", forged.status === 401, `status ${forged.status}`);

    const bare = await ctx.app.fetch(new Request("http://scenario/settings"));
    check("and so is no credential at all", bare.status === 401, `status ${bare.status}`);

    const forgedToken = await ctx.app.fetch(
      new Request("http://scenario/settings", { headers: { authorization: `Bearer ${"A".repeat(43)}` } }),
    );
    // 401, not 403. A caller the server cannot identify has to be told apart
    // from a signed-in one meeting a permission they do not hold — the client's
    // only correct answer to the first is "sign in again", and it cannot know
    // that from a 403. Collapsing the two made an expired session render an
    // empty list, which reads as data.
    check("a token that was never issued is refused as UNAUTHENTICATED", forgedToken.status === 401, `status ${forgedToken.status}`);
    const forgedBody = (await forgedToken.json()) as { error?: string };
    check("and says so by name, so the client can act on it", forgedBody.error === "SESSION_EXPIRED", JSON.stringify(forgedBody));

    const login = await ctx.app.fetch(
      new Request("http://scenario/auth/login", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ username: "admin@cyag.example", pin: SEED_ADMIN_PIN }),
      }),
    );
    check("a real sign-in succeeds", login.status === 200, `status ${login.status}`);
    const session = (await login.json()) as { token?: string };
    check("and returns an opaque token", typeof session.token === "string" && session.token.length > 30, String(session.token).slice(0, 12));

    const allowed = await ctx.app.fetch(
      new Request("http://scenario/settings", { headers: { authorization: `Bearer ${session.token}` } }),
    );
    check("which does open the route", allowed.status === 200, `status ${allowed.status}`);

    await ctx.app.fetch(
      new Request("http://scenario/auth/logout", { method: "POST", headers: { authorization: `Bearer ${session.token}` } }),
    );
    const afterLogout = await ctx.app.fetch(
      new Request("http://scenario/settings", { headers: { authorization: `Bearer ${session.token}` } }),
    );
    check("and stops opening it after sign-out", afterLogout.status === 401, `status ${afterLogout.status}`);
  });

  // ---------------------------------------------------------------------
  // The login name is an identifier, not a label
  // ---------------------------------------------------------------------
  await ctx.scenario("sign-in matches the email, never the display name — and a domain policy gates who may have an account", async () => {
    const attempt = async (username: string) => {
      const res = await ctx.app.fetch(
        new Request("http://scenario/auth/login", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ username, pin: SEED_ADMIN_PIN }),
        }),
      );
      return res.status;
    };

    check("the email opens the door", (await attempt("admin@cyag.example")) === 200, String(await attempt("admin@cyag.example")));
    check("in any case the operator types it", (await attempt("ADMIN@Cyag.Example")) === 200, String(await attempt("ADMIN@Cyag.Example")));

    // The defect: login used to match `fullName`, so "who can sign in" was a
    // property of a field any admin may edit, and two people who share a
    // display name shared the account door.
    check("the DISPLAY NAME does not — it is neither unique nor stable", (await attempt("محمد الشهابي")) === 401, String(await attempt("محمد الشهابي")));
    check("nor does a bare name that is not an address", (await attempt("admin")) === 401, String(await attempt("admin")));

    // --- the allowed-domain policy -------------------------------------
    const newUser = (email: string, id: string) => ({
      nameAr: "مستخدم نطاق", nameEn: null,
      email,
      phone: null,
      roleId: null,
      isCompanyAdmin: true,
      employeeId: null,
      branchScope: "*",
      warehouseScope: "*",
      status: "active",
      password: "SCN-password-1",
      id,
    });

    const seeded = await req("GET", "/settings");
    check(
      "the seeded tenant names the domain its own people are at",
      (seeded.body?.allowedEmailDomains ?? []).includes("cyag.example"),
      JSON.stringify(seeded.body?.allowedEmailDomains),
    );

    // Both states are set explicitly rather than inherited from the seed: an
    // assertion that only holds while the seeder happens to leave a field
    // alone stops testing the product the moment the seeder changes.
    await req("PUT", "/settings", { ...seeded.body, allowedEmailDomains: [] });
    const anyDomain = await req("POST", "/users", newUser("free@anywhere.example", "SCN-U-DOMAIN-0"));
    check("an EMPTY list restricts nothing — a rollout is not blocked by a rule nobody configured", anyDomain.status === 201, `${anyDomain.status}: ${JSON.stringify(anyDomain.body)}`);

    const setPolicy = await req("PUT", "/settings", { ...seeded.body, allowedEmailDomains: ["cyag.example", "mezan.com"] });
    check("the tenant names the domains it allows", setPolicy.status === 200, `${setPolicy.status}: ${JSON.stringify(setPolicy.body).slice(0, 200)}`);

    const outside = await req("POST", "/users", newUser("someone@gmail.com", "SCN-U-DOMAIN-1"));
    check(
      "an address outside them is refused, and the refusal names the domains that would work",
      outside.status === 422 && outside.body?.error === "EMAIL_DOMAIN_NOT_ALLOWED" && String(outside.body?.message).includes("mezan.com"),
      `${outside.status}: ${JSON.stringify(outside.body)}`,
    );

    const inside = await req("POST", "/users", newUser("Ops@Mezan.COM", "SCN-U-DOMAIN-2"));
    check("one inside them is accepted", inside.status === 201, `${inside.status}: ${JSON.stringify(inside.body)}`);
    check(
      "and is stored normalised, so no case variant can become a second account",
      inside.body?.email === "ops@mezan.com",
      String(inside.body?.email),
    );

    // Restore what the seed configured, so later scenarios see the tenant as
    // the seeder left it rather than as this one reshaped it.
    await req("PUT", "/settings", seeded.body);
  });

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
      nameAr: "SCN Submitter", nameEn: null, email: "scn-submitter@cyag.example", phone: null,
      roleId: approverRoleId, isCompanyAdmin: false, employeeId: null,
      branchScope: "*", warehouseScope: "*", status: "active", password: "SCN-password-1",
    });
    check("create SCN submitter user", submitter.status === 201, `${submitter.status}: ${JSON.stringify(submitter.body)}`);
    submitterUserId = submitter.body?.id ?? "";

    const approver = await req("POST", "/users", {
      nameAr: "SCN Approver", nameEn: null, email: "scn-approver@cyag.example", phone: null,
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

    const auditList = await req("GET", "/audit", undefined, noPerm);
    check("GET /audit refused without audit.logs.view", auditList.status === 403, `${auditList.status}: ${JSON.stringify(auditList.body)}`);

    const sequencesEdit = await req("PATCH", "/sequences/BOM", { prefix: "SCN-BOM-" }, nonAdmin("SCN-USER-SEQVIEWER", "admin.sequences.view", "SCN_NONE"));
    check("PATCH /sequences/:code refused with view-only admin.sequences.view", sequencesEdit.status === 403, `${sequencesEdit.status}: ${JSON.stringify(sequencesEdit.body)}`);

    const decideNoPerm = await req("POST", `/workflow/requests/${approveOutcome!.workflowRequestId}/decide`, { decision: "approve" }, nonAdmin("SCN-USER-NOWORKFLOW", "", "SCN_NONE"));
    check("POST /workflow/requests/:id/decide refused without workflow.view", decideNoPerm.status === 403, `${decideNoPerm.status}: ${JSON.stringify(decideNoPerm.body)}`);
  });

  // ---------------------------------------------------------------------
  // Webhooks — REMOVED with the mount (DEC-17, packages/api/src/app.ts). The
  // dispatcher, its HMAC signing and its bounded retries are still covered by
  // @mezan/api's own route tests; what no longer exists is a way for a user of
  // this product to register a target for them.
  // ---------------------------------------------------------------------
  // ---------------------------------------------------------------------
  // Numbering sequences — a prefix change affects the next document only,
  // never renumbers history.
  // ---------------------------------------------------------------------
  await ctx.scenario("platform / numbering sequences — prefix change affects next document only", async () => {
    const before = await req("GET", "/sequences/SALES_INVOICE", undefined, {});
    const currentValue = before.body.currentValue;
    // Read the existing document's number BEFORE the prefix moves. Pinning the
    // literal "INV-000001" only held while this invoice happened to be the
    // first ever numbered; what the scenario actually claims is that the
    // number does not move, whatever it is.
    const docNoBefore = (await req("GET", "/sales-invoices/INV-DEMO-1", undefined, {})).body?.docNo;
    check("the existing invoice has a number to preserve", typeof docNoBefore === "string" && docNoBefore.length > 0, String(docNoBefore));

    const patch = await req("PATCH", "/sequences/SALES_INVOICE", { prefix: "SCN-SI-" }, {});
    check("prefix change accepted", patch.status === 200 && patch.body?.prefix === "SCN-SI-", `${patch.status}: ${JSON.stringify(patch.body)}`);
    check("the counter itself is untouched by a prefix change", patch.body?.currentValue === currentValue, `${patch.body?.currentValue} vs ${currentValue}`);
    check("the preview recomputes against the SAME counter value under the new prefix", patch.body?.nextNumber === `SCN-SI-${String(currentValue + 1).padStart(patch.body?.padLength ?? 6, "0")}`, patch.body?.nextNumber);

    const oldInvoice = await req("GET", "/sales-invoices/INV-DEMO-1", undefined, {});
    check("an existing confirmed invoice's docNo is unchanged by the prefix change", oldInvoice.body?.docNo === docNoBefore, `${oldInvoice.body?.docNo} was ${docNoBefore}`);

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
    // Notification rules, not webhooks: the webhook mount is gone (DEC-17) and
    // this scenario is about the AUDIT row's actor/branch, not about what wrote
    // it. Rule creation is audited through the same `recordSensitiveEvent`.
    async function rule(id: string, name: string, headers: Record<string, string>) {
      return req("POST", "/notification-rules", {
        id, name, eventCode: "SALES_INVOICE_VOIDED", recipientType: "permission",
        recipientValue: "sales.invoice.view", priority: "normal", channels: ["in_app"],
        titleAr: null, bodyAr: null, active: true,
      }, headers);
    }

    const whMain = await rule("SCN-AUD-A", "SCN-audit-branch-main", branchScoped("BR-MAIN"));
    check("register rule A scoped to BR-MAIN", whMain.status === 201, `${whMain.status}: ${JSON.stringify(whMain.body)}`);

    const whOther = await rule("SCN-AUD-B", "SCN-audit-branch-other", branchScoped("SCN-BR-OTHER"));
    check("register rule B scoped to SCN-BR-OTHER", whOther.status === 201, `${whOther.status}: ${JSON.stringify(whOther.body)}`);

    const whUnscoped = await rule("SCN-AUD-C", "SCN-audit-branchless", {});
    check("register rule C with no branch scope (ALL_SCOPE → branchId null)", whUnscoped.status === 201, `${whUnscoped.status}: ${JSON.stringify(whUnscoped.body)}`);

    const q = "module=notification-rules&action=CREATE";
    const filteredMain = await req("GET", `/audit?${q}&branchId=BR-MAIN`, undefined, {});
    const namesMain = filteredMain.body.events.map((e: any) => e.details?.name);
    check("branch filter BR-MAIN includes A", namesMain.includes("SCN-audit-branch-main"), namesMain.join(","));
    check("the right actor is recorded on A's row", filteredMain.body.events.find((e: any) => e.details?.name === "SCN-audit-branch-main")?.actor === "USER-ADMIN", JSON.stringify(filteredMain.body.events[0]));
    check("the right branch is recorded on A's row", filteredMain.body.events.find((e: any) => e.details?.name === "SCN-audit-branch-main")?.branchId === "BR-MAIN", JSON.stringify(filteredMain.body.events[0]));
    check("branch filter BR-MAIN excludes B (a different branch)", !namesMain.includes("SCN-audit-branch-other"), namesMain.join(","));
    check("branch filter BR-MAIN excludes C (no branch at all)", !namesMain.includes("SCN-audit-branchless"), namesMain.join(","));

    const filteredOther = await req("GET", `/audit?${q}&branchId=SCN-BR-OTHER`, undefined, {});
    const namesOther = filteredOther.body.events.map((e: any) => e.details?.name);
    check("branch filter SCN-BR-OTHER includes only B", namesOther.includes("SCN-audit-branch-other") && !namesOther.includes("SCN-audit-branch-main") && !namesOther.includes("SCN-audit-branchless"), namesOther.join(","));

    const unfiltered = await req("GET", `/audit?${q}`, undefined, {});
    const namesUnfiltered = unfiltered.body.events.map((e: any) => e.details?.name);
    check("unfiltered view includes the branchless row C", namesUnfiltered.includes("SCN-audit-branchless"), namesUnfiltered.join(","));
    check("unfiltered view also includes A and B", namesUnfiltered.includes("SCN-audit-branch-main") && namesUnfiltered.includes("SCN-audit-branch-other"), namesUnfiltered.join(","));

    const anyBranchFilter = await req("GET", `/audit?${q}&branchId=BR-MAIN`, undefined, {});
    check("a branchless historical row never appears under ANY specific-branch filter", !anyBranchFilter.body.events.some((e: any) => e.branchId === null), JSON.stringify(anyBranchFilter.body.events.map((e: any) => e.branchId)));
  });

  // ---------------------------------------------------------------------
  // The audit trail is hash-chained (audit S-3): `/audit/verify` walks it.
  // ---------------------------------------------------------------------
  await ctx.scenario("platform / audit — the chain verifies on an untouched trail", async () => {
    const verified = await req("GET", "/audit/verify", undefined, {});
    check("GET /audit/verify answers 200", verified.status === 200, `${verified.status}: ${JSON.stringify(verified.body)}`);
    check("the seeded trail verifies intact", verified.body?.ok === true, JSON.stringify(verified.body));
    check("every chained row was actually walked", (verified.body?.checked ?? 0) > 0, JSON.stringify(verified.body));

    const refused = await req("GET", "/audit/verify", undefined, nonAdmin("SCN-USER-NOAUDIT", "", "SCN_NONE"));
    check("GET /audit/verify refused without audit.logs.view", refused.status === 403, `${refused.status}: ${JSON.stringify(refused.body)}`);
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
    check("the API-key surface is unmounted (DEC-17)", apiKeys.status === 404, `${apiKeys.status}: ${JSON.stringify(apiKeys.body)}`);

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
  await taxSettingsAreLive(ctx);
  await generalSettingsAreLive(ctx);

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

  await scenario("settings / سياسة المخزون — السماح بالبيع من مستودع آخر sources a line the document's warehouse cannot cover", async () => {
    const original = await settings();
    const item = "SCN-SET-XW";
    const other = "WH-DEMO-2";
    const created = await req("POST", "/items", {
      id: item,
      code: "SCN-SET-XW",
      nameAr: "صنف اختبار البيع من مستودع آخر",
      type: "stock",
      baseUnitCode: "PCS",
      trackInventory: true,
      revenueAccountId: "4100",
      cogsAccountId: "5100",
      inventoryAccountId: "1200",
    });
    check("a stock item exists", created.status === 201, `${created.status}: ${JSON.stringify(created.body).slice(0, 160)}`);

    await req("POST", "/inventory/stock-adjustments/draft", {
      id: "SCN-SET-XW-ADJ",
      date: "2026-08-24",
      lines: [{ itemId: item, warehouseId: other, reason: "INITIAL_STOCK", direction: "IN", qty: "20", unitCost: "50" }],
    });
    const opened = await req("POST", "/inventory/stock-adjustments/SCN-SET-XW-ADJ/confirm", {});
    check("20 units are opened in the OTHER warehouse only", opened.status === 200, JSON.stringify(opened.body).slice(0, 160));

    async function onHandAt(wh: string): Promise<number> {
      return ctx.n((await req("GET", `/inventory/balance?itemId=${item}&warehouseId=${wh}`)).body?.onHand);
    }
    checkEq("the document's warehouse holds none of it", await onHandAt(WAREHOUSE), 0);

    function sell(id: string) {
      return req("POST", "/sales-invoices", {
        id,
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
            lineId: "L1",
            itemId: item,
            itemNameAr: "صنف اختبار البيع من مستودع آخر",
            isStock: true,
            qty: "5",
            unitPrice: "90",
            taxRatePercent: 14,
            revenueAccountId: "4100",
            cogsAccountId: "5100",
            inventoryAccountId: "1200",
          },
        ],
      });
    }

    const off = await setPolicy({ allowCrossWarehouseSales: false, allowNegativeStock: false, allowBackorder: false });
    check("selling from another warehouse is off", off.status === 200 && off.body?.allowCrossWarehouseSales === false, `status ${off.status}`);
    await sell("SCN-SET-XW-INV-1");
    const refused = await req("POST", "/sales-invoices/SCN-SET-XW-INV-1/confirm", {});
    check("the sale is refused — the named warehouse is empty and nothing licenses looking elsewhere", refused.status !== 200, `status ${refused.status} ${JSON.stringify(refused.body).slice(0, 200)}`);

    const on = await setPolicy({ allowCrossWarehouseSales: true });
    check("the tenant allows selling from another warehouse", on.status === 200 && on.body?.allowCrossWarehouseSales === true, `status ${on.status}`);
    const posted = await req("POST", "/sales-invoices/SCN-SET-XW-INV-1/confirm", {});
    check("the same sale now confirms", posted.status === 200 && posted.body?.status === "confirmed", `status ${posted.status} ${JSON.stringify(posted.body).slice(0, 200)}`);
    checkEq("the goods left the warehouse that actually had them", await onHandAt(other), 15);
    checkEq("and the empty warehouse was NOT driven negative behind the user's back", await onHandAt(WAREHOUSE), 0);

    const restore = await setPolicy({
      allowCrossWarehouseSales: original?.allowCrossWarehouseSales,
      allowNegativeStock: original?.allowNegativeStock,
      allowBackorder: original?.allowBackorder,
    });
    check(
      "the three switches are left exactly where the tenant had them",
      restore.status === 200 && restore.body?.allowCrossWarehouseSales === original?.allowCrossWarehouseSales,
      `status ${restore.status}`,
    );
  });

  await scenario("settings / سياسة المخزون — عرض المخزون في المستودعات الأخرى decides what a line's availability lookup may say", async () => {
    const path = "/inventory/availability?itemId=ITEM-DEMO-1&warehouseId=WH-MAIN";
    const on = await setPolicy({ showOtherWarehouseStock: true });
    check("the switch is on", on.status === 200 && on.body?.showOtherWarehouseStock === true, `status ${on.status}`);

    const withOthers = await req("GET", path);
    check("the availability lookup answers for the document's own warehouse", withOthers.status === 200 && withOthers.body?.warehouseId === WAREHOUSE, `${withOthers.status}: ${JSON.stringify(withOthers.body).slice(0, 200)}`);
    check("and says so is on", withOthers.body?.showOtherWarehouseStock === true, JSON.stringify(withOthers.body?.showOtherWarehouseStock));
    check(
      "and it really lists what the OTHER warehouses hold, with a real warehouse id on every row",
      (withOthers.body?.otherWarehouses ?? []).length > 0 &&
        (withOthers.body?.otherWarehouses ?? []).every((w: any) => typeof w.warehouseId === "string" && w.warehouseId !== WAREHOUSE),
      JSON.stringify(withOthers.body?.otherWarehouses),
    );

    const off = await setPolicy({ showOtherWarehouseStock: false });
    check("the switch is turned off", off.status === 200 && off.body?.showOtherWarehouseStock === false, `status ${off.status}`);
    const withoutOthers = await req("GET", path);
    check("the same lookup still reports this warehouse's own on-hand", withoutOthers.status === 200 && withoutOthers.body?.onHand === withOthers.body?.onHand, `${withoutOthers.status}: ${JSON.stringify(withoutOthers.body).slice(0, 200)}`);
    check("but says nothing at all about the other warehouses — the server withholds it, the screen never had to", (withoutOthers.body?.otherWarehouses ?? []).length === 0, JSON.stringify(withoutOthers.body?.otherWarehouses));

    const back = await setPolicy({ showOtherWarehouseStock: true });
    check("the switch is restored", back.status === 200 && back.body?.showOtherWarehouseStock === true, `status ${back.status}`);
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

/**
 * R11.5 — the الضريبة tab. VAT on/off, the default rate, tax-inclusive vs
 * tax-exclusive pricing and the depreciation basis all had no reader: tax was
 * computed as if it were always exclusive, a line with no rate carried none,
 * and depreciation was always day-prorated. Every check below only raises
 * DRAFTS, so nothing here touches the books.
 */
async function taxSettingsAreLive(ctx: Ctx): Promise<void> {
  const { req, check, checkEq, scenario } = ctx;

  async function settings() {
    return (await req("GET", "/settings")).body;
  }
  async function setTax(patch: Record<string, unknown>) {
    return req("PUT", "/settings", { ...(await settings()), ...patch });
  }
  async function draftInvoice(id: string, line: Record<string, unknown>) {
    return req("POST", "/sales-invoices", {
      id,
      date: "2026-08-24",
      dueDate: "2026-09-23",
      customerId: "CUST-DEMO-1",
      customerNameAr: "شركة الأمل للتجارة",
      warehouseId: "WH-MAIN",
      branchId: "BR-MAIN",
      currency: "EGP",
      arAccountId: "1105",
      taxAccountId: "2200",
      lines: [
        {
          lineId: `${id}-L1`,
          itemId: "ITEM-DEMO-1",
          itemNameAr: "صنف اختبار الضريبة",
          isStock: false,
          qty: "1",
          unitPrice: "100",
          revenueAccountId: "4100",
          ...line,
        },
      ],
    });
  }

  await scenario("settings / الضريبة — نسبة الضريبة الافتراضية is what a line with no rate of its own is raised at", async () => {
    const before = await settings();
    checkEq("the tenant's default rate is 14%", ctx.n(before?.defaultTaxRate), 14);

    const draft = await draftInvoice("SCN-SET-TAX-DEFAULT", {});
    check("a line that names no rate drafts", draft.status === 201, JSON.stringify(draft.body).slice(0, 200));
    checkEq("and is raised at the tenant's own default, not at zero", ctx.n(draft.body?.lines?.[0]?.taxRatePercent), 14);
    checkEq("so the invoice carries 14.00 of tax", ctx.n(draft.body?.totals?.taxTotal), 14);
    checkEq("and totals 114.00", ctx.n(draft.body?.totals?.grandTotal), 114);
    check("on a tax-exclusive basis", draft.body?.taxInclusive === false, JSON.stringify(draft.body?.taxInclusive));
  });

  await scenario("settings / الضريبة — الأسعار شاملة الضريبة makes the invoice total the price the customer was quoted", async () => {
    const inclusive = await setTax({ taxCalculation: "INCLUSIVE" });
    check("the tenant switches to inclusive pricing", inclusive.status === 200 && inclusive.body?.taxCalculation === "INCLUSIVE", `status ${inclusive.status}`);

    const draft = await draftInvoice("SCN-SET-TAX-INCLUSIVE", { taxRatePercent: 14 });
    check("the invoice drafts", draft.status === 201, JSON.stringify(draft.body).slice(0, 200));
    check("and it is stamped inclusive, so a later settings change cannot restate it", draft.body?.taxInclusive === true, JSON.stringify(draft.body?.taxInclusive));
    checkEq("the customer still pays exactly the 100.00 on the price tag", ctx.n(draft.body?.totals?.grandTotal), 100);
    checkEq("12.28 of it is the VAT already inside that price (100 × 14/114)", ctx.n(draft.body?.totals?.taxTotal), 12.28);
    checkEq("and 87.72 is the revenue the GL will see", ctx.n(draft.body?.totals?.taxableTotal), 87.72);
    checkEq("the two reconcile to the cent", ctx.n(draft.body?.totals?.taxableTotal) + ctx.n(draft.body?.totals?.taxTotal), 100);

    const exclusive = await setTax({ taxCalculation: "EXCLUSIVE" });
    check("the tenant switches back to exclusive pricing", exclusive.status === 200, `status ${exclusive.status}`);

    const reread = await req("GET", "/sales-invoices/SCN-SET-TAX-INCLUSIVE");
    check("the invoice raised under inclusive pricing is STILL inclusive after the switch", reread.body?.taxInclusive === true, JSON.stringify(reread.body?.taxInclusive));
    checkEq("and still totals 100.00 — a settings change never restates a document", ctx.n(reread.body?.totals?.grandTotal), 100);

    const after = await draftInvoice("SCN-SET-TAX-EXCLUSIVE-AGAIN", { taxRatePercent: 14 });
    check("while a NEW invoice is exclusive again", after.body?.taxInclusive === false, JSON.stringify(after.body?.taxInclusive));
    checkEq("and totals 114.00", ctx.n(after.body?.totals?.grandTotal), 114);
  });

  await scenario("settings / الضريبة — تفعيل ضريبة القيمة المضافة off raises every line at a zero rate", async () => {
    const off = await setTax({ taxEnabled: false });
    check("VAT is switched off", off.status === 200 && off.body?.taxEnabled === false, `status ${off.status}`);

    const draft = await draftInvoice("SCN-SET-TAX-DISABLED", { taxRatePercent: 14 });
    check("an invoice still drafts", draft.status === 201, JSON.stringify(draft.body).slice(0, 200));
    checkEq("but the line's rate is zero even though the caller asked for 14", ctx.n(draft.body?.lines?.[0]?.taxRatePercent), 0);
    checkEq("no tax is charged", ctx.n(draft.body?.totals?.taxTotal), 0);
    checkEq("and the invoice totals the goods alone", ctx.n(draft.body?.totals?.grandTotal), 100);

    const item = await req("POST", "/items", {
      id: "SCN-SET-ITEM-NOVAT",
      code: "SCN-SET-NOVAT",
      nameAr: "صنف بلا ضريبة",
      type: "stock",
      baseUnitCode: "PCS",
      trackInventory: true,
      revenueAccountId: "4100",
      cogsAccountId: "5100",
      inventoryAccountId: "1200",
    });
    check("a new item is created while VAT is off", item.status === 201, `${item.status}: ${JSON.stringify(item.body).slice(0, 160)}`);
    checkEq("and inherits a zero rate rather than the built-in 14", ctx.n(item.body?.taxRatePercent), 0);

    const on = await setTax({ taxEnabled: true, defaultTaxRate: 5 });
    check("VAT is switched back on at a different default", on.status === 200 && ctx.n(on.body?.defaultTaxRate) === 5, `status ${on.status}`);
    const item5 = await req("POST", "/items", {
      id: "SCN-SET-ITEM-VAT5",
      code: "SCN-SET-VAT5",
      nameAr: "صنف بضريبة 5%",
      type: "stock",
      baseUnitCode: "PCS",
      trackInventory: true,
      revenueAccountId: "4100",
      cogsAccountId: "5100",
      inventoryAccountId: "1200",
    });
    checkEq("a new item inherits the tenant's rate, not a number baked into the code", ctx.n(item5.body?.taxRatePercent), 5);

    const restore = await setTax({ defaultTaxRate: 14 });
    check("the default rate is restored", restore.status === 200 && ctx.n(restore.body?.defaultTaxRate) === 14, `status ${restore.status}`);
  });

  await scenario("settings / الضريبة — الإهلاك في شهر الاقتناء picks the basis the depreciation run uses", async () => {
    const asset = (id: string, start: string) => ({
      id,
      code: id,
      nameAr: `أصل اختبار الإهلاك ${id}`,
      categoryId: "ASSET-CAT-DEMO-1",
      scope: "general",
      acquisitionDate: start,
      acquisitionCost: "31000",
      depreciationStartDate: start,
      usefulLifeMonths: 10,
      salvageValue: "0",
    });
    const a = await req("POST", "/assets", asset("SCN-SET-ASSET-A", "2026-05-20"));
    const b = await req("POST", "/assets", asset("SCN-SET-ASSET-B", "2026-06-20"));
    check("two identical assets, each acquired on the 20th of its own month", a.status === 201 && b.status === 201, `${a.status}/${b.status}`);

    // 31,000 over 10 months is 3,100 a month; May has 31 days and the asset was
    // in service for 12 of them, so a day-prorated May charge is 1,200.
    const daily = await setTax({ depreciationProrate: "DAILY" });
    check("the tenant's basis is the IFRS daily proration", daily.status === 200 && daily.body?.depreciationProrate === "DAILY", `status ${daily.status}`);
    const mayRun = await req("POST", "/assets/depreciation/runs", { period: "2026-05" });
    check("the May run drafts", mayRun.status === 201, `${mayRun.status}: ${JSON.stringify(mayRun.body).slice(0, 200)}`);
    const mayLine = (mayRun.body?.lines ?? []).find((l: any) => l.assetId === "SCN-SET-ASSET-A");
    checkEq("and charges 12 of May's 31 days, not a whole month", ctx.n(mayLine?.amount), 1200);

    const fullMonth = await setTax({ depreciationProrate: "FULL_MONTH" });
    check("the tenant switches to a whole month in the month of acquisition", fullMonth.status === 200 && fullMonth.body?.depreciationProrate === "FULL_MONTH", `status ${fullMonth.status}`);
    const juneRun = await req("POST", "/assets/depreciation/runs", { period: "2026-06" });
    check("the June run drafts", juneRun.status === 201, `${juneRun.status}: ${JSON.stringify(juneRun.body).slice(0, 200)}`);
    const juneLine = (juneRun.body?.lines ?? []).find((l: any) => l.assetId === "SCN-SET-ASSET-B");
    checkEq("and the identical asset acquired on the 20th now carries the whole 3,100", ctx.n(juneLine?.amount), 3100);

    const restore = await setTax({ depreciationProrate: "DAILY" });
    check("the basis is restored", restore.status === 200 && restore.body?.depreciationProrate === "DAILY", `status ${restore.status}`);
  });
}

/**
 * R11.7 / R11.1 — the عام and الرقابة الائتمانية tabs. Multi-currency, the list
 * of usable currencies, the missing-rate policy and the price-list switch all
 * had no reader: any three-letter string reached the ledger, the strict refusal
 * was hardcoded, and turning price lists off left every invoice still measured
 * against one.
 */
async function generalSettingsAreLive(ctx: Ctx): Promise<void> {
  const { req, check, checkEq, scenario } = ctx;

  async function settings() {
    return (await req("GET", "/settings")).body;
  }
  async function set(patch: Record<string, unknown>) {
    return req("PUT", "/settings", { ...(await settings()), ...patch });
  }
  function invoiceIn(id: string, currency: string) {
    return req("POST", "/sales-invoices", {
      id,
      date: "2026-08-24",
      dueDate: "2026-09-23",
      customerId: "CUST-DEMO-1",
      customerNameAr: "شركة الأمل للتجارة",
      warehouseId: "WH-MAIN",
      branchId: "BR-MAIN",
      currency,
      arAccountId: "1105",
      taxAccountId: "2200",
      lines: [
        {
          lineId: `${id}-L1`,
          itemId: "ITEM-DEMO-1",
          itemNameAr: "صنف اختبار العملة",
          isStock: false,
          qty: "1",
          unitPrice: "100",
          taxRatePercent: 14,
          revenueAccountId: "4100",
        },
      ],
    });
  }

  await scenario("settings / عام — تعدد العملات decides which currencies a document may carry", async () => {
    const base = await settings();
    const off = await set({ multiCurrencyEnabled: false });
    check("multi-currency can be switched off", off.status === 200 && off.body?.multiCurrencyEnabled === false, `status ${off.status}`);

    const currenciesOff = await req("GET", "/settings/currencies");
    check("and the allowed list is the base currency alone", currenciesOff.status === 200 && JSON.stringify(currenciesOff.body?.allowed) === JSON.stringify(["EGP"]), JSON.stringify(currenciesOff.body));

    const refused = await invoiceIn("SCN-SET-CUR-USD-1", "USD");
    check("a USD invoice is refused while multi-currency is off", refused.status === 422 && refused.body?.error === "CURRENCY_NOT_ALLOWED", `${refused.status}: ${JSON.stringify(refused.body).slice(0, 180)}`);

    const on = await set({ multiCurrencyEnabled: true });
    check("multi-currency is switched on", on.status === 200 && on.body?.multiCurrencyEnabled === true, `status ${on.status}`);
    const currenciesOn = await req("GET", "/settings/currencies");
    check("the allowed list now carries the base plus the tenant's own additions", (currenciesOn.body?.allowed ?? []).includes("USD"), JSON.stringify(currenciesOn.body?.allowed));

    const accepted = await invoiceIn("SCN-SET-CUR-USD-2", "USD");
    check("the same USD invoice is now accepted", accepted.status === 201, `${accepted.status}: ${JSON.stringify(accepted.body).slice(0, 180)}`);
    check("and really carries USD", accepted.body?.currency === "USD", JSON.stringify(accepted.body?.currency));

    // The demo tenant now lists all ten foreign codes the platform supports
    // (R1.15), so proving the list is load-bearing means taking one back OUT.
    const withoutGbp = (base?.secondaryCurrencies ?? []).filter((c: string) => c !== "GBP");
    const narrowed = await set({ secondaryCurrencies: withoutGbp });
    check("GBP is taken off the tenant's list", narrowed.status === 200 && !(narrowed.body?.secondaryCurrencies ?? []).includes("GBP"), JSON.stringify(narrowed.body?.secondaryCurrencies));

    const notListed = await invoiceIn("SCN-SET-CUR-GBP", "GBP");
    check("a currency the tenant did NOT list is still refused — the list is not decoration", notListed.status === 422 && notListed.body?.error === "CURRENCY_NOT_ALLOWED", `${notListed.status}: ${JSON.stringify(notListed.body).slice(0, 180)}`);

    const withGbp = await set({ secondaryCurrencies: [...withoutGbp, "GBP"] });
    check("GBP is added to the list", withGbp.status === 200 && (withGbp.body?.secondaryCurrencies ?? []).includes("GBP"), `status ${withGbp.status}`);
    const gbpNow = await invoiceIn("SCN-SET-CUR-GBP-2", "GBP");
    check("and the same GBP invoice goes through", gbpNow.status === 201, `${gbpNow.status}: ${JSON.stringify(gbpNow.body).slice(0, 180)}`);

    const restore = await set({
      secondaryCurrencies: base?.secondaryCurrencies,
      multiCurrencyEnabled: base?.multiCurrencyEnabled,
    });
    check("the tenant's own currency configuration is put back", restore.status === 200 && restore.body?.multiCurrencyEnabled === base?.multiCurrencyEnabled, `status ${restore.status}`);
  });

  await scenario("settings / عام — سياسة عدم وجود سعر صرف decides whether a rate-less document may post", async () => {
    // A currency of this scenario's own, so the debt it leaves behind cannot
    // disturb the USD revaluation a later module measures: one approved SAR
    // rate, dated AFTER the document — exactly the "no rate on or before my own
    // date" case the policy governs.
    const rate = await req("POST", "/exchange-rates", {
      id: "SCN-SET-FX-SAR", currency: "SAR", rate: "13.20", effectiveDate: "2026-08-01", rateType: "standard", source: "manual",
    });
    check("a SAR rate is recorded", rate.status === 201, `${rate.status}: ${JSON.stringify(rate.body).slice(0, 180)}`);
    const approved = await req("POST", "/exchange-rates/SCN-SET-FX-SAR/approve", {});
    check("and approved", approved.body?.status === "approved", JSON.stringify(approved.body).slice(0, 180));

    const draft = await req("POST", "/purchases/invoices", {
      id: "SCN-SET-FX-PI",
      supplierId: "SUPP-DEMO-1",
      date: "2026-07-15",
      dueDate: "2026-08-15",
      warehouseId: "WH-MAIN",
      branchId: "BR-MAIN",
      currency: "SAR",
      lines: [{ itemId: null, kind: "expense", description: "خدمة بالريال", qty: "1", unitCost: "100", taxRatePercent: 0 }],
    });
    check("a SAR purchase invoice dated before that rate drafts", draft.status === 201, `${draft.status}: ${JSON.stringify(draft.body).slice(0, 220)}`);

    const strict = await req("POST", "/purchases/invoices/SCN-SET-FX-PI/confirm", {});
    check("STRICT refuses to post it — the ledger will not guess a rate", strict.status !== 200, `status ${strict.status} ${JSON.stringify(strict.body).slice(0, 200)}`);

    const allow = await set({ fxRateMissingPolicy: "ALLOW_MISSING" });
    check("the tenant relaxes the policy", allow.status === 200 && allow.body?.fxRateMissingPolicy === "ALLOW_MISSING", `status ${allow.status}`);

    const posted = await req("POST", "/purchases/invoices/SCN-SET-FX-PI/confirm", {});
    check("and the same invoice now posts", posted.status === 200, `status ${posted.status} ${JSON.stringify(posted.body).slice(0, 200)}`);

    const je = await req("GET", "/gl/journal-entries/PI-JE:SCN-SET-FX-PI");
    const payable = (je.body?.lines ?? []).find((l: any) => ctx.n(l.credit) > 0);
    checkEq("at the tenant's nearest approved rate (13.20), not at 1:1", ctx.n(payable?.credit), 1320);
    check("and the posted line records the currency and the rate it used", payable?.currency === "SAR" && ctx.n(payable?.fxRate) === 13.2, JSON.stringify(payable));

    const back = await set({ fxRateMissingPolicy: "STRICT" });
    check("the missing-rate policy is restored", back.status === 200 && back.body?.fxRateMissingPolicy === "STRICT", `status ${back.status}`);
  });

  await scenario("settings / الرقابة الائتمانية — تفعيل قوائم الأسعار decides whether an invoice is measured against one", async () => {
    const itemId = "SCN-SET-PL-ITEM";
    await req("POST", "/items", {
      id: itemId,
      code: "SCN-SET-PL",
      nameAr: "صنف بقائمة أسعار",
      type: "service",
      baseUnitCode: "PCS",
      trackInventory: false,
      revenueAccountId: "4100",
    });
    const list = await req("POST", "/price-lists", {
      id: "SCN-SET-PL-1",
      code: "SCN-SET-PL",
      nameAr: "قائمة أسعار اختبار الإعدادات",
      lines: [{ itemId, price: "80.00" }],
    });
    check("a price list quoting 80 is created", list.status === 201, `${list.status}: ${JSON.stringify(list.body).slice(0, 180)}`);
    const customer = await req("POST", "/customers", {
      id: "SCN-SET-PL-CUST",
      code: "SCN-SET-PLC",
      nameAr: "عميل قائمة أسعار الإعدادات",
      priceListId: "SCN-SET-PL-1",
      currency: "EGP",
    });
    check("and a customer assigned to it", customer.status === 201 && customer.body?.priceListId === "SCN-SET-PL-1", `${customer.status}: ${JSON.stringify(customer.body).slice(0, 180)}`);

    function underList(id: string) {
      return req("POST", "/sales-invoices", {
        id,
        date: "2026-08-24",
        dueDate: "2026-09-23",
        customerId: "SCN-SET-PL-CUST",
        customerNameAr: "عميل قائمة أسعار الإعدادات",
        warehouseId: "WH-MAIN",
        branchId: "BR-MAIN",
        currency: "EGP",
        arAccountId: "1105",
        taxAccountId: "2200",
        lines: [{ lineId: "L1", itemId, itemNameAr: "صنف بقائمة أسعار", isStock: false, qty: "1", unitPrice: "5.00", taxRatePercent: 14, revenueAccountId: "4100" }],
      });
    }

    const off = await set({ priceListsEnabled: false });
    check("price lists are switched off", off.status === 200 && off.body?.priceListsEnabled === false, `status ${off.status}`);
    await underList("SCN-SET-PL-INV-OFF");
    const confirmedOff = await req("POST", "/sales-invoices/SCN-SET-PL-INV-OFF/confirm", {});
    check("an invoice five pounds under the list confirms", confirmedOff.status === 200, `status ${confirmedOff.status}`);
    check("and reports NO variance — a tenant that does not use price lists is not nagged about them", (confirmedOff.body?.pricingVariances ?? []).length === 0, JSON.stringify(confirmedOff.body?.pricingVariances));

    const on = await set({ priceListsEnabled: true });
    check("price lists are switched back on", on.status === 200 && on.body?.priceListsEnabled === true, `status ${on.status}`);
    await underList("SCN-SET-PL-INV-ON");
    const confirmedOn = await req("POST", "/sales-invoices/SCN-SET-PL-INV-ON/confirm", {});
    const variances = (confirmedOn.body?.pricingVariances ?? []) as any[];
    check(
      "and the identical invoice now reports the line charged under the customer's list",
      confirmedOn.status === 200 && variances.length === 1 && ctx.n(variances[0]?.listPrice) === 80 && ctx.n(variances[0]?.chargedPrice) === 5,
      `status ${confirmedOn.status} ${JSON.stringify(variances).slice(0, 200)}`,
    );
  });
}
