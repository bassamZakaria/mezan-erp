import { describe, it, expect, afterEach } from "vitest";
import {
  createSqliteLeadRepository,
  createSqliteOpportunityRepository,
  createSqlitePipelineStageRepository,
  createSqliteActivityRepository,
  type SqliteLeadRepositoryHandle,
  type SqliteOpportunityRepositoryHandle,
  type SqlitePipelineStageRepositoryHandle,
  type SqliteActivityRepositoryHandle,
  // NOTE: not yet exported from @mezan/persistence's index.ts (that barrel is
  // edited centrally elsewhere to avoid concurrent-edit conflicts across
  // agents), so this test imports the new store module by relative path.
} from "../../persistence/src/crm-store.js";
import type { AuditEvent, AuditSink, AuditStream, CustomerRepository, Customer } from "@mezan/domain";
import { createCrmRoutes } from "./crm-routes.js";

import { insecureHeaderAuthContextResolver } from "./permission-gate.js";
const handles: { close(): void }[] = [];

afterEach(() => {
  for (const h of handles.splice(0)) h.close();
});

function inMemoryCustomers(): Pick<CustomerRepository, "save" | "findAll" | "findById"> & { list(): Customer[] } {
  const customers = new Map<string, Customer>();
  return {
    async save(customer) {
      customers.set(customer.id, customer);
    },
    async findAll() {
      return Array.from(customers.values());
    },
    async findById(id) {
      return customers.get(id) ?? null;
    },
    list: () => Array.from(customers.values()),
  };
}

function newApp() {
  const leads: SqliteLeadRepositoryHandle = createSqliteLeadRepository();
  const opportunities: SqliteOpportunityRepositoryHandle = createSqliteOpportunityRepository();
  const pipelineStages: SqlitePipelineStageRepositoryHandle = createSqlitePipelineStageRepository();
  const activities: SqliteActivityRepositoryHandle = createSqliteActivityRepository();
  handles.push(leads, opportunities, pipelineStages, activities);
  const customers = inMemoryCustomers();
  const app = createCrmRoutes({ leads, opportunities, pipelineStages, activities, customers }, insecureHeaderAuthContextResolver);
  return { app, leads, opportunities, pipelineStages, activities, customers };
}

function req(path: string, init: RequestInit & { permissions?: string } = {}) {
  const headers = new Headers(init.headers);
  if (init.permissions !== undefined) headers.set("x-permissions", init.permissions);
  return new Request(`http://local${path}`, { ...init, headers });
}

function jsonReq(path: string, permissions: string, body: unknown, method = "POST") {
  return req(path, { method, permissions, headers: { "content-type": "application/json" }, body: JSON.stringify(body) });
}

describe("crm router — permission gate", () => {
  it("rejects GET /leads with no permissions with 403", async () => {
    const { app } = newApp();
    const res = await app.fetch(req("/leads"));
    expect(res.status).toBe(403);
    const body = (await res.json()) as { error: string; permission: string };
    expect(body.error).toBe("PERMISSION_DENIED");
    expect(body.permission).toBe("crm.lead.view");
  });

  it("rejects POST /pipeline-stages with only view permission", async () => {
    const { app } = newApp();
    const res = await app.fetch(jsonReq("/pipeline-stages", "crm.pipeline.view", { name: "مرحلة جديدة" }));
    expect(res.status).toBe(403);
  });
});

