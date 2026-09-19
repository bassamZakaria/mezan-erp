import { describe, it, expect } from "vitest";
import {
  createTenant,
  activateTenant,
  suspendTenant,
  resumeTenant,
  archiveTenant,
  type Tenant,
  type TenantRepository,
} from "./tenant.js";
import {
  InvalidTenantError,
  InvalidTenantTransitionError,
  TenantCodeTakenError,
  TenantNotFoundError,
} from "./errors.js";

function memoryRepo(seed: Tenant[] = []): TenantRepository & { rows: Map<string, Tenant> } {
  const rows = new Map(seed.map((t) => [t.id, t]));
  return {
    rows,
    async findById(id) { return rows.get(id) ?? null; },
    async findByCode(code) { return [...rows.values()].find((t) => t.code === code) ?? null; },
    async list() { return [...rows.values()]; },
    async save(t) { rows.set(t.id, t); },
  };
}

const NOW = "2026-09-13T10:00:00.000Z";
const cmd = { id: "T1", code: "cyag", nameAr: "سياج", nameEn: "Cyag", ownerEmail: " Owner@Cyag.EG ", now: NOW };

describe("createTenant", () => {
  it("creates a provisioning tenant with a derived db file and a normalised email", async () => {
    const repo = memoryRepo();
    const t = await createTenant(cmd, repo);
    expect(t).toEqual({
      id: "T1", code: "cyag", nameAr: "سياج", nameEn: "Cyag", ownerEmail: "owner@cyag.eg",
      status: "provisioning", dbFile: "tenants/cyag.db", createdAt: NOW, updatedAt: NOW,
    });
    expect(repo.rows.get("T1")).toEqual(t);
  });

  it("refuses a bad slug, an empty Arabic name and an empty email, all at once", async () => {
    await expect(createTenant({ ...cmd, code: "Cy ag", nameAr: " ", ownerEmail: "" }, memoryRepo()))
      .rejects.toThrow(InvalidTenantError);
    await expect(createTenant({ ...cmd, code: "Cy ag", nameAr: " ", ownerEmail: "" }, memoryRepo()))
      .rejects.toMatchObject({ reasons: expect.arrayContaining([
        expect.stringContaining("الرمز"), expect.stringContaining("الاسم بالعربية"), expect.stringContaining("بريد المالك"),
      ]) });
  });

  it("refuses a code another tenant already holds", async () => {
    const repo = memoryRepo();
    await createTenant(cmd, repo);
    await expect(createTenant({ ...cmd, id: "T2" }, repo)).rejects.toThrow(TenantCodeTakenError);
  });

  it("refuses a clock that is not an ISO-8601 timestamp", async () => {
    await expect(createTenant({ ...cmd, now: "garbage" }, memoryRepo())).rejects.toThrow(InvalidTenantError);
  });

  it("normalises a clock with no milliseconds", async () => {
    const t = await createTenant({ ...cmd, now: "2026-09-13T10:00:00Z" }, memoryRepo());
    expect(t.createdAt).toBe("2026-09-13T10:00:00.000Z");
    expect(t.updatedAt).toBe("2026-09-13T10:00:00.000Z");
  });
});

describe("tenant state machine", () => {
  async function seeded(status: Tenant["status"]) {
    const repo = memoryRepo();
    const t = await createTenant(cmd, repo);
    repo.rows.set(t.id, { ...t, status });
    return repo;
  }
  const LATER = "2026-09-14T00:00:00.000Z";

  it("provisioning → active, and stamps updatedAt", async () => {
    const repo = await seeded("provisioning");
    const t = await activateTenant({ id: "T1", now: LATER }, repo);
    expect(t.status).toBe("active");
    expect(t.updatedAt).toBe(LATER);
  });

  it("refuses a bad clock before looking up the tenant, even for an unknown id", async () => {
    await expect(activateTenant({ id: "nope", now: "garbage" }, memoryRepo())).rejects.toThrow(InvalidTenantError);
  });

  it("normalises a transition clock with no milliseconds into updatedAt", async () => {
    const repo = await seeded("provisioning");
    const t = await activateTenant({ id: "T1", now: "2026-09-14T00:00:00Z" }, repo);
    expect(t.updatedAt).toBe("2026-09-14T00:00:00.000Z");
  });

  it("active ⇄ suspended", async () => {
    const repo = await seeded("active");
    expect((await suspendTenant({ id: "T1", now: LATER }, repo)).status).toBe("suspended");
    expect((await resumeTenant({ id: "T1", now: LATER }, repo)).status).toBe("active");
  });

  it("active or suspended → archived, and archived is terminal", async () => {
    const repo = await seeded("suspended");
    expect((await archiveTenant({ id: "T1", now: LATER }, repo)).status).toBe("archived");
    await expect(resumeTenant({ id: "T1", now: LATER }, repo)).rejects.toThrow(InvalidTenantTransitionError);
    await expect(activateTenant({ id: "T1", now: LATER }, repo)).rejects.toThrow(InvalidTenantTransitionError);
  });

  it("refuses provisioning → suspended and provisioning → archived", async () => {
    const repo = await seeded("provisioning");
    await expect(suspendTenant({ id: "T1", now: LATER }, repo)).rejects.toThrow(InvalidTenantTransitionError);
    await expect(archiveTenant({ id: "T1", now: LATER }, repo)).rejects.toThrow(InvalidTenantTransitionError);
  });

  it("refuses resuming a provisioning tenant", async () => {
    const repo = await seeded("provisioning");
    await expect(resumeTenant({ id: "T1", now: LATER }, repo)).rejects.toThrow(InvalidTenantTransitionError);
  });

  it("refuses activating a suspended tenant, since resume is the only way back", async () => {
    const repo = await seeded("suspended");
    await expect(activateTenant({ id: "T1", now: LATER }, repo)).rejects.toThrow(InvalidTenantTransitionError);
  });

  it("reports a missing tenant", async () => {
    await expect(activateTenant({ id: "nope", now: LATER }, memoryRepo())).rejects.toThrow(TenantNotFoundError);
  });
});
