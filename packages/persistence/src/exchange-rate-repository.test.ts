import { describe, it, expect, afterEach } from "vitest";
import type { ExchangeRate } from "@mezan/domain";
import { createSqliteExchangeRateRepository, type SqliteExchangeRateRepositoryHandle } from "./exchange-rate-repository.js";

let repo: SqliteExchangeRateRepositoryHandle;
afterEach(() => repo?.close());

function rate(overrides: Partial<ExchangeRate>): ExchangeRate {
  return { id: "r", currency: "USD", rate: "50", effectiveDate: "2026-08-01", rateType: "standard", source: "manual", status: "approved", ...overrides };
}

describe("SqliteExchangeRateRepository", () => {
  it("returns the latest approved/locked rate on or before the date", async () => {
    repo = createSqliteExchangeRateRepository();
    await repo.create(rate({ id: "r1", rate: "50", effectiveDate: "2026-08-01" }));
    await repo.create(rate({ id: "r2", rate: "55", effectiveDate: "2026-08-20" }));
    await repo.create(rate({ id: "r3", rate: "99", effectiveDate: "2026-09-01" })); // future
    const r = await repo.findRate("USD", "2026-08-31");
    expect(r?.rate).toBe("55");
  });

  it("ignores pending rates (approval workflow)", async () => {
    repo = createSqliteExchangeRateRepository();
    await repo.create(rate({ id: "r1", rate: "60", effectiveDate: "2026-08-25", status: "pending" }));
    await repo.create(rate({ id: "r2", rate: "55", effectiveDate: "2026-08-20", status: "approved" }));
    const r = await repo.findRate("USD", "2026-08-31");
    expect(r?.rate).toBe("55");
  });

  it("returns null when no usable rate exists", async () => {
    repo = createSqliteExchangeRateRepository();
    expect(await repo.findRate("GBP", "2026-08-31")).toBeNull();
  });
});
