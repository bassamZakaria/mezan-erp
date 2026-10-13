import { ALL_SCOPE, DISPLAY_SETTING_KEYS, DisplaySettingKey } from "@mezan/domain";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { seededWorld, type SeededWorld } from "./test-helpers/seeded-world.js";

interface SeededRole {
  readonly code: string;
  readonly permissions: string[];
}

let world: SeededWorld;
let roles: SeededRole[];
let full: Record<string, unknown>;

beforeAll(async () => {
  world = await seededWorld();
  roles = (await world.request("GET", "/roles")).body as unknown as SeededRole[];
  full = (await world.request("GET", "/settings")).body;
}, 900_000);

afterAll(() => world?.close());

async function as(role: SeededRole, path: string): Promise<{ status: number; body: Record<string, unknown> }> {
  const token = world.backend.sessions.issue({ userId: `display-${role.code}`, permissions: role.permissions, roleCode: role.code, branchScope: ALL_SCOPE, warehouseScope: ALL_SCOPE });
  const res = await world.backend.app.fetch(new Request(`http://local${path}`, { headers: { authorization: `Bearer ${token}` } }));
  return { status: res.status, body: (await res.json()) as Record<string, unknown> };
}

describe("what any signed-in user may read of the settings: how figures are shown and who the company is", () => {
  it("the allowlist is the display keys and the company's identity, and nothing that is policy or a secret", () => {
    expect([...DISPLAY_SETTING_KEYS].sort()).toEqual(Object.values(DisplaySettingKey).sort());
    for (const secret of ["smtpPassword", "smtpHost", "smtpUser", "allowedEmailDomains", "allowNegativeStock", "periodCloseSingleOperatorMode", "tenantClaimedAt"]) {
      expect(DISPLAY_SETTING_KEYS as readonly string[], secret).not.toContain(secret);
    }
  });

  it("every seeded role reads it — restricted ones included — and gets exactly the allowlisted keys with the tenant's own values", async () => {
    const restricted = roles.filter((role) => !role.permissions.includes("*") && !role.permissions.includes("admin.settings.view"));
    expect(restricted.length).toBeGreaterThan(5);
    for (const role of roles) {
      const display = await as(role, "/settings/display");
      expect(`${role.code} ${display.status}`).toBe(`${role.code} 200`);
      expect(Object.keys(display.body).sort(), role.code).toEqual([...DISPLAY_SETTING_KEYS].sort());
      for (const key of DISPLAY_SETTING_KEYS) expect(display.body[key], `${role.code} ${key}`).toEqual(full[key]);
    }
    for (const role of restricted) expect(`${role.code} ${(await as(role, "/settings")).status}`).toBe(`${role.code} 403`);
  }, 900_000);

  it("it follows the tenant's settings as they change, and is refused to nobody but the signed-out", async () => {
    const saved = await world.request("PUT", "/settings", { ...full, dateNumerals: "arabic", companyName: "شركة الاختبار للتجارة" });
    expect(saved.status, JSON.stringify(saved.body)).toBe(200);
    const restricted = roles.find((role) => !role.permissions.includes("*") && !role.permissions.includes("admin.settings.view"))!;
    expect((await as(restricted, "/settings/display")).body).toMatchObject({ dateNumerals: "arabic", companyName: "شركة الاختبار للتجارة" });
    const anonymous = await world.backend.app.fetch(new Request("http://local/settings/display"));
    expect(anonymous.status).toBe(401);
  });
});
