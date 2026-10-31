import { randomBytes } from "node:crypto";
import { chmod, rm, writeFile } from "node:fs/promises";
import path from "node:path";
import { SEED_ADMIN_EMAIL, SEED_ADMIN_USER_ID } from "@mezan/backend";
import {
  createScryptHasher,
  createSqliteSettingsStore,
  createSqliteUnitOfWork,
  type SqliteConnectionInput,
} from "@mezan/persistence";

/**
 * The one way back into an install nobody can sign into.
 *
 * WHAT THIS FIXES. A packaged build seeds its fallback admin with a RANDOM
 * temporary password (seed.ts — the alternative was the published demo password
 * on every Mezan install in the country), and that password was previously
 * printed nowhere. There is no password-reset route in this product, no admin
 * unlock, and no second account on a fresh install — so a forgotten password
 * did not degrade the install, it ended it: the remaining moves were
 * hand-editing a scrypt hash into the SQLite file or losing the books. The same
 * wall stood in front of the disaster case the backups exist for — a backup
 * restored onto replacement hardware is only usable by someone who still knows
 * a password from the machine that died.
 *
 * Both doors below are authorised by FILESYSTEM ACCESS to the database
 * directory. That was once an argument from futility — the SQLite file was not
 * encrypted, so anybody who could read the directory already held the customer
 * list, every purchase price and every salary. It is not any more
 * (main/encrypted-database.ts), so the bar is now genuinely "can open this
 * machine's database": both entry points below take an ALREADY-OPEN keyed
 * connection from the caller rather than a path, because opening the path
 * themselves would mean opening it unkeyed and failing on every real install.
 * The threat this does NOT open is a remote one: nothing here is reachable over
 * the LAN socket, over IPC, or from the renderer.
 *
 * Deliberately free of any `electron` import (like main/lan-host.ts), so the
 * paths come in as arguments and the module is exercisable headlessly.
 */

const RECOVERY_FILE_NAME = "recovery-password.txt";
/** Written by installs from before the PIN was removed; its PIN became a temporary password on upgrade, so it is still a live credential. */
const LEGACY_RECOVERY_FILE_NAME = "recovery-pin.txt";

/** Owner read/write only. The file holds a live credential until the wizard runs. */
const OWNER_ONLY = 0o600;

/** Beside the database, not in it — the point is to be readable when the app is not. */
export function recoveryFilePath(dbPath: string): string {
  return path.join(path.dirname(dbPath), RECOVERY_FILE_NAME);
}

export enum RecoveryReason {
  FirstRun = "first-run",
  Reset = "reset",
}

function recoveryFileBody(password: string, reason: RecoveryReason): string {
  const heading =
    reason === RecoveryReason.FirstRun
      ? ["مزان — كلمة المرور المؤقتة الأولى لحساب المدير", "Mezan — first-run administrator password"]
      : ["مزان — كلمة مرور مؤقتة جديدة لحساب المدير (تمت إعادة التعيين)", "Mezan — administrator password reset"];

  return [
    "============================================================",
    heading[0],
    heading[1],
    "============================================================",
    "",
    `البريد الإلكتروني / Email:       ${SEED_ADMIN_EMAIL}`,
    `كلمة المرور المؤقتة / Password:  ${password}`,
    "",
    "------------------------------------------------------------",
    "بالعربية",
    "------------------------------------------------------------",
    "هذا الملف يحتوي على كلمة مرور مؤقتة لحساب المدير لهذه النسخة من مزان.",
    "سجّل الدخول بها مرة واحدة، وسيطلب منك البرنامج تعيين كلمة مرور جديدة",
    "فوراً، ثم أكمل معالج الإعداد وأنشئ حسابك الشخصي.",
    "",
    "بعد إتمام الإعداد يحذف البرنامج هذا الملف تلقائياً عند التشغيل",
    "التالي. إن أردت حذفه بنفسك فافعل بعد تعيين كلمة مرورك الجديدة.",
    "",
    "من يقرأ هذا الملف يستطيع الدخول إلى دفاتر منشأتك. لا تتركه على",
    "جهاز مشترك ولا ترسله في رسالة.",
    "",
    "------------------------------------------------------------",
    "In English",
    "------------------------------------------------------------",
    "This file holds a temporary administrator password for this Mezan",
    "installation. Sign in with it once; Mezan then asks you to set a new",
    "password straight away. Finish the first-run wizard and create your",
    "own account.",
    "",
    "Once the tenant is set up, Mezan deletes this file automatically on",
    "the next launch. Delete it yourself sooner if you prefer, once you",
    "have set your new password.",
    "",
    "Anyone who reads this file can sign in to your company's books. Do",
    "not leave it on a shared machine and do not send it in a message.",
    "============================================================",
    "",
  ].join("\n");
}

