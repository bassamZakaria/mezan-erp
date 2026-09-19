import { describe, it, expect } from "vitest";
import { Qty } from "@mezan/domain";
import {
  createSqliteAttendanceRepository,
  createSqliteLeavePolicyRepository,
  createSqliteLeaveBalanceRepository,
  createSqliteLeaveAccrualBatchRepository,
} from "./hr-time-leave-store.js";

describe("SqliteAttendanceRepository", () => {
  function baseEntry() {
    return {
      id: "att-1",
      employeeId: "emp-1",
      date: "2026-01-05",
      checkIn: "08:00",
      checkOut: "17:00",
      workedMinutes: 480,
      approvedOvertimeMinutes: null,
      holidayCompensation: "pay" as const,
      status: "present" as const,
      notes: null,
      createdAt: "2026-01-05T17:00:00.000Z",
      updatedAt: "2026-01-05T17:00:00.000Z",
    };
  }

  it("round-trips by id and by (employeeId, date), and checkIn/checkOut/notes as null", async () => {
    const repo = createSqliteAttendanceRepository();
    try {
      await repo.create({ ...baseEntry(), checkIn: null, checkOut: null, notes: null, status: "absent" });
      const loaded = await repo.findById("att-1");
      expect(loaded?.checkIn).toBeNull();
      expect(loaded?.checkOut).toBeNull();
      expect(loaded?.notes).toBeNull();
      const byKey = await repo.findByEmployeeAndDate("emp-1", "2026-01-05");
      expect(byKey?.id).toBe("att-1");
      expect(await repo.findByEmployeeAndDate("emp-1", "2026-02-01")).toBeNull();
    } finally {
      repo.close();
    }
  });

  it("round-trips a holiday taken as a substitute day off and a راحة بديلة (D186)", async () => {
    const repo = createSqliteAttendanceRepository();
    try {
      await repo.create({ ...baseEntry(), holidayCompensation: "day_off" });
      await repo.create({ ...baseEntry(), id: "att-2", date: "2026-01-08", status: "compensatory_off", checkIn: null, checkOut: null, workedMinutes: 0 });
      expect((await repo.findById("att-1"))?.holidayCompensation).toBe("day_off");
      expect((await repo.findById("att-2"))?.status).toBe("compensatory_off");
      expect((await repo.findById("att-2"))?.holidayCompensation).toBe("pay");
    } finally {
      repo.close();
    }
  });

  it("enforces uniqueness of (employee_id, date) — one attendance row per employee per day", async () => {
    const repo = createSqliteAttendanceRepository();
    try {
      await repo.create(baseEntry());
      await expect(repo.create({ ...baseEntry(), id: "att-2" })).rejects.toThrow();
      expect((await repo.list()).map((a) => a.id)).toEqual(["att-1"]);
    } finally {
      repo.close();
    }
  });

  it("update() changes status/workedMinutes via upsert", async () => {
    const repo = createSqliteAttendanceRepository();
    try {
      await repo.create(baseEntry());
      await repo.update({ ...baseEntry(), status: "late", workedMinutes: 420 });
      const loaded = await repo.findById("att-1");
      expect(loaded?.status).toBe("late");
      expect(loaded?.workedMinutes).toBe(420);
    } finally {
      repo.close();
    }
  });

  it("list(filter) narrows by employeeId/from/to/status, and a filter matching nothing returns an empty list", async () => {
    const repo = createSqliteAttendanceRepository();
    try {
      await repo.create({ ...baseEntry(), id: "att-1", employeeId: "emp-1", date: "2026-01-05", status: "present" });
      await repo.create({ ...baseEntry(), id: "att-2", employeeId: "emp-1", date: "2026-01-06", status: "absent" });
      await repo.create({ ...baseEntry(), id: "att-3", employeeId: "emp-2", date: "2026-01-05", status: "present" });

      expect((await repo.list({ employeeId: "emp-2" })).map((a) => a.id)).toEqual(["att-3"]);
      expect((await repo.list({ from: "2026-01-06" })).map((a) => a.id).sort()).toEqual(["att-2"]);
      expect((await repo.list({ to: "2026-01-05" })).map((a) => a.id).sort()).toEqual(["att-1", "att-3"]);
      expect((await repo.list({ status: "absent" })).map((a) => a.id)).toEqual(["att-2"]);
      expect(await repo.list({ employeeId: "emp-does-not-exist" })).toEqual([]);
      expect(await repo.list({ status: "holiday" })).toEqual([]);
    } finally {
      repo.close();
    }
  });

  it("list() with no filter orders by date DESC then employee_id", async () => {
    const repo = createSqliteAttendanceRepository();
    try {
      await repo.create({ ...baseEntry(), id: "att-early", employeeId: "emp-2", date: "2026-01-04" });
      await repo.create({ ...baseEntry(), id: "att-late-a", employeeId: "emp-2", date: "2026-01-06" });
      await repo.create({ ...baseEntry(), id: "att-late-b", employeeId: "emp-1", date: "2026-01-06" });
      const all = await repo.list();
      expect(all.map((a) => a.id)).toEqual(["att-late-b", "att-late-a", "att-early"]);
    } finally {
      repo.close();
    }
  });
});

