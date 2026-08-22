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