/**
 * Writes the temporary password where a human can find it, with owner-only permissions.
 *
 * `chmod` runs as a separate step rather than relying on `writeFile`'s `mode`,
 * because `mode` is only applied when the file is CREATED — a second run over
 * an existing world-readable file would silently keep the old permissions.
 * (On Windows the call is a no-op; NTFS inherits the directory's ACL, and the
 * per-user app-data directory is already owner-scoped there.)
 */
export async function writeRecoveryPassword(
  dbPath: string,
  password: string,
  reason: RecoveryReason,
): Promise<string> {
  const target = recoveryFilePath(dbPath);
  await writeFile(target, recoveryFileBody(password, reason), { encoding: "utf8", mode: OWNER_ONLY });
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
export async function clearRecoveryPasswordIfClaimed(
  dbPath: string,
  connection: SqliteConnectionInput = dbPath,
): Promise<boolean> {
  const settings = createSqliteSettingsStore(connection);
  try {
    const current = await settings.get();
    if (!current?.tenantClaimedAt) return false;
  } finally {
    settings.close();
  }

  await rm(recoveryFilePath(dbPath), { force: true });
  await rm(path.join(path.dirname(dbPath), LEGACY_RECOVERY_FILE_NAME), { force: true });
  return true;
}

export interface SeedAdminPasswordReset {
  readonly password: string;
  /** True when the account had been deactivated and this brought it back. */
  readonly reactivated: boolean;
  readonly recoveryFile: string;
}

/**
 * `--reset-admin`: mints a fresh TEMPORARY password for the seeded admin
 * account, so the next sign-in is forced through a password change.
 *
 * Writes the row directly rather than going through `saveUser`, because the
 * reset is authorised by filesystem access, not by a signed-in admin. Nothing
 * else about the account changes, with one exception: a deactivated seed admin
 * is reactivated. That account
 * being inactive is the other half of the same brick — a company admin may
 * deactivate another company admin, so an install can reach "no account anybody
 * can sign into" without anyone meaning to — and a reset that leaves the door
 * locked from the inside is not a reset. It is reported, not silent.
 *
 * Returns null when there is no seeded admin to reset (an empty or
 * not-yet-created database), so the caller can say so rather than claim success.
 */
export async function resetSeedAdminPassword(
  dbPath: string,
  connection: SqliteConnectionInput = dbPath,
): Promise<SeedAdminPasswordReset | null> {
  const uow = createSqliteUnitOfWork(connection);
  let password: string;
  let reactivated: boolean;
  try {
    const user = await uow.users.findById(SEED_ADMIN_USER_ID);
    if (!user) return null;

    password = randomBytes(9).toString("base64url");
    reactivated = user.status !== "active";
    await uow.users.save({
      ...user,
      passwordHash: await createScryptHasher().hash(password),
      mustChangePassword: true,
      status: "active",
    });
  } finally {
    uow.close();
  }

  return { password, reactivated, recoveryFile: await writeRecoveryPassword(dbPath, password, RecoveryReason.Reset) };
}

/** True when the process was started with the `--reset-admin` recovery flag. */
export function wantsAdminReset(argv: readonly string[] = process.argv): boolean {
  return argv.includes("--reset-admin");
}
