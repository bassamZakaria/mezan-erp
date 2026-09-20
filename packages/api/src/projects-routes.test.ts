import { describe, it, expect, afterEach } from "vitest";
import { createSqliteCostCenterRepository, type SqliteCostCenterRepositoryHandle } from "@mezan/persistence";
// `@mezan/persistence`'s package barrel (src/index.ts) is centrally wired by
// another agent working on this same worktree — not editable here — so this
// new repository isn't exported through it yet. Import its module directly
// by relative path until that wiring lands.
import {
  createSqliteProjectRepository,
  type SqliteProjectRepositoryHandle,
} from "../../persistence/src/project-repository.js";
import { createProjectsRoutes } from "./projects-routes.js";
import { MasterDataKind, type MasterDataChecks, type MasterRecordCheck } from "./master-data-check.js";

import { insecureHeaderAuthContextResolver } from "./permission-gate.js";
const projectHandles: SqliteProjectRepositoryHandle[] = [];
const costCenterHandles: SqliteCostCenterRepositoryHandle[] = [];

afterEach(() => {
  for (const h of projectHandles.splice(0)) h.close();
  for (const h of costCenterHandles.splice(0)) h.close();
});

function newApp(masterData?: MasterDataChecks) {
  const projects = createSqliteProjectRepository();
  const costCenters = createSqliteCostCenterRepository();
  projectHandles.push(projects);
  costCenterHandles.push(costCenters);
  const app = createProjectsRoutes({ projects, costCenters, ...(masterData ? { masterData } : {}) }, insecureHeaderAuthContextResolver);
  return { app, projects, costCenters };
}

function req(path: string, init: RequestInit & { permissions?: string } = {}) {
  const headers = new Headers(init.headers);
  if (init.permissions !== undefined) headers.set("x-permissions", init.permissions);
  return new Request(`http://local${path}`, { ...init, headers });
}

const payload = { id: "p1", code: "PRJ-001", nameAr: "برج النيل" };

describe("projects router — permission gate", () => {
  it("rejects a request with no permissions with 403", async () => {
    const { app } = newApp();
    const res = await app.fetch(req("/"));
    expect(res.status).toBe(403);
    const body = (await res.json()) as { error: string; permission: string };
    expect(body.error).toBe("PERMISSION_DENIED");
    expect(body.permission).toBe("projects.project.view");
  });

  it("rejects POST / with only view permission", async () => {
    const { app } = newApp();
    const res = await app.fetch(
      req("/", { method: "POST", permissions: "projects.project.view", headers: { "content-type": "application/json" }, body: JSON.stringify(payload) }),
    );
    expect(res.status).toBe(403);
  });

  it("allows POST / with projects.project.manage", async () => {
    const { app } = newApp();
    const res = await app.fetch(
      req("/", { method: "POST", permissions: "projects.project.manage", headers: { "content-type": "application/json" }, body: JSON.stringify(payload) }),
    );
    expect(res.status).toBe(201);
  });
});

describe("projects router — CRUD", () => {
  it("creates a project, auto-creating a linked PRJ-{code} cost center", async () => {
    const { app, costCenters } = newApp();
    const createRes = await app.fetch(
      req("/", { method: "POST", permissions: "projects.project.manage", headers: { "content-type": "application/json" }, body: JSON.stringify(payload) }),
    );
    expect(createRes.status).toBe(201);
    const body = (await createRes.json()) as { costCenterId: string; budget: string };
    expect(body.budget).toBe("0.000000");

    const linkedCostCenter = await costCenters.findByCode("PRJ-PRJ-001");
    expect(linkedCostCenter).not.toBeNull();
    expect(linkedCostCenter?.id).toBe(body.costCenterId);
    expect(linkedCostCenter?.type).toBe("project");
  });

  it("creates a project with a budget and retrieves it by id", async () => {
    const { app } = newApp();
    await app.fetch(
      req("/", {
        method: "POST",
        permissions: "projects.project.manage",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ ...payload, budget: "1250.50" }),
      }),
    );
    const getRes = await app.fetch(req("/p1", { permissions: "projects.project.view" }));
    expect(getRes.status).toBe(200);
    const body = (await getRes.json()) as { budget: string; status: string };
    expect(body.budget).toBe("1250.500000");
    expect(body.status).toBe("planned");
  });

  it("404s for an unknown project", async () => {
    const { app } = newApp();
    const res = await app.fetch(req("/nope", { permissions: "projects.project.view" }));
    expect(res.status).toBe(404);
  });

  it("400s a malformed create payload", async () => {
    const { app } = newApp();
    const res = await app.fetch(
      req("/", { method: "POST", permissions: "projects.project.manage", headers: { "content-type": "application/json" }, body: JSON.stringify({ code: "PRJ-001" }) }),
    );
    expect(res.status).toBe(400);
  });

  it("409s a duplicate project code", async () => {
    const { app } = newApp();
    await app.fetch(req("/", { method: "POST", permissions: "projects.project.manage", headers: { "content-type": "application/json" }, body: JSON.stringify(payload) }));
    const res = await app.fetch(
      req("/", { method: "POST", permissions: "projects.project.manage", headers: { "content-type": "application/json" }, body: JSON.stringify({ ...payload, id: "p2" }) }),
    );
    expect(res.status).toBe(409);
  });

  it("PATCH edits a project (e.g. status transition)", async () => {
    const { app } = newApp();
    await app.fetch(req("/", { method: "POST", permissions: "projects.project.manage", headers: { "content-type": "application/json" }, body: JSON.stringify(payload) }));
    const res = await app.fetch(
      req("/p1", { method: "PATCH", permissions: "projects.project.manage", headers: { "content-type": "application/json" }, body: JSON.stringify({ status: "active" }) }),
    );
    expect(res.status).toBe(200);
    expect(((await res.json()) as { status: string }).status).toBe("active");
  });

  it("PATCH 404s for an unknown project", async () => {
    const { app } = newApp();
    const res = await app.fetch(
      req("/nope", { method: "PATCH", permissions: "projects.project.manage", headers: { "content-type": "application/json" }, body: JSON.stringify({ status: "active" }) }),
    );
    expect(res.status).toBe(404);
  });
});

function roster(...ids: readonly string[]): MasterRecordCheck {
  const held = new Set(ids);
  return { findById: async (id) => (held.has(id) ? { id } : null) };
}

describe("D310 — a project may not name a customer that does not exist", () => {
  const MASTER_DATA: MasterDataChecks = { [MasterDataKind.Customer]: roster("CUST-1") };

  it("refuses a project whose customer has no master record", async () => {
    const { app } = newApp(MASTER_DATA);
    const res = await app.fetch(
      req("/", {
        method: "POST",
        permissions: "projects.project.manage",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ ...payload, customerId: "CUST-PHANTOM" }),
      }),
    );
    expect(res.status).toBe(422);
    const body = (await res.json()) as { error: string; customerIds: string[]; messageEn: string };
    expect(body.error).toBe("CUSTOMER_NOT_FOUND");
    expect(body.customerIds).toEqual(["CUST-PHANTOM"]);
    expect(body.messageEn).toContain("CUST-PHANTOM");
  });

  it("still creates a project whose customer is real", async () => {
    const { app } = newApp(MASTER_DATA);
    const res = await app.fetch(
      req("/", {
        method: "POST",
        permissions: "projects.project.manage",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ ...payload, customerId: "CUST-1" }),
      }),
    );
    expect(res.status).toBe(201);
  });
});
