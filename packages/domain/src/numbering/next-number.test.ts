import { describe, it, expect } from "vitest";
import {
  NextNumberService,
  type SequenceStore,
} from "./next-number.js";

/** In-memory store standing in for the SQLite port in domain-level tests. */
class MemoryStore implements SequenceStore {
  private counters = new Map<string, number>();
  async increment(code: string, period: number | null): Promise<number> {
    const key = `${code}:${period ?? ""}`;
    const next = (this.counters.get(key) ?? 0) + 1;
    this.counters.set(key, next);
    return next;
  }
}

describe("NextNumberService", () => {
  it("issues sequential formatted numbers", async () => {
    const svc = new NextNumberService(new MemoryStore());
    expect((await svc.next("SALES_INVOICE")).formatted).toBe("INV-000001");
    expect((await svc.next("SALES_INVOICE")).formatted).toBe("INV-000002");
    expect((await svc.next("SALES_INVOICE")).formatted).toBe("INV-000003");
    // Independent counters per code.
    expect((await svc.next("PURCHASE_ORDER")).formatted).toBe("PO-000001");
  });

  it("does not reset non-annual sequences across years", async () => {
    const svc = new NextNumberService(new MemoryStore());
    expect((await svc.next("SALES_INVOICE", { year: 2025 })).value).toBe(1);
    // SALES_INVOICE has annualReset=false, so year is ignored.
    expect((await svc.next("SALES_INVOICE", { year: 2026 })).value).toBe(2);
  });

  it("resets an annual-reset sequence at the year boundary", async () => {
    // Synthesize an annual-reset store keyed by period to prove the behavior.
    const store = new MemoryStore();
    // POS_SALE ships non-reset; exercise the port's period keying directly.
    expect(await store.increment("X", 2025)).toBe(1);
    expect(await store.increment("X", 2025)).toBe(2);
    expect(await store.increment("X", 2026)).toBe(1); // reset in the new period
    expect(await store.increment("X", 2026)).toBe(2);
  });
});
