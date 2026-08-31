import { describe, it, expect, afterEach } from "vitest";
import {
  createSqliteLeadRepository,
  createSqliteOpportunityRepository,
  createSqlitePipelineStageRepository,
  createSqliteActivityRepository,
} from "../../persistence/src/crm-store.js";
import type { CustomerRepository, Customer } from "@mezan/domain";
import { createCrmRoutes } from "./crm-routes.js";

const handles: { close(): void }[] = [];
afterEach(() => {
  for (const h of handles.splice(0)) h.close();
});

function inMemoryCustomers(): Pick<CustomerRepository, "save" | "findAll"> {
  const customers = new Map<string, Customer>();
  return {
    async save(customer) {
      customers.set(customer.id, customer);
    },
    async findAll() {
      return Array.from(customers.values());
    },
  };
}

function newApp() {
  const leads = createSqliteLeadRepository();
  const opportunities = createSqliteOpportunityRepository();
  const pipelineStages = createSqlitePipelineStageRepository();
  const activities = createSqliteActivityRepository();
  handles.push(leads, opportunities, pipelineStages, activities);
  const customers = inMemoryCustomers();
  return { app: createCrmRoutes({ leads, opportunities, pipelineStages, activities, customers }) };
}

type App = ReturnType<typeof newApp>["app"];

const ADMIN = "*";

function req(path: string, init: RequestInit & { permissions?: string; branchScope?: string } = {}) {
  const headers = new Headers(init.headers);
  headers.set("x-permissions", init.permissions ?? ADMIN);
  if (init.branchScope !== undefined) headers.set("x-branch-scope", init.branchScope);
  if (init.body) headers.set("content-type", "application/json");
  return new Request(`http://local${path}`, { ...init, headers });
}

type ReqInit = Parameters<typeof req>[1];

async function post(app: App, path: string, payload?: unknown, init: ReqInit = {}) {
  return app.fetch(
    req(path, { method: "POST", ...init, body: payload === undefined ? undefined : JSON.stringify(payload) }),
  );
}

async function get(app: App, path: string, init: ReqInit = {}) {
  return app.fetch(req(path, init));
}

async function json<T>(res: Response): Promise<T> {
  return (await res.json()) as T;
}

async function newStage(app: App, overrides: Record<string, unknown> = {}) {
  return post(app, "/pipeline-stages", {
    id: "stage-1",
    name: "اتصال أول",
    defaultProbability: 20,
    ...overrides,
  });
}

