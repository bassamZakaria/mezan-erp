import { describe, it, expect, afterEach } from "vitest";
import { createSqliteCostCenterRepository, type SqliteCostCenterRepositoryHandle } from "@mezan/persistence";
import { createCostCentersRoutes } from "./cost-centers-routes.js";
import { AuditChangeAction, auditChangesOf, type AuditEvent, type AuditSink, type AuditStream } from "@mezan/domain";

import { insecureHeaderAuthContextResolver } from "./permission-gate.js";
const handles: SqliteCostCenterRepositoryHandle[] = [];

afterEach(() => {
  for (const h of handles.splice(0)) h.close();
});

function newApp() {
  const repo = createSqliteCostCenterRepository();
  handles.push(repo);
  const app = createCostCentersRoutes(repo, insecureHeaderAuthContextResolver);
  return { app, repo };
}

function req(path: string, init: RequestInit & { permissions?: string } = {}) {
  const headers = new Headers(init.headers);
  if (init.permissions !== undefined) headers.set("x-permissions", init.permissions);
  return new Request(`http://local${path}`, { ...init, headers });
}

const payload = { id: "cc1", code: "CC-001", nameAr: "الإدارة العامة" };

describe("cost-centers router — permission gate", () => {
  it("rejects a request with no permissions with 403 (reuses accounting.coa.view)", async () => {
    const { app } = newApp();
    const res = await app.fetch(req("/"));
    expect(res.status).toBe(403);
    const body = (await res.json()) as { error: string; permission: string };
    expect(body.error).toBe("PERMISSION_DENIED");
    expect(body.permission).toBe("accounting.coa.view");
  });

  it("rejects POST / with only view permission", async () => {
    const { app } = newApp();
    const res = await app.fetch(
      req("/", { method: "POST", permissions: "accounting.coa.view", headers: { "content-type": "application/json" }, body: JSON.stringify(payload) }),
    );
    expect(res.status).toBe(403);
  });

  it("allows POST / with accounting.coa.manage (reused, no dedicated cost-center permission exists)", async () => {
    const { app } = newApp();
    const res = await app.fetch(
      req("/", { method: "POST", permissions: "accounting.coa.manage", headers: { "content-type": "application/json" }, body: JSON.stringify(payload) }),
    );
    expect(res.status).toBe(201);
  });
});

describe("cost-centers router — CRUD", () => {
  it("creates a cost center and retrieves it by id", async () => {
    const { app } = newApp();
    const createRes = await app.fetch(
      req("/", { method: "POST", permissions: "accounting.coa.manage", headers: { "content-type": "application/json" }, body: JSON.stringify(payload) }),
    );
    expect(createRes.status).toBe(201);

    const getRes = await app.fetch(req("/cc1", { permissions: "accounting.coa.view" }));
    expect(getRes.status).toBe(200);
    expect((await getRes.json()) as unknown).toMatchObject({ id: "cc1", code: "CC-001", status: "active" });
  });

  it("404s for an unknown cost center", async () => {
    const { app } = newApp();
    const res = await app.fetch(req("/nope", { permissions: "accounting.coa.view" }));
    expect(res.status).toBe(404);
  });

  it("400s a malformed create payload", async () => {
    const { app } = newApp();
    const res = await app.fetch(
      req("/", { method: "POST", permissions: "accounting.coa.manage", headers: { "content-type": "application/json" }, body: JSON.stringify({ code: "CC-001" }) }),
    );
    expect(res.status).toBe(400);
  });

  it("409s a duplicate cost center code", async () => {
    const { app } = newApp();
    await app.fetch(req("/", { method: "POST", permissions: "accounting.coa.manage", headers: { "content-type": "application/json" }, body: JSON.stringify(payload) }));
    const res = await app.fetch(
      req("/", { method: "POST", permissions: "accounting.coa.manage", headers: { "content-type": "application/json" }, body: JSON.stringify({ ...payload, id: "cc2" }) }),
    );
    expect(res.status).toBe(409);
  });

  it("422s creating a cost center under a non-existent parent", async () => {
    const { app } = newApp();
    const res = await app.fetch(
      req("/", { method: "POST", permissions: "accounting.coa.manage", headers: { "content-type": "application/json" }, body: JSON.stringify({ ...payload, id: "cc2", code: "CC-002", parentId: "nope" }) }),
    );
    expect(res.status).toBe(422);
  });

  it("PATCH edits a cost center (e.g. deactivate)", async () => {
    const { app } = newApp();
    await app.fetch(req("/", { method: "POST", permissions: "accounting.coa.manage", headers: { "content-type": "application/json" }, body: JSON.stringify(payload) }));
    const res = await app.fetch(
      req("/cc1", { method: "PATCH", permissions: "accounting.coa.manage", headers: { "content-type": "application/json" }, body: JSON.stringify({ status: "inactive" }) }),
    );
    expect(res.status).toBe(200);
    expect(((await res.json()) as { status: string }).status).toBe("inactive");
  });

  it("GET /tree returns the nested hierarchy", async () => {
    const { app } = newApp();
    await app.fetch(req("/", { method: "POST", permissions: "accounting.coa.manage", headers: { "content-type": "application/json" }, body: JSON.stringify(payload) }));
    await app.fetch(
      req("/", { method: "POST", permissions: "accounting.coa.manage", headers: { "content-type": "application/json" }, body: JSON.stringify({ id: "cc2", code: "CC-002", nameAr: "المبيعات", parentId: "cc1" }) }),
    );
    const res = await app.fetch(req("/tree", { permissions: "accounting.coa.view" }));
    expect(res.status).toBe(200);
    const tree = (await res.json()) as Array<{ id: string; children: unknown[] }>;
    expect(tree.map((n) => n.id)).toEqual(["cc1"]);
    expect(tree[0]?.children).toHaveLength(1);
  });
});

describe("cost-centre changes leave a trail", () => {
  class MemorySink implements AuditSink {
    readonly events: AuditEvent[] = [];
    async append(event: AuditEvent) {
      this.events.push(event);
    }
    async query(stream: AuditStream, limit = 100) {
      return this.events.filter((e) => e.stream === stream).slice(-limit).reverse();
    }
  }

  function auditedApp() {
    const repo = createSqliteCostCenterRepository();
    handles.push(repo);
    const audit = new MemorySink();
    return { app: createCostCentersRoutes(repo, insecureHeaderAuthContextResolver, undefined, audit), audit };
  }

  it("records the create and the edit, with the field that moved", async () => {
    const { app, audit } = auditedApp();
    await app.fetch(
      req("/", { method: "POST", permissions: "*", headers: { "content-type": "application/json" }, body: JSON.stringify(payload) }),
    );
    await app.fetch(
      req("/cc1", { method: "PATCH", permissions: "*", headers: { "content-type": "application/json" }, body: JSON.stringify({ nameAr: "إدارة المبيعات" }) }),
    );

    expect(audit.events.map((e) => e.action)).toEqual([AuditChangeAction.Create, AuditChangeAction.Update]);
    expect(audit.events.every((e) => e.entityType === "COST_CENTER" && e.entityId === "cc1")).toBe(true);
    const changes = auditChangesOf(audit.events[1]!.details);
    expect(changes).toEqual([{ field: "nameAr", from: "الإدارة العامة", to: "إدارة المبيعات" }]);
  });
});
