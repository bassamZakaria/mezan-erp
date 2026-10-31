import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtempSync, rmSync, statSync } from "node:fs";
import { readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { DEFAULT_SETTINGS } from "@mezan/domain";
import { SEED_ADMIN_EMAIL, SEED_ADMIN_USER_ID } from "@mezan/backend";
import { createScryptHasher, createSqliteSettingsStore, createSqliteUnitOfWork } from "@mezan/persistence";
import {
  clearRecoveryPasswordIfClaimed,
  recoveryFilePath,
  RecoveryReason,
  resetSeedAdminPassword,
  wantsAdminReset,
  writeRecoveryPassword,
} from "./recovery.js";

/**
 * The install this file exists to save: a packaged build seeds its admin with a
 * RANDOM temporary password and there is no reset route, no admin unlock and no
 * second account, so a password nobody wrote down did not degrade the install — it ended
 * it. These are the two doors back in, and both are authorised by filesystem
 * access to the database directory, which already holds every price and every
 * customer in an unencrypted file.
 */

let dir: string;
let dbPath: string;

beforeEach(() => {
  dir = mkdtempSync(path.join(tmpdir(), "mezan-recovery-"));
  dbPath = path.join(dir, "mezan.db");
});

afterEach(() => {
  rmSync(dir, { recursive: true, force: true });
});

async function seedAdmin(status: "active" | "inactive" = "active"): Promise<void> {
  const uow = createSqliteUnitOfWork(dbPath);
  try {
    await uow.users.save({
      id: SEED_ADMIN_USER_ID,
      nameAr: "محمد الشهابي",
      nameEn: "Mohamed El Shehaby",
      email: SEED_ADMIN_EMAIL,
      phone: null,
      passwordHash: await createScryptHasher().hash("the-owner-still-knows-this"),
      mustChangePassword: false,
      roleId: null,
      isCompanyAdmin: true,
      employeeId: null,
      photoUrl: null,
      branchScope: "*",
      warehouseScope: "*",
      status,
      lastLoginAt: null,
      createdAt: new Date().toISOString(),
    });
  } finally {
    uow.close();
  }
}

describe("the first-run recovery file", () => {
  it("writes the temporary password owner-readable only, with both languages and the email to sign in with", async () => {
    const target = await writeRecoveryPassword(dbPath, "Tmp-482913xy", RecoveryReason.FirstRun);
    expect(target).toBe(recoveryFilePath(dbPath));

    const body = await readFile(target, "utf8");
    expect(body).toContain("Tmp-482913xy");
    expect(body).toContain(SEED_ADMIN_EMAIL);
    // Arabic first, and an English half — the owner may not be the person who
    // installs it, and neither may be the person who finds this file later.
    expect(body).toContain("كلمة المرور المؤقتة");
    expect(body).toContain("administrator password");
    expect(path.basename(target)).toBe("recovery-password.txt");

    // 0600. The file is a live company-admin credential until the wizard runs;
    // a world-readable one on a shared shop machine is the credential itself.
    if (process.platform !== "win32") {
      expect(statSync(target).mode & 0o777).toBe(0o600);
    }
  });

  it("re-tightens the permissions when it overwrites a file that was already loose", async () => {
    // `writeFile`'s `mode` only applies when the file is CREATED, so a second
    // write over a world-readable file would silently keep 0644.
    const target = recoveryFilePath(dbPath);
    await writeFile(target, "stale", { encoding: "utf8", mode: 0o644 });

    await writeRecoveryPassword(dbPath, "Tmp-111222xy", RecoveryReason.Reset);
    if (process.platform !== "win32") {
      expect(statSync(target).mode & 0o777).toBe(0o600);
    }
  });
});

describe("clearing the recovery file", () => {
  async function saveSettings(tenantClaimedAt: string | null): Promise<void> {
    const settings = createSqliteSettingsStore(dbPath);
    try {
      await settings.save({ ...DEFAULT_SETTINGS, tenantClaimedAt });
    } finally {
      settings.close();
    }
  }

  it("keeps the file while nobody has claimed the tenant", async () => {
    await saveSettings(null);
    const target = await writeRecoveryPassword(dbPath, "Tmp-482913xy", RecoveryReason.FirstRun);

    expect(await clearRecoveryPasswordIfClaimed(dbPath)).toBe(false);
    expect(await readFile(target, "utf8")).toContain("Tmp-482913xy");
  });

  it("removes it once the tenant is claimed", async () => {
    await saveSettings("2026-08-30T09:00:00.000Z");
    const target = await writeRecoveryPassword(dbPath, "Tmp-482913xy", RecoveryReason.FirstRun);

    const legacy = path.join(dir, "recovery-pin.txt");
    await writeFile(legacy, "old PIN, now a live temporary password", "utf8");

    expect(await clearRecoveryPasswordIfClaimed(dbPath)).toBe(true);
    await expect(readFile(target, "utf8")).rejects.toThrow();
    await expect(readFile(legacy, "utf8")).rejects.toThrow();
  });
});

describe("--reset-admin", () => {
  it("is off unless the flag is actually on the command line", () => {
    expect(wantsAdminReset(["electron", "."])).toBe(false);
    expect(wantsAdminReset(["electron", ".", "--reset-admin"])).toBe(true);
  });

  it("says so rather than claiming success when there is no seeded admin", async () => {
    expect(await resetSeedAdminPassword(dbPath)).toBeNull();
  });

  it("mints a temporary password that actually signs in and must be changed at the next sign-in", async () => {
    await seedAdmin();
    const before = await (async () => {
      const uow = createSqliteUnitOfWork(dbPath);
      try {
        return await uow.users.findById(SEED_ADMIN_USER_ID);
      } finally {
        uow.close();
      }
    })();

    const reset = await resetSeedAdminPassword(dbPath);
    expect(reset).not.toBeNull();
    expect(reset!.password.length).toBeGreaterThanOrEqual(12);

    const uow = createSqliteUnitOfWork(dbPath);
    try {
      const after = await uow.users.findById(SEED_ADMIN_USER_ID);
      const hasher = createScryptHasher();
      expect(await hasher.verify(reset!.password, after!.passwordHash!)).toBe(true);
      expect(await hasher.verify("the-owner-still-knows-this", after!.passwordHash!)).toBe(false);
      expect(after!.mustChangePassword).toBe(true);
      expect(after!.email).toBe(before!.email);
    } finally {
      uow.close();
    }

    expect(await readFile(reset!.recoveryFile, "utf8")).toContain(reset!.password);
  });

  it("reactivates a deactivated seed admin, and reports that it did", async () => {
    // The other half of the same brick: a company admin may deactivate another
    // company admin, so an install can reach "no account anybody can sign into"
    // with nobody meaning to. A reset that leaves the door locked is not one.
    await seedAdmin("inactive");
    const reset = await resetSeedAdminPassword(dbPath);
    expect(reset?.reactivated).toBe(true);

    const uow = createSqliteUnitOfWork(dbPath);
    try {
      expect((await uow.users.findById(SEED_ADMIN_USER_ID))?.status).toBe("active");
    } finally {
      uow.close();
    }
  });
});
