import { afterEach, describe, expect, it } from "vitest";
import { PowerSaveMode, startTillWakeLock, type TillWakeLock } from "./till-wake-lock.js";

function fakeBlocker() {
  const started: string[] = [];
  const live = new Set<number>();
  let next = 1;
  return {
    started,
    live,
    start: (type: `${PowerSaveMode}`) => {
      started.push(type);
      live.add(next);
      return next++;
    },
    stop: (id: number) => {
      live.delete(id);
    },
  };
}

const locks: TillWakeLock[] = [];
afterEach(() => {
  for (const lock of locks.splice(0)) lock.stop();
});

describe("startTillWakeLock", () => {
  it("holds the host awake while a till is seated and releases it when the last one leaves", async () => {
    const blocker = fakeBlocker();
    let devices: unknown[] = [];
    const lock = startTillWakeLock({ blocker, connectedDevices: async () => devices, intervalMs: 60_000 });
    locks.push(lock);
    await lock.refresh();
    expect(lock.isHolding()).toBe(false);

    devices = [{ sessionId: "till-1" }];
    await lock.refresh();
    await lock.refresh();
    expect(blocker.started).toEqual([PowerSaveMode.PreventAppSuspension]);
    expect(blocker.live.size).toBe(1);

    devices = [];
    await lock.refresh();
    expect(lock.isHolding()).toBe(false);
    expect(blocker.live.size).toBe(0);
  });

  it("releases on stop and keeps its state when the backend cannot answer", async () => {
    const blocker = fakeBlocker();
    let fail = false;
    const lock = startTillWakeLock({
      blocker,
      connectedDevices: async () => {
        if (fail) throw new Error("worker gone");
        return [{}];
      },
      intervalMs: 60_000,
    });
    await lock.refresh();
    fail = true;
    await lock.refresh();
    expect(lock.isHolding()).toBe(true);
    lock.stop();
    expect(blocker.live.size).toBe(0);
  });
});
