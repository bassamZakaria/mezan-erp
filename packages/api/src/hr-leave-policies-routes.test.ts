import { describe, it, expect, afterEach } from "vitest";
import { createSqliteLeavePolicyRepository } from "@mezan/persistence";
import { createHrLeavePoliciesRoutes } from "./hr-leave-policies-routes.js";

const closers: { close(): void }[] = [];
afterEach(() => {
  for (const h of closers.splice(0)) h.close();
});

function req(path: string, init: RequestInit & { permissions?: string } = {}) {
  const headers = new Headers(init.headers);
  if (init.permissions !== undefined) headers.set("x-permissions", init.permissions);
  if (init.body) headers.set("content-type", "application/json");
  return new Request(`http://local${path}`, { ...init, headers });
}

async function newApp() {
  const policies = createSqliteLeavePolicyRepository();
  closers.push(policies);
  let seq = 0;
  return { app: createHrLeavePoliciesRoutes({ policies, idGen: () => `id-${++seq}` }), policies };
}

describe("hr leave-policies router", () => {
  it("rejects with no permission", async () => {
    const { app } = await newApp();
    expect((await app.fetch(req("/"))).status).toBe(403);
  });

  it("lists presets", async () => {
    const { app } = await newApp();
    const res = await app.fetch(req("/presets", { permissions: "hr.leave_policy.view" }));
    expect(res.status).toBe(200);
    const body = (await res.json()) as { source: string }[];
    expect(body.map((p) => p.source).sort()).toEqual(["PRESET_EG_LAW_12_2003", "PRESET_EG_LAW_14_2025"]);
  });

  it("applies a preset, then GET / returns the effective 8-row matrix", async () => {
    const { app } = await newApp();
    const apply = await app.fetch(
      req("/apply-preset", {
        method: "POST",
        permissions: "hr.leave_policy.apply_preset",
        body: JSON.stringify({ source: "PRESET_EG_LAW_12_2003" }),
      }),
    );
    expect(apply.status).toBe(201);

    const list = await app.fetch(req("/?asOfDate=2026-01-01", { permissions: "hr.leave_policy.view" }));
    const body = (await list.json()) as { leaveTypeCode: string; baseBalanceDays: number }[];
    expect(body).toHaveLength(8);
    expect(body.find((v) => v.leaveTypeCode === "ANNUAL")?.baseBalanceDays).toBe(21);
  });

  it("sets a manual policy version", async () => {
    const { app } = await newApp();
    const res = await app.fetch(
      req("/", {
        method: "POST",
        permissions: "hr.leave_policy.edit",
        body: JSON.stringify({
          leaveTypeCode: "ANNUAL",
          effectiveDate: "2027-01-01",
          baseBalanceDays: 25,
          accrualFrequency: "MONTHLY",
          carryover: "LIMITED",
          carryoverMaxDays: 10,
          payoutOnTermination: true,
          legallyMandatory: true,
        }),
      }),
    );
    expect(res.status).toBe(201);
  });

  it("rejects an unknown leave type on the versions endpoint", async () => {
    const { app } = await newApp();
    const res = await app.fetch(req("/NOT_A_TYPE/versions", { permissions: "hr.leave_policy.view" }));
    expect(res.status).toBe(400);
  });
});
