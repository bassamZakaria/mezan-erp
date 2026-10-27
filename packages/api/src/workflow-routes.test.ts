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
  async function req(
    path: string,
    init: RequestInit & { userId?: string; permissions?: string; roleCode?: string } = {},
  ) {
    const headers = new Headers(init.headers);
    if (init.userId !== undefined || init.permissions !== undefined || init.roleCode !== undefined) {
      const token = await sessions.issue({
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
    expect((await app.fetch((await req("/configs")))).status).toBe(401);
    expect((await app.fetch((await req("/configs", { userId: "u1", permissions: "workflow.view" })))).status).toBe(403);
  });

  it("creates and lists a config", async () => {
    const { app, req } = newApp();
    const res = await app.fetch(
      (await req("/configs", {
        method: "POST",
        permissions: "workflow.config.manage",
        body: JSON.stringify({ actionType: "SALES_INVOICE_CONFIRM", steps: [{ role: "SUPERVISOR" }] }),
      })),
    );
    expect(res.status).toBe(201);
    const created = (await res.json()) as { id: string; actionType: string };
    expect(created.actionType).toBe("SALES_INVOICE_CONFIRM");

    const list = (await (
      await app.fetch((await req("/configs", { permissions: "workflow.config.view" })))
    ).json()) as unknown[];
    expect(list).toHaveLength(1);
  });

  it("rejects an unknown action type with 400", async () => {
    const { app, req } = newApp();
    const res = await app.fetch(
      (await req("/configs", {
        method: "POST",
        permissions: "workflow.config.manage",
        body: JSON.stringify({ actionType: "NOT_REAL", steps: [{ role: "SUPERVISOR" }] }),
      })),
    );
    expect(res.status).toBe(400);
  });

  it("rejects a duplicate config for the same action type with 409", async () => {
    const { app, req } = newApp();
    const create = async () =>
      app.fetch(
        (await req("/configs", {
          method: "POST",
          permissions: "workflow.config.manage",
          body: JSON.stringify({ actionType: "SALES_INVOICE_CONFIRM", steps: [{ role: "SUPERVISOR" }] }),
        })),
      );
    expect((await create()).status).toBe(201);
    expect((await create()).status).toBe(409);
  });

  it("updates and deletes a config", async () => {
    const { app, req } = newApp();
    const created = (await (
      await app.fetch(
        (await req("/configs", {
          method: "POST",
          permissions: "workflow.config.manage",
          body: JSON.stringify({ actionType: "SALES_INVOICE_CONFIRM", steps: [{ role: "SUPERVISOR" }] }),
        })),
      )
    ).json()) as { id: string };

    const updated = await app.fetch(
      (await req(`/configs/${created.id}`, {
        method: "PUT",
        permissions: "workflow.config.manage",
        body: JSON.stringify({ steps: [{ role: "SUPERVISOR" }, { role: "FINANCE_MANAGER" }] }),
      })),
    );
    expect(updated.status).toBe(200);
    expect(((await updated.json()) as { steps: unknown[] }).steps).toHaveLength(2);

    const deleted = await app.fetch((await req(`/configs/${created.id}`, { method: "DELETE", permissions: "workflow.config.manage" })));
    expect(deleted.status).toBe(204);
  });
});

