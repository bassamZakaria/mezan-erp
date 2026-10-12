import { describe, it, expect } from "vitest";
import {
  createTenant,
  activateTenant,
  suspendTenant,
  resumeTenant,
  archiveTenant,
  tenantWithOwnerContact,
  tenantHandedTo,
  releaseTenant,
  releasedTenantCode,
  OwnerContactProof,
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
    async compareAndSetOwner() { return false; },
    async compareAndSetStatus(before, after) {
      const stored = rows.get(after.id);
      if (!stored || stored.status !== before.status || stored.code !== before.code) return false;
      rows.set(after.id, { ...stored, status: after.status, code: after.code, updatedAt: after.updatedAt });
      return true;
    },
    async setDbFile() { return false; },
  };
}

const NOW = "2026-09-13T10:00:00.000Z";
const cmd = { id: "T1", code: "cyag", nameAr: "سياج", nameEn: "Cyag", ownerEmail: " Owner@Cyag.EG ", now: NOW };

describe("createTenant", () => {
  it("creates a provisioning tenant whose database file is named by its id, and a normalised email", async () => {
    const repo = memoryRepo();
    const t = await createTenant(cmd, repo);
    expect(t).toEqual({
      id: "T1", code: "cyag", nameAr: "سياج", nameEn: "Cyag", ownerEmail: "owner@cyag.eg", ownerUserId: null, ownerContactVerified: true,
      status: "provisioning", dbFile: "tenants/T1.db", createdAt: NOW, updatedAt: NOW,
    });
    expect(repo.rows.get("T1")).toEqual(t);
  });

  it("refuses an id that cannot name a file", async () => {
    for (const id of ["../platform", "a/b", "t.1", "-lead", "a b"]) {
      await expect(createTenant({ ...cmd, id }, memoryRepo())).rejects.toThrow(InvalidTenantError);
    }
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

describe("tenantWithOwnerContact", () => {
  const LATER = "2026-09-14T08:00:00.000Z";
  const linked: Tenant = {
    id: "T1", code: "cyag", nameAr: "سياج", nameEn: null, ownerEmail: "owner@cyag.eg", ownerUserId: "U-OWNER", ownerContactVerified: true,
    status: "active", dbFile: "tenants/cyag.db", createdAt: NOW, updatedAt: NOW,
  };
  const unlinked: Tenant = { ...linked, ownerUserId: null };

  it("changes nothing when the owner's address is the one already recorded and verified", () => {
    expect(tenantWithOwnerContact(linked, { id: "U-OWNER", email: " Owner@Cyag.EG " }, OwnerContactProof.Unproven, LATER)).toBeNull();
    expect(tenantWithOwnerContact(linked, { id: "U-OWNER", email: "owner@cyag.eg" }, OwnerContactProof.OwnerActed, LATER)).toBeNull();
  });

  it("links an unlinked tenant to the owner's user id", () => {
    expect(tenantWithOwnerContact(unlinked, { id: "U-OWNER", email: "owner@cyag.eg" }, OwnerContactProof.Unproven, LATER)).toEqual({
      ...linked, updatedAt: LATER,
    });
  });

  it("follows a new address only on the owner's own act", () => {
    expect(tenantWithOwnerContact(linked, { id: "U-OWNER", email: "New@Cyag.EG" }, OwnerContactProof.OwnerActed, LATER)).toEqual({
      ...linked, ownerEmail: "new@cyag.eg", updatedAt: LATER,
    });
  });

  it("keeps the recorded address and marks the contact unverified when the new address is unproven", () => {
    const flagged = tenantWithOwnerContact(linked, { id: "U-OWNER", email: "inbox@elsewhere.example" }, OwnerContactProof.Unproven, LATER);
    expect(flagged).toEqual({ ...linked, ownerContactVerified: false, updatedAt: LATER });
    expect(tenantWithOwnerContact(flagged!, { id: "U-OWNER", email: "inbox@elsewhere.example" }, OwnerContactProof.Unproven, LATER)).toBeNull();
  });

  it("verifies again, without moving the address, once the tenant's own address is the recorded one", () => {
    const flagged: Tenant = { ...linked, ownerContactVerified: false };
    expect(tenantWithOwnerContact(flagged, { id: "U-OWNER", email: "owner@cyag.eg" }, OwnerContactProof.Unproven, LATER)).toEqual({
      ...linked, updatedAt: LATER,
    });
  });

  it("ignores every user who is not the recorded owner, whatever they prove", () => {
    expect(tenantWithOwnerContact(linked, { id: "U-OTHER", email: "owner@cyag.eg" }, OwnerContactProof.OwnerActed, LATER)).toBeNull();
    expect(tenantWithOwnerContact(linked, { id: "U-OTHER", email: "other@cyag.eg" }, OwnerContactProof.OwnerActed, LATER)).toBeNull();
  });

  it("refuses an empty address and a bad clock", () => {
    expect(() => tenantWithOwnerContact(linked, { id: "U-OWNER", email: "  " }, OwnerContactProof.OwnerActed, LATER)).toThrow(InvalidTenantError);
    expect(() => tenantWithOwnerContact(linked, { id: "U-OWNER", email: "a@b.eg" }, OwnerContactProof.OwnerActed, "soon")).toThrow(InvalidTenantError);
  });

  it("hands the tenant to a successor, verified only when told so", () => {
    expect(tenantHandedTo(linked, { id: "U-NEXT", email: "Next@Cyag.EG" }, false, LATER)).toEqual({
      ...linked, ownerUserId: "U-NEXT", ownerEmail: "next@cyag.eg", ownerContactVerified: false, updatedAt: LATER,
    });
    expect(tenantHandedTo(linked, { id: "U-NEXT", email: "next@cyag.eg" }, true, LATER).ownerContactVerified).toBe(true);
  });
});

describe("releaseTenant", () => {
  it("archives a provisioning tenant under a code of its own and keeps its database file, so the code it held is free", async () => {
    const repo = memoryRepo();
    const t = await createTenant(cmd, repo);

    const released = await releaseTenant({ id: t.id, now: "2026-09-14T08:00:00.000Z" }, repo);

    expect(released).toEqual({
      ...t, status: "archived", code: "released-T1", updatedAt: "2026-09-14T08:00:00.000Z",
    });
    expect(released.dbFile).toBe("tenants/T1.db");
    expect(await repo.findByCode("cyag")).toBeNull();
    expect(releasedTenantCode("T1")).toBe("released-T1");
  });

  it("refuses every tenant that is not provisioning", async () => {
    const repo = memoryRepo();
    const t = await createTenant(cmd, repo);
    await activateTenant({ id: t.id, now: NOW }, repo);
    await expect(releaseTenant({ id: t.id, now: NOW }, repo)).rejects.toBeInstanceOf(InvalidTenantTransitionError);
    await suspendTenant({ id: t.id, now: NOW }, repo);
    await expect(releaseTenant({ id: t.id, now: NOW }, repo)).rejects.toBeInstanceOf(InvalidTenantTransitionError);
    await expect(releaseTenant({ id: "nope", now: NOW }, repo)).rejects.toBeInstanceOf(TenantNotFoundError);
  });
});

