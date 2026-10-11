import { describe, expect, it } from "vitest";
import { COMPLETED_RETAKE_TIMEOUT_MS } from "@mezan/persistence";
import { OUTSIDE_WORK_DEADLINES_MS, OutsideWork, OutsideWorkDeadlineError, withinDeadline } from "./outside-work.js";

describe("work done with the tenant's connection handed back", () => {
  it("has a deadline for every kind, each shorter than the wait given to completed work to record its answer", () => {
    for (const work of Object.values(OutsideWork)) {
      expect(OUTSIDE_WORK_DEADLINES_MS[work], work).toBeGreaterThan(0);
      expect(OUTSIDE_WORK_DEADLINES_MS[work], work).toBeLessThan(COMPLETED_RETAKE_TIMEOUT_MS);
    }
  });

  it("answers with what the work answered when it is inside its deadline, and with its failure when it fails", async () => {
    const quick = { ...OUTSIDE_WORK_DEADLINES_MS, [OutsideWork.Mail]: 200 };
    expect(await withinDeadline(OutsideWork.Mail, async () => "250 ok", quick)).toBe("250 ok");
    await expect(withinDeadline(OutsideWork.Mail, async () => Promise.reject(new Error("refused")), quick)).rejects.toThrow("refused");
  });

  it("stops waiting at the deadline for work that never answers", async () => {
    const quick = { ...OUTSIDE_WORK_DEADLINES_MS, [OutsideWork.EtaHttp]: 20 };
    const never = () => new Promise<string>(() => undefined);
    await expect(withinDeadline(OutsideWork.EtaHttp, never, quick)).rejects.toBeInstanceOf(OutsideWorkDeadlineError);
  });
});
