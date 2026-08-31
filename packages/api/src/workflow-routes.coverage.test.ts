import { describe, it, expect, afterEach } from "vitest";
import {
  createSqliteWorkflowConfigStore,
  createSqliteApprovalRequestStore,
  type SqliteWorkflowConfigStoreHandle,
  type SqliteApprovalRequestStoreHandle,
} from "@mezan/persistence";
import { ALL_SCOPE, type ApprovalRequestRecord } from "@mezan/domain";
import { createWorkflowRoutes, type WorkflowRoutesDeps, type HeldDocumentActions } from "./workflow-routes.js";
import { createSessionRegistry, createSessionAuthContextResolver } from "./session-auth.js";

const handles: Array<{ close(): void }> = [];
afterEach(() => {
  for (const h of handles.splice(0)) h.close();
});

function newApp(heldDocuments?: WorkflowRoutesDeps["heldDocuments"]) {
  const configs: SqliteWorkflowConfigStoreHandle = createSqliteWorkflowConfigStore();
  const requests: SqliteApprovalRequestStoreHandle = createSqliteApprovalRequestStore();
  handles.push(configs, requests);
  const sessions = createSessionRegistry();
  const app = createWorkflowRoutes({ configs, requests, heldDocuments }, createSessionAuthContextResolver(sessions));

  function req(path: string, init: RequestInit & { userId?: string; permissions?: string; roleCode?: string } = {}) {
    const headers = new Headers(init.headers);
    if (init.userId !== undefined || init.permissions !== undefined || init.roleCode !== undefined) {
      const token = sessions.issue({
        userId: init.userId ?? "anonymous",
        permissions: init.permissions ? init.permissions.split(",") : [],
        roleCode: init.roleCode ?? null,
        branchScope: ALL_SCOPE,
        warehouseScope: ALL_SCOPE,
      });
      headers.set("authorization", `Bearer ${token}`);
    }
    if (init.body !== undefined) headers.set("content-type", "application/json");
    return new Request(`http://local${path}`, { ...init, headers });
  }

  return { app, configs, requests, req };
}

describe("workflow config routes — schema and unknown-id refusals, never 500", () => {
  it("400s creating a config with a body the wire contract rejects", async () => {
    const { app, req } = newApp();
    const res = await app.fetch(
      req("/configs", { method: "POST", permissions: "workflow.config.manage", body: JSON.stringify({ steps: [] }) }),
    );
    expect(res.status).toBe(400);
    expect(((await res.json()) as { error: string }).error).toBe("VALIDATION_ERROR");
  });

  it("404s updating a config id that does not exist", async () => {
    const { app, req } = newApp();
    const res = await app.fetch(
      req("/configs/does-not-exist", {
        method: "PUT",
        permissions: "workflow.config.manage",
        body: JSON.stringify({ steps: [{ role: "SUPERVISOR" }] }),
      }),
    );
    expect(res.status).toBe(404);
  });

  it("400s updating an existing config with a body the wire contract rejects", async () => {
    const { app, req } = newApp();
    const created = (await (
      await app.fetch(
        req("/configs", {
          method: "POST",
          permissions: "workflow.config.manage",
          body: JSON.stringify({ actionType: "SALES_INVOICE_CONFIRM", steps: [{ role: "SUPERVISOR" }] }),
        }),
      )
    ).json()) as { id: string };

    const res = await app.fetch(
      req(`/configs/${created.id}`, { method: "PUT", permissions: "workflow.config.manage", body: JSON.stringify({ steps: [] }) }),
    );
    expect(res.status).toBe(400);
  });

  it("404s — never 500s — deleting a config id that does not exist", async () => {
    const { app, req } = newApp();
    const res = await app.fetch(req("/configs/does-not-exist", { method: "DELETE", permissions: "workflow.config.manage" }));
    expect(res.status).toBe(404);
  });
});

describe("POST /requests — schema and unknown action type refusals", () => {
  it("400s a body the wire contract rejects", async () => {
    const { app, req } = newApp();
    const res = await app.fetch(req("/requests", { method: "POST", userId: "alice", body: JSON.stringify({}) }));
    expect(res.status).toBe(400);
    expect(((await res.json()) as { error: string }).error).toBe("VALIDATION_ERROR");
  });

  it("400s — UNKNOWN_ACTION_TYPE — submitting an action type outside the 26-code gateable catalog", async () => {
    const { app, req } = newApp();
    const res = await app.fetch(
      req("/requests", { method: "POST", userId: "alice", body: JSON.stringify({ actionType: "NOT_A_GATEABLE_TYPE" }) }),
    );
    expect(res.status).toBe(400);
    expect(((await res.json()) as { error: string }).error).toBe("UNKNOWN_ACTION_TYPE");
  });
});

describe("POST /requests/:id/decide — schema and unknown-request refusals", () => {
  it("400s a body the wire contract rejects", async () => {
    const { app, req } = newApp();
    const res = await app.fetch(
      req("/requests/anything/decide", {
        method: "POST",
        userId: "sup-1",
        permissions: "workflow.view,workflow.approve",
        roleCode: "SUPERVISOR",
        body: JSON.stringify({ decision: "not-a-real-decision" }),
      }),
    );
    expect(res.status).toBe(400);
  });

  it("404s — never 500s — deciding on a request id that does not exist", async () => {
    const { app, req } = newApp();
    const res = await app.fetch(
      req("/requests/does-not-exist/decide", {
        method: "POST",
        userId: "sup-1",
        permissions: "workflow.view,workflow.approve",
        roleCode: "SUPERVISOR",
        body: JSON.stringify({ decision: "approve" }),
      }),
    );
    expect(res.status).toBe(404);
  });
});