describe("SqliteLeavePolicyRepository", () => {
  function basePolicy() {
    return {
      id: "pol-1",
      leaveType: "annual" as const,
      entitlementDays: Qty.fromMajor("21.000000"),
      accrualFrequency: "monthly" as const,
      carryOver: true,
      maxCarryOverDays: Qty.fromMajor("5.500000"),
      payoutOnTermination: true,
      legallyMandated: true,
      presetCode: "EG_ANNUAL",
      active: true,
      createdAt: "2026-01-01T00:00:00.000Z",
      updatedAt: "2026-01-01T00:00:00.000Z",
    };
  }

  it("round-trips entitlementDays/maxCarryOverDays as Qty at scale 1e-6, and maxCarryOverDays as null when unset", async () => {
    const repo = createSqliteLeavePolicyRepository();
    try {
      await repo.create(basePolicy());
      const loaded = await repo.findById("pol-1");
      expect(loaded?.entitlementDays.toString()).toBe("21.000000");
      expect(loaded?.maxCarryOverDays?.toString()).toBe("5.500000");

      await repo.create({ ...basePolicy(), id: "pol-2", leaveType: "sick", maxCarryOverDays: null });
      const loaded2 = await repo.findById("pol-2");
      expect(loaded2?.maxCarryOverDays).toBeNull();
    } finally {
      repo.close();
    }
  });

  it("round-trips every boolean flag independently", async () => {
    const repo = createSqliteLeavePolicyRepository();
    try {
      await repo.create({
        ...basePolicy(),
        carryOver: false,
        payoutOnTermination: false,
        legallyMandated: false,
        active: false,
      });
      const loaded = await repo.findById("pol-1");
      expect(loaded?.carryOver).toBe(false);
      expect(loaded?.payoutOnTermination).toBe(false);
      expect(loaded?.legallyMandated).toBe(false);
      expect(loaded?.active).toBe(false);
    } finally {
      repo.close();
    }
  });

  it("enforces uniqueness of leave_type — one policy per leave type", async () => {
    const repo = createSqliteLeavePolicyRepository();
    try {
      await repo.create(basePolicy());
      await expect(repo.create({ ...basePolicy(), id: "pol-2" })).rejects.toThrow();
    } finally {
      repo.close();
    }
  });

  it("update() changes entitlementDays/active but the UPDATE SET clause leaves leave_type untouched", async () => {
    const repo = createSqliteLeavePolicyRepository();
    try {
      await repo.create(basePolicy());
      await repo.update({
        ...basePolicy(),
        leaveType: "sick",
        entitlementDays: Qty.fromMajor("30.000000"),
        active: false,
      });
      const loaded = await repo.findById("pol-1");
      expect(loaded?.entitlementDays.toString()).toBe("30.000000");
      expect(loaded?.active).toBe(false);
      expect(loaded?.leaveType).toBe("annual");
    } finally {
      repo.close();
    }
  });

  it("findByLeaveType returns null for a type with no policy configured", async () => {
    const repo = createSqliteLeavePolicyRepository();
    try {
      await repo.create(basePolicy());
      expect((await repo.findByLeaveType("annual"))?.id).toBe("pol-1");
      expect(await repo.findByLeaveType("maternity")).toBeNull();
    } finally {
      repo.close();
    }
  });

  it("remove() deletes the policy, and it is gone from both findById and list()", async () => {
    const repo = createSqliteLeavePolicyRepository();
    try {
      await repo.create(basePolicy());
      await repo.remove("pol-1");
      expect(await repo.findById("pol-1")).toBeNull();
      expect(await repo.list()).toEqual([]);
    } finally {
      repo.close();
    }
  });

  it("list() orders by leave_type", async () => {
    const repo = createSqliteLeavePolicyRepository();
    try {
      await repo.create({ ...basePolicy(), id: "pol-sick", leaveType: "sick" });
      await repo.create({ ...basePolicy(), id: "pol-annual", leaveType: "annual" });
      const all = await repo.list();
      expect(all.map((p) => p.leaveType)).toEqual(["annual", "sick"]);
    } finally {
      repo.close();
    }
  });
});