describe("crm router — lead create -> transition -> convert", () => {
  it("full happy path creates a customer + opportunity via the injected repos", async () => {
    const { app, leads, opportunities, customers, pipelineStages } = newApp();

    await app.fetch(jsonReq("/pipeline-stages", "crm.pipeline.manage", { id: "stage1", name: "تفاوض" }));

    const createRes = await app.fetch(
      jsonReq("/leads", "crm.lead.create", {
        id: "lead1",
        name: "أحمد",
        company: "شركة النور",
        expectedValue: "1000.00",
      }),
    );
    expect(createRes.status).toBe(201);
    expect(await leads.findById("lead1")).not.toBeNull();

    const contactedRes = await app.fetch(jsonReq("/leads/lead1/transition", "crm.lead.edit", { status: "contacted" }));
    expect(contactedRes.status).toBe(200);
    expect(((await contactedRes.json()) as { status: string }).status).toBe("contacted");

    const qualifiedRes = await app.fetch(jsonReq("/leads/lead1/transition", "crm.lead.edit", { status: "qualified" }));
    expect(qualifiedRes.status).toBe(200);

    const convertRes = await app.fetch(
      jsonReq("/leads/lead1/convert", "crm.lead.convert", {
        createCustomer: true,
        createOpportunity: true,
        opportunity: {
          id: "opp1",
          title: "صفقة أحمد",
          stageId: "stage1",
          expectedValue: "1000.00",
          probability: 50,
        },
      }),
    );
    expect(convertRes.status).toBe(200);
    const convertBody = (await convertRes.json()) as { lead: { status: string }; customerId: string; opportunityId: string };
    expect(convertBody.lead.status).toBe("converted");
    expect(convertBody.customerId).toBeTruthy();
    expect(convertBody.opportunityId).toBe("opp1");

    const persistedCustomers = await customers.findAll();
    expect(persistedCustomers).toHaveLength(1);
    expect(persistedCustomers[0]?.code).toBe("C000001");
    const persistedOpportunity = await opportunities.findById("opp1");
    expect(persistedOpportunity).not.toBeNull();
    expect(persistedOpportunity?.title).toBe("صفقة أحمد");
    expect(await pipelineStages.findById("stage1")).not.toBeNull();
  });

  it("422s an invalid lead transition", async () => {
    const { app } = newApp();
    await app.fetch(jsonReq("/leads", "crm.lead.create", { id: "lead1", name: "أحمد" }));
    const res = await app.fetch(jsonReq("/leads/lead1/transition", "crm.lead.edit", { status: "converted" }));
    expect(res.status).toBe(422);
  });

  it("404s transition for an unknown lead", async () => {
    const { app } = newApp();
    const res = await app.fetch(jsonReq("/leads/nope/transition", "crm.lead.edit", { status: "contacted" }));
    expect(res.status).toBe(404);
  });

  it("refuses a customer code the customer rules reject with 422 and the Arabic reason, not a 500", async () => {
    const { app, customers } = newApp();
    await app.fetch(jsonReq("/leads", "crm.lead.create", { id: "lead1", name: "أحمد" }));
    await app.fetch(jsonReq("/leads/lead1/transition", "crm.lead.edit", { status: "contacted" }));
    await app.fetch(jsonReq("/leads/lead1/transition", "crm.lead.edit", { status: "qualified" }));
    const res = await app.fetch(
      jsonReq("/leads/lead1/convert", "crm.lead.convert", { createCustomer: true, customer: { id: "c1", code: "عميل محتمل" }, createOpportunity: false }),
    );
    expect(res.status).toBe(422);
    expect(((await res.json()) as { message: string }).message).toContain("الكود");
    expect(await customers.findAll()).toHaveLength(0);
  });

  it("422s converting a lead that is not qualified", async () => {
    const { app } = newApp();
    await app.fetch(jsonReq("/leads", "crm.lead.create", { id: "lead1", name: "أحمد" }));
    const res = await app.fetch(jsonReq("/leads/lead1/convert", "crm.lead.convert", { createCustomer: true, createOpportunity: false }));
    expect(res.status).toBe(422);
  });
});

describe("crm router — pipeline stages", () => {
  it("creates a stage and 422s a duplicate win-stage", async () => {
    const { app } = newApp();
    const first = await app.fetch(jsonReq("/pipeline-stages", "crm.pipeline.manage", { id: "s1", name: "فوز", isWinStage: true }));
    expect(first.status).toBe(201);
    const second = await app.fetch(jsonReq("/pipeline-stages", "crm.pipeline.manage", { id: "s2", name: "فوز آخر", isWinStage: true }));
    expect(second.status).toBe(422);
  });

  it("moves a stage up and down", async () => {
    const { app } = newApp();
    await app.fetch(jsonReq("/pipeline-stages", "crm.pipeline.manage", { id: "s1", name: "أول" }));
    await app.fetch(jsonReq("/pipeline-stages", "crm.pipeline.manage", { id: "s2", name: "ثاني" }));

    const moveRes = await app.fetch(jsonReq("/pipeline-stages/s2/move", "crm.pipeline.manage", { direction: "up" }));
    expect(moveRes.status).toBe(200);
    const moved = (await moveRes.json()) as { id: string; order: number }[];
    const s1 = moved.find((s) => s.id === "s1")!;
    const s2 = moved.find((s) => s.id === "s2")!;
    expect(s2.order).toBe(0);
    expect(s1.order).toBe(1);

    const listRes = await app.fetch(req("/pipeline-stages", { permissions: "crm.pipeline.view" }));
    const list = (await listRes.json()) as { id: string; order: number }[];
    expect(list.find((s) => s.id === "s2")?.order).toBe(0);

    const backRes = await app.fetch(jsonReq("/pipeline-stages/s2/move", "crm.pipeline.manage", { direction: "down" }));
    expect(backRes.status).toBe(200);
    const back = (await backRes.json()) as { id: string; order: number }[];
    expect(back.find((s) => s.id === "s2")?.order).toBe(1);
  });
});

