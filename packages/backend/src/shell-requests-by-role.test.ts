import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { ALL_SCOPE, MODULE_CATALOG, SCREEN_REQUESTS, SHELL_REQUESTS, ScreenRequest, ShellRequest, createAuthContext, createEntitlements, holdsShellRequest, mayAskScreenRequest } from "@mezan/domain";
import { seededWorld, type SeededWorld } from "./test-helpers/seeded-world.js";

interface SeededRole {
  readonly code: string;
  readonly permissions: string[];
}

let world: SeededWorld;
let roles: SeededRole[];

beforeAll(async () => {
  world = await seededWorld();
  roles = (await world.request("GET", "/roles")).body as unknown as SeededRole[];
}, 900_000);

afterAll(() => world?.close());

async function statusAs(role: SeededRole, path: string): Promise<number> {
  const token = world.backend.sessions.issue({ userId: `shell-${role.code}`, permissions: role.permissions, roleCode: role.code, branchScope: ALL_SCOPE, warehouseScope: ALL_SCOPE });
  return (await world.backend.app.fetch(new Request(`http://local${path}`, { headers: { authorization: `Bearer ${token}` } }))).status;
}

describe("what the shell asks for is what the session's role may read", () => {
  it("the demo tenant seeds the roles this walks, restricted ones among them", () => {
    expect(roles.length).toBeGreaterThanOrEqual(15);
    expect(roles.some((role) => !role.permissions.includes("*"))).toBe(true);
  });

  it("for every seeded role, no request the shell would send is refused, and every one it withholds would have been", async () => {
    const refused: string[] = [];
    const withheldNeedlessly: string[] = [];
    for (const role of roles) {
      const auth = createAuthContext({ userId: role.code, permissions: role.permissions, branchScope: ALL_SCOPE, warehouseScope: ALL_SCOPE });
      for (const request of Object.values(ShellRequest)) {
        const { path, servedByTenant } = SHELL_REQUESTS[request];
        if (!servedByTenant) continue;
        const status = await statusAs(role, path);
        if (holdsShellRequest(auth, request) && status === 403) refused.push(`${role.code} ${path}`);
        if (!holdsShellRequest(auth, request) && status !== 403) withheldNeedlessly.push(`${role.code} ${path} ${status}`);
      }
    }
    expect(refused).toEqual([]);
    expect(withheldNeedlessly).toEqual([]);
  }, 900_000);

  const tenantServed = Object.values(ShellRequest).filter((request) => SHELL_REQUESTS[request].servedByTenant);

  it.each(tenantServed)("a role holding only the permission behind «%s» is served it, and a role holding every other shell permission is refused it", async (request) => {
    const { path, permission } = SHELL_REQUESTS[request];
    const everyOther = [...new Set(Object.values(SHELL_REQUESTS).map((gate) => gate.permission))].filter((held) => held !== permission);

    expect(await statusAs({ code: `ONLY-${request}`, permissions: [permission] }, path), `${path} with only ${permission}`).not.toBe(403);
    expect(await statusAs({ code: `ALL-BUT-${request}`, permissions: everyOther }, path), `${path} without ${permission}`).toBe(403);
  });

  it("the subscription request, which the platform serves, is gated there on the same permission the shell checks", () => {
    const source = readFileSync(fileURLToPath(new URL("../../../apps/server/src/billing-routes.ts", import.meta.url)), "utf8");
    const handler = source.slice(source.indexOf('app.get("/subscription"'));
    const gatedOn = /allowed\(caller\.grant, "([^"]+)"\)/.exec(handler)?.[1];

    expect(SHELL_REQUESTS[ShellRequest.Subscription].path).toBe("/billing/subscription");
    expect(gatedOn).toBe(SHELL_REQUESTS[ShellRequest.Subscription].permission);
  });
});

describe("what a document screen asks for beside its own document is what the session's role may read", () => {
  const licensed = createEntitlements({ plan: "DEMO", activeModules: MODULE_CATALOG, features: {}, seats: 50, expiresAt: null });

  it("for every seeded role, no such request it would send is refused, and every one it withholds would have been", async () => {
    const refused: string[] = [];
    const withheldNeedlessly: string[] = [];
    for (const role of roles) {
      const auth = createAuthContext({ userId: role.code, permissions: role.permissions, branchScope: ALL_SCOPE, warehouseScope: ALL_SCOPE });
      for (const request of Object.values(ScreenRequest)) {
        const status = await statusAs(role, SCREEN_REQUESTS[request].path);
        const asks = mayAskScreenRequest(auth, licensed, request);
        if (asks && status === 403) refused.push(`${role.code} ${SCREEN_REQUESTS[request].path}`);
        if (!asks && status !== 403) withheldNeedlessly.push(`${role.code} ${SCREEN_REQUESTS[request].path} ${status}`);
      }
    }
    expect(refused).toEqual([]);
    expect(withheldNeedlessly).toEqual([]);
  }, 900_000);

  it.each(Object.values(ScreenRequest))("«%s» is withheld from a tenant whose licence never held the module its permission belongs to", (request) => {
    const auth = createAuthContext({ userId: "ANY", permissions: [SCREEN_REQUESTS[request].permission], branchScope: ALL_SCOPE, warehouseScope: ALL_SCOPE });
    const bare = createEntitlements({ plan: "BARE", activeModules: ["dashboard"], features: {}, seats: 1, expiresAt: null });

    expect(mayAskScreenRequest(auth, licensed, request)).toBe(true);
    expect(mayAskScreenRequest(auth, bare, request)).toBe(false);
  });
});
