import { describe, it, expect } from "vitest";
import { Money } from "../money/index.js";
import {
  applyGarnishmentRecovery,
  createGarnishment,
  createGarnishmentProvider,
  getGarnishmentKindLabel,
  releaseGarnishment,
  type CreateGarnishmentCommand,
  type GarnishmentRecord,
} from "./garnishment.js";
import { InvalidGarnishmentError } from "./errors.js";

const NOW = () => "2026-03-01T00:00:00.000Z";

function command(overrides: Partial<CreateGarnishmentCommand> = {}): CreateGarnishmentCommand {
  return {
    id: "grn-1",
    employeeId: "emp-1",
    kind: "court_order",
    reference: " 1842/2026 ",
    labelAr: " حجز تنفيذي ",
    totalAmount: Money.fromMajor("900.00"),
    monthlyAmount: Money.fromMajor("300.00"),
    currency: "EGP",
    startDate: "2026-01-01",
    ...overrides,
  };
}

describe("createGarnishment", () => {
  it("opens an active order whose outstanding is the whole total and nothing recovered", () => {
    const order = createGarnishment(command(), NOW);
    expect(order.reference).toBe("1842/2026");
    expect(order.labelAr).toBe("حجز تنفيذي");
    expect(order.outstanding.toString()).toBe("900.000000");
    expect(order.recovered.toString()).toBe("0.000000");
    expect(order.active).toBe(true);
    expect(order.endDate).toBeNull();
    expect(order.createdAt).toBe("2026-03-01T00:00:00.000Z");
  });

  it("refuses a monthly instalment larger than the order itself", () => {
    expect(() => createGarnishment(command({ monthlyAmount: Money.fromMajor("900.01") }), NOW)).toThrow(InvalidGarnishmentError);
  });

  it("refuses zero amounts, a blank reference, and an end date before the start", () => {
    for (const bad of [
      command({ totalAmount: Money.zero() }),
      command({ monthlyAmount: Money.zero() }),
      command({ reference: "  " }),
      command({ endDate: "2025-12-31" }),
      command({ startDate: "01/01/2026" }),
    ]) {
      expect(() => createGarnishment(bad, NOW)).toThrow(InvalidGarnishmentError);
    }
  });

  it("names every reason at once, in Arabic", () => {
    try {
      createGarnishment(command({ employeeId: "", reference: "" }), NOW);
      expect.unreachable();
    } catch (err) {
      expect((err as InvalidGarnishmentError).reasons).toEqual(["الموظف مطلوب", "رقم السند أو الحكم مطلوب"]);
    }
  });
});

describe("applyGarnishmentRecovery", () => {
  const open = (): GarnishmentRecord => createGarnishment(command(), NOW);

  it("counts the order down by exactly what was withheld", () => {
    const next = applyGarnishmentRecovery(open(), Money.fromMajor("300.00"), NOW);
    expect(next.outstanding.toString()).toBe("600.000000");
    expect(next.recovered.toString()).toBe("300.000000");
    expect(next.active).toBe(true);
  });

  it("deactivates itself the moment outstanding reaches zero, so a satisfied order stops deducting", () => {
    const paid = applyGarnishmentRecovery(applyGarnishmentRecovery(open(), Money.fromMajor("600.00"), NOW), Money.fromMajor("300.00"), NOW);
    expect(paid.outstanding.scaled).toBe(0n);
    expect(paid.recovered.toString()).toBe("900.000000");
    expect(paid.active).toBe(false);
  });

  it("never recovers more than was owed — total stays outstanding plus recovered", () => {
    const next = applyGarnishmentRecovery(open(), Money.fromMajor("5000.00"), NOW);
    expect(next.recovered.toString()).toBe("900.000000");
    expect(next.outstanding.scaled + next.recovered.scaled).toBe(next.totalAmount.scaled);
  });

  it("ignores a zero or negative amount rather than reopening or inflating the order", () => {
    const order = open();
    expect(applyGarnishmentRecovery(order, Money.zero(), NOW)).toBe(order);
    expect(applyGarnishmentRecovery(order, Money.fromMajor("-10"), NOW)).toBe(order);
  });

  it("does not reactivate a released order", () => {
    const released = releaseGarnishment(open(), NOW);
    expect(applyGarnishmentRecovery(released, Money.fromMajor("100"), NOW).active).toBe(false);
  });
});

describe("createGarnishmentProvider", () => {
  it("hands payroll only orders that are active, still owed, and in force on the payroll date", async () => {
    const base = createGarnishment(command(), NOW);
    const records: GarnishmentRecord[] = [
      { ...base, id: "live" },
      { ...base, id: "released", active: false },
      { ...base, id: "paid", outstanding: Money.zero() },
      { ...base, id: "future", startDate: "2026-02-01" },
      { ...base, id: "ended", endDate: "2026-01-15" },
      { ...base, id: "last-day", endDate: "2026-01-31" },
      { ...base, id: "other", employeeId: "emp-2" },
    ];
    const provider = createGarnishmentProvider({ listByEmployeeId: async (id) => records.filter((r) => r.employeeId === id) });
    const active = await provider.listActiveFor("emp-1", "2026-01-31");
    expect(active.map((r) => r.id)).toEqual(["live", "last-day"]);
  });
});

describe("getGarnishmentKindLabel", () => {
  it("labels each kind in Arabic", () => {
    expect(getGarnishmentKindLabel("alimony")).toBe("نفقة");
    expect(getGarnishmentKindLabel("court_order")).toBe("حكم قضائي");
  });
});
