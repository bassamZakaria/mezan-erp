import { afterEach, describe, expect, it } from "vitest";
import { EmployeeRefStatus, Qty, createEmployee, createLeavePolicy, LeaveAccrualRunTypeCode } from "@mezan/domain";
import {
  createSqliteEmployeeRepository,
  createSqliteLeaveAccrualBatchRepository,
  createSqliteLeaveBalanceRepository,
  createSqliteLeavePolicyRepository,
  openSqliteConnection,
  withSqliteTransaction,
} from "@mezan/persistence";
import { createLeaveAccrualJob, ScheduledJobKind, startScheduledJobs } from "./scheduled-jobs.js";

const open: { close(): void }[] = [];
afterEach(() => {
  for (const db of open.splice(0)) db.close();
});

async function setup() {
  const { sqlite } = openSqliteConnection(":memory:");
  open.push(sqlite);
  const employees = createSqliteEmployeeRepository(sqlite);
  const policies = createSqliteLeavePolicyRepository(sqlite);
  const balances = createSqliteLeaveBalanceRepository(sqlite);
  const batches = createSqliteLeaveAccrualBatchRepository(sqlite);
  await createEmployee({ id: "e1", code: "EMP-0001", firstName: "Mona", lastName: "Adel", branchId: "MAIN", hireDate: "2024-01-01" }, employees);
  await policies.create(createLeavePolicy({ id: "p1", leaveType: "annual", entitlementDays: Qty.fromMajor("12"), accrualFrequency: "monthly" }));
  let counter = 0;
  let ids = 0;
  const job = createLeaveAccrualJob({
    batches,
    balances,
    policies,
    employees,
    numbering: { next: async () => ({ formatted: `LAB-${String(++counter).padStart(6, "0")}` }) },
    transactor: { run: (fn) => withSqliteTransaction(sqlite, fn) },
    generateId: () => `id-${++ids}`,
  });
  return { job, batches, balances, employees };
}

describe("leave accrual job", () => {
  it("records only the current month the first time, then catches up the months it missed — once each", async () => {
    const { job, batches, balances } = await setup();
    expect((await job.run("2026-08-10", () => true)).recorded).toEqual(["2026-08"]);
    expect((await job.run("2026-08-25", () => true)).recorded).toEqual([]);
    expect((await job.run("2026-10-02", () => true)).recorded).toEqual(["2026-09", "2026-10"]);

    const recorded = await batches.list();
    expect(recorded.map((b) => b.periodKey).sort()).toEqual(["2026-08", "2026-09", "2026-10"]);
    expect(recorded.every((b) => b.runType === LeaveAccrualRunTypeCode.Scheduled && b.runBy === null)).toBe(true);
    const balance = await balances.find("e1", "annual", 2026);
    expect(balance?.entitled.toString()).toBe(Qty.fromMajor("3").toString());
  });

  it("skips a period a manual run already recorded, and does nothing while not allowed", async () => {
    const { job, batches } = await setup();
    await job.run("2026-08-10", () => true);
    expect((await job.run("2026-08-11", () => false)).recorded).toEqual([]);
    expect(await batches.list()).toHaveLength(1);
  });

  it("ignores terminated employees through the directory", async () => {
    const { job, employees, balances } = await setup();
    const current = await employees.findById("e1");
    await employees.update({ ...current!, status: EmployeeRefStatus.Terminated, terminatedAt: "2026-07-31" });
    await job.run("2026-08-10", () => true);
    expect(await balances.find("e1", "annual", 2026)).toBeNull();
  });
});

describe("startScheduledJobs", () => {
  it("runs every job inside the turn with the tenant day, and stops cleanly", async () => {
    const seen: string[] = [];
    let turns = 0;
    const jobs = startScheduledJobs({
      jobs: [{ kind: ScheduledJobKind.LeaveAccrual, run: async (today) => (seen.push(today), { kind: ScheduledJobKind.LeaveAccrual, recorded: [] }) }],
      today: async () => "2026-10-17",
      turn: async (work) => (turns++, work()),
      firstRunDelayMs: 60_000,
    });
    await jobs.runNow();
    jobs.stop();
    await jobs.runNow();
    expect(seen).toEqual(["2026-10-17"]);
    expect(turns).toBe(1);
  });

  it("keeps ticking after a job throws", async () => {
    const errors: unknown[] = [];
    let calls = 0;
    const jobs = startScheduledJobs({
      jobs: [{ kind: ScheduledJobKind.LeaveAccrual, run: async () => { calls++; throw new Error("boom"); } }],
      today: async () => "2026-10-17",
      turn: (work) => work(),
      firstRunDelayMs: 60_000,
      onError: (_kind, err) => errors.push(err),
    });
    await jobs.runNow();
    await jobs.runNow();
    jobs.stop();
    expect(calls).toBe(2);
    expect(errors).toHaveLength(2);
  });
});
