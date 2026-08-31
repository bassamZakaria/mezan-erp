import { describe, it, expect } from "vitest";
import { generateFiscalYear, closeFiscalPeriod, lockFiscalPeriod } from "@mezan/domain";
import { createSqliteFiscalPeriodRepository } from "./fiscal-period-repository.js";

describe("SqliteFiscalPeriodRepository", () => {
  it("generates and retrieves a full fiscal year (12 periods) by id, by year, and by date", async () => {
    const repo = createSqliteFiscalPeriodRepository();
    try {
      await generateFiscalYear(2026, repo, (y, p) => `fp-${y}-${p}`);
      expect(await repo.findById("fp-2026-8")).toMatchObject({ year: 2026, periodNumber: 8, status: "open" });
      expect(await repo.listByYear(2026)).toHaveLength(12);
      expect(await repo.findByYearAndNumber(2026, 1)).toMatchObject({ startDate: "2026-01-01" });
      expect(await repo.findByDate("2026-08-15")).toMatchObject({ periodNumber: 8 });
      expect(await repo.findByDate("2027-01-01")).toBeNull();

      // THE LAST DAY OF THE MONTH, AS AN INSTANT — which is what every caller
      // actually passes (a document's `occurredAt`), and what this test used to
      // miss by asking with a mid-month DAY. `end_date` is "2026-08-31" and
      // string order puts "2026-08-31T…" after it, so `BETWEEN` matched nothing
      // and every GL posting on a month's last day failed for want of a period
      // — on the day a shop posts most, because that is when it closes.
      expect(await repo.findByDate("2026-08-31T03:10:33.016Z")).toMatchObject({ periodNumber: 8 });
      expect(await repo.findByDate("2026-08-01T00:00:00.000Z")).toMatchObject({ periodNumber: 8 });
      expect(await repo.findByDate("2026-02-28T23:59:59.999Z")).toMatchObject({ periodNumber: 2 });
      // Still outside is still outside: normalising the day must not widen the
      // period by one.
      expect(await repo.findByDate("2027-01-01T00:00:00.000Z")).toBeNull();
    } finally {
      repo.close();
    }
  });

  it("persists status transitions (open -> closed -> locked)", async () => {
    const repo = createSqliteFiscalPeriodRepository();
    try {
      await generateFiscalYear(2026, repo, (y, p) => `fp-${y}-${p}`);
      await closeFiscalPeriod("fp-2026-1", repo);
      expect((await repo.findById("fp-2026-1"))?.status).toBe("closed");
      await lockFiscalPeriod("fp-2026-1", repo);
      expect((await repo.findById("fp-2026-1"))?.status).toBe("locked");
    } finally {
      repo.close();
    }
  });

  it("list() returns every persisted period ordered by year/period number", async () => {
    const repo = createSqliteFiscalPeriodRepository();
    try {
      await generateFiscalYear(2026, repo, (y, p) => `fp-${y}-${p}`);
      const all = await repo.list();
      expect(all).toHaveLength(12);
      expect(all[0]).toMatchObject({ periodNumber: 1 });
      expect(all[11]).toMatchObject({ periodNumber: 12 });
    } finally {
      repo.close();
    }
  });
});
