import { randomInt } from "node:crypto";
import { chmod, rm, writeFile } from "node:fs/promises";
import path from "node:path";
import { SEED_ADMIN_EMAIL, SEED_ADMIN_USER_ID } from "@mezan/backend";
import { createScryptHasher, createSqliteSettingsStore, createSqliteUnitOfWork } from "@mezan/persistence";

/**
 * The one way back into an install nobody can sign into.
 *
 * WHAT THIS FIXES. A packaged build seeds its fallback admin with a RANDOM PIN
 * (seed.ts — the alternative was the published `123456` on every Mezan install
 * in the country), and that PIN was previously printed nowhere. There is no
 * password-reset route in this product, no admin unlock, and no second account
 * on a fresh install — so a forgotten PIN did not degrade the install, it ended
 * it: the remaining moves were hand-editing a scrypt hash into the SQLite file
 * or losing the books. The same wall stood in front of the disaster case the
 * backups exist for — a backup restored onto replacement hardware is only
 * usable by someone who still knows a PIN from the machine that died.
 *
 * Both doors below are authorised by FILESYSTEM ACCESS to the database
 * directory, and that is deliberate. Somebody who can read that directory
 * already holds the whole customer list, every purchase price and every
 * salary — the SQLite file is not encrypted. Refusing them a way back in
 * protects nothing they could not already take, and costs the entire install.
 * The threat this does NOT open is a remote one: nothing here is reachable over
 * the LAN socket, over IPC, or from the renderer.
 *
 * Deliberately free of any `electron` import (like main/lan-host.ts), so the
 * paths come in as arguments and the module is exercisable headlessly.
 */

const RECOVERY_FILE_NAME = "recovery-pin.txt";

/** Owner read/write only. The file holds a live credential until the wizard runs. */
const OWNER_ONLY = 0o600;

/** Beside the database, not in it — the point is to be readable when the app is not. */
export function recoveryFilePath(dbPath: string): string {
  return path.join(path.dirname(dbPath), RECOVERY_FILE_NAME);
}

export type RecoveryReason = "first-run" | "reset";

function recoveryFileBody(pin: string, reason: RecoveryReason): string {
  const heading =
    reason === "first-run"
      ? ["مزان — رمز الدخول الأول لحساب المدير", "Mezan — first-run administrator PIN"]
      : ["مزان — رمز دخول جديد لحساب المدير (تمت إعادة التعيين)", "Mezan — administrator PIN reset"];

  return [
    "============================================================",
    heading[0],
    heading[1],
    "============================================================",
    "",
    `البريد الإلكتروني / Email:  ${SEED_ADMIN_EMAIL}`,
    `رمز الدخول / PIN:           ${pin}`,
    "",
    "------------------------------------------------------------",
    "بالعربية",
    "------------------------------------------------------------",
    "هذا الملف يحتوي على رمز دخول حساب المدير لهذه النسخة من مزان.",
    "استخدمه لتسجيل الدخول أول مرة، ثم أكمل معالج الإعداد وأنشئ",
    "حسابك الشخصي.",
    "",
    "بعد إتمام الإعداد يحذف البرنامج هذا الملف تلقائياً عند التشغيل",
    "التالي. إن أردت حذفه بنفسك فافعل — احتفظ بالرمز في مكان آمن أولاً.",
    "",
    "من يقرأ هذا الملف يستطيع الدخول إلى دفاتر منشأتك. لا تتركه على",
    "جهاز مشترك ولا ترسله في رسالة.",
    "",
    "------------------------------------------------------------",
    "In English",
    "------------------------------------------------------------",
    "This file holds the administrator PIN for this Mezan installation.",
    "Sign in with it once, finish the first-run wizard, and create your",
    "own account.",
    "",
    "Once the tenant is set up, Mezan deletes this file automatically on",
    "the next launch. Delete it yourself sooner if you prefer — write the",
    "PIN down somewhere safe first.",
    "",
    "Anyone who reads this file can sign in to your company's books. Do",
    "not leave it on a shared machine and do not send it in a message.",
    "============================================================",
    "",
  ].join("\n");
}

