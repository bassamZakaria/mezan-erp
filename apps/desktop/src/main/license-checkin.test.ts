import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import {
  checkinFilePath,
  checkinMessageAr,
  decideCheckin,
  readCheckinState,
  recordSuccessfulCheckin,
  READ_ONLY_AFTER_DAYS,
  REFUSE_TO_START_AFTER_DAYS,
} from "./license-checkin.js";

const dirs: string[] = [];
afterEach(async () => {
  for (const d of dirs.splice(0)) await rm(d, { recursive: true, force: true });
});

async function scratchDb(): Promise<string> {
  const dir = await mkdtemp(path.join(tmpdir(), "mezan-checkin-"));
  dirs.push(dir);
  return path.join(dir, "mezan.db");
}

const INSTALLED = "2026-09-01T00:00:00.000Z";
const at = (iso: string) => new Date(iso);

describe("the online check-in window", () => {
  it("allows writing inside the first week", () => {
    for (const day of ["2026-09-01", "2026-09-05", "2026-09-08"]) {
      const d = decideCheckin({
        lastVerifiedAt: INSTALLED,
        installedAt: INSTALLED,
        now: at(`${day}T00:00:00.000Z`),
      });
      expect(d.verdict).toBe("ok");
    }
  });

  /**
   * The band that makes this shippable to a shop on bad internet: their own
   * books stay readable and printable. A hard cut here would take a business's
   * records away over a week of no connection.
   */
  it("drops to read-only past seven days, and does not go further until thirty", () => {
    const eight = decideCheckin({
      lastVerifiedAt: INSTALLED,
      installedAt: INSTALLED,
      now: at("2026-09-09T01:00:00.000Z"),
    });
    expect(eight.verdict).toBe("read-only");
    expect(eight.daysSince).toBe(READ_ONLY_AFTER_DAYS + 1);

    const thirty = decideCheckin({
      lastVerifiedAt: INSTALLED,
      installedAt: INSTALLED,
      now: at("2026-10-01T00:00:00.000Z"),
    });
    expect(thirty.verdict).toBe("read-only");
    expect(thirty.daysSince).toBe(REFUSE_TO_START_AFTER_DAYS);
  });

  it("refuses to start past thirty days", () => {
    const d = decideCheckin({
      lastVerifiedAt: INSTALLED,
      installedAt: INSTALLED,
      now: at("2026-10-02T01:00:00.000Z"),
    });
    expect(d.verdict).toBe("refuse-to-start");
  });

  /**
   * A machine commissioned in a village with no connection must still work for
   * its first week — the clock starts at install, not at "never".
   */
  it("starts the clock at install when the machine has never checked in", () => {
    const fresh = decideCheckin({
      lastVerifiedAt: null,
      installedAt: INSTALLED,
      now: at("2026-09-04T00:00:00.000Z"),
    });
    expect(fresh.verdict).toBe("ok");

    const stale = decideCheckin({
      lastVerifiedAt: null,
      installedAt: INSTALLED,
      now: at("2026-09-20T00:00:00.000Z"),
    });
    expect(stale.verdict).toBe("read-only");
  });

  it("a successful check-in resets the window", async () => {
    const dbPath = await scratchDb();
    await recordSuccessfulCheckin(dbPath, at("2026-09-20T00:00:00.000Z"));

    const state = await readCheckinState(dbPath);
    expect(state.lastVerifiedAt).toBe("2026-09-20T00:00:00.000Z");
    expect(
      decideCheckin({ ...state, installedAt: INSTALLED, now: at("2026-09-22T00:00:00.000Z") }).verdict,
    ).toBe("ok");
  });

  /**
   * Neither "unlimited offline use" nor "brick a working shop" is an acceptable
   * answer to a file somebody edited by hand.
   */
  it("treats an unreadable timestamp as checked-in-now rather than either extreme", async () => {
    const dbPath = await scratchDb();
    await writeFile(checkinFilePath(dbPath), '{"lastVerifiedAt":"not-a-date"}', "utf8");

    const state = await readCheckinState(dbPath);
    const d = decideCheckin({ ...state, installedAt: "also-not-a-date", now: at("2027-01-01T00:00:00.000Z") });
    expect(d.verdict).toBe("ok");
  });

  it("says how many days it has been, in Arabic, and what to do", () => {
    expect(checkinMessageAr("read-only", 9)).toContain("9");
    expect(checkinMessageAr("read-only", 9)).toContain("تصديرها");
    expect(checkinMessageAr("refuse-to-start", 40)).toContain("40");
  });
});
