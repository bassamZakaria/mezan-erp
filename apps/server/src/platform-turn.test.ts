import { afterEach, describe, expect, it } from "vitest";
import { drainForeignWrites, drainUntransactedAudits } from "@mezan/persistence";
import { drainTurnYields } from "@mezan/api";
import { bootCloudHarness, proxiedRequest, type CloudHarness } from "./cloud-harness.js";
import { SWEEP_PENDING_AFTER_MS } from "./card-checkout.js";

const T = Date.parse("2026-01-15T00:00:00.000Z");
const MINUTE = 60_000;

const harnesses: CloudHarness[] = [];
afterEach(async () => {
  for (const harness of harnesses.splice(0)) await harness.close();
});

async function boot() {
  let clock = T;
  const harness = await bootCloudHarness({ vars: { MEZAN_PAYMOB_TEST_MODE: "1" }, options: { now: () => new Date(clock) } });
  harnesses.push(harness);
  return { harness, advance: (ms: number) => void (clock += ms) };
}

async function provisionAndLogin(harness: CloudHarness, owner: string, code: string) {
  const res = await harness.send("/api/platform/tenants", {
    method: "POST",
    token: owner,
    body: JSON.stringify({
      code, nameAr: `منشأة ${code}`, ownerEmail: `owner@${code}.example`, ownerNameAr: "المالك", planId: "PLAN-CORE", billingCycle: "monthly", trial: false,
    }),
  });
  expect(res.status).toBe(201);
  const provisioned = (await res.json()) as { tenant: { id: string }; adminEmail: string; adminPassword: string };
  const login = await harness.send("/api/auth/login", { method: "POST", tenant: code, body: JSON.stringify({ username: provisioned.adminEmail, password: provisioned.adminPassword }) });
  expect(login.status).toBe(200);
  const issued = (await login.json()) as { token: string };
  const changed = await harness.send("/api/profile/change-password", { method: "POST", token: issued.token, tenant: code, body: JSON.stringify({ currentPassword: provisioned.adminPassword, newPassword: "owner-own-password" }) });
  expect(changed.status).toBe(204);
  const own = await harness.send("/api/auth/login", { method: "POST", tenant: code, body: JSON.stringify({ username: provisioned.adminEmail, password: "owner-own-password" }) });
  return { id: provisioned.tenant.id, token: ((await own.json()) as { token: string }).token };
}

describe("the platform database under a sweep, a card callback and a console write at once", () => {
  it("settles the payment exactly once, creates every user with its event, and lets no write land in another's transaction", async () => {
    const { harness, advance } = await boot();
    const owner = await harness.platformToken();
    const acme = await provisionAndLogin(harness, owner, "acme");
    const opened = await harness.send("/api/billing/checkout", { method: "POST", token: acme.token, tenant: "acme", body: JSON.stringify({ returnPath: "/settings/billing" }) });
    expect(opened.status).toBe(201);
    const { id: checkoutId } = (await opened.json()) as { id: string };
    advance(SWEEP_PENDING_AFTER_MS + MINUTE);
    const press = () =>
      Promise.resolve(
        harness.app.root.fetch(
          proxiedRequest(`/billing/test-checkout/${checkoutId}/complete`, { method: "POST", headers: { "content-type": "application/x-www-form-urlencoded" }, body: "outcome=success" }),
        ),
      );
    const sweep = () => harness.send("/api/platform/card-checkouts/sweep", { method: "POST", token: owner });
    const addUser = (n: number) =>
      harness.send("/api/platform/users", { method: "POST", token: owner, body: JSON.stringify({ email: `staff${n}@mezan.app`, password: "a long enough password", role: "support" }) });

    const [swept, pressed, pressedAgain, ...users] = await Promise.all([sweep(), press(), press(), addUser(1), addUser(2), addUser(3)]);
    const sweptAfter = await sweep();

    expect([200, 409]).toContain(swept.status);
    expect([pressed.status, pressedAgain.status]).toEqual([303, 303]);
    expect(users.map((res) => res.status)).toEqual([201, 201, 201]);
    expect(sweptAfter.status).toBe(200);

    const summary = (await (await harness.send(`/api/platform/tenants/${acme.id}`, { token: owner })).json()) as { payments: unknown[] };
    expect(summary.payments).toHaveLength(1);
    const checkouts = (await (await harness.send(`/api/platform/tenants/${acme.id}/card-checkouts`, { token: owner })).json()) as { checkouts: { status: string }[] };
    expect(checkouts.checkouts.map((checkout) => checkout.status)).toEqual(["paid"]);

    const listed = (await (await harness.send("/api/platform/users", { token: owner })).json()) as { email: string }[];
    expect(listed.map((user) => user.email).filter((email) => email.startsWith("staff")).sort()).toEqual(["staff1@mezan.app", "staff2@mezan.app", "staff3@mezan.app"]);

    expect(drainForeignWrites()).toEqual([]);
    expect(drainUntransactedAudits()).toEqual([]);
    expect(drainTurnYields()).toEqual([]);
  });
});
