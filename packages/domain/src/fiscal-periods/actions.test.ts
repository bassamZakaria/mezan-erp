import { describe, it, expect } from "vitest";
import { InMemoryFiscalPeriodRepository } from "./test-helpers/in-memory-fiscal-period-repository.js";
import { closeFiscalPeriod, lockFiscalPeriod, reopenFiscalPeriod } from "./actions.js";
import { FiscalPeriodNotFoundError, InvalidPeriodTransitionError } from "./errors.js";

async function seedOpenPeriod(repo: InMemoryFiscalPeriodRepository) {
  await repo.create({ id: "fp1", year: 2026, periodNumber: 8, startDate: "2026-08-01", endDate: "2026-08-31", status: "open" });
}

describe("fiscal period repo-backed actions", () => {
  it("closeFiscalPeriod persists the closed status", async () => {
    const repo = new InMemoryFiscalPeriodRepository();
    await seedOpenPeriod(repo);
    const closed = await closeFiscalPeriod("fp1", repo);
    expect(closed.status).toBe("closed");
    expect((await repo.findById("fp1"))?.status).toBe("closed");
  });

  it("404s (throws FiscalPeriodNotFoundError) for an unknown id", async () => {
    const repo = new InMemoryFiscalPeriodRepository();
    await expect(closeFiscalPeriod("nope", repo)).rejects.toThrow(FiscalPeriodNotFoundError);
  });

  it("lockFiscalPeriod requires the period to already be closed", async () => {
    const repo = new InMemoryFiscalPeriodRepository();
    await seedOpenPeriod(repo);
    await expect(lockFiscalPeriod("fp1", repo)).rejects.toThrow(InvalidPeriodTransitionError);
    await closeFiscalPeriod("fp1", repo);
    const locked = await lockFiscalPeriod("fp1", repo);
    expect(locked.status).toBe("locked");
  });

  it("reopenFiscalPeriod flips a closed period back to open", async () => {
    const repo = new InMemoryFiscalPeriodRepository();
    await seedOpenPeriod(repo);
    await closeFiscalPeriod("fp1", repo);
    const reopened = await reopenFiscalPeriod("fp1", repo);
    expect(reopened.status).toBe("open");
  });
});
