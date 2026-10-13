import { describe, expect, it } from "vitest";
import { Hono } from "hono";
import { ALL_SCOPE, createAuthContext } from "@mezan/domain";
import { branchPolicyEnforcement } from "./branch-policy.js";

function appFor(branchScope: readonly string[] | typeof ALL_SCOPE) {
  const ctx = createAuthContext({ userId: "u1", permissions: ["*"], branchScope, warehouseScope: ALL_SCOPE });
  const app = new Hono();
  app.use("*", branchPolicyEnforcement({ resolveAuthContext: () => ctx }));
  app.get("/undeclared-files/*", (c) => c.json({ served: c.req.path }));
  app.get("/projects/*", (c) => c.json({ served: c.req.path }));
  return app;
}

describe("a handler mounted on a wildcard path is held to the branch policy like any other (D111)", () => {
  it("is refused to a branch-restricted session when its family declares nothing", async () => {
    const res = await appFor(["BR-ALEX"]).fetch(new Request("http://x/undeclared-files/a/b"));
    expect(res.status).toBe(403);
    expect(((await res.json()) as { error: string }).error).toBe("BRANCH_POLICY_UNDECLARED");
  });

  it("answers by its family's policy when one is declared", async () => {
    const res = await appFor(["BR-ALEX"]).fetch(new Request("http://x/projects/a/b"));
    expect(res.status).toBe(403);
    expect(((await res.json()) as { error: string }).error).toBe("COMPANY_WIDE_REPORT");
  });

  it("stays open to an unrestricted session", async () => {
    expect((await appFor(ALL_SCOPE).fetch(new Request("http://x/undeclared-files/a"))).status).toBe(200);
  });
});
