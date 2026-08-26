import { describe, it, expect } from "vitest";
import { Money, type Lead, type Opportunity, type PipelineStage, type Activity } from "@mezan/domain";
import {
  createSqliteLeadRepository,
  createSqliteOpportunityRepository,
  createSqlitePipelineStageRepository,
  createSqliteActivityRepository,
} from "./crm-store.js";

describe("SqliteLeadRepository", () => {
  const lead: Lead = {
    id: "lead1",
    name: "أحمد محمد",
    company: "شركة النور",
    email: "ahmed@example.com",
    phone: "0100000000",
    source: "website",
    expectedValue: Money.fromMajor("15000.50"),
    interest: "نظام محاسبي",
    notes: "عميل مهتم",
    status: "new",
    convertedCustomerId: null,
    convertedOpportunityId: null,
    createdAt: "2026-01-01T00:00:00.000Z",
  };

  it("creates and retrieves a lead by id, round-tripping expectedValue", async () => {
    const repo = createSqliteLeadRepository();
    try {
      await repo.create(lead);
      const found = await repo.findById("lead1");
      expect(found).toMatchObject({ id: "lead1", name: "أحمد محمد", status: "new" });
      expect(found?.expectedValue?.toString()).toBe("15000.500000");
      expect(await repo.findById("nope")).toBeNull();
    } finally {
      repo.close();
    }
  });

  it("round-trips a null expectedValue (not the string 'null')", async () => {
    const repo = createSqliteLeadRepository();
    try {
      await repo.create({ ...lead, id: "lead2", expectedValue: null });
      const found = await repo.findById("lead2");
      expect(found?.expectedValue).toBeNull();
    } finally {
      repo.close();
    }
  });

  it("update() persists a full replace (e.g. status transition)", async () => {
    const repo = createSqliteLeadRepository();
    try {
      await repo.create(lead);
      await repo.update({ ...lead, status: "contacted" });
      expect((await repo.findById("lead1"))?.status).toBe("contacted");
    } finally {
      repo.close();
    }
  });

  it("list() returns every persisted lead", async () => {
    const repo = createSqliteLeadRepository();
    try {
      await repo.create(lead);
      await repo.create({ ...lead, id: "lead2" });
      const all = await repo.list();
      expect(all).toHaveLength(2);
      expect(all.map((l) => l.id).sort()).toEqual(["lead1", "lead2"]);
    } finally {
      repo.close();
    }
  });
});

describe("SqliteOpportunityRepository", () => {
  const opportunity: Opportunity = {
    id: "opp1",
    title: "صفقة مع شركة النور",
    customerId: "cust1",
    branchId: null,
    stageId: "stage1",
    expectedValue: Money.fromMajor("50000"),
    probability: 40,
    expectedCloseDate: "2026-03-01",
    notes: null,
    status: "open",
    createdAt: "2026-01-01T00:00:00.000Z",
    closedAt: null,
  };

  it("creates and retrieves an opportunity by id", async () => {
    const repo = createSqliteOpportunityRepository();
    try {
      await repo.create(opportunity);
      const found = await repo.findById("opp1");
      expect(found).toMatchObject({ id: "opp1", title: "صفقة مع شركة النور", probability: 40 });
      expect(found?.expectedValue.toString()).toBe("50000.000000");
      expect(await repo.findById("nope")).toBeNull();
    } finally {
      repo.close();
    }
  });

  it("update() persists a full replace (e.g. stage/status change)", async () => {
    const repo = createSqliteOpportunityRepository();
    try {
      await repo.create(opportunity);
      await repo.update({ ...opportunity, stageId: "stage2", status: "won", closedAt: "2026-02-01" });
      const found = await repo.findById("opp1");
      expect(found?.stageId).toBe("stage2");
      expect(found?.status).toBe("won");
      expect(found?.closedAt).toBe("2026-02-01");
    } finally {
      repo.close();
    }
  });

  it("list() returns every persisted opportunity", async () => {
    const repo = createSqliteOpportunityRepository();
    try {
      await repo.create(opportunity);
      await repo.create({ ...opportunity, id: "opp2" });
      expect(await repo.list()).toHaveLength(2);
    } finally {
      repo.close();
    }
  });
});

describe("SqlitePipelineStageRepository", () => {
  const stage: PipelineStage = {
    id: "stage1",
    name: "تواصل أولي",
    order: 0,
    defaultProbability: 20,
    color: "#3b82f6",
    isWinStage: false,
    isLossStage: false,
    active: true,
  };

  it("creates and retrieves a pipeline stage, round-tripping booleans as 0/1", async () => {
    const repo = createSqlitePipelineStageRepository();
    try {
      await repo.create(stage);
      const found = await repo.findById("stage1");
      expect(found).toMatchObject({ id: "stage1", name: "تواصل أولي", order: 0, defaultProbability: 20 });
      expect(found?.isWinStage).toBe(false);
      expect(found?.isLossStage).toBe(false);
      expect(found?.active).toBe(true);
      expect(await repo.findById("nope")).toBeNull();
    } finally {
      repo.close();
    }
  });

  it("round-trips true boolean flags (win stage)", async () => {
    const repo = createSqlitePipelineStageRepository();
    try {
      await repo.create({ ...stage, id: "stage2", isWinStage: true, active: true });
      const found = await repo.findById("stage2");
      expect(found?.isWinStage).toBe(true);
    } finally {
      repo.close();
    }
  });

  it("update() persists a full replace (e.g. reordering / deactivation)", async () => {
    const repo = createSqlitePipelineStageRepository();
    try {
      await repo.create(stage);
      await repo.update({ ...stage, order: 3, active: false });
      const found = await repo.findById("stage1");
      expect(found?.order).toBe(3);
      expect(found?.active).toBe(false);
    } finally {
      repo.close();
    }
  });

  it("list() returns every persisted stage, quoted 'order' column works", async () => {
    const repo = createSqlitePipelineStageRepository();
    try {
      await repo.create(stage);
      await repo.create({ ...stage, id: "stage2", order: 1 });
      const all = await repo.list();
      expect(all).toHaveLength(2);
      expect(all.map((s) => s.order).sort()).toEqual([0, 1]);
    } finally {
      repo.close();
    }
  });
});

describe("SqliteActivityRepository", () => {
  const activity: Activity = {
    id: "act1",
    subject: "اتصال متابعة",
    type: "call",
    relatedLeadId: "lead1",
    relatedOpportunityId: null,
    dueDate: "2026-02-01",
    status: "pending",
    notes: null,
    createdAt: "2026-01-01T00:00:00.000Z",
  };

  it("creates and retrieves an activity by id", async () => {
    const repo = createSqliteActivityRepository();
    try {
      await repo.create(activity);
      const found = await repo.findById("act1");
      expect(found).toMatchObject({ id: "act1", subject: "اتصال متابعة", type: "call", status: "pending" });
      expect(found?.relatedOpportunityId).toBeNull();
      expect(await repo.findById("nope")).toBeNull();
    } finally {
      repo.close();
    }
  });

  it("update() persists a full replace (e.g. completing/cancelling)", async () => {
    const repo = createSqliteActivityRepository();
    try {
      await repo.create(activity);
      await repo.update({ ...activity, status: "completed" });
      expect((await repo.findById("act1"))?.status).toBe("completed");
    } finally {
      repo.close();
    }
  });

  it("list() returns every persisted activity", async () => {
    const repo = createSqliteActivityRepository();
    try {
      await repo.create(activity);
      await repo.create({ ...activity, id: "act2" });
      expect(await repo.list()).toHaveLength(2);
    } finally {
      repo.close();
    }
  });
});
