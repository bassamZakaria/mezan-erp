import { ipcMain } from "electron";
import {
  MEZAN_BACKUP_EXPORT_PORTABLE_CHANNEL,
  MEZAN_BACKUP_REVERT_CHANNEL,
  MEZAN_LICENCE_CHECKIN_CHANNEL,
  MEZAN_LICENCE_IMPORT_CHANNEL,
  MEZAN_SUPPORT_DELETE_CHANNEL,
  MEZAN_SUPPORT_DIAGNOSTIC_CHANNEL,
  MEZAN_SUPPORT_REVEAL_CHANNEL,
  MEZAN_SUPPORT_SAVE_LOGS_CHANNEL,
  MEZAN_UPDATE_INVOKE_CHANNEL,
  type BackupFailure,
  type LicenceCheckinResult,
  type LicenceImportResult,
  type SupportActionResult,
  type UpdateStatus,
} from "../shared/ipc-contract.js";

/**
 * WHAT A CLIENT MACHINE CANNOT DO, SAID IN ARABIC INSTEAD OF NOT SAID AT ALL.
 *
 * The client startup registered four channels and the preload bridge exposes a
 * dozen. An `ipcMain.handle` that was never registered does not degrade to "no
 * data" — it REJECTS — so «تحقّق من الترخيص» and «ابحث عن تحديث» on a till
 * rejected with `Error invoking remote method 'mezan:licence:checkin': No
 * handler registered`, and neither caller had a `catch`. The operator's entire
 * experience of pressing those buttons was nothing happening, twice, which is
 * the seventh-most-expected support ticket in the audit.
 *
 * Each refusal states the reason and where the action DOES live, because in
 * every case the answer is "on the host, and only there":
 *
 *   - the licence belongs to the host and is enforced by it on every request; a
 *     client that checked in separately would be a second source of truth for a
 *     fact with one;
 *   - a client that updated itself would then be talking to a host on a
 *     different build, which is the failure the version check exists to catch —
 *     the host is updated first, deliberately;
 *   - the support diagnostic and the plaintext-risk files describe a database
 *     this machine does not have.
 *
 * `removeHandler` before `handle` because `ipcMain.handle` throws on a channel
 * that already has one, and the client startup registers several of these
 * elsewhere as the product grows; clobbering one Arabic refusal with another is
 * harmless, crashing the launch is not.
 */
function refuse<T>(channel: string, answer: () => T): void {
  ipcMain.removeHandler(channel);
  ipcMain.handle(channel, () => answer());
}

export function registerClientMaintenanceRefusalsOverIpc(hostUrl: string): void {
  const licence: LicenceCheckinResult = {
    reachedServer: false,
    revoked: false,
    daysSince: 0,
    messageAr:
      `الترخيص يُدار من الجهاز الرئيسي (${hostUrl}). نفّذ التحقّق من هناك — هذا الجهاز محطة متصلة ولا يحمل ترخيصاً خاصاً به.`,
    messageEn: `The licence is managed from the main machine (${hostUrl}). Run the check from there — this machine is a connected till and holds no licence of its own.`,
  };
  refuse(MEZAN_LICENCE_CHECKIN_CHANNEL, (): LicenceCheckinResult => licence);

  refuse(
    MEZAN_LICENCE_IMPORT_CHANNEL,
    (): LicenceImportResult => ({
      ok: false,
      code: "FAILED",
      message: `ملف الترخيص يُثبَّت على الجهاز الرئيسي (${hostUrl})، وليس على المحطات المتصلة.`,
      messageEn: `The licence file is installed on the main machine (${hostUrl}), not on connected tills.`,
    }),
  );

  // `unavailable`, NOT `error`. A till genuinely cannot update itself — it must
  // stay on the host's version — and reporting that as a failure puts a red
  // banner and «تعذّر إكمال التحديث» in front of a shop where nothing went
  // wrong. It is a fact about the machine, said calmly.
  refuse(
    MEZAN_UPDATE_INVOKE_CHANNEL,
    (): UpdateStatus => ({
      phase: "unavailable",
      reason: "CLIENT_MACHINE",
    }),
  );

  // The two backup channels `registerClientBackupRefusalsOverIpc` does not
  // cover. They were added after it and left unregistered on a client, which is
  // the same "press, nothing" the check-in button had.
  const backup: BackupFailure = {
    ok: false,
    code: "UNAVAILABLE",
    message: `النسخ الاحتياطي يُدار من الجهاز الرئيسي (${hostUrl}). هذا الجهاز محطة متصلة ولا يحتفظ بقاعدة بيانات خاصة به.`,
    messageEn: `Backups are managed from the main machine (${hostUrl}). This machine is a connected till and keeps no database of its own.`,
  };
  refuse(MEZAN_BACKUP_REVERT_CHANNEL, (): BackupFailure => backup);
  refuse(MEZAN_BACKUP_EXPORT_PORTABLE_CHANNEL, (): BackupFailure => backup);

  const support: SupportActionResult = {
    ok: false,
    code: "FAILED",
    message: `هذا الجهاز محطة متصلة ولا يحتفظ بقاعدة بيانات. نفّذ هذا من الجهاز الرئيسي (${hostUrl}).`,
    messageEn: `This machine is a connected till and keeps no database. Do this from the main machine (${hostUrl}).`,
  };
  for (const channel of [
    MEZAN_SUPPORT_DIAGNOSTIC_CHANNEL,
    MEZAN_SUPPORT_REVEAL_CHANNEL,
    MEZAN_SUPPORT_SAVE_LOGS_CHANNEL,
    MEZAN_SUPPORT_DELETE_CHANNEL,
  ]) {
    refuse(channel, (): SupportActionResult => support);
  }
}
