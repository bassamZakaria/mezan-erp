import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { getPublicKeyAsync, signAsync } from "@noble/ed25519";
import { bytesToHex, signCheckinResponse } from "@mezan/domain";
import {
  applyCheckinAttempt,
  attemptCheckin,
  checkinFailureMessageAr,
  checkinMessageAr,
  createLicenseGuardStore,
  decideCheckin,
  guardFilePath,
  EMPTY_GUARD_RECORD,
  BLOCKING_NOTICE_AFTER_DAYS,
  READ_ONLY_AFTER_DAYS,
  type LicenseGuardRecord,
} from "./license-checkin.js";

const dirs: string[] = [];
afterEach(async () => {
  for (const d of dirs.splice(0)) await rm(d, { recursive: true, force: true });
});

async function scratchDir(): Promise<string> {
  const dir = await mkdtemp(path.join(tmpdir(), "mezan-checkin-"));
  dirs.push(dir);
  return dir;
}

const INSTALLED = "2026-09-01T00:00:00.000Z";
const at = (iso: string) => new Date(iso);
const HIGH_WATER = Date.parse("2027-01-01T00:00:00.000Z");

function record(over: Partial<LicenseGuardRecord> = {}): LicenseGuardRecord {
  return { ...EMPTY_GUARD_RECORD, installedAt: INSTALLED, highWater: HIGH_WATER, ...over };
}

const MAC_KEY = "0123456789abcdef0123456789abcdef";