/**
 * Writes the PIN where a human can find it, with owner-only permissions.
 *
 * `chmod` runs as a separate step rather than relying on `writeFile`'s `mode`,
 * because `mode` is only applied when the file is CREATED — a second run over
 * an existing world-readable file would silently keep the old permissions.
 * (On Windows the call is a no-op; NTFS inherits the directory's ACL, and the
 * per-user app-data directory is already owner-scoped there.)
 */
export async function writeRecoveryPin(
  dbPath: string,
  pin: string,
  reason: RecoveryReason,
): Promise<string> {
  const target = recoveryFilePath(dbPath);
  await writeFile(target, recoveryFileBody(pin, reason), { encoding: "utf8", mode: OWNER_ONLY });
  await chmod(target, OWNER_ONLY).catch(() => undefined);
  return target;
}

/**
 * Removes the recovery file once the tenant has been claimed.
 *
 * `settings.tenantClaimedAt` is the fact `POST /bootstrap/admin` writes the
 * first time it succeeds (see settings.ts) — it is not derived from "does a
 * non-seed account exist", which is editable master data and read as
 * "unclaimed" again the moment a seasonal shop deactivated its staff accounts.
 * So this deletes the file exactly when the owner has a real account of their
 * own, and never on an install still sitting on the wizard.
 *
 * Returns true when a file was actually removed.
 */
export async function clearRecoveryPinIfClaimed(dbPath: string): Promise<boolean> {
  const settings = createSqliteSettingsStore(dbPath);
  try {
    const current = await settings.get();
    if (!current?.tenantClaimedAt) return false;
  } finally {
    settings.close();
  }

  const target = recoveryFilePath(dbPath);
  await rm(target, { force: true });
  return true;
}

export interface SeedAdminPinReset {
  readonly pin: string;
  /** True when the account had been deactivated and this brought it back. */
  readonly reactivated: boolean;
  readonly recoveryFile: string;
}

/**
 * `--reset-admin`: mints a fresh PIN for the seeded admin account.
 *
 * Writes the PIN hash directly rather than going through `saveUser`, because
 * `saveUser` takes a plaintext PASSWORD too and would therefore reset a
 * credential the owner may still know. Nothing else about the account changes,
 * with one exception: a deactivated seed admin is reactivated. That account
 * being inactive is the other half of the same brick — a company admin may
 * deactivate another company admin, so an install can reach "no account anybody
 * can sign into" without anyone meaning to — and a reset that leaves the door
 * locked from the inside is not a reset. It is reported, not silent.
 *
 * Returns null when there is no seeded admin to reset (an empty or
 * not-yet-created database), so the caller can say so rather than claim success.
 */
export async function resetSeedAdminPin(dbPath: string): Promise<SeedAdminPinReset | null> {
  const uow = createSqliteUnitOfWork(dbPath);
  let pin: string;
  let reactivated: boolean;
  try {
    const user = await uow.users.findById(SEED_ADMIN_USER_ID);
    if (!user) return null;

    // Same generator the seed uses: `randomInt` refuses a range wider than
    // 2**48-1, and six digits is what the login screen's PIN pad accepts.
    pin = String(randomInt(0, 1_000_000)).padStart(6, "0");
    reactivated = user.status !== "active";
    await uow.users.save({
      ...user,
      pinHash: await createScryptHasher().hash(pin),
      status: "active",
    });
  } finally {
    uow.close();
  }

  return { pin, reactivated, recoveryFile: await writeRecoveryPin(dbPath, pin, "reset") };
}

/** True when the process was started with the `--reset-admin` recovery flag. */
export function wantsAdminReset(argv: readonly string[] = process.argv): boolean {
  return argv.includes("--reset-admin");
}
