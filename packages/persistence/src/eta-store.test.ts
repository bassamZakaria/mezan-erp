import { describe, it, expect, afterEach } from "vitest";
import { DEFAULT_ETA_CONFIG, type EtaSubmission } from "@mezan/domain";
import { createSqliteEtaStore, type SqliteEtaStoreHandle } from "./eta-store.js";

let store: SqliteEtaStoreHandle;
afterEach(() => store?.close());

describe("SqliteEtaConfigRepository", () => {
  it("returns the default config before anything is saved", async () => {
    store = createSqliteEtaStore();
    const cfg = await store.config.get();
    expect(cfg.environment).toBe("preproduction");
    expect(cfg.hasClientSecret).toBe(false);
  });

  it("persists config and surfaces only hasClientSecret for the secret (never the secret)", async () => {
    store = createSqliteEtaStore();
    await store.config.save({ ...DEFAULT_ETA_CONFIG, activityCode: "4610", clientId: "cid" });
    await store.config.setClientSecret("super-secret");
    const cfg = await store.config.get();
    expect(cfg.activityCode).toBe("4610");
    expect(cfg.clientId).toBe("cid");
    expect(cfg.hasClientSecret).toBe(true);
    expect(JSON.stringify(cfg)).not.toContain("super-secret");
  });

  it("preserves the stored secret across a later config save", async () => {
    store = createSqliteEtaStore();
    await store.config.setClientSecret("s1");
    await store.config.save({ ...DEFAULT_ETA_CONFIG, activityCode: "999" });
    expect((await store.config.get()).hasClientSecret).toBe(true);
  });
});

describe("SqliteEtaSubmissionRepository", () => {
  const sub: EtaSubmission = {
    id: "s1", internalId: "INV-000014", documentType: "invoice", status: "ready", etaUuid: null,
    payload: { totalAmount: "114" }, errors: [], exclusionReason: null,
    createdAt: "2026-08-22T10:00:00.000Z", updatedAt: "2026-08-22T10:00:00.000Z", submittedAt: null,
  };

  it("round-trips a submission with JSON payload and lists by status", async () => {
    store = createSqliteEtaStore();
    await store.submissions.create(sub);
    const found = await store.submissions.findByInternalId("INV-000014");
    expect((found!.payload as { totalAmount: string }).totalAmount).toBe("114");
    await store.submissions.update({ ...sub, status: "submitted", submittedAt: "2026-08-22T11:00:00.000Z" });
    expect(await store.submissions.list("ready")).toHaveLength(0);
    expect(await store.submissions.list("submitted")).toHaveLength(1);
  });
});
