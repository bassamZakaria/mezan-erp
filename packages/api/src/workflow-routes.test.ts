import { describe, it, expect, afterEach } from "vitest";
import {
  createSqliteWorkflowConfigStore,
  createSqliteApprovalRequestStore,
  type SqliteWorkflowConfigStoreHandle,
  type SqliteApprovalRequestStoreHandle,
} from "@mezan/persistence";
import { ALL_SCOPE } from "@mezan/domain";
import { createWorkflowRoutes } from "./workflow-routes.js";
import { createSessionRegistry, createSessionAuthContextResolver } from "./session-auth.js";

const handles: Array<{ close(): void }> = [];
afterEach(() => {
  for (const h of handles.splice(0)) h.close();
});

function newApp() {
  const configs: SqliteWorkflowConfigStoreHandle = createSqliteWorkflowConfigStore();
  const requests: SqliteApprovalRequestStoreHandle = createSqliteApprovalRequestStore();
  handles.push(configs, requests);
  const sessions = createSessionRegistry();
  const app = createWorkflowRoutes({ configs, requests }, createSessionAuthContextResolver(sessions));

  /**
   * A request carrying a REAL session. The approver role a step matches on is
   * read off the server's own grant, never off a header — naming a role in the
   * request is exactly the impersonation the gate stopped accepting.
   */
  function req(
    path: string,
    init: RequestInit & { userId?: string; permissions?: string; roleCode?: string } = {},
  ) {
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

describe("workflow config routes", () => {
  it("gates the config list behind workflow.config.view", async () => {
    const { app, req } = newApp();
    expect((await app.fetch(req("/configs"))).status).toBe(401);
    expect((await app.fetch(req("/configs", { userId: "u1", permissions: "workflow.view" }))).status).toBe(403);
  });

  it("creates and lists a config", async () => {
    const { app, req } = newApp();
    const res = await app.fetch(
      req("/configs", {
        method: "POST",
        permissions: "workflow.config.manage",
        body: JSON.stringify({ actionType: "SALES_INVOICE_CONFIRM", steps: [{ role: "SUPERVISOR" }] }),
      }),
    );
    expect(res.status).toBe(201);
    const created = (await res.json()) as { id: string; actionType: string };
    expect(created.actionType).toBe("SALES_INVOICE_CONFIRM");

    const list = (await (
      await app.fetch(req("/configs", { permissions: "workflow.config.view" }))
    ).json()) as unknown[];
    expect(list).toHaveLength(1);
  });

  it("rejects an unknown action type with 400", async () => {
    const { app, req } = newApp();
    const res = await app.fetch(
      req("/configs", {
        method: "POST",
        permissions: "workflow.config.manage",
        body: JSON.stringify({ actionType: "NOT_REAL", steps: [{ role: "SUPERVISOR" }] }),
      }),
    );
    expect(res.status).toBe(400);
  });

  it("rejects a duplicate config for the same action type with 409", async () => {
    const { app, req } = newApp();
    const create = () =>
      app.fetch(
        req("/configs", {
          method: "POST",
          permissions: "workflow.config.manage",
          body: JSON.stringify({ actionType: "SALES_INVOICE_CONFIRM", steps: [{ role: "SUPERVISOR" }] }),
        }),
      );
    expect((await create()).status).toBe(201);
    expect((await create()).status).toBe(409);
  });

  it("updates and deletes a config", async () => {
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

    const updated = await app.fetch(
      req(`/configs/${created.id}`, {
        method: "PUT",
        permissions: "workflow.config.manage",
        body: JSON.stringify({ steps: [{ role: "SUPERVISOR" }, { role: "FINANCE_MANAGER" }] }),
      }),
    );
    expect(updated.status).toBe(200);
    expect(((await updated.json()) as { steps: unknown[] }).steps).toHaveLength(2);

    const deleted = await app.fetch(req(`/configs/${created.id}`, { method: "DELETE", permissions: "workflow.config.manage" }));
    expect(deleted.status).toBe(204);
  });
});

describe("approval request routes", () => {
  it("submits a request and lists it as pending for the step's role", async () => {
    const { app, req } = newApp();
    await app.fetch(
      req("/configs", {
        method: "POST",
        permissions: "workflow.config.manage",
        body: JSON.stringify({ actionType: "SALES_INVOICE_CONFIRM", steps: [{ role: "SUPERVISOR" }] }),
      }),
    );

    const submitted = await app.fetch(
      req("/requests", {
        method: "POST",
        userId: "alice",
        body: JSON.stringify({ actionType: "SALES_INVOICE_CONFIRM", entityLabel: "فاتورة INV-001" }),
      }),
    );
    expect(submitted.status).toBe(201);
    const record = (await submitted.json()) as { id: string; status: string };
    expect(record.status).toBe("pending");

    const pending = (await (
      await app.fetch(req("/requests/pending", { permissions: "workflow.view", roleCode: "SUPERVISOR" }))
    ).json()) as unknown[];
    expect(pending).toHaveLength(1);

    const pendingForOther = (await (
      await app.fetch(req("/requests/pending", { permissions: "workflow.view", roleCode: "FINANCE_MANAGER" }))
    ).json()) as unknown[];
    expect(pendingForOther).toHaveLength(0);

    const count = (await (
      await app.fetch(req("/requests/pending-count", { permissions: "workflow.view", roleCode: "SUPERVISOR" }))
    ).json()) as { count: number };
    expect(count.count).toBe(1);
  });

  it("submits and immediately grants when no config exists for the action type", async () => {
    const { app, req } = newApp();
    const res = await app.fetch(
      req("/requests", { method: "POST", userId: "alice", body: JSON.stringify({ actionType: "PURCHASE_ORDER_CONFIRM" }) }),
    );
    expect((await res.json() as { status: string }).status).toBe("approved");
  });

  it("approves through a two-step chain and rejects a wrong-role decision", async () => {
    const { app, req } = newApp();
    await app.fetch(
      req("/configs", {
        method: "POST",
        permissions: "workflow.config.manage",
        body: JSON.stringify({
          actionType: "SALES_INVOICE_CONFIRM",
          steps: [{ role: "SUPERVISOR" }, { role: "FINANCE_MANAGER" }],
        }),
      }),
    );
    const submitted = (await (
      await app.fetch(req("/requests", { method: "POST", userId: "alice", body: JSON.stringify({ actionType: "SALES_INVOICE_CONFIRM" }) }))
    ).json()) as { id: string };

    const wrongRole = await app.fetch(
      req(`/requests/${submitted.id}/decide`, {
        method: "POST",
        userId: "fin-1",
        permissions: "workflow.view,workflow.approve",
        roleCode: "FINANCE_MANAGER",
        body: JSON.stringify({ decision: "approve" }),
      }),
    );
    expect(wrongRole.status).toBe(409);

    const step1 = await app.fetch(
      req(`/requests/${submitted.id}/decide`, {
        method: "POST",
        userId: "sup-1",
        permissions: "workflow.view,workflow.approve",
        roleCode: "SUPERVISOR",
        body: JSON.stringify({ decision: "approve" }),
      }),
    );
    expect((await step1.json() as { status: string }).status).toBe("pending");

    const step2 = await app.fetch(
      req(`/requests/${submitted.id}/decide`, {
        method: "POST",
        userId: "fin-1",
        permissions: "workflow.view,workflow.approve",
        roleCode: "FINANCE_MANAGER",
        body: JSON.stringify({ decision: "approve" }),
      }),
    );
    expect((await step2.json() as { status: string }).status).toBe("approved");
  });

  it("requires workflow.reject to reject a request even with workflow.approve", async () => {
    const { app, req } = newApp();
    await app.fetch(
      req("/configs", {
        method: "POST",
        permissions: "workflow.config.manage",
        body: JSON.stringify({ actionType: "SALES_INVOICE_CONFIRM", steps: [{ role: "SUPERVISOR" }] }),
      }),
    );
    const submitted = (await (
      await app.fetch(req("/requests", { method: "POST", userId: "alice", body: JSON.stringify({ actionType: "SALES_INVOICE_CONFIRM" }) }))
    ).json()) as { id: string };

    const denied = await app.fetch(
      req(`/requests/${submitted.id}/decide`, {
        method: "POST",
        userId: "sup-1",
        permissions: "workflow.view,workflow.approve",
        roleCode: "SUPERVISOR",
        body: JSON.stringify({ decision: "reject" }),
      }),
    );
    expect(denied.status).toBe(403);

    const rejected = await app.fetch(
      req(`/requests/${submitted.id}/decide`, {
        method: "POST",
        userId: "sup-1",
        permissions: "workflow.view,workflow.approve,workflow.reject",
        roleCode: "SUPERVISOR",
        body: JSON.stringify({ decision: "reject", comment: "بيانات ناقصة" }),
      }),
    );
    expect((await rejected.json() as { status: string }).status).toBe("rejected");
  });

  /**
   * KNOWN PRODUCT DEFECT — kept asserting the CORRECT behaviour, expected to fail.
   *
   * `POST /workflow/requests` is deliberately ungated, so no permission gate
   * ever stashes an AuthContext on the request; `actorRoles` (= `callerRoleCodes`,
   * workflow-routes.ts:104) reads that stash and therefore hands `submitApproval`
   * an EMPTY `submitterRoles` on this route. `hasAdminRole` never sees `"*"`, so
   * a tenant admin's submission is held بانتظار الموافقة instead of granted.
   * Before the session move the helper read the headers directly and this worked.
   * Delete the `.fails` once workflow-routes.ts resolves the roles itself.
   */
  it.fails("an admin submitter (\"*\") bypasses the gate and is granted immediately", async () => {
    const { app, req } = newApp();
    await app.fetch(
      req("/configs", {
        method: "POST",
        permissions: "workflow.config.manage",
        body: JSON.stringify({ actionType: "SALES_INVOICE_CONFIRM", steps: [{ role: "SUPERVISOR" }] }),
      }),
    );
    const res = await app.fetch(
      req("/requests", { method: "POST", userId: "admin", permissions: "*", body: JSON.stringify({ actionType: "SALES_INVOICE_CONFIRM" }) }),
    );
    expect((await res.json() as { status: string }).status).toBe("approved");
  });
});
