import { describe, it, expect } from "vitest";
import { Money } from "../money/index.js";
import { createInMemoryContractRepository } from "./test-helpers/in-memory-hr-repositories.js";
import { createContract, terminateContract } from "./create-contract.js";
import { InvalidContractError, ContractNotActiveError } from "./errors.js";
import { isContractExpiringSoon } from "./contract.js";

describe("createContract", () => {
  it("creates an indefinite contract with defaults, starting status 'active'", async () => {
    const repo = createInMemoryContractRepository();
    const contract = await createContract(
      { id: "ctr-1", number: "CTR-0001", employeeId: "emp-1", startDate: "2026-01-01", monthlySalary: Money.fromMajor("14000.00") },
      repo,
    );
    expect(contract).toMatchObject({
      type: "indefinite",
      payBasis: "monthly",
      payFrequency: "monthly",
      currency: "EGP",
      endDate: null,
      status: "active",
      allowances: [],
      deductions: [],
    });
    expect(contract.leaveEntitlement).toEqual({ annualLeaveDays: null, sickLeaveDays: null, personalLeaveDays: null });
    expect(await repo.findById("ctr-1")).toEqual(contract);
  });

  it("rejects an indefinite contract with an end date", async () => {
    const repo = createInMemoryContractRepository();
    await expect(
      createContract(
        { id: "ctr-1", number: "CTR-0001", employeeId: "emp-1", startDate: "2026-01-01", endDate: "2026-12-31", monthlySalary: Money.zero() },
        repo,
      ),
    ).rejects.toThrow(InvalidContractError);
  });

  it("rejects an end date before the start date", async () => {
    const repo = createInMemoryContractRepository();
    await expect(
      createContract(
        {
          id: "ctr-1",
          number: "CTR-0001",
          employeeId: "emp-1",
          type: "fixed_term",
          startDate: "2026-06-01",
          endDate: "2026-01-01",
          monthlySalary: Money.zero(),
        },
        repo,
      ),
    ).rejects.toThrow(InvalidContractError);
  });

  it("accepts allowance/deduction line items and leave-entitlement overrides", async () => {
    const repo = createInMemoryContractRepository();
    const contract = await createContract(
      {
        id: "ctr-1",
        number: "CTR-0001",
        employeeId: "emp-1",
        startDate: "2026-01-01",
        monthlySalary: Money.fromMajor("10000.00"),
        allowances: [{ id: "a1", name: "بدل مواصلات", amount: Money.fromMajor("500.00"), componentId: null }],
        deductions: [{ id: "d1", name: "تأمينات", amount: Money.fromMajor("200.00"), componentId: null }],
        leaveEntitlement: { annualLeaveDays: 21 },
      },
      repo,
    );
    expect(contract.allowances).toHaveLength(1);
    expect(contract.deductions).toHaveLength(1);
    expect(contract.leaveEntitlement.annualLeaveDays).toBe(21);
  });
});

describe("terminateContract", () => {
  it("terminates an active contract", async () => {
    const repo = createInMemoryContractRepository();
    const contract = await createContract(
      { id: "ctr-1", number: "CTR-0001", employeeId: "emp-1", startDate: "2026-01-01", monthlySalary: Money.zero() },
      repo,
    );
    const terminated = terminateContract(contract, "2026-06-01T00:00:00.000Z");
    expect(terminated.status).toBe("terminated");
    expect(terminated.terminatedAt).toBe("2026-06-01T00:00:00.000Z");
  });

  it("rejects terminating an already-terminated contract", async () => {
    const repo = createInMemoryContractRepository();
    const contract = await createContract(
      { id: "ctr-1", number: "CTR-0001", employeeId: "emp-1", startDate: "2026-01-01", monthlySalary: Money.zero() },
      repo,
    );
    const terminated = terminateContract(contract);
    expect(() => terminateContract(terminated)).toThrow(ContractNotActiveError);
  });
});

describe("isContractExpiringSoon", () => {
  it("is true for an active contract ending within 30 days", async () => {
    const repo = createInMemoryContractRepository();
    const contract = await createContract(
      {
        id: "ctr-1",
        number: "CTR-0001",
        employeeId: "emp-1",
        type: "fixed_term",
        startDate: "2026-01-01",
        endDate: "2026-08-30",
        monthlySalary: Money.zero(),
      },
      repo,
    );
    expect(isContractExpiringSoon(contract, new Date("2026-08-10T00:00:00Z"))).toBe(true);
  });

  it("is false for an indefinite contract (no end date)", async () => {
    const repo = createInMemoryContractRepository();
    const contract = await createContract(
      { id: "ctr-1", number: "CTR-0001", employeeId: "emp-1", startDate: "2026-01-01", monthlySalary: Money.zero() },
      repo,
    );
    expect(isContractExpiringSoon(contract, new Date("2026-08-10T00:00:00Z"))).toBe(false);
  });

  it("is false once terminated", async () => {
    const repo = createInMemoryContractRepository();
    const contract = await createContract(
      {
        id: "ctr-1",
        number: "CTR-0001",
        employeeId: "emp-1",
        type: "fixed_term",
        startDate: "2026-01-01",
        endDate: "2026-08-15",
        monthlySalary: Money.zero(),
      },
      repo,
    );
    const terminated = terminateContract(contract);
    expect(isContractExpiringSoon(terminated, new Date("2026-08-10T00:00:00Z"))).toBe(false);
  });
});