describe("approval request routes", () => {
  it("submits a request and lists it as pending for the step's role", async () => {
    const { app, req } = newApp();
    await app.fetch(
      (await req("/configs", {
        method: "POST",
        permissions: "workflow.config.manage",
        body: JSON.stringify({ actionType: "SALES_INVOICE_CONFIRM", steps: [{ role: "SUPERVISOR" }] }),
      })),
    );

    const submitted = await app.fetch(
      (await req("/requests", {
        method: "POST",
        userId: "alice",
        permissions: "workflow.view",
        body: JSON.stringify({ actionType: "SALES_INVOICE_CONFIRM", entityLabel: "فاتورة INV-001" }),
      })),
    );
    expect(submitted.status).toBe(201);
    const record = (await submitted.json()) as { id: string; status: string };
    expect(record.status).toBe("pending");

    const pending = (await (
      await app.fetch((await req("/requests/pending", { permissions: "workflow.view", roleCode: "SUPERVISOR" })))
    ).json()) as unknown[];
    expect(pending).toHaveLength(1);

    const pendingForOther = (await (
      await app.fetch((await req("/requests/pending", { permissions: "workflow.view", roleCode: "FINANCE_MANAGER" })))
    ).json()) as unknown[];
    expect(pendingForOther).toHaveLength(0);

    const count = (await (
      await app.fetch((await req("/requests/pending-count", { permissions: "workflow.view", roleCode: "SUPERVISOR" })))
    ).json()) as { count: number };
    expect(count.count).toBe(1);
  });

  it("submits and immediately grants when no config exists for the action type", async () => {
    const { app, req } = newApp();
    const res = await app.fetch(
      (await req("/requests", { method: "POST", userId: "alice", permissions: "workflow.view", body: JSON.stringify({ actionType: "PURCHASE_ORDER_CONFIRM" }) })),
    );
    expect((await res.json() as { status: string }).status).toBe("approved");
  });

  it("approves through a two-step chain and rejects a wrong-role decision", async () => {
    const { app, req } = newApp();
    await app.fetch(
      (await req("/configs", {
        method: "POST",
        permissions: "workflow.config.manage",
        body: JSON.stringify({
          actionType: "SALES_INVOICE_CONFIRM",
          steps: [{ role: "SUPERVISOR" }, { role: "FINANCE_MANAGER" }],
        }),
      })),
    );
    const submitted = (await (
      await app.fetch((await req("/requests", { method: "POST", userId: "alice", permissions: "workflow.view", body: JSON.stringify({ actionType: "SALES_INVOICE_CONFIRM" }) })))
    ).json()) as { id: string };

    const wrongRole = await app.fetch(
      (await req(`/requests/${submitted.id}/decide`, {
        method: "POST",
        userId: "fin-1",
        permissions: "workflow.view,workflow.approve",
        roleCode: "FINANCE_MANAGER",
        body: JSON.stringify({ decision: "approve" }),
      })),
    );
    expect(wrongRole.status).toBe(409);

    const step1 = await app.fetch(
      (await req(`/requests/${submitted.id}/decide`, {
        method: "POST",
        userId: "sup-1",
        permissions: "workflow.view,workflow.approve",
        roleCode: "SUPERVISOR",
        body: JSON.stringify({ decision: "approve" }),
      })),
    );
    expect((await step1.json() as { status: string }).status).toBe("pending");

    const step2 = await app.fetch(
      (await req(`/requests/${submitted.id}/decide`, {
        method: "POST",
        userId: "fin-1",
        permissions: "workflow.view,workflow.approve",
        roleCode: "FINANCE_MANAGER",
        body: JSON.stringify({ decision: "approve" }),
      })),
    );
    expect((await step2.json() as { status: string }).status).toBe("approved");
  });

  /**
   * Guards DEC-2. `GateStep.role` is a ROLE code, and the two document routes
   * that feed the gate used to hand it the caller's PERMISSION set instead, so
   * the two sides of the same gate disagreed about what a step names. A step
   * is satisfied by the role the session grant carries, and by nothing else
   * that happens to be spelled the same.
   */
  it("matches a step's role against the caller's ROLE, never a permission of the same name", async () => {
    const { app, req } = newApp();
    await app.fetch(
      (await req("/configs", {
        method: "POST",
        permissions: "workflow.config.manage",
        body: JSON.stringify({ actionType: "SALES_INVOICE_CONFIRM", steps: [{ role: "FINANCE_MANAGER" }] }),
      })),
    );
    const submit = async () =>
      ((await (
        await app.fetch(
          (await req("/requests", { method: "POST", userId: "alice", permissions: "workflow.view", body: JSON.stringify({ actionType: "SALES_INVOICE_CONFIRM" }) })),
        )
      ).json()) as { id: string }).id;

    // A clerk who holds "FINANCE_MANAGER" as a PERMISSION is not the finance
    // manager, and the step does not open for them.
    const impostor = await app.fetch(
      (await req(`/requests/${await submit()}/decide`, {
        method: "POST",
        userId: "clerk-1",
        permissions: "workflow.view,workflow.approve,FINANCE_MANAGER",
        roleCode: "CLERK",
        body: JSON.stringify({ decision: "approve" }),
      })),
    );
    expect(impostor.status).toBe(409);
    expect(await impostor.json()).toMatchObject({ error: "WRONG_APPROVER" });

    // The same step, decided by the holder of the ROLE, goes through.
    const approver = await app.fetch(
      (await req(`/requests/${await submit()}/decide`, {
        method: "POST",
        userId: "fin-1",
        permissions: "workflow.view,workflow.approve",
        roleCode: "FINANCE_MANAGER",
        body: JSON.stringify({ decision: "approve" }),
      })),
    );
    expect((await approver.json() as { status: string }).status).toBe("approved");
  });

  it("requires workflow.reject to reject a request even with workflow.approve", async () => {
    const { app, req } = newApp();
    await app.fetch(
      (await req("/configs", {
        method: "POST",
        permissions: "workflow.config.manage",
        body: JSON.stringify({ actionType: "SALES_INVOICE_CONFIRM", steps: [{ role: "SUPERVISOR" }] }),
      })),
    );
    const submitted = (await (
      await app.fetch((await req("/requests", { method: "POST", userId: "alice", permissions: "workflow.view", body: JSON.stringify({ actionType: "SALES_INVOICE_CONFIRM" }) })))
    ).json()) as { id: string };

    const denied = await app.fetch(
      (await req(`/requests/${submitted.id}/decide`, {
        method: "POST",
        userId: "sup-1",
        permissions: "workflow.view,workflow.approve",
        roleCode: "SUPERVISOR",
        body: JSON.stringify({ decision: "reject" }),
      })),
    );
    expect(denied.status).toBe(403);

    const rejected = await app.fetch(
      (await req(`/requests/${submitted.id}/decide`, {
        method: "POST",
        userId: "sup-1",
        permissions: "workflow.view,workflow.approve,workflow.reject",
        roleCode: "SUPERVISOR",
        body: JSON.stringify({ decision: "reject", comment: "بيانات ناقصة" }),
      })),
    );
    expect((await rejected.json() as { status: string }).status).toBe("rejected");
  });

  it("approving a sale below the price floor needs sales.pricing_guard.approve on top of workflow.approve; rejecting it does not", async () => {
    const { app, req } = newApp();
    await app.fetch(
      (await req("/configs", {
        method: "POST",
        permissions: "workflow.config.manage",
        body: JSON.stringify({ actionType: "SALES_PRICE_FLOOR_OVERRIDE", steps: [{ role: "BRANCH_MANAGER" }] }),
      })),
    );
    const submit = async () =>
      ((await (await app.fetch((await req("/requests", { method: "POST", userId: "rep-1", permissions: "workflow.view", body: JSON.stringify({ actionType: "SALES_PRICE_FLOOR_OVERRIDE" }) })))).json()) as { id: string }).id;
    const decide = async (id: string, permissions: string, decision: string) =>
      app.fetch((await req(`/requests/${id}/decide`, { method: "POST", userId: "bm-1", permissions, roleCode: "BRANCH_MANAGER", body: JSON.stringify({ decision }) })));

    const first = await submit();
    const denied = await decide(first, "workflow.view,workflow.approve,sales.pricing_guard.manage", "approve");
    expect(denied.status).toBe(403);
    expect(JSON.stringify(await denied.json())).toContain("sales.pricing_guard.approve");

    const approved = await decide(first, "workflow.view,workflow.approve,sales.pricing_guard.approve", "approve");
    expect(((await approved.json()) as { status: string }).status).toBe("approved");

    const rejected = await decide(await submit(), "workflow.view,workflow.reject", "reject");
    expect(((await rejected.json()) as { status: string }).status).toBe("rejected");
  });

  /**
   * `POST /workflow/requests` is deliberately ungated — submitting is a side
   * effect of whatever the caller was already allowed to do — so no permission
   * gate stashes an AuthContext on it, and `callerRoleCodes` (which reads that
   * stash) answered `[]` for everyone. `hasAdminRole` therefore never saw `"*"`
   * and a tenant admin's own submission was held بانتظار الموافقة by a bypass
   * that could not fire (D69). The route now reads the roles off the context it
   * resolves itself.
   */
  it("an admin submitter (\"*\") bypasses the gate and is granted immediately", async () => {
    const { app, req } = newApp();
    await app.fetch(
      (await req("/configs", {
        method: "POST",
        permissions: "workflow.config.manage",
        body: JSON.stringify({ actionType: "SALES_INVOICE_CONFIRM", steps: [{ role: "SUPERVISOR" }] }),
      })),
    );
    const res = await app.fetch(
      (await req("/requests", { method: "POST", userId: "admin", permissions: "*", body: JSON.stringify({ actionType: "SALES_INVOICE_CONFIRM" }) })),
    );
    expect((await res.json() as { status: string }).status).toBe("approved");
  });

  it("refuses a submission from a caller with no session, or without the inbox permission, and stores nothing", async () => {
    const { app, req, requests } = newApp();
    const body = JSON.stringify({ actionType: "SALES_INVOICE_CONFIRM" });
    expect((await app.fetch((await req("/requests", { method: "POST", body })))).status).toBe(401);
    expect((await app.fetch((await req("/requests", { method: "POST", userId: "alice", permissions: "sales.invoice.confirm", body })))).status).toBe(403);
    expect(await requests.list()).toHaveLength(0);
  });

  it("refuses a submission that names its own request id and leaves a standing request as it was", async () => {
    const { app, req, requests } = newApp();
    const first = await app.fetch((await req("/requests", { method: "POST", userId: "alice", permissions: "workflow.view", body: JSON.stringify({ actionType: "SALES_INVOICE_CONFIRM" }) })));
    const { id } = (await first.json()) as { id: string };
    const before = await requests.findById(id);
    for (const key of ["requestId", "id"]) {
      const res = await app.fetch(
        (await req("/requests", { method: "POST", userId: "mallory", permissions: "workflow.view", body: JSON.stringify({ actionType: "TREASURY_VOUCHER_CONFIRM", [key]: id }) })),
      );
      expect(res.status).toBe(400);
      expect(((await res.json()) as { message: string }).message).toMatch(/[\u0600-\u06ff]/);
    }
    expect(await requests.findById(id)).toEqual(before);
    expect(await requests.list()).toHaveLength(1);
  });
});
