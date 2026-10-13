import { afterEach, describe, expect, it, vi } from "vitest";
import { drainForeignWrites, drainUntransactedAudits, reportForeignWrite, reportUntransactedAudit } from "./untransacted-audits.js";

afterEach(() => {
  vi.restoreAllMocks();
  drainUntransactedAudits();
  drainForeignWrites();
});

describe("reports of a write that escaped its transaction", () => {
  it("logs a change-log event appended outside any transaction, by name", () => {
    const logged = vi.spyOn(console, "error").mockImplementation(() => undefined);

    reportUntransactedAudit("contracting/PROGRESS_CERTIFICATE/APPROVE");

    expect(logged).toHaveBeenCalledTimes(1);
    expect(String(logged.mock.calls[0]?.[0])).toContain("contracting/PROGRESS_CERTIFICATE/APPROVE");
    expect(String(logged.mock.calls[0]?.[0])).toContain("outside any transaction");
    expect(drainUntransactedAudits()).toEqual(["contracting/PROGRESS_CERTIFICATE/APPROVE"]);
  });

  it("keeps the most recent two hundred of each kind, however many arrive between drains", () => {
    vi.spyOn(console, "error").mockImplementation(() => undefined);

    for (let i = 0; i < 1000; i += 1) {
      reportUntransactedAudit(`admin/USER/EVENT-${i}`);
      reportForeignWrite(`INSERT INTO t VALUES (${i})`);
    }

    const audits = drainUntransactedAudits();
    const writes = drainForeignWrites();
    expect(audits).toHaveLength(200);
    expect(audits[0]).toBe("admin/USER/EVENT-800");
    expect(writes).toHaveLength(200);
    expect(writes[199]).toBe("INSERT INTO t VALUES (999)");
  });
});
