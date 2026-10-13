import { afterEach, describe, expect, it } from "vitest";
import { ALL_SCOPE, MODULE_CATALOG, SHELL_REQUESTS, ShellRequest, createEntitlements, planServesShellRequest } from "@mezan/domain";
import { createBackend, type BackendHandle } from "./create-backend.js";

const handles: BackendHandle[] = [];
afterEach(() => {
  for (const handle of handles.splice(0)) handle.close();
});

const NEVER_EXPIRES = "2099-01-01T00:00:00.000Z";
const tenantServed = Object.values(ShellRequest).filter((request) => SHELL_REQUESTS[request].servedByTenant);

async function tenantOn(activeModules: readonly string[]) {
  const entitlements = createEntitlements({
    plan: "CORE", activeModules: [...activeModules], features: {}, seats: 5, expiresAt: NEVER_EXPIRES,
  });
  const backend = await createBackend({ dbPath: ":memory:", resolveEntitlements: () => entitlements });
  handles.push(backend);
  const token = backend.sessions.issue({ userId: "admin", permissions: ["*"], roleCode: null, branchScope: ALL_SCOPE, warehouseScope: ALL_SCOPE });
  const statusOf = async (path: string) => {
    const res = await backend.app.fetch(new Request(`http://local${path}`, { headers: { authorization: `Bearer ${token}` } }));
    return { status: res.status, error: res.status === 403 ? ((await res.json()) as { error?: string }).error : undefined };
  };
  return { entitlements, statusOf };
}

describe("what the shell asks for is what the tenant's plan includes", () => {
  it("names the module behind every shell request the server gates by module, and no other", async () => {
    const withoutHr = MODULE_CATALOG.filter((module) => module !== "hr");
    const t = await tenantOn(withoutHr);
    const refusedForTheModule: ShellRequest[] = [];
    for (const request of tenantServed) {
      const answer = await t.statusOf(SHELL_REQUESTS[request].path);
      if (answer.error === "MODULE_NOT_LICENSED") refusedForTheModule.push(request);
    }

    expect(refusedForTheModule.sort()).toEqual(tenantServed.filter((request) => SHELL_REQUESTS[request].module === "hr").sort());
    expect(refusedForTheModule.sort()).toEqual([ShellRequest.Employees, ShellRequest.JobTitles].sort());
  });

  it("is never refused for the module by a request the shell would send, and withholds only what would be", async () => {
    for (const activeModules of [MODULE_CATALOG, MODULE_CATALOG.filter((module) => module !== "hr")]) {
      const t = await tenantOn(activeModules);
      for (const request of tenantServed) {
        const answer = await t.statusOf(SHELL_REQUESTS[request].path);
        const asked = planServesShellRequest(t.entitlements, request);
        expect(`${request} asked=${asked} refused=${answer.error === "MODULE_NOT_LICENSED"}`).toBe(`${request} asked=${asked} refused=${!asked}`);
      }
    }
  });
});