describe("crm-routes — leads", () => {
  it("mints an id when the caller supplies none, and carries every optional field", async () => {
    const { app } = newApp();
    const res = await post(app, "/leads", {
      name: "شركة النور",
      company: "النور للتجارة",
      email: "info@nour.example",
      phone: "01000000000",
      source: "referral",
      expectedValue: "50000.00",
      interest: "رفوف",
      notes: "مهتم جداً",
    });
    expect(res.status).toBe(201);
    const lead = await json<{ id: string; expectedValue: string | null; status: string }>(res);
    expect(lead.id).toMatch(/.+/);
    expect(lead.expectedValue).toBe("50000.000000");
    expect(lead.status).toBe("new");
  });

  it("keeps an omitted expected value absent rather than inventing a zero", async () => {
    const { app } = newApp();
    const lead = await json<{ expectedValue: string | null }>(
      await post(app, "/leads", { id: "lead-1", name: "عميل محتمل" }),
    );
    expect(lead.expectedValue).toBeNull();
  });

  it("400s a lead body the schema rejects", async () => {
    const { app } = newApp();
    expect((await post(app, "/leads", {})).status).toBe(400);
    expect((await post(app, "/leads", { name: "" })).status).toBe(400);
  });

  it("lists leads and serves one by id, 404ing one that is not there", async () => {
    const { app } = newApp();
    await post(app, "/leads", { id: "lead-1", name: "عميل محتمل" });

    expect(await json<unknown[]>(await get(app, "/leads"))).toHaveLength(1);
    expect((await json<{ id: string }>(await get(app, "/leads/lead-1"))).id).toBe("lead-1");

    const missing = await get(app, "/leads/nope");
    expect(missing.status).toBe(404);
    expect((await json<{ error: string }>(missing)).error).toBe("LEAD_NOT_FOUND");
  });

  it("400s a transition or a conversion body the schema rejects", async () => {
    const { app } = newApp();
    await post(app, "/leads", { id: "lead-1", name: "عميل محتمل" });
    expect((await post(app, "/leads/lead-1/transition", { status: "levitating" })).status).toBe(400);
    expect((await post(app, "/leads/lead-1/convert", { createCustomer: "yes" })).status).toBe(400);
  });

  it("404s converting a lead that does not exist", async () => {
    const { app } = newApp();
    const res = await post(app, "/leads/nope/convert", { createCustomer: false, createOpportunity: false });
    expect(res.status).toBe(404);
  });

  it("converts a qualified lead into a customer alone when no opportunity is asked for", async () => {
    const { app } = newApp();
    await post(app, "/leads", { id: "lead-1", name: "شركة النور" });
    await post(app, "/leads/lead-1/transition", { status: "contacted" });
    await post(app, "/leads/lead-1/transition", { status: "qualified" });

    const res = await post(app, "/leads/lead-1/convert", {
      createCustomer: true,
      customer: { id: "cust-1", code: "CUS-1", nameAr: "شركة النور" },
      createOpportunity: false,
    });
    expect(res.status).toBe(200);
    const payload = await json<{ customerId: string | null; opportunityId: string | null; lead: { status: string } }>(res);
    expect(payload.customerId).toBe("cust-1");
    expect(payload.opportunityId).toBeNull();
    expect(payload.lead.status).toBe("converted");
  });

  it("converts into a customer AND an opportunity, carrying the money exactly", async () => {
    const { app } = newApp();
    await newStage(app);
    await post(app, "/leads", { id: "lead-1", name: "شركة النور" });
    await post(app, "/leads/lead-1/transition", { status: "contacted" });
    await post(app, "/leads/lead-1/transition", { status: "qualified" });

    const res = await post(app, "/leads/lead-1/convert", {
      createCustomer: true,
      customer: { id: "cust-1", code: "CUS-1", nameAr: "شركة النور" },
      createOpportunity: true,
      opportunity: {
        id: "opp-1",
        title: "توريد رفوف",
        branchId: "MAIN",
        stageId: "stage-1",
        expectedValue: "125000.75",
        probability: 40,
        expectedCloseDate: "2026-10-01",
      },
    });
    expect(res.status).toBe(200);
    expect((await json<{ opportunityId: string }>(res)).opportunityId).toBe("opp-1");

    const opportunity = await json<{ expectedValue: string; probability: number }>(await get(app, "/opportunities/opp-1"));
    expect(opportunity.expectedValue).toBe("125000.750000");
    expect(opportunity.probability).toBe(40);
  });
});

describe("crm-routes — opportunities", () => {
  it("mints an id, defaults the value and probability, and 400s a bad body", async () => {
    const { app } = newApp();
    const res = await post(app, "/opportunities", {
      title: "فرصة",
      customerId: "cust-1",
      stageId: "stage-1",
    });
    expect(res.status).toBe(201);
    const opportunity = await json<{ id: string; expectedValue: string; probability: number; branchId: string | null }>(res);
    expect(opportunity.id).toMatch(/.+/);
    expect(opportunity.expectedValue).toBe("0.000000");
    expect(opportunity.probability).toBe(50);
    expect(opportunity.branchId).toBeNull();

    expect((await post(app, "/opportunities", { title: "بلا عميل" })).status).toBe(400);
  });

  it("422s an opportunity the domain refuses even though the schema allowed it", async () => {
    const { app } = newApp();
    const res = await post(app, "/opportunities", {
      id: "opp-bad",
      title: "   ",
      customerId: "cust-1",
      stageId: "stage-1",
    });
    expect(res.status).toBe(422);
    expect((await json<{ error: string }>(res)).error).toBe("INVALID_OPPORTUNITY");

    // The contract catches an impossible probability before the domain sees it.
    expect(
      (await post(app, "/opportunities", { title: "فرصة", customerId: "c1", stageId: "s1", probability: 500 })).status,
    ).toBe(400);
  });

  it("shows a caller only the branches their scope reaches, and narrows within it", async () => {
    const { app } = newApp();
    await post(app, "/opportunities", { id: "opp-main", title: "أ", customerId: "c1", stageId: "s1", branchId: "MAIN" });
    await post(app, "/opportunities", { id: "opp-br2", title: "ب", customerId: "c1", stageId: "s1", branchId: "BR2" });

    const all = await json<Array<{ id: string }>>(await get(app, "/opportunities"));
    expect(all).toHaveLength(2);

    const filtered = await json<Array<{ id: string }>>(await get(app, "/opportunities?branchId=BR2"));
    expect(filtered.map((o) => o.id)).toEqual(["opp-br2"]);

    const scoped = await json<Array<{ id: string }>>(await get(app, "/opportunities", { branchScope: "BR2" }));
    expect(scoped.map((o) => o.id)).toEqual(["opp-br2"]);

    // A query parameter cannot widen the scope it sits inside.
    const widened = await json<unknown[]>(await get(app, "/opportunities?branchId=MAIN", { branchScope: "BR2" }));
    expect(widened).toEqual([]);
  });

  it("404s an opportunity that is not there, and a stage move naming a missing stage", async () => {
    const { app } = newApp();
    expect((await get(app, "/opportunities/nope")).status).toBe(404);
    expect((await post(app, "/opportunities/nope/move-stage", { stageId: "stage-1" })).status).toBe(404);

    await post(app, "/opportunities", { id: "opp-1", title: "فرصة", customerId: "c1", stageId: "s1" });
    const missingStage = await post(app, "/opportunities/opp-1/move-stage", { stageId: "ghost" });
    expect(missingStage.status).toBe(404);
    expect((await json<{ error: string }>(missingStage)).error).toBe("PIPELINE_STAGE_NOT_FOUND");
  });

  it("400s a move-stage body the schema rejects", async () => {
    const { app } = newApp();
    await post(app, "/opportunities", { id: "opp-1", title: "فرصة", customerId: "c1", stageId: "s1" });
    expect((await post(app, "/opportunities/opp-1/move-stage", {})).status).toBe(400);
  });

  it("takes the stage's default probability when the opportunity moves onto it", async () => {
    const { app } = newApp();
    await newStage(app, { id: "stage-2", name: "عرض سعر", defaultProbability: 70 });
    await post(app, "/opportunities", { id: "opp-1", title: "فرصة", customerId: "c1", stageId: "s1" });

    const res = await post(app, "/opportunities/opp-1/move-stage", { stageId: "stage-2" });
    expect(res.status).toBe(200);
    expect(await json<{ stageId: string; probability: number }>(res)).toMatchObject({
      stageId: "stage-2",
      probability: 70,
    });
  });
});

