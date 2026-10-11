import { describe, it, expect } from "vitest";
import { createInMemoryEmployeeRepository } from "./test-helpers/in-memory-hr-repositories.js";
import { createEmployee } from "./create-employee.js";
import { transitionEmployee, terminateEmployee, rehireEmployee } from "./transition-employee.js";
import { InvalidEmployeeError, InvalidEmployeeTransitionError } from "./errors.js";

const BASE = {
  id: "emp-1",
  code: "EMP-0001",
  firstName: "Ahmed",
  lastName: "Mahmoud",
  branchId: "MAIN",
  hireDate: "2020-01-01",
} as const;

describe("transitionEmployee", () => {
  it("allows every documented transition out of active", async () => {
    const repo = createInMemoryEmployeeRepository();
    const emp = await createEmployee(BASE, repo);
    expect(transitionEmployee(emp, "on_leave").status).toBe("on_leave");
    expect(transitionEmployee(emp, "suspended").status).toBe("suspended");
    expect(transitionEmployee(emp, "terminated").status).toBe("terminated");
  });

  it("rejects a transition the state machine does not allow", async () => {
    const repo = createInMemoryEmployeeRepository();
    const emp = await createEmployee(BASE, repo);
    const terminated = transitionEmployee(emp, "terminated");
    expect(() => transitionEmployee(terminated, "active")).toThrow(InvalidEmployeeTransitionError);
  });
});

describe("terminateEmployee", () => {
  it("sets status terminated and stamps terminatedAt", async () => {
    const repo = createInMemoryEmployeeRepository();
    const emp = await createEmployee(BASE, repo);
    const terminated = terminateEmployee(emp, "2026-06-01", "2026-06-10");
    expect(terminated.status).toBe("terminated");
    expect(terminated.terminatedAt).toBe("2026-06-01");
    expect(() => terminateEmployee(emp, "2026-06-11", "2026-06-10")).toThrow(InvalidEmployeeError);
    expect(() => terminateEmployee(emp, "2026-06-01T00:00:00.000Z", "2026-06-10")).toThrow(InvalidEmployeeError);
    expect(() => terminateEmployee({ ...emp, hireDate: "2026-06-05" }, "2026-06-01", "2026-06-10")).toThrow(InvalidEmployeeError);
  });

  it("rejects terminating an already-terminated employee", async () => {
    const repo = createInMemoryEmployeeRepository();
    const emp = await createEmployee(BASE, repo);
    const terminated = terminateEmployee(emp, "2026-06-01");
    expect(() => terminateEmployee(terminated, "2026-06-02")).toThrow(InvalidEmployeeTransitionError);
  });
});

describe("rehireEmployee", () => {
  it("rejects rehiring an employee who is not terminated", async () => {
    const repo = createInMemoryEmployeeRepository();
    const emp = await createEmployee(BASE, repo);
    expect(() => rehireEmployee(emp, "2026-01-01")).toThrow(InvalidEmployeeTransitionError);
  });

  it("rejects a malformed rehire date", async () => {
    const repo = createInMemoryEmployeeRepository();
    const emp = await createEmployee(BASE, repo);
    const terminated = terminateEmployee(emp, "2023-01-01");
    expect(() => rehireEmployee(terminated, "not-a-date")).toThrow(InvalidEmployeeError);
  });

  it("re-activates onto the SAME record, folding the served spell into priorServiceYears", async () => {
    const repo = createInMemoryEmployeeRepository();
    const emp = await createEmployee(BASE, repo);
    // 2020-01-01 -> 2023-01-01 spans 1096 days (2020 is a leap year): 3 completed years.
    const terminated = terminateEmployee(emp, "2023-01-01");
    const rehired = rehireEmployee(terminated, "2026-06-01");

    expect(rehired.status).toBe("active");
    expect(rehired.hireDate).toBe("2026-06-01");
    expect(rehired.terminatedAt).toBeNull();
    expect(rehired.priorServiceYears).toBe(3);
    expect(rehired.id).toBe(emp.id);
  });

  it("accumulates priorServiceYears across repeated hire/terminate/rehire spells", async () => {
    const repo = createInMemoryEmployeeRepository();
    const emp = await createEmployee({ ...BASE, priorServiceYears: 2 }, repo);
    const terminated = terminateEmployee(emp, "2023-01-01");
    const rehired = rehireEmployee(terminated, "2026-06-01");
    expect(rehired.priorServiceYears).toBe(2 + 3);
  });

  it("never counts a negative or zero served duration (rehire date at or before the prior hire date)", async () => {
    const repo = createInMemoryEmployeeRepository();
    const emp = await createEmployee({ ...BASE, hireDate: "2026-01-01" }, repo);
    const terminated = terminateEmployee(emp, "2026-01-01");
    const rehired = rehireEmployee(terminated, "2026-06-01");
    expect(rehired.priorServiceYears).toBe(0);
  });
});