describe("SqliteLeaveBalanceRepository", () => {
  function baseBalance() {
    return {
      id: "bal-1",
      employeeId: "emp-1",
      leaveType: "annual" as const,
      year: 2026,
      entitled: Qty.fromMajor("21.000000"),
      carriedOver: Qty.fromMajor("2.500000"),
      used: Qty.fromMajor("3.250000"),
      createdAt: "2026-01-01T00:00:00.000Z",
      updatedAt: "2026-01-01T00:00:00.000Z",
    };
  }

  it("round-trips entitled/carriedOver/used as Qty at scale 1e-6", async () => {
    const repo = createSqliteLeaveBalanceRepository();
    try {
      await repo.create(baseBalance());
      const loaded = await repo.findById("bal-1");
      expect(loaded?.entitled.toString()).toBe("21.000000");
      expect(loaded?.carriedOver.toString()).toBe("2.500000");
      expect(loaded?.used.toString()).toBe("3.250000");
      // Remaining = entitled + carriedOver - used, computed from the round-tripped
      // values, must land exactly on the expected micro-unit.
      const remaining = loaded!.entitled.add(loaded!.carriedOver).subtract(loaded!.used);
      expect(remaining.toString()).toBe("20.250000");
    } finally {
      repo.close();
    }
  });

  it("enforces uniqueness of (employee_id, leave_type, year)", async () => {
    const repo = createSqliteLeaveBalanceRepository();
    try {
      await repo.create(baseBalance());
      await expect(repo.create({ ...baseBalance(), id: "bal-2" })).rejects.toThrow();
      // A different year for the same employee/type is a different balance.
      await repo.create({ ...baseBalance(), id: "bal-2026-vs-2027", year: 2027 });
      expect(await repo.list()).toHaveLength(2);
    } finally {
      repo.close();
    }
  });

  it("find(employeeId, leaveType, year) returns null when the combination doesn't exist", async () => {
    const repo = createSqliteLeaveBalanceRepository();
    try {
      await repo.create(baseBalance());
      expect((await repo.find("emp-1", "annual", 2026))?.id).toBe("bal-1");
      expect(await repo.find("emp-1", "annual", 2025)).toBeNull();
      expect(await repo.find("emp-1", "sick", 2026)).toBeNull();
    } finally {
      repo.close();
    }
  });

  it("list(filter) narrows by employeeId/leaveType/year, and a filter matching nothing returns an empty list", async () => {
    const repo = createSqliteLeaveBalanceRepository();
    try {
      await repo.create({ ...baseBalance(), id: "bal-1", employeeId: "emp-1", leaveType: "annual", year: 2026 });
      await repo.create({ ...baseBalance(), id: "bal-2", employeeId: "emp-1", leaveType: "sick", year: 2026 });
      await repo.create({ ...baseBalance(), id: "bal-3", employeeId: "emp-2", leaveType: "annual", year: 2026 });

      expect((await repo.list({ leaveType: "sick" })).map((b) => b.id)).toEqual(["bal-2"]);
      expect((await repo.list({ employeeId: "emp-2" })).map((b) => b.id)).toEqual(["bal-3"]);
      expect((await repo.list({ year: 2027 }))).toEqual([]);
    } finally {
      repo.close();
    }
  });

  it("update() changes used/entitled but not the (employeeId, leaveType, year) identity, via upsert on id", async () => {
    const repo = createSqliteLeaveBalanceRepository();
    try {
      await repo.create(baseBalance());
      await repo.update({ ...baseBalance(), used: Qty.fromMajor("5.000000") });
      const loaded = await repo.findById("bal-1");
      expect(loaded?.used.toString()).toBe("5.000000");
      expect(loaded?.employeeId).toBe("emp-1");
      expect(loaded?.leaveType).toBe("annual");
      expect(loaded?.year).toBe(2026);
    } finally {
      repo.close();
    }
  });
});

