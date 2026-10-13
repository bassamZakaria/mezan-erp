import { describe, it, expect } from "vitest";
import { InMemoryFiscalPeriodRepository } from "./test-helpers/in-memory-fiscal-period-repository.js";
import * as actions from "./actions.js";
import { reopenFiscalPeriod } from "./actions.js";
import { FiscalPeriodNotFoundError, InvalidPeriodTransitionError } from "./errors.js";

async function seedPeriod(repo: InMemoryFiscalPeriodRepository, status: "open" | "closed" | "locked") {
  await repo.create({ id: "fp1", year: 2026, periodNumber: 8, startDate: "2026-08-01", endDate: "2026-08-31", status });
}

describe("fiscal period repo-backed actions", () => {
  it("reopenFiscalPeriod flips a closed period back to open and persists it", async () => {
    const repo = new InMemoryFiscalPeriodRepository();
    await seedPeriod(repo, "closed");
    const reopened = await reopenFiscalPeriod("fp1", repo);
    expect(reopened.status).toBe("open");
    expect((await repo.findById("fp1"))?.status).toBe("open");
  });

  it("refuses to reopen a locked period, and leaves it locked", async () => {
    const repo = new InMemoryFiscalPeriodRepository();
    await seedPeriod(repo, "locked");
    await expect(reopenFiscalPeriod("fp1", repo)).rejects.toThrow(InvalidPeriodTransitionError);
    expect((await repo.findById("fp1"))?.status).toBe("locked");
  });

  it("404s (throws FiscalPeriodNotFoundError) for an unknown id", async () => {
    await expect(reopenFiscalPeriod("nope", new InMemoryFiscalPeriodRepository())).rejects.toThrow(FiscalPeriodNotFoundError);
  });

  it("offers no close or lock that skips the checklist, the override rule and the audit row", () => {
    expect(Object.keys(actions).sort()).toEqual(["reopenFiscalPeriod"]);
  });
});
