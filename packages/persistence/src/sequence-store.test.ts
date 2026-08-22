import { describe, it, expect } from "vitest";
import { NextNumberService } from "@mezan/domain";
import { createSqliteSequenceStore } from "./sequence-store.js";

describe("SqliteSequenceStore", () => {
  it("issues a gap-free, duplicate-free run under sequential calls", async () => {
    const store = createSqliteSequenceStore();
    try {
      const values: number[] = [];
      for (let i = 0; i < 1000; i++) {
        values.push(await store.increment("SALES_INVOICE", null));
      }
      // Exactly 1..1000 in order: no gaps, no dupes.
      expect(values).toEqual(Array.from({ length: 1000 }, (_, i) => i + 1));
      expect(new Set(values).size).toBe(1000);
    } finally {
      store.close();
    }
  });

  it("keeps independent counters per code", async () => {
    const store = createSqliteSequenceStore();
    try {
      expect(await store.increment("A", null)).toBe(1);
      expect(await store.increment("B", null)).toBe(1);
      expect(await store.increment("A", null)).toBe(2);
      expect(await store.increment("B", null)).toBe(2);
    } finally {
      store.close();
    }
  });

  it("resets the counter at the annual (period) boundary", async () => {
    const store = createSqliteSequenceStore();
    try {
      expect(await store.increment("POS_SALE", 2025)).toBe(1);
      expect(await store.increment("POS_SALE", 2025)).toBe(2);
      expect(await store.increment("POS_SALE", 2025)).toBe(3);
      // New year -> new period row -> starts again at 1.
      expect(await store.increment("POS_SALE", 2026)).toBe(1);
      expect(await store.increment("POS_SALE", 2026)).toBe(2);
      // Old period is untouched and continues where it left off.
      expect(await store.increment("POS_SALE", 2025)).toBe(4);
    } finally {
      store.close();
    }
  });

  it("drives the domain NextNumberService end to end", async () => {
    const store = createSqliteSequenceStore();
    try {
      const svc = new NextNumberService(store);
      expect((await svc.next("SALES_INVOICE")).formatted).toBe("INV-000001");
      expect((await svc.next("SALES_INVOICE")).formatted).toBe("INV-000002");
      expect((await svc.next("JOURNAL_ENTRY")).formatted).toBe("JE-000001");
    } finally {
      store.close();
    }
  });
});
