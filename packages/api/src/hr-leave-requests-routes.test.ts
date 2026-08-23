import { describe, it, expect, afterEach } from "vitest";
import { NextNumberService, createDefaultSettings } from "@mezan/domain";
import { createSqliteLeaveRequestRepository, createSqliteSequenceStore, createSqliteSettingsStore } from "@mezan/persistence";
import { createHrLeaveRequestsRoutes } from "./hr-leave-requests-routes.js";

const closers: { close(): void }[] = [];
afterEach(() => {
  for (const h of closers.splice(0)) h.close();
});

function req(path: string, init: RequestInit & { permissions?: string; userId?: string; roles?: string } = {}) {
  const headers = new Headers(init.headers);
  if (init.permissions !== undefined) headers.set("x-permissions", init.permissions);
  if (init.userId !== undefined) headers.set("x-user-id", init.userId);
  if (init.roles !== undefined) headers.set("x-roles", init.roles);
  if (init.body) headers.set("content-type", "application/json");
  return new Request(`http://local${path}`, { ...init, headers });
}

async function newApp() {
  const requests = createSqliteLeaveRequestRepository();
  const sequences = createSqliteSequenceStore();
  const settings = createSqliteSettingsStore();
  closers.push(requests, sequences, settings);
  await settings.save(createDefaultSettings());
  const numbering = new NextNumberService(sequences);
  const accrualCreditSource = { async sumCreditedDays() { return 21; } };
  let seq = 0;
  return {
    app: createHrLeaveRequestsRoutes({ requests, numbering, settings, accrualCreditSource, idGen: () => `req-${++seq}` }),
    requests,
  };
}

describe("hr leave-requests router", () => {
  it("rejects with no permission", async () => {
    const { app } = await newApp();
    expect((await app.fetch(req("/"))).status).toBe(403);
  });

  it("submits a request (holds PENDING by default), then a correctly-roled decide approves it", async () => {
    const { app } = await newApp();
    const submit = await app.fetch(
      req("/", {
        method: "POST",
        permissions: "hr.leave.create",
        userId: "u1",
        body: JSON.stringify({ employeeId: "emp-1", leaveTypeCode: "ANNUAL", startDate: "2026-08-16", endDate: "2026-08-17" }),
      }),
    );
    expect(submit.status).toBe(201);
    const created = (await submit.json()) as { id: string; status: string; requestNo: string };
    expect(created.status).toBe("PENDING");
    expect(created.requestNo).toBe("LR-000001");

    const denied = await app.fetch(
      req(`/${created.id}/decide`, {
        method: "POST",
        permissions: "hr.leave.approve",
        userId: "someone-else",
        roles: "sales_rep",
        body: JSON.stringify({ decision: "approve" }),
      }),
    );
    expect(denied.status).toBe(409);

    const approved = await app.fetch(
      req(`/${created.id}/decide`, {
        method: "POST",
        permissions: "hr.leave.approve",
        userId: "mgr-1",
        roles: "hr_manager",
        body: JSON.stringify({ decision: "approve" }),
      }),
    );
    expect(approved.status).toBe(200);
    expect(((await approved.json()) as { status: string }).status).toBe("APPROVED");
  });

  it("cancels a pending request", async () => {
    const { app } = await newApp();
    const submit = await app.fetch(
      req("/", {
        method: "POST",
        permissions: "hr.leave.create",
        userId: "u1",
        body: JSON.stringify({ employeeId: "emp-1", leaveTypeCode: "SICK", startDate: "2026-08-16", endDate: "2026-08-16" }),
      }),
    );
    const created = (await submit.json()) as { id: string };
    const cancel = await app.fetch(req(`/${created.id}/cancel`, { method: "POST", permissions: "hr.leave.create" }));
    expect(cancel.status).toBe(200);
    expect(((await cancel.json()) as { status: string }).status).toBe("CANCELLED");
  });

  it("computes the leave balance from the injected accrual credit source + submitted requests", async () => {
    const { app } = await newApp();
    await app.fetch(
      req("/", {
        method: "POST",
        permissions: "hr.leave.create",
        userId: "u1",
        body: JSON.stringify({ employeeId: "emp-1", leaveTypeCode: "ANNUAL", startDate: "2026-08-16", endDate: "2026-08-16" }),
      }),
    );
    const res = await app.fetch(req("/balance/emp-1/ANNUAL", { permissions: "hr.leave.view" }));
    expect(res.status).toBe(200);
    const body = (await res.json()) as { entitledDays: number; pendingDays: number };
    expect(body.entitledDays).toBe(21);
    expect(body.pendingDays).toBe(1);
  });
});
