import { afterEach, describe, expect, it, vi } from "vitest";
import { bootCloudHarness, type CloudHarness } from "./cloud-harness.js";

const harnesses: CloudHarness[] = [];
afterEach(async () => {
  for (const harness of harnesses.splice(0)) await harness.close();
  vi.restoreAllMocks();
});

async function lockedOwner() {
  vi.spyOn(console, "error").mockImplementation(() => undefined);
  const harness = await bootCloudHarness();
  harnesses.push(harness);
  const operator = await harness.platformToken();
  const created = await harness.send("/api/platform/tenants", {
    method: "POST",
    token: operator,
    body: JSON.stringify({ code: "acme", nameAr: "منشأة أكمي", ownerEmail: "owner@acme.example", ownerNameAr: "المالك", planId: "PLAN-CORE", billingCycle: "monthly", trial: false }),
  });
  expect(created.status).toBe(201);
  const { tenant, adminPin } = (await created.json()) as { tenant: { id: string }; adminPin: string };
  const signIn = (pin: string, client: string) =>
    harness.send("/api/auth/login", { method: "POST", tenant: "acme", client, body: JSON.stringify({ username: "owner@acme.example", pin }) });
  const statuses: number[] = [];
  for (let i = 0; i < 20; i += 1) statuses.push((await signIn(String(100000 + i), `41.33.${i}.10`)).status);
  expect(statuses[19]).toBe(423);
  return { harness, operator, tenantId: tenant.id, adminPin, signIn };
}

describe("a tenant's only administrator locked out on the cloud, with no mail server", () => {
  it("is told to reach platform support, is listed in the console, and signs in again once the operator unlocks the account", async () => {
    const { harness, operator, tenantId, adminPin, signIn } = await lockedOwner();

    const refused = await signIn(adminPin, "196.221.5.5");
    expect(refused.status).toBe(423);
    const told = (await refused.json()) as { message: string; unlockByCode: boolean };
    expect(told.unlockByCode).toBe(false);
    expect(told.message).toContain("دعم المنصة");
    expect(told.message).not.toContain("جهاز الخادم");

    const listed = await harness.send(`/api/platform/tenants/${tenantId}/locked-accounts`, { token: operator });
    expect(await listed.json()).toEqual({ accounts: ["owner@acme.example"] });

    const unlocked = await harness.send(`/api/platform/tenants/${tenantId}/unlock-account`, { method: "POST", token: operator, body: JSON.stringify({ account: "owner@acme.example" }) });
    expect(unlocked.status).toBe(200);
    expect(await unlocked.json()).toEqual({ accounts: [] });

    const back = await signIn(adminPin, "196.221.5.5");
    expect(back.status).toBe(200);
    const session = (await back.json()) as { token: string };
    const trail = await harness.send("/api/audit?stream=security&action=ACCOUNT_UNLOCKED_BY_PLATFORM", { token: session.token, tenant: "acme", client: "196.221.5.5" });
    expect((await trail.text()).match(/ACCOUNT_UNLOCKED_BY_PLATFORM/g)).toHaveLength(1);
  }, 120_000);

  it("is opened by the console's owner PIN reset as well: the PIN it hands out signs in", async () => {
    const { harness, operator, tenantId, signIn } = await lockedOwner();

    const reset = await harness.send(`/api/platform/tenants/${tenantId}/owner-pin/reset`, { method: "POST", token: operator });
    expect(reset.status).toBe(200);
    const { adminPin } = (await reset.json()) as { adminPin: string };

    expect((await signIn(adminPin, "196.221.5.5")).status).toBe(200);
    const listed = await harness.send(`/api/platform/tenants/${tenantId}/locked-accounts`, { token: operator });
    expect(await listed.json()).toEqual({ accounts: [] });
  }, 120_000);
});
