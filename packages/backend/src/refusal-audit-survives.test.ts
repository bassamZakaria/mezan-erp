import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { ALL_SCOPE } from "@mezan/domain";
import { seededWorld, type SeededWorld } from "./test-helpers/seeded-world.js";

const OTHER_BRANCH = "BR-ALEX";
const TENANT_DOMAIN = "cyag.example";
const MAIN_BRANCH_USER = `hossam.nabil@${TENANT_DOMAIN}`;
const SIGN_IN_USER = `laila.ibrahim@${TENANT_DOMAIN}`;

const BODIES: readonly (readonly [string, Record<string, unknown>])[] = [
  ["no id", {}],
  ["an id key", { id: "x" }],
  ["an id key one object down", { z: { id: "x" } }],
];

enum RefusedAttempt {
  Deactivate = "deactivate",
  Activate = "activate",
  Unlock = "unlock",
  Erase = "erase",
}

let world: SeededWorld;
let targetId: string;

beforeAll(async () => {
  world = await seededWorld();
  const users = (await world.request("GET", "/users")).body as unknown as { id: string; email: string }[];
  targetId = users.find((user) => user.email === MAIN_BRANCH_USER)!.id;
}, 900_000);

afterAll(() => world?.close());

const auditRows = (action: string): number => world.count("audit_event", `action = '${action}'`);
const securityRows = (): number => world.count("audit_event", "stream = 'security'");

async function post(path: string, body: unknown, session?: { userId: string; permissions: string[]; branchScope: readonly string[] | typeof ALL_SCOPE }): Promise<number> {
  const headers: Record<string, string> = { "content-type": "application/json" };
  if (session) headers.authorization = `Bearer ${await world.backend.sessions.issue({ ...session, roleCode: null, warehouseScope: ALL_SCOPE })}`;
  return (await world.backend.app.fetch(new Request(`http://local${path}`, { method: "POST", headers, body: JSON.stringify(body) }))).status;
}

async function chainIsSound(): Promise<void> {
  const verified = (await world.request("GET", "/audit/verify")).body as { ok?: boolean };
  expect(verified.ok, JSON.stringify(verified)).toBe(true);
}

describe("the audit row of a refused attempt is there after the answer, whatever the body names", () => {
  const cases = Object.values(RefusedAttempt).flatMap((attempt) => BODIES.map(([label, body]) => [attempt, label, body] as const));

  it.each(cases)("a branch-restricted administrator refused «%s» on a user of another branch — %s", async (attempt, _label, body) => {
    const before = auditRows("PRIVILEGE_ESCALATION_DENIED");
    const status = await post(`/users/${targetId}/${attempt}`, body, { userId: "USER-ALEX-ADMIN", permissions: ["*"], branchScope: [OTHER_BRANCH] });
    expect(status).toBe(404);
    expect(auditRows("PRIVILEGE_ESCALATION_DENIED")).toBe(before + 1);
    await chainIsSound();
  });

  it.each(BODIES)("a sign-in with the wrong password — %s", async (_label, body) => {
    const before = securityRows();
    const status = await post("/auth/login", { username: SIGN_IN_USER, password: "pw-000000", ...body });
    expect(status).toBeGreaterThanOrEqual(400);
    expect(securityRows()).toBe(before + 1);
    await chainIsSound();
  });

  it.each(BODIES)("a create by a session without the permission, on a route that runs in the create transaction — %s", async (label, body) => {
    const before = auditRows("PERMISSION_DENIED");
    const status = await post("/sales-invoices", body, { userId: `USER-NO-GRANT-${label}`, permissions: ["dashboard.view"], branchScope: ALL_SCOPE });
    expect(status).toBe(403);
    expect(auditRows("PERMISSION_DENIED")).toBe(before + 1);
    await chainIsSound();
  });
});
