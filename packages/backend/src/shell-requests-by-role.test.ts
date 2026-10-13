import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { ALL_SCOPE, SHELL_REQUESTS, ShellRequest, createAuthContext, holdsShellRequest } from "@mezan/domain";
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
});
