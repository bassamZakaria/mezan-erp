import { describe, expect, it } from "vitest";
import { createSignInGate } from "./sign-in-gate.js";

function held() {
  let finish!: () => void;
  const done = new Promise<void>((resolve) => {
    finish = resolve;
  });
  return { check: () => done, finish };
}

const tick = () => new Promise<void>((resolve) => setImmediate(resolve));

describe("how many PIN checks a tenant runs at once", () => {
  it("runs as many as it was given, queues a few more, and refuses the rest at once", async () => {
    const gate = createSignInGate({ running: 2, waiting: 1, perSource: 10 });
    const started: number[] = [];
    const checks = [held(), held(), held()];
    const admitted = checks.map((work, index) =>
      gate.admit("41.33.10.10", () => {
        started.push(index);
        return work.check();
      }),
    );

    expect(admitted.every((entry) => entry !== null)).toBe(true);
    expect(started).toEqual([0, 1]);
    expect(gate.admit("41.33.10.10", async () => undefined)).toBeNull();

    checks[0]!.finish();
    await tick();
    expect(started).toEqual([0, 1, 2]);
    checks[1]!.finish();
    checks[2]!.finish();
    await Promise.all(admitted);
    expect(gate.admit("41.33.10.10", async () => undefined)).not.toBeNull();
  });

  it("keeps places for another address when one address has taken its share", async () => {
    const gate = createSignInGate({ running: 2, waiting: 6, perSource: 3 });
    const flood = [held(), held(), held()];
    const admitted = flood.map((work) => gate.admit("41.33.10.10", work.check));

    expect(gate.admit("41.33.10.10", async () => undefined)).toBeNull();
    const owner = gate.admit("196.221.5.5", async () => "checked");
    expect(owner).not.toBeNull();

    for (const work of flood) work.finish();
    await Promise.all(admitted);
    expect(await owner).toBe("checked");
  });

  it("gives a place back when the check throws", async () => {
    const gate = createSignInGate({ running: 1, waiting: 0, perSource: 1 });

    await expect(gate.admit(null, () => Promise.reject(new Error("store is down")))).rejects.toThrow("store is down");

    expect(await gate.admit(null, async () => "checked")).toBe("checked");
  });

  it("counts the machine's own console as one address", () => {
    const gate = createSignInGate({ running: 1, waiting: 5, perSource: 2 });
    const console1 = held();
    const console2 = held();

    expect(gate.admit(null, console1.check)).not.toBeNull();
    expect(gate.admit(null, console2.check)).not.toBeNull();
    expect(gate.admit(null, async () => undefined)).toBeNull();
    console1.finish();
    console2.finish();
  });
});