describe("the online check-in window", () => {
  it("allows writing inside the first week", () => {
    for (const day of ["2026-09-01", "2026-09-05", "2026-09-08"]) {
      const d = decideCheckin({
        record: record({ lastVerifiedAt: INSTALLED }),
        integrity: "ok",
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
  it("drops to read-only past seven days, and does not escalate until thirty", () => {
    const eight = decideCheckin({
      record: record({ lastVerifiedAt: INSTALLED }),
      integrity: "ok",
      now: at("2026-09-09T01:00:00.000Z"),
    });
    expect(eight.verdict).toBe("read-only");
    expect(eight.daysSince).toBe(READ_ONLY_AFTER_DAYS + 1);
    expect(eight.blocking).toBe(false);

    const thirty = decideCheckin({
      record: record({ lastVerifiedAt: INSTALLED }),
      integrity: "ok",
      now: at("2026-10-01T00:00:00.000Z"),
    });
    expect(thirty.verdict).toBe("read-only");
    expect(thirty.daysSince).toBe(BLOCKING_NOTICE_AFTER_DAYS);
  });

  /**
   * guards L-3: past thirty days the app used to `app.exit(1)` before a window
   * existed. It now stays READ_ONLY and merely asks the shell for a blocking
   * notice — the data is never withheld.
   */
  it("blocks with a notice past thirty days, and never refuses to run", () => {
    const d = decideCheckin({
      record: record({ lastVerifiedAt: INSTALLED }),
      integrity: "ok",
      now: at("2026-10-02T01:00:00.000Z"),
    });
    expect(d.verdict).toBe("blocked");
    expect(d.blocking).toBe(true);
  });

  /**
   * guards L-3: the clock starts at the licence's signed `notBefore`, which the
   * install stamps into the guard record — it used to start at `expiresAt`, so
   * a valid licence produced a NEGATIVE day count and the policy never fired.
   */
  it("starts the clock at install when the machine has never checked in", () => {
    const fresh = decideCheckin({
      record: record({ lastVerifiedAt: null }),
      integrity: "ok",
      now: at("2026-09-04T00:00:00.000Z"),
    });
    expect(fresh.verdict).toBe("ok");

    const stale = decideCheckin({
      record: record({ lastVerifiedAt: null }),
      integrity: "ok",
      now: at("2026-09-20T00:00:00.000Z"),
    });
    expect(stale.verdict).toBe("read-only");
  });

  it("a successful check-in resets the window", async () => {
    const store = createLicenseGuardStore({ dir: await scratchDir(), macKey: MAC_KEY });
    store.write(record({ lastVerifiedAt: "2026-09-20T00:00:00.000Z" }));

    const read = store.read();
    expect(read.integrity).toBe("ok");
    expect(
      decideCheckin({ record: read.record, integrity: read.integrity, now: at("2026-09-22T00:00:00.000Z") })
        .verdict,
    ).toBe("ok");
  });

  /**
   * Neither "unlimited offline use" nor "brick a working shop" is an acceptable
   * answer to a date nobody can parse.
   */
  it("treats an unreadable timestamp as checked-in-now rather than either extreme", () => {
    const d = decideCheckin({
      record: record({ lastVerifiedAt: "not-a-date", installedAt: "also-not-a-date" }),
      integrity: "ok",
      now: at("2027-01-01T00:00:00.000Z"),
    });
    expect(d.verdict).toBe("ok");
  });

  it("says how many days it has been, in Arabic, and what to do", () => {
    expect(checkinMessageAr("read-only", 9)).toContain("9");
    expect(checkinMessageAr("read-only", 9)).toContain("تصديرها");
    expect(checkinMessageAr("blocked", 40)).toContain("40");
    expect(checkinMessageAr("revoked", 0)).toContain("إلغاء");
  });
});

/** guards L-10 */
describe("the guard record is tamper-evident, and tampering is not permissive", () => {
  it("round-trips a MAC'd record", async () => {
    const store = createLicenseGuardStore({ dir: await scratchDir(), macKey: MAC_KEY });
    store.write(record({ lastVerifiedAt: INSTALLED }));
    const read = store.read();
    expect(read.integrity).toBe("ok");
    expect(read.record.lastVerifiedAt).toBe(INSTALLED);
  });

  it("refuses a record whose fields were edited under a valid-looking MAC", async () => {
    const dir = await scratchDir();
    const store = createLicenseGuardStore({ dir, macKey: MAC_KEY });
    store.write(record({ lastVerifiedAt: INSTALLED }));

    const file = guardFilePath(dir);
    const body = JSON.parse(await readFile(file, "utf8")) as { record: LicenseGuardRecord; mac: string };
    body.record = { ...body.record, lastVerifiedAt: "2099-01-01T00:00:00.000Z" };
    await writeFile(file, JSON.stringify(body), "utf8");

    const read = store.read();
    expect(read.integrity).toBe("tampered");
    expect(decideCheckin({ record: read.record, integrity: read.integrity, now: at("2026-09-02T00:00:00.000Z") }).verdict).toBe(
      "tampered",
    );
  });

  it("refuses a record with the MAC stripped off", async () => {
    const dir = await scratchDir();
    const store = createLicenseGuardStore({ dir, macKey: MAC_KEY });
    store.write(record());
    await writeFile(guardFilePath(dir), JSON.stringify({ record: record() }), "utf8");
    expect(store.read().integrity).toBe("tampered");
  });

  /**
   * Deleting the file is the obvious attack, and it buys nothing: the install
   * re-stamps from the licence's SIGNED notBefore, which the attacker cannot
   * move — see `installStamp` in main/index.ts.
   */
  it("reports a deleted record as missing rather than as history", async () => {
    const store = createLicenseGuardStore({ dir: await scratchDir(), macKey: MAC_KEY });
    expect(store.read().integrity).toBe("missing");
    expect(store.read().record.lastVerifiedAt).toBeNull();
  });

  /**
   * guards L-10: the cross-check the old comment claimed and no code performed.
   */
  it("refuses a lastVerifiedAt later than the greatest clock value ever seen", () => {
    const d = decideCheckin({
      record: record({ lastVerifiedAt: "2028-01-01T00:00:00.000Z", highWater: HIGH_WATER }),
      integrity: "ok",
      now: at("2027-06-01T00:00:00.000Z"),
    });
    expect(d.verdict).toBe("tampered");
  });

  it("refuses a MAC'd record on an install with no key to check it with", async () => {
    const dir = await scratchDir();
    createLicenseGuardStore({ dir, macKey: MAC_KEY }).write(record());
    expect(createLicenseGuardStore({ dir, macKey: null }).read().integrity).toBe("tampered");
  });

  it("latches a signed revocation into the record", () => {
    const d = decideCheckin({
      record: record({ revoked: true, lastVerifiedAt: INSTALLED }),
      integrity: "ok",
      now: at("2026-09-02T00:00:00.000Z"),
    });
    expect(d.verdict).toBe("revoked");
    expect(d.blocking).toBe(true);
  });
});

/** guards L-4 */
describe("the check-in answer must be signed by the vendor", () => {
  const LICENSE_ID = "lic-1";
  const FINGERPRINT = "fp-abc";

  async function vendorKeys() {
    const secret = new Uint8Array(32).fill(9);
    return { secret, publicKey: bytesToHex(await getPublicKeyAsync(secret)) };
  }

  function respondWith(body: unknown): typeof fetch {
    return (async () =>
      new Response(JSON.stringify(body), {
        status: 200,
        headers: { "content-type": "application/json" },
      })) as unknown as typeof fetch;
  }

  it("accepts a correctly signed answer and takes the SERVER's clock", async () => {
    const { secret, publicKey } = await vendorKeys();
    const serverTime = "2026-09-10T00:00:00.000Z";
    const signature = await signCheckinResponse(
      { licenseId: LICENSE_ID, fingerprint: FINGERPRINT, revoked: false, serverTime },
      secret,
    );

    const attempt = await attemptCheckin({
      endpoint: "https://licence.example/checkin",
      licenseId: LICENSE_ID,
      fingerprint: FINGERPRINT,
      publicKey,
      lastVerifiedAt: null,
      fetchImpl: respondWith({ revoked: false, serverTime, signature }),
    });
    expect(attempt.reachedServer).toBe(true);
    expect(attempt.serverTime).toBe(serverTime);
  });

  it("rejects an unsigned answer — the old shape — as BAD_ANSWER, not as a pass", async () => {
    const { publicKey } = await vendorKeys();
    const attempt = await attemptCheckin({
      endpoint: "https://licence.example/checkin",
      licenseId: LICENSE_ID,
      fingerprint: FINGERPRINT,
      publicKey,
      lastVerifiedAt: null,
      fetchImpl: respondWith({ revoked: true }),
    });
    expect(attempt.reachedServer).toBe(false);
    expect(attempt.revoked).toBe(false);
    expect(attempt.failure).toBe("BAD_ANSWER");
  });

  it("rejects an answer signed for a DIFFERENT licence — a captured reply", async () => {
    const { secret, publicKey } = await vendorKeys();
    const serverTime = "2026-09-10T00:00:00.000Z";
    const signature = await signCheckinResponse(
      { licenseId: "someone-elses", fingerprint: FINGERPRINT, revoked: false, serverTime },
      secret,
    );
    const attempt = await attemptCheckin({
      endpoint: "https://licence.example/checkin",
      licenseId: LICENSE_ID,
      fingerprint: FINGERPRINT,
      publicKey,
      lastVerifiedAt: null,
      fetchImpl: respondWith({ revoked: false, serverTime, signature }),
    });
    expect(attempt.failure).toBe("BAD_ANSWER");
  });

  it("rejects a replayed answer whose serverTime did not advance", async () => {
    const { secret, publicKey } = await vendorKeys();
    const serverTime = "2026-09-10T00:00:00.000Z";
    const signature = await signCheckinResponse(
      { licenseId: LICENSE_ID, fingerprint: FINGERPRINT, revoked: false, serverTime },
      secret,
    );
    const attempt = await attemptCheckin({
      endpoint: "https://licence.example/checkin",
      licenseId: LICENSE_ID,
      fingerprint: FINGERPRINT,
      publicKey,
      lastVerifiedAt: serverTime,
      fetchImpl: respondWith({ revoked: false, serverTime, signature }),
    });
    expect(attempt.failure).toBe("BAD_ANSWER");
  });

  it("carries a signed revocation into the guard record", async () => {
    const { secret, publicKey } = await vendorKeys();
    const serverTime = "2026-09-10T00:00:00.000Z";
    const signature = await signCheckinResponse(
      { licenseId: LICENSE_ID, fingerprint: FINGERPRINT, revoked: true, serverTime },
      secret,
    );
    const attempt = await attemptCheckin({
      endpoint: "https://licence.example/checkin",
      licenseId: LICENSE_ID,
      fingerprint: FINGERPRINT,
      publicKey,
      lastVerifiedAt: null,
      fetchImpl: respondWith({ revoked: true, serverTime, signature }),
    });
    expect(attempt.revoked).toBe(true);

    const store = createLicenseGuardStore({ dir: await scratchDir(), macKey: MAC_KEY });
    store.write(record());
    applyCheckinAttempt(store, attempt, at(serverTime));
    const read = store.read();
    expect(read.record.revoked).toBe(true);
    expect(read.record.lastVerifiedAt).toBe(serverTime);
    expect(
      decideCheckin({ record: read.record, integrity: read.integrity, now: at(serverTime) }).verdict,
    ).toBe("revoked");
  });

  it("treats a missing endpoint or vendor key as a failure, never as a pass", async () => {
    const attempt = await attemptCheckin({
      endpoint: undefined,
      licenseId: LICENSE_ID,
      fingerprint: FINGERPRINT,
      publicKey: null,
      lastVerifiedAt: null,
    });
    expect(attempt.reachedServer).toBe(false);
    expect(attempt.failure).toBe("NO_ENDPOINT");
  });

  it("reports a network fault as UNREACHABLE — not as a revocation", async () => {
    const { publicKey } = await vendorKeys();
    const attempt = await attemptCheckin({
      endpoint: "https://licence.example/checkin",
      licenseId: LICENSE_ID,
      fingerprint: FINGERPRINT,
      publicKey,
      lastVerifiedAt: null,
      fetchImpl: (async () => {
        throw new Error("ECONNREFUSED");
      }) as unknown as typeof fetch,
    });
    expect(attempt.failure).toBe("UNREACHABLE");
    expect(attempt.revoked).toBe(false);
  });
});

/** guards L-11 */
describe("Arabic failure copy", () => {
  it("gives each cause its own sentence, and never interpolates an Error message", () => {
    const messages = (["NO_ENDPOINT", "UNREACHABLE", "BAD_ANSWER"] as const).map(
      checkinFailureMessageAr,
    );
    expect(new Set(messages).size).toBe(3);
    for (const message of messages) {
      expect(message).toMatch(/[؀-ۿ]/);
      expect(message).not.toMatch(/[A-Za-z]{4,}/);
    }
  });
});

/** Kept so the signing helper this file leans on is exercised end to end. */
describe("noble signing is what the domain verifies", () => {
  it("signs with the same primitive the domain verifies with", async () => {
    const secret = new Uint8Array(32).fill(3);
    const signature = await signAsync(new TextEncoder().encode("x"), secret);
    expect(signature.length).toBe(64);
  });
});