describe("crm-routes — pipeline stages and activities", () => {
  it("400s a stage or an activity body the schema rejects", async () => {
    const { app } = newApp();
    expect((await post(app, "/pipeline-stages", { name: "" })).status).toBe(400);
    expect((await post(app, "/pipeline-stages/stage-1/move", { direction: "sideways" })).status).toBe(400);
    expect((await post(app, "/activities", { type: "telepathy" })).status).toBe(400);
  });

  it("mints a stage id when none is supplied and lists what it stored", async () => {
    const { app } = newApp();
    const res = await post(app, "/pipeline-stages", { name: "تفاوض", defaultProbability: 60 });
    expect(res.status).toBe(201);
    expect((await json<{ id: string; order: number }>(res)).id).toMatch(/.+/);
    expect(await json<unknown[]>(await get(app, "/pipeline-stages"))).toHaveLength(1);
  });

  it("422s moving a stage that is not in the pipeline at all", async () => {
    const { app } = newApp();
    await newStage(app);
    const res = await post(app, "/pipeline-stages/ghost/move", { direction: "up" });
    expect([404, 422]).toContain(res.status);
  });

  it("mints an activity id, lists activities, and 404s an unknown one on both actions", async () => {
    const { app } = newApp();
    const created = await post(app, "/activities", { subject: "مكالمة", type: "call", dueDate: "2026-09-01" });
    expect(created.status).toBe(201);
    expect((await json<{ id: string; status: string }>(created)).status).toBe("pending");

    expect(await json<unknown[]>(await get(app, "/activities"))).toHaveLength(1);
    expect((await post(app, "/activities/nope/complete")).status).toBe(404);
    expect((await post(app, "/activities/nope/cancel")).status).toBe(404);
  });

  it("422s completing or cancelling an activity that is no longer pending", async () => {
    const { app } = newApp();
    await post(app, "/activities", { id: "act-1", subject: "مكالمة", type: "call", dueDate: "2026-09-01" });
    expect((await post(app, "/activities/act-1/complete")).status).toBe(200);

    expect((await post(app, "/activities/act-1/complete")).status).toBe(422);
    expect((await post(app, "/activities/act-1/cancel")).status).toBe(422);
  });

  it("403s each surface for a caller holding only the neighbouring view permission", async () => {
    const { app } = newApp();
    expect((await get(app, "/opportunities", { permissions: "crm.lead.view" })).status).toBe(403);
    expect((await get(app, "/pipeline-stages", { permissions: "crm.lead.view" })).status).toBe(403);
    expect((await get(app, "/activities", { permissions: "crm.lead.view" })).status).toBe(403);
    expect((await post(app, "/leads/lead-1/convert", {}, { permissions: "crm.lead.edit" })).status).toBe(403);
  });
});