describe("crm router — activities", () => {
  it("creates an activity then completes it", async () => {
    const { app } = newApp();
    const createRes = await app.fetch(jsonReq("/activities", "crm.activity.create", { id: "act1", subject: "اتصال متابعة" }));
    expect(createRes.status).toBe(201);

    const completeRes = await app.fetch(req("/activities/act1/complete", { method: "POST", permissions: "crm.activity.edit" }));
    expect(completeRes.status).toBe(200);
    expect(((await completeRes.json()) as { status: string }).status).toBe("completed");

    const doubleCompleteRes = await app.fetch(req("/activities/act1/complete", { method: "POST", permissions: "crm.activity.edit" }));
    expect(doubleCompleteRes.status).toBe(422);
  });

  it("cancels a pending activity", async () => {
    const { app } = newApp();
    await app.fetch(jsonReq("/activities", "crm.activity.create", { id: "act1", subject: "اتصال متابعة" }));
    const res = await app.fetch(req("/activities/act1/cancel", { method: "POST", permissions: "crm.activity.edit" }));
    expect(res.status).toBe(200);
    expect(((await res.json()) as { status: string }).status).toBe("cancelled");
  });
});

describe("converting a lead leaves a record of the customer it minted", () => {
  class MemorySink implements AuditSink {
    readonly events: AuditEvent[] = [];
    async append(event: AuditEvent) {
      this.events.push(event);
    }
    async query(stream: AuditStream, limit = 100) {
      return this.events.filter((e) => e.stream === stream).slice(-limit).reverse();
    }
  }

  it("records CONVERT with the lead, the new customer id and its code", async () => {
    const leads = createSqliteLeadRepository();
    const opportunities = createSqliteOpportunityRepository();
    const pipelineStages = createSqlitePipelineStageRepository();
    const activities = createSqliteActivityRepository();
    handles.push(leads, opportunities, pipelineStages, activities);
    const audit = new MemorySink();
    const app = createCrmRoutes(
      { leads, opportunities, pipelineStages, activities, customers: inMemoryCustomers(), audit },
      insecureHeaderAuthContextResolver,
    );

    await app.fetch(jsonReq("/leads", "crm.lead.create", { id: "lead9", name: "سلمى" }));
    await app.fetch(jsonReq("/leads/lead9/transition", "crm.lead.edit", { status: "contacted" }));
    await app.fetch(jsonReq("/leads/lead9/transition", "crm.lead.edit", { status: "qualified" }));
    const res = await app.fetch(
      jsonReq("/leads/lead9/convert", "crm.lead.convert", { createCustomer: true, customer: { id: "cust9", code: "C-0009" }, createOpportunity: false }),
    );
    expect(res.status).toBe(200);

    expect(audit.events.map((e) => `${e.entityType}:${e.action}`)).toEqual(["CUSTOMER:CREATE", "LEAD:CONVERT"]);
    const onCustomer = audit.events[0]!;
    expect(onCustomer.entityId).toBe("cust9");
    expect(onCustomer.details).toMatchObject({ code: "C-0009" });
    expect((onCustomer.details as { changes: { field: string }[] }).changes.map((change) => change.field)).toContain("code");
    const event = audit.events[1]!;
    expect(event.stream).toBe("sensitive");
    expect(event.entityType).toBe("LEAD");
    expect(event.entityId).toBe("lead9");
    expect(event.action).toBe("CONVERT");
    expect(event.details).toMatchObject({ customerId: "cust9", customerCode: "C-0009", leadName: "سلمى" });
  });
});
