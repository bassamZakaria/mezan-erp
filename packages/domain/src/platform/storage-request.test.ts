import { describe, expect, it } from "vitest";
import {
  StorageRequestRefusal,
  StorageRequestRefusedError,
  StorageRequestStatus,
  StorageRequestStepMb,
  decideStorageRequest,
  requestStorage,
  type StorageRequest,
  type StorageRequestRepository,
} from "./storage-request.js";
import { InvalidSubscriptionError } from "./errors.js";
import { formatStorageMb, LimitKind, limitRefusal, usedStorageMb, BYTES_PER_MB } from "./usage-limits.js";

class MemoryRequests implements StorageRequestRepository {
  readonly rows = new Map<string, StorageRequest>();
  async findById(id: string) {
    return this.rows.get(id) ?? null;
  }
  async listByTenant(tenantId: string) {
    return [...this.rows.values()].filter((r) => r.tenantId === tenantId);
  }
  async listPending() {
    return [...this.rows.values()].filter((r) => r.status === StorageRequestStatus.Pending);
  }
  async insertIfNonePending(r: StorageRequest) {
    if ([...this.rows.values()].some((x) => x.tenantId === r.tenantId && x.status === StorageRequestStatus.Pending)) return false;
    this.rows.set(r.id, r);
    return true;
  }
  async decide(before: StorageRequest, after: StorageRequest, sideEffect: () => Promise<void>) {
    if (this.rows.get(before.id)?.status !== StorageRequestStatus.Pending) return false;
    await sideEffect();
    this.rows.set(after.id, after);
    return true;
  }
}

const NOW = "2026-10-31T10:00:00.000Z";
const ask = (repo: MemoryRequests, id: string, extraMb: number = StorageRequestStepMb.FiveGb) =>
  requestStorage({ id, tenantId: "T1", extraMb, note: "  scans  ", requestedBy: "tenant:acme:U1", now: NOW }, repo);

describe("storage requests", () => {
  it("files a pending request with a trimmed note", async () => {
    const repo = new MemoryRequests();
    const r = await ask(repo, "R1");
    expect(r).toMatchObject({ status: StorageRequestStatus.Pending, extraMb: 5120, note: "scans", decidedAt: null });
  });

  it("refuses an amount that is not one of the offered steps", async () => {
    await expect(ask(new MemoryRequests(), "R1", 999)).rejects.toBeInstanceOf(InvalidSubscriptionError);
  });

  it("keeps one open request per tenant", async () => {
    const repo = new MemoryRequests();
    await ask(repo, "R1");
    await expect(ask(repo, "R2")).rejects.toMatchObject({ code: StorageRequestRefusal.AlreadyPending });
  });

  it("grants the space on approval, inside the decision", async () => {
    const repo = new MemoryRequests();
    await ask(repo, "R1");
    const granted: number[] = [];
    const decided = await decideStorageRequest({ id: "R1", approve: true, decidedBy: "owner", now: NOW }, repo, async (r) => {
      granted.push(r.extraMb);
    });
    expect(decided.status).toBe(StorageRequestStatus.Approved);
    expect(granted).toEqual([5120]);
  });

  it("grants nothing on decline, and a decided request cannot be decided again", async () => {
    const repo = new MemoryRequests();
    await ask(repo, "R1");
    let grants = 0;
    const grant = async () => {
      grants += 1;
    };
    await decideStorageRequest({ id: "R1", approve: false, decidedBy: "owner", now: NOW }, repo, grant);
    await expect(decideStorageRequest({ id: "R1", approve: true, decidedBy: "owner", now: NOW }, repo, grant)).rejects.toMatchObject({
      code: StorageRequestRefusal.AlreadyDecided,
    });
    expect(grants).toBe(0);
  });

  it("answers an unknown request as not found", async () => {
    await expect(decideStorageRequest({ id: "nope", approve: true, decidedBy: "owner", now: NOW }, new MemoryRequests(), async () => undefined)).rejects.toBeInstanceOf(
      StorageRequestRefusedError,
    );
  });
});

describe("storage figures", () => {
  it("reads MB below a gigabyte and GB to one decimal above", () => {
    expect(formatStorageMb(200)).toBe("200 MB");
    expect(formatStorageMb(2048)).toBe("2 GB");
    expect(formatStorageMb(1536)).toBe("1.5 GB");
  });

  it("rounds used bytes up to the next MB, so a nearly full store never reads as having room", () => {
    expect(usedStorageMb(0)).toBe(0);
    expect(usedStorageMb(1)).toBe(1);
    expect(usedStorageMb(BYTES_PER_MB)).toBe(1);
  });

  it("names the sizes in the refusal, not raw MB counts", () => {
    const refusal = limitRefusal(LimitKind.StorageMb, 2048, 2000, { code: "core", nameAr: "الأساسية", nameEn: "Core" });
    expect(refusal).toMatchObject({ limit: LimitKind.StorageMb, allowed: 2048, used: 2000 });
    expect(refusal.message).toContain("2 GB");
    expect(refusal.messageEn).toContain("2 GB");
  });
});
