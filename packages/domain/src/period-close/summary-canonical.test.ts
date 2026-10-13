import { createHash } from "node:crypto";
import { describe, expect, it } from "vitest";
import { Money } from "../money/index.js";
import { canonicalCloseSummary, type UnsignedPeriodCloseSummary } from "./summary.js";

const summary = {
  id: "PCS-1",
  periodId: "fp-2026-07",
  year: 2026,
  periodNumber: 7,
  startDate: "2026-07-01",
  endDate: "2026-07-31",
  closedBy: "USER-ADMIN",
  closedAt: "2026-08-03T09:00:00.000Z",
  overrideReason: null,
  failedChecks: [],
  checks: [],
  trialBalance: [{ accountId: "1105", code: "1105", nameAr: "العملاء", nameEn: null, opening: Money.fromMajor("10"), movement: Money.fromMajor("2.5"), closing: Money.fromMajor("12.5") }],
  totals: { closingDebit: Money.fromMajor("12.5"), closingCredit: Money.zero(), movementDebit: Money.fromMajor("2.5"), movementCredit: Money.zero() },
} as unknown as UnsignedPeriodCloseSummary;

const SEALED_SHA256 = "cd679517d40fd9ef55571a738fa5800cb8010f414cd2dc7f3815b606b28cc3cc";
const SEALED_BYTES =
  '{"checks":[],"closedAt":"2026-08-03T09:00:00.000Z","closedBy":"USER-ADMIN","endDate":"2026-07-31","failedChecks":[],"id":"PCS-1","overrideReason":null,"periodId":"fp-2026-07","periodNumber":7,"startDate":"2026-07-01","totals":{"closingCredit":"0.000000","closingDebit":"12.500000","movementCredit":"0.000000","movementDebit":"2.500000"},"trialBalance":[{"accountId":"1105","closing":"12.500000","code":"1105","movement":"2.500000","nameAr":"العملاء","nameEn":null,"opening":"10.000000"}],"year":2026}';

describe("the bytes a period-close summary is sealed over", () => {
  it("are these, key for key and digit for digit — a stored hash only verifies while they stay so", () => {
    expect(canonicalCloseSummary(summary)).toBe(SEALED_BYTES);
    expect(createHash("sha256").update(canonicalCloseSummary(summary)).digest("hex")).toBe(SEALED_SHA256);
  });

  it("do not depend on the order the fields were written in", () => {
    const reordered = Object.fromEntries(Object.entries(summary).reverse()) as unknown as UnsignedPeriodCloseSummary;
    expect(canonicalCloseSummary(reordered)).toBe(SEALED_BYTES);
  });
});
