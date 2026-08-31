import Database from "better-sqlite3";
import { describe, expect, it } from "vitest";
import { Money } from "@mezan/domain";
import { createSqliteVatFilingStore } from "./vat-filing-store.js";

/**
 * `findCovering` is what stops a posting landing inside a VAT period whose
 * return has already been filed. It compared a caller's INSTANT against the
 * period's `period_to` DAY as strings, so on the period's own last day
 * `period_to >= ?` was false, the filing read as not covering that day, and the
 * control failed OPEN — silently, once a month. A control that works on thirty
 * days out of thirty-one is not a control.
 */
function storeWithFiledPeriod() {
  const sqlite = new Database(":memory:");
  const store = createSqliteVatFilingStore(sqlite);
  return { sqlite, store };
}

const AUGUST = {
  id: "VF-2026-08",
  periodFrom: "2026-08-01",
  periodTo: "2026-08-31",
  netAmount: Money.fromMajor("1250.50"),
  referenceNo: "ETA-99",
  status: "filed" as const,
  filedAt: "2026-09-02T09:00:00.000Z",
  filedBy: "USER-ADMIN",
  amendedAt: null,
  amendmentReason: null,
};

describe("SqliteVatFilingStore.findCovering", () => {
  it("covers a mid-period day", async () => {
    const { sqlite, store } = storeWithFiledPeriod();
    try {
      await store.save(AUGUST);
      expect(await store.findCovering("2026-08-15")).toHaveLength(1);
    } finally {
      sqlite.close();
    }
  });

  it("covers the period's LAST day, given as an instant", async () => {
    const { sqlite, store } = storeWithFiledPeriod();
    try {
      await store.save(AUGUST);
      // The regression. Before the fix this returned [], so `assertVatNotFiled`
      // found no filed period and allowed the posting.
      expect(await store.findCovering("2026-08-31T03:10:33.016Z")).toHaveLength(1);
      expect(await store.findCovering("2026-08-01T00:00:00.000Z")).toHaveLength(1);
    } finally {
      sqlite.close();
    }
  });

  it("still does not cover a day outside the period", async () => {
    const { sqlite, store } = storeWithFiledPeriod();
    try {
      await store.save(AUGUST);
      // Normalising the day must not widen the period by one at either end.
      expect(await store.findCovering("2026-09-01T00:00:00.000Z")).toHaveLength(0);
      expect(await store.findCovering("2026-07-31T23:59:59.999Z")).toHaveLength(0);
    } finally {
      sqlite.close();
    }
  });
});
