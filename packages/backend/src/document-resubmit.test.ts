import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { GATEABLE_ACTION_TYPES } from "@mezan/domain";
import { bootBackendKit, type BackendKit, type Reply } from "./test-helpers/backend-kit.js";
import { gatedFamilies } from "./test-helpers/gated-families.js";

const REJECTION = "الكمية لا تطابق محضر الاستلام";
const APPROVER_ROLE = "SUPERVISOR";

let kit: BackendKit;
const FAMILIES = gatedFamilies(() => kit);

const requestIdOf = (id: string) => `${id}:confirm`;
const decide = (id: string, decision: string, comment?: string) =>
  kit.call("POST", `/workflow/requests/${encodeURIComponent(requestIdOf(id))}/decide`, { decision, ...(comment ? { comment } : {}) });
const requestOf = async (id: string) =>
  ((await kit.call("GET", "/workflow/requests")).body as Reply["body"][]).find((row) => row.id === requestIdOf(id));

beforeAll(async () => {
  kit = await bootBackendKit();
  for (const family of FAMILIES) {
    const configured = await kit.call("POST", "/workflow/configs", { actionType: family.actionType, steps: [{ role: APPROVER_ROLE }] });
    expect(configured.status, JSON.stringify(configured.body)).toBe(201);
  }
}, 180_000);

afterAll(async () => {
  await kit.close();
});

describe("the gated document families the resubmit route covers", () => {
  it("are every DocumentService family the gate catalogue holds", () => {
    const heldElsewhere = GATEABLE_ACTION_TYPES.map((entry) => entry.code).filter(
      (code) => code.endsWith("_CONFIRM") && !FAMILIES.some((family) => family.actionType === code),
    );
    expect(heldElsewhere.sort()).toEqual([
      "PURCHASE_INVOICE_CONFIRM",
      "PURCHASE_ORDER_CONFIRM",
      "PURCHASE_RECEIPT_CONFIRM",
      "SALES_INVOICE_CONFIRM",
      "TREASURY_CAPITAL_WITHDRAWAL_CONFIRM",
      "TREASURY_TAX_PAYMENT_CONFIRM",
    ]);
  });
});

describe.each(FAMILIES)("resubmitting a rejected $mount document", (family) => {
  const id = `RSB-${family.actionType}`;
  const read = async (permissions?: readonly string[]) => (await kit.call("GET", `${family.mount}/${id}`, undefined, permissions)).body;
  const resubmit = (permissions?: readonly string[]) => kit.call("POST", `${family.mount}/${id}/resubmit`, {}, permissions);

  it("is held, rejected with a reason the document shows, and the rejection stands against a plain confirm", async () => {
    const drafted = await family.draft(id);
    expect(drafted.status, JSON.stringify(drafted.body)).toBe(201);
    const submitted = await kit.call("POST", `${family.mount}/${id}/confirm`, {}, family.submitter);
    expect([submitted.status, submitted.body.held, family.documentOf(submitted).status], JSON.stringify(submitted.body)).toEqual([200, true, "pending"]);
    expect((await read(family.reader)).approval).toMatchObject({ status: "pending", rejectionReason: null });

    const refusedWhilePending = await resubmit(family.submitter);
    expect([refusedWhilePending.status, refusedWhilePending.body.error], JSON.stringify(refusedWhilePending.body)).toEqual([409, "DOCUMENT_RESUBMIT_REFUSED"]);
    expect(refusedWhilePending.body.message).toMatch(/[؀-ۿ]/);

    expect((await decide(id, "reject", REJECTION)).status).toBe(200);
    const rejected = await read(family.reader);
    expect([rejected.status, rejected.approval], JSON.stringify(rejected)).toEqual(["draft", { status: "rejected", rejectionReason: REJECTION, rejectedBy: "USER-ADMIN" }]);

    const confirmedAgain = await kit.call("POST", `${family.mount}/${id}/confirm`, {}, family.submitter);
    expect([confirmedAgain.status, confirmedAgain.body.error]).toEqual([409, "APPROVAL_REQUEST_REJECTED"]);
  });

  it("is refused to a caller who may read the document but not confirm it", async () => {
    const refused = await resubmit(family.reader);
    expect(refused.status, JSON.stringify(refused.body)).toBe(403);
    expect((await read()).status).toBe("draft");
    expect((await requestOf(id)).status).toBe("rejected");
  });

  it("goes back to pending under the same request, which keeps the rejection, and the caller is on the audit row", async () => {
    const resubmitted = await resubmit(family.submitter);
    expect([resubmitted.status, resubmitted.body.held, resubmitted.body.document?.status], JSON.stringify(resubmitted.body)).toEqual([200, true, "pending"]);
    expect(resubmitted.body.document.approval).toMatchObject({ status: "pending", rejectionReason: REJECTION });

    const request = await requestOf(id);
    expect([request.status, request.currentStep]).toEqual(["pending", 0]);
    expect(request.decisions.map((d: { kind: string; comment?: string }) => [d.kind, d.comment])).toEqual([["reject", REJECTION]]);
    expect((await read()).workflowRequestId).toBe(requestIdOf(id));

    const audit = await kit.auditRows(family.auditEntity, id, "RESUBMIT");
    expect(audit.map((row) => row.actor)).toEqual(["LIMITED"]);
  });

  it("is refused once approved, and the approval is not discarded", async () => {
    const approved = await decide(id, "approve");
    expect(approved.status, JSON.stringify(approved.body)).toBe(200);
    expect((await read()).status).toBe(family.postedStatus);

    const refused = await resubmit(family.submitter);
    expect([refused.status, refused.body.error], JSON.stringify(refused.body)).toEqual([409, "DOCUMENT_RESUBMIT_REFUSED"]);
    expect((await requestOf(id)).status).toBe("approved");
    expect((await read()).status).toBe(family.postedStatus);
  });
});

describe.each(FAMILIES)("a tenant admin confirming a gated $mount document", (family) => {
  it("is not held behind an approver step the admin already satisfies", async () => {
    const id = `ADM-${family.actionType}`;
    expect((await family.draft(id)).status).toBe(201);
    const confirmed = await kit.call("POST", `${family.mount}/${id}/confirm`, {});
    expect([confirmed.status, confirmed.body.held, family.documentOf(confirmed).status], JSON.stringify(confirmed.body)).toEqual([200, false, family.postedStatus]);
  });
});

describe("after every family has been through the gate", () => {
  it("the books still reconcile", async () => {
    expect(await kit.invariants()).toEqual({ tb: 0n, inventory: 0n, ap: 0n, ar: 0n });
  });
});