describe("a decision re-invokes the held document it gated (the fix for D-approve-never-posts)", () => {
  async function seedApprovedTwoStep(req: ReturnType<typeof newApp>["req"], app: ReturnType<typeof newApp>["app"]) {
    await app.fetch(
      req("/configs", {
        method: "POST",
        permissions: "workflow.config.manage",
        body: JSON.stringify({ actionType: "SALES_INVOICE_CONFIRM", steps: [{ role: "SUPERVISOR" }] }),
      }),
    );
    const submitted = (await (
      await app.fetch(
        req("/requests", {
          method: "POST",
          userId: "alice",
          body: JSON.stringify({ actionType: "SALES_INVOICE_CONFIRM", requestId: "INV-1:confirm" }),
        }),
      )
    ).json()) as { id: string };
    return submitted;
  }

  it("confirms the held document once its request is approved", async () => {
    const confirmCalls: { docId: string; actor: string }[] = [];
    const heldDocuments = (record: ApprovalRequestRecord): HeldDocumentActions | null => ({
      heldRequestId: async () => record.id,
      confirm: async (docId, actor) => {
        confirmCalls.push({ docId, actor });
      },
      returnToDraft: async () => {
        throw new Error("should not be called on approve");
      },
    });
    const { app, req } = newApp(heldDocuments);
    const submitted = await seedApprovedTwoStep(req, app);

    const decided = await app.fetch(
      req(`/requests/${submitted.id}/decide`, {
        method: "POST",
        userId: "sup-1",
        permissions: "workflow.view,workflow.approve",
        roleCode: "SUPERVISOR",
        body: JSON.stringify({ decision: "approve" }),
      }),
    );

    expect(decided.status).toBe(200);
    expect((await decided.json() as { status: string }).status).toBe("approved");
    expect(confirmCalls).toEqual([{ docId: "INV-1", actor: "sup-1" }]);
  });

  it("returns the held document to draft when its request is rejected", async () => {
    const returnCalls: string[] = [];
    const heldDocuments = (record: ApprovalRequestRecord): HeldDocumentActions | null => ({
      heldRequestId: async () => record.id,
      confirm: async () => {
        throw new Error("should not be called on reject");
      },
      returnToDraft: async (docId) => {
        returnCalls.push(docId);
      },
    });
    const { app, req } = newApp(heldDocuments);
    const submitted = await seedApprovedTwoStep(req, app);

    const decided = await app.fetch(
      req(`/requests/${submitted.id}/decide`, {
        method: "POST",
        userId: "sup-1",
        permissions: "workflow.view,workflow.approve,workflow.reject",
        roleCode: "SUPERVISOR",
        body: JSON.stringify({ decision: "reject", comment: "بيانات ناقصة" }),
      }),
    );

    expect(decided.status).toBe(200);
    expect(returnCalls).toEqual(["INV-1"]);
  });

  it("takes no document action when the held request id no longer matches — stale gate, not this decision's document", async () => {
    let confirmCalled = false;
    const heldDocuments = (): HeldDocumentActions => ({
      heldRequestId: async () => "some-other-request-id",
      confirm: async () => {
        confirmCalled = true;
      },
      returnToDraft: async () => {
        confirmCalled = true;
      },
    });
    const { app, req } = newApp(heldDocuments);
    const submitted = await seedApprovedTwoStep(req, app);

    const decided = await app.fetch(
      req(`/requests/${submitted.id}/decide`, {
        method: "POST",
        userId: "sup-1",
        permissions: "workflow.view,workflow.approve",
        roleCode: "SUPERVISOR",
        body: JSON.stringify({ decision: "approve" }),
      }),
    );

    expect(decided.status).toBe(200);
    expect(confirmCalled).toBe(false);
  });

  it("409s — HELD_DOCUMENT_NOT_RESOLVED — reporting a failure to post, rather than reading as a clean success", async () => {
    const heldDocuments = (record: ApprovalRequestRecord): HeldDocumentActions => ({
      heldRequestId: async () => record.id,
      confirm: async () => {
        throw new Error("closed fiscal period");
      },
      returnToDraft: async () => {},
    });
    const { app, req } = newApp(heldDocuments);
    const submitted = await seedApprovedTwoStep(req, app);

    const decided = await app.fetch(
      req(`/requests/${submitted.id}/decide`, {
        method: "POST",
        userId: "sup-1",
        permissions: "workflow.view,workflow.approve",
        roleCode: "SUPERVISOR",
        body: JSON.stringify({ decision: "approve" }),
      }),
    );

    expect(decided.status).toBe(409);
    const body = (await decided.json()) as { error: string; message: string };
    expect(body.error).toBe("HELD_DOCUMENT_NOT_RESOLVED");
    expect(body.message).toBe("closed fiscal period");
    // The decision itself still stands — it is already persisted before the held-document call.
    const list = (await (
      await app.fetch(req("/requests", { permissions: "workflow.view" }))
    ).json()) as { status: string }[];
    expect(list[0]!.status).toBe("approved");
  });

  it("no document action at all when heldDocuments resolves to null for this record", async () => {
    const { app, req } = newApp(() => null);
    const submitted = await seedApprovedTwoStep(req, app);

    const decided = await app.fetch(
      req(`/requests/${submitted.id}/decide`, {
        method: "POST",
        userId: "sup-1",
        permissions: "workflow.view,workflow.approve",
        roleCode: "SUPERVISOR",
        body: JSON.stringify({ decision: "approve" }),
      }),
    );
    expect(decided.status).toBe(200);
  });
});