describe("SqliteLeaveAccrualBatchRepository", () => {
  function baseBatch() {
    return {
      id: "batch-1",
      number: "LAB-000001",
      periodKey: "2026-01",
      frequency: "monthly" as const,
      runType: "scheduled" as const,
      runDate: "2026-01-31",
      notes: null,
      employeeCount: 2,
      totalDays: Qty.fromMajor("3.500000"),
      lines: [
        { employeeId: "emp-1", leaveType: "annual" as const, days: Qty.fromMajor("1.750000") },
        { employeeId: "emp-2", leaveType: "annual" as const, days: Qty.fromMajor("1.750000") },
      ],
      runBy: null,
      createdAt: "2026-01-31T00:00:00.000Z",
    };
  }

  it("round-trips totalDays and each line's days as Qty at scale 1e-6, and Σ(line days) equals totalDays exactly", async () => {
    const repo = createSqliteLeaveAccrualBatchRepository();
    try {
      await repo.create(baseBatch());
      const loaded = await repo.findById("batch-1");
      expect(loaded?.totalDays.toString()).toBe("3.500000");
      expect(loaded!.lines[0]!.days.toString()).toBe("1.750000");
      const sum = loaded!.lines.reduce((acc, l) => acc + l.days.scaled, 0n);
      expect(sum).toBe(loaded!.totalDays.scaled);
    } finally {
      repo.close();
    }
  });

  it("round-trips notes/runBy as null", async () => {
    const repo = createSqliteLeaveAccrualBatchRepository();
    try {
      await repo.create(baseBatch());
      const loaded = await repo.findById("batch-1");
      expect(loaded?.notes).toBeNull();
      expect(loaded?.runBy).toBeNull();
    } finally {
      repo.close();
    }
  });

  it("enforces uniqueness of period_key — a second run for the same period is refused at the DB layer (idempotency backstop)", async () => {
    const repo = createSqliteLeaveAccrualBatchRepository();
    try {
      await repo.create(baseBatch());
      await expect(repo.create({ ...baseBatch(), id: "batch-2", number: "LAB-000002" })).rejects.toThrow();
      expect(await repo.list()).toHaveLength(1);
    } finally {
      repo.close();
    }
  });

  it("findByPeriodKey returns null for a period with no batch yet", async () => {
    const repo = createSqliteLeaveAccrualBatchRepository();
    try {
      await repo.create(baseBatch());
      expect((await repo.findByPeriodKey("2026-01"))?.id).toBe("batch-1");
      expect(await repo.findByPeriodKey("2026-02")).toBeNull();
    } finally {
      repo.close();
    }
  });

  it("list(filter) narrows by runType, and a runType with no batches returns an empty list", async () => {
    const repo = createSqliteLeaveAccrualBatchRepository();
    try {
      await repo.create({ ...baseBatch(), id: "batch-sched", periodKey: "2026-01", runType: "scheduled" });
      await repo.create({ ...baseBatch(), id: "batch-manual", periodKey: "2026-02", runType: "manual", number: "LAB-000002" });
      expect((await repo.list({ runType: "manual" })).map((b) => b.id)).toEqual(["batch-manual"]);
      expect((await repo.list({ runType: "scheduled" })).map((b) => b.id)).toEqual(["batch-sched"]);
    } finally {
      repo.close();
    }
  });

  it("list() with no filter orders by run_date DESC, created_at DESC", async () => {
    const repo = createSqliteLeaveAccrualBatchRepository();
    try {
      await repo.create({ ...baseBatch(), id: "batch-jan", periodKey: "2026-01", runDate: "2026-01-31" });
      await repo.create({ ...baseBatch(), id: "batch-feb", periodKey: "2026-02", runDate: "2026-02-28", number: "LAB-000002" });
      const all = await repo.list();
      expect(all.map((b) => b.id)).toEqual(["batch-feb", "batch-jan"]);
    } finally {
      repo.close();
    }
  });
});
