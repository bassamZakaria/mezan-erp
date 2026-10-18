import { ArabicCase, arabicDays } from "@mezan/domain";
import { copyFileSync, existsSync, readFileSync, unlinkSync, writeFileSync } from "node:fs";
import path from "node:path";
import { app, dialog, shell } from "electron";
import { handleGuarded } from "./ipc-guard.js";
import type { SessionLookup } from "./backend-bridge.js";
import {
  MEZAN_APP_VERSION_CHANNEL,
  MEZAN_LICENCE_CHECKIN_CHANNEL,
  MEZAN_LICENCE_IMPORT_CHANNEL,
  MEZAN_LICENCE_STATUS_CHANNEL,
  MEZAN_SUPPORT_DELETE_CHANNEL,
  MEZAN_SUPPORT_DIAGNOSTIC_CHANNEL,
  MEZAN_SUPPORT_REVEAL_CHANNEL,
  MEZAN_SUPPORT_SAVE_LOGS_CHANNEL,
  SUPPORT_LOG_TAIL_LINES,
  type SupportRevealTarget,
  type LicenceCheckinResult,
  type LicenceCode,
  type LicenceImportResult,
  type LicenceStateDTO,
  type LicenceStatusDTO,
  type LicenceStatusFailure,
  type LicenceStatusResult,
  type PlaintextRiskTarget,
  type SupportActionResult,
} from "../shared/ipc-contract.js";
import { keyCardFilePath } from "./encrypted-database.js";
import type { LanHostHandle } from "./lan-host.js";
import type { DesktopLicense } from "./license.js";
import {
  applyCheckinAttempt,
  attemptCheckin,
  checkinFailureMessageAr,
  checkinMessageAr,
  decideCheckin,
  type LicenseGuardStore,
} from "./license-checkin.js";

const UNAUTHORIZED: LicenceStatusFailure = {
  ok: false,
  code: "UNAUTHORIZED",
  message: "سجّل الدخول لعرض حالة الترخيص وعنوان الشبكة المحلية.",
};

const UNAVAILABLE: LicenceStatusFailure = {
  ok: false,
  code: "UNAVAILABLE",
  message: "تعذّرت قراءة حالة الترخيص على هذا الجهاز.",
};

export interface LicenceIpcDeps {
  /**
   * The VERIFIED licence main/index.ts is running under — the same object the
   * write gate reads. Through a getter so an import replaces it in place.
   *
   * This used to be `diagnoseDesktopEntitlements()`, which reads the dev-only
   * `MEZAN_ENTITLEMENTS_JSON` env var: one install then answered `LIC-MISSING`
   * on the licence panel while every save succeeded, and an unlicensed one
   * could be made to read `ENTERPRISE` by exporting a variable.
   */
  readonly licence: () => DesktopLicense;
  /** Re-reads and re-verifies `license.mezan` from disk after an import. */
  readonly reloadLicence: () => Promise<DesktopLicense>;
  /** The raw machine fingerprint this install reports (main/machine-fingerprint.ts). */
  readonly fingerprint: () => Promise<string | null>;
  /** Days since the last successful online check-in, or null when unknown. */
  readonly daysSinceCheckin: () => number | null;
  readonly dbPath: string;
  readonly backupsDir: string;
  /** The unencrypted pre-conversion archive, while it is still on this disk. */
  readonly plaintextArchivePath: () => string | null;
  /** The rotating log file; absent in tests that do not exercise the log actions. */
  readonly logs?: { readonly filePath: string; tail(maxLines: number): readonly string[] };
  /** Seats currently held, from the live seat registry. */
  /**
   * Async because the seat registry moved into the backend process with the
   * database (Q-1). A real registry stays assignable, which is what the tests
   * and the headless demo pass.
   */
  readonly seatsUsed: () => number | Promise<number>;
  /**
   * The live LAN handle, through a getter: `startLanHost` runs after this is
   * registered, and the socket's address is not known until `ready` resolves.
   */
  readonly lanHost: () => LanHostHandle | undefined;
  /** Reads the caller's grant from the live session registry (api/session-auth.ts). */
  readonly sessions: SessionLookup;
  /**
   * Told when an imported licence has been verified, so the write gate can
   * re-read it without a restart. Optional: an install that cannot re-evaluate
   * still reports the honest verdict here and asks for a restart.
   */
  readonly onLicenceReplaced?: (licence: DesktopLicense) => void;
  /**
   * Whether this install already belongs to somebody, asked of the running
   * backend. It exists for ONE case: the first-run wizard's activation step
   * runs before any account has been created, so there is no session to
   * present — and requiring one would mean the licence could never be
   * installed at the moment the product asks for it. An UNCLAIMED install has
   * no books and no accounts to protect; the same line `registerPairingOverIpc`
   * already draws. Omitted (or true) keeps the session requirement absolute.
   */
  readonly tenantIsClaimed?: () => Promise<boolean>;
}

/**
 * The support code, derived from the VERIFIED state and nothing else.
 *
 * `INVALID` splits on the reason because the two failures need different
 * instructions: a bad signature means the file is not ours, a parse failure
 * means the file arrived damaged.
 */
export function licenceCodeFor(state: LicenceStateDTO, reason: string | null): LicenceCode {
  if (reason === "CHECKIN_OVERDUE") return "LIC-CHECKIN";
  if (reason === "REVOKED") return "LIC-REVOKED";
  if (reason === "NO_PUBLIC_KEY") return "LIC-NOKEY";
  switch (state) {
    case "ACTIVE":
      return "LIC-OK";
    case "GRACE":
      return "LIC-GRACE";
    case "READ_ONLY":
      return "LIC-EXPIRED";
    case "FINGERPRINT_MISMATCH":
      return "LIC-MACHINE";
    case "REVOKED":
      return "LIC-REVOKED";
    case "TAMPERED":
      return "LIC-CLOCK";
    case "NOT_YET_VALID":
      return "LIC-NOTYET";
    case "INVALID":
      return reason === "BAD_SIGNATURE" ? "LIC-INVALID" : "LIC-MALFORMED";
    case "UNLICENSED":
      return reason === "NO_PUBLIC_KEY" ? "LIC-NOKEY" : "LIC-MISSING";
  }
}

const MESSAGE_AR: Record<LicenceCode, string> = {
  "LIC-OK": "الترخيص سارٍ.",
  "LIC-GRACE":
    "انتهت صلاحية الترخيص وأنت الآن في فترة السماح. جدّد الترخيص قبل انتهائها حتى لا يتوقف حفظ الحركات الجديدة.",
  "LIC-MISSING":
    "لا يوجد ملف ترخيص على هذا الجهاز. البيانات كلها متاحة للعرض والطباعة والتصدير، ولا يمكن حفظ حركات جديدة حتى تُثبِّت ملف الترخيص.",
  "LIC-MALFORMED": "ملف الترخيص غير مقروء. اطلب من الدعم ملفاً جديداً وثبّته من هذه الشاشة.",
  "LIC-INVALID":
    "توقيع ملف الترخيص غير صحيح، فلا يمكن الوثوق به. اطلب من الدعم ملف الترخيص الأصلي وثبّته من هذه الشاشة.",
  "LIC-EXPIRED":
    "انتهت صلاحية الترخيص وانتهت معه فترة السماح. البيانات كلها متاحة للعرض والطباعة والتصدير، ولا يمكن حفظ حركات جديدة حتى التجديد.",
  "LIC-CHECKIN":
    "لم يُؤكَّد هذا الترخيص عبر الإنترنت منذ مدة. اتصل بالإنترنت ثم اضغط «تحقّق الآن».",
  "LIC-REVOKED": "هذا الترخيص مُلغى من جهة الإصدار. تواصل مع الدعم واذكر الرمز الظاهر أمامك.",
  "LIC-NOKEY":
    "هذه النسخة لا تحمل مفتاح التحقق من التراخيص، فلا يمكنها قبول أي ملف ترخيص. تواصل مع الدعم للحصول على نسخة تثبيت صحيحة.",
  "LIC-MACHINE":
    "ملف الترخيص مرتبط بجهاز آخر. أرسل بصمة هذا الجهاز الظاهرة أمامك إلى الدعم ليصدر ملف ترخيص لهذا الجهاز، ثم ثبّته بزر «استيراد ملف الترخيص».",
  "LIC-CLOCK":
    "تاريخ الجهاز أقدم من آخر تشغيل مسجَّل للبرنامج. اضبط تاريخ ووقت الجهاز بشكل صحيح ثم أعد تشغيل البرنامج.",
  "LIC-NOTYET": "لم يبدأ سريان هذا الترخيص بعد.",
};

/**
 * `state.messageAr` wins where main/license.ts supplied one: it is set exactly
 * where the generic copy for a state would be WRONG — «جدّد الترخيص» for a build
 * that shipped without a vendor key, or for a valid licence that has merely not
 * been online — and those two sentences must not be written twice.
 */
function messageFor(
  code: LicenceCode,
  daysSince: number | null,
  fromLicence: string | undefined,
): string {
  if (fromLicence) return fromLicence;
  if (code === "LIC-CHECKIN" && daysSince !== null) {
    return `لم يُؤكَّد هذا الترخيص عبر الإنترنت منذ ${arabicDays(daysSince, ArabicCase.Oblique)}. اتصل بالإنترنت ثم اضغط «تحقّق الآن».`;
  }
  return MESSAGE_AR[code];
}

/**
 * Where `license.mezan` lives. Mirrors main/license-runtime.ts's resolution,
 * including the `MEZAN_LICENSE_FILE` override, because support tells the owner
 * the path over the phone and the two must never disagree.
 */
function licenceFilePath(): string {
  return process.env["MEZAN_LICENSE_FILE"] ?? path.join(app.getPath("userData"), "license.mezan");
}

/**
 * The fingerprint the verification itself produced, wherever main/license.ts
 * currently exposes it. Read defensively: this file must keep answering while
 * that shape is being widened, and a status channel that throws puts
 * "Error invoking remote method" across the top of an Arabic shell.
 */
function licenceFingerprint(licence: DesktopLicense): string | null {
  const state = licence.state as { fingerprint?: unknown };
  if (typeof state.fingerprint === "string" && state.fingerprint !== "") return state.fingerprint;
  const identity = (licence as { identity?: { fingerprint?: unknown } }).identity;
  if (typeof identity?.fingerprint === "string" && identity.fingerprint !== "") {
    return identity.fingerprint;
  }
  return null;
}

/**
 * `mezan:licence:status` — the one channel that lets a screen say what is wrong
 * with the licence, and where a till should be pointed.
 *
 * A SESSION IS REQUIRED, no permission beyond it. The same line `GET
 * /lan/status` draws: seat counts and the host's own LAN address are facts
 * about the shop rather than public ones, so a signed-in account is the bar —
 * but a licence problem is the owner's to see, and gating it behind an admin
 * grant would hide the message from the person holding the phone to support.
 *
 * Nothing here throws across the bridge; an `ipcMain.handle` rejection reaches
 * the renderer as "Error invoking remote method 'mezan:licence:status'", which
 * is not something to put in front of a shop owner in any language.
 */
/**
 * The CLIENT-machine answer on the same channel.
 *
 * It has to be registered, and the first live two-machine run is why: a client
 * registered no handler at all, so the shell's own licence panel put
 * `Error invoking remote method 'mezan:licence:status': No handler registered`
 * across the top of the window, in English, on the very first screen after
 * login. An unregistered `ipcMain.handle` channel does not degrade to "no data";
 * it rejects, and the rejection is rendered.
 *
 * WHAT IT REPORTS AND WHY IT IS NOT THE HOST'S LICENCE. A client is entitled to
 * nothing on its own — the host's licence is what governs, and the host enforces
 * it per request. Restating the host's plan and seat count here would mean
 * re-fetching a fact this process does not own and cannot verify, and every
 * disagreement between the two readings would be a support call. What the client
 * knows for certain, and what a person standing at the client machine actually
 * needs, is which host it is paired with and which certificate it pinned — so
 * that is what it says. `listening: false` is honest: this machine listens on
 * nothing.
 */
export function registerClientLicenceStatusOverIpc(config: {
  hostUrl: string;
  fingerprintSha256: string;
}): void {
  handleGuarded(MEZAN_LICENCE_STATUS_CHANNEL, (): LicenceStatusResult => {
    return {
      ok: true,
      code: "LIC-OK",
      messageAr: `هذا الجهاز يعمل كمحطة متصلة بالجهاز الرئيسي على ${config.hostUrl}. الترخيص وعدد المقاعد يُداران من الجهاز الرئيسي.`,
      state: "ACTIVE",
      reason: null,
      canWrite: true,
      plan: "CLIENT",
      seats: 0,
      seatsUsed: 0,
      modules: [],
      expiresAt: null,
      fingerprint: null,
      daysSinceCheckin: null,
      licenceFilePath: "",
      appVersion: app.getVersion(),
      role: "client",
      databasePath: null,
      backupsDir: null,
      keyCardPath: null,
      plaintextArchivePath: null,
      lan: {
        listening: false,
        url: config.hostUrl,
        fingerprintSha256: config.fingerprintSha256,
        // lan-ux: a client listens on nothing BY DESIGN. Null, not a fault
        // code — the panel must not offer this machine "free the port" advice
        // for a socket it was never meant to open.
        closedReason: null,
      },
    };
  });
  registerAppVersionOverIpc();
}

/**
 * `mezan:app:version` — `app.getVersion()`, no session required.
 *
 * «ما هي نسختك؟» is a support question no user of this build could answer: the
 * login screen carried the literal `Mezan 2026.8`, System Status read the web
 * package's version and the backup table read each archive's manifest. One
 * source, asked before sign-in because the login screen is where the question
 * gets asked.
 */
export function registerAppVersionOverIpc(): void {
  handleGuarded(MEZAN_APP_VERSION_CHANNEL, (): string => app.getVersion());
}

export function registerLicenceStatusOverIpc(deps: LicenceIpcDeps): void {
  async function describe(licence: DesktopLicense): Promise<LicenceStatusDTO> {
    const state = licence.state.state as LicenceStateDTO;
    const reason = licence.state.reason ?? null;
    const code = licenceCodeFor(state, reason);
    // The licence's own day count wins where it carries one — it came from the
    // same decision the write gate is running under.
    const licenceState = licence.state as { daysSince?: number; messageAr?: string };
    const daysSince = licenceState.daysSince ?? deps.daysSinceCheckin();
    const host = deps.lanHost();
    const keyCard = keyCardFilePath(deps.dbPath);
    return {
      ok: true,
      code,
      messageAr: messageFor(code, daysSince, licenceState.messageAr),
      state,
      reason,
      canWrite: licence.state.canWrite,
      plan: licence.entitlements.plan,
      seats: licence.entitlements.seats,
      seatsUsed: await deps.seatsUsed(),
      modules: [...licence.entitlements.activeModules],
      expiresAt: licence.state.expiresAt ?? licence.entitlements.expiresAt ?? null,
      // The licence's own reading first: that is the SALTED hash `machineBinding`
      // is compared against, so it is the exact string support has to put in a
      // reissued licence. The raw machine id is only a fallback for an install
      // that never got as far as verifying a file.
      fingerprint: licenceFingerprint(licence) ?? (await deps.fingerprint().catch(() => null)),
      daysSinceCheckin: daysSince,
      licenceFilePath: licenceFilePath(),
      appVersion: app.getVersion(),
      role: "host",
      databasePath: deps.dbPath,
      backupsDir: deps.backupsDir,
      keyCardPath: existsSync(keyCard) ? keyCard : null,
      plaintextArchivePath: deps.plaintextArchivePath(),
      lan: {
        // `enabled` is the licence gate; a bound socket is what makes an
        // address real, and `url()` is null until then — see lan-host.ts.
        listening: host?.address() !== null && host?.enabled === true,
        url: host?.url() ?? null,
        // The pinning fact, reported independently of `listening`: it is
        // read from the certificate on disk, so it is knowable a moment
        // before the socket binds, and it is the one value a consultant
        // cannot recover from anywhere else in the product.
        fingerprintSha256: host?.fingerprint() ?? null,
        // lan-ux: WHICH of the four faults closed it. One sentence for
        // unlicensed, port-in-use, unreadable TLS identity and no network
        // interface was one support call per install; each has its own fix.
        closedReason: host?.closedReason() ?? "NOT_LICENSED",
      },
    };
  }

  handleGuarded(
    MEZAN_LICENCE_STATUS_CHANNEL,
    async (_event, sessionToken: unknown): Promise<LicenceStatusResult> => {
      if (typeof sessionToken !== "string" || sessionToken === "") return UNAUTHORIZED;
      if (!(await deps.sessions.find(sessionToken))) return UNAUTHORIZED;
      try {
        return await describe(deps.licence());
      } catch (err) {
        console.error("[licence] could not read the verified licence", err);
        return UNAVAILABLE;
      }
    },
  );

  /**
   * ACTIVATION. A file, chosen in an OS dialog, copied into place, then
   * verified — and what comes back is that verification, whatever it says.
   *
   * The wizard step this replaces set its own status to "done" without calling
   * anything and painted a green «مُفعّل» pill, so the one moment a new owner
   * is told whether they are licensed was the one moment the product never
   * checked. `accepted` is the verified `canWrite`, never the fact that a file
   * was copied.
   */
  handleGuarded(
    MEZAN_LICENCE_IMPORT_CHANNEL,
    async (_event, sessionToken: unknown): Promise<LicenceImportResult> => {
      const signedIn =
        typeof sessionToken === "string" && (await deps.sessions.find(sessionToken)) !== null;
      const unclaimed = signedIn ? false : ((await deps.tenantIsClaimed?.().catch(() => true)) === false);
      if (!signedIn && !unclaimed) {
        return { ok: false, code: "UNAUTHORIZED", message: UNAUTHORIZED.message };
      }

      let chosen: string | undefined;
      try {
        const picked = await dialog.showOpenDialog({
          title: "اختر ملف الترخيص",
          properties: ["openFile"],
          filters: [{ name: "Mezan licence", extensions: ["mezan", "lic", "txt"] }],
        });
        if (picked.canceled) {
          return { ok: false, code: "CANCELLED", message: "لم يتم اختيار أي ملف." };
        }
        chosen = picked.filePaths[0];
      } catch (err) {
        console.error("[licence] the file picker could not be opened", err);
        return { ok: false, code: "FAILED", message: "تعذّر فتح نافذة اختيار الملف." };
      }
      if (!chosen) {
        return { ok: false, code: "CANCELLED", message: "لم يتم اختيار أي ملف." };
      }

      const target = licenceFilePath();
      try {
        // Read before writing: a file this process cannot read is a refusal, not
        // a licence.mezan the next launch will choke on.
        readFileSync(chosen, "utf8");
        copyFileSync(chosen, target);
      } catch (err) {
        console.error("[licence] the chosen licence file could not be installed", err);
        return {
          ok: false,
          code: "UNREADABLE",
          message: "تعذّرت قراءة الملف المختار أو نسخه إلى مكانه. تأكد أنه ملف الترخيص الصحيح.",
        };
      }

      try {
        const licence = await deps.reloadLicence();
        deps.onLicenceReplaced?.(licence);
        return { ok: true, status: await describe(licence), accepted: licence.state.canWrite };
      } catch (err) {
        console.error("[licence] the imported licence could not be verified", err);
        return { ok: false, code: "FAILED", message: "تعذّر التحقق من ملف الترخيص بعد تثبيته." };
      }
    },
  );

  registerAppVersionOverIpc();
  registerSupportActionsOverIpc(deps);
}

/**
 * THE TWO PLAINTEXT FILES, and the diagnostic file support asks for.
 *
 * `target` is a discriminator and the paths are re-derived here, exactly as the
 * backup handlers re-derive an archive path from a file name: the renderer must
 * never be able to name a file for the main process to reveal or unlink.
 */
function registerSupportActionsOverIpc(deps: LicenceIpcDeps): void {
  function resolveLog(): string | null {
    const file = deps.logs?.filePath;
    return file && existsSync(file) ? file : null;
  }

  function resolveTarget(target: unknown): string | null {
    if (target === "key-card") {
      const file = keyCardFilePath(deps.dbPath);
      return existsSync(file) ? file : null;
    }
    if (target === "plaintext-archive") {
      const file = deps.plaintextArchivePath();
      return file && existsSync(file) ? file : null;
    }
    return null;
  }

  async function authorized(sessionToken: unknown): Promise<boolean> {
    return typeof sessionToken === "string" && (await deps.sessions.find(sessionToken)) !== null;
  }

  handleGuarded(
    MEZAN_SUPPORT_DIAGNOSTIC_CHANNEL,
    async (_event, sessionToken: unknown, body: unknown): Promise<SupportActionResult> => {
      if (!(await authorized(sessionToken))) {
        return { ok: false, code: "UNAUTHORIZED", message: UNAUTHORIZED.message };
      }
      if (typeof body !== "string" || body === "") {
        return { ok: false, code: "FAILED", message: "لا توجد بيانات تشخيص لحفظها." };
      }
      try {
        const picked = await dialog.showSaveDialog({
          title: "حفظ ملف التشخيص",
          defaultPath: path.join(
            app.getPath("desktop"),
            `mezan-diagnostic-${new Date().toISOString().slice(0, 10)}.json`,
          ),
          filters: [{ name: "JSON", extensions: ["json"] }],
        });
        if (picked.canceled || !picked.filePath) {
          return { ok: false, code: "CANCELLED", message: "لم يتم حفظ الملف." };
        }
        writeFileSync(picked.filePath, body, "utf8");
        return { ok: true, path: picked.filePath };
      } catch (err) {
        console.error("[support] the diagnostic file could not be written", err);
        return { ok: false, code: "FAILED", message: "تعذّر حفظ ملف التشخيص." };
      }
    },
  );

  handleGuarded(
    MEZAN_SUPPORT_SAVE_LOGS_CHANNEL,
    async (_event, sessionToken: unknown, diagnostic: unknown): Promise<SupportActionResult> => {
      if (!(await authorized(sessionToken))) {
        return { ok: false, code: "UNAUTHORIZED", message: UNAUTHORIZED.message };
      }
      if (!deps.logs) {
        return { ok: false, code: "NOT_FOUND", message: "لا يوجد سجل أخطاء على هذا الجهاز." };
      }
      try {
        const picked = await dialog.showSaveDialog({
          title: "حفظ السجلات للدعم",
          defaultPath: path.join(
            app.getPath("desktop"),
            `mezan-support-logs-${new Date().toISOString().slice(0, 10)}.txt`,
          ),
          filters: [{ name: "Text", extensions: ["txt"] }],
        });
        if (picked.canceled || !picked.filePath) {
          return { ok: false, code: "CANCELLED", message: "لم يتم حفظ الملف." };
        }
        const lines = deps.logs.tail(SUPPORT_LOG_TAIL_LINES);
        const body = [
          "=== Mezan support bundle ===",
          typeof diagnostic === "string" ? diagnostic : "",
          `=== mezan.log (last ${lines.length} lines, secrets redacted) ===`,
          ...lines,
          "",
        ].join("\n");
        writeFileSync(picked.filePath, body, { encoding: "utf8", mode: 0o600 });
        return { ok: true, path: picked.filePath };
      } catch (err) {
        console.error("[support] the log bundle could not be written", err);
        return { ok: false, code: "FAILED", message: "تعذّر حفظ السجلات." };
      }
    },
  );

  handleGuarded(
    MEZAN_SUPPORT_REVEAL_CHANNEL,
    async (_event, sessionToken: unknown, target: unknown): Promise<SupportActionResult> => {
      if (!(await authorized(sessionToken))) {
        return { ok: false, code: "UNAUTHORIZED", message: UNAUTHORIZED.message };
      }
      const revealTarget = target as SupportRevealTarget;
      const file = revealTarget === "log" ? resolveLog() : resolveTarget(target);
      if (!file) return { ok: false, code: "NOT_FOUND", message: "الملف لم يعد موجوداً." };
      try {
        shell.showItemInFolder(file);
        return { ok: true, path: file };
      } catch (err) {
        console.error("[support] the file could not be revealed", err);
        return { ok: false, code: "FAILED", message: "تعذّر فتح مجلد الملف." };
      }
    },
  );

  handleGuarded(
    MEZAN_SUPPORT_DELETE_CHANNEL,
    async (_event, sessionToken: unknown, target: unknown): Promise<SupportActionResult> => {
      if (!(await authorized(sessionToken))) {
        return { ok: false, code: "UNAUTHORIZED", message: UNAUTHORIZED.message };
      }
      const file = resolveTarget(target);
      if (!file) return { ok: true, path: null };
      try {
        unlinkSync(file);
        return { ok: true, path: file };
      } catch (err) {
        console.error("[support] the file could not be deleted", err);
        return { ok: false, code: "FAILED", message: "تعذّر حذف الملف. احذفه يدوياً من مكانه." };
      }
    },
  );
}

/**
 * `mezan:licence:checkin` — the operator asking, now, rather than waiting for
 * the silent one at startup.
 *
 * SESSION-GATED like the status channel: whether a shop's licence is current is
 * a fact about that shop. No permission beyond a session, for the same reason —
 * a licence problem is the owner's to see, and hiding it behind an admin grant
 * hides it from the person holding the phone to support.
 *
 * Records the success itself, so pressing the button is what actually clears an
 * overdue window. A failed attempt records NOTHING and says so: the day counter
 * has to keep degrading on its own rather than be reset by an attempt that
 * reached nobody, or "press the button" becomes the way around the whole thing.
 */
export function registerLicenceCheckinOverIpc(deps: {
  readonly guard: LicenseGuardStore;
  /** The licence's signed `notBefore`, used when the record has no stamp yet. */
  readonly installedAtFallback: string | null;
  readonly endpoint: string | undefined;
  /** `payload.licenseId` — null when there is no authentic licence to check in. */
  readonly licenseId: string | null;
  /** This machine's SALTED fingerprint hash. */
  readonly fingerprint: string | null;
  /** The vendor key the ANSWER is verified against, not just the licence. */
  readonly publicKey: string | null;
  readonly sessions: SessionLookup;
  readonly log?: (message: string) => void;
}): void {
  handleGuarded(
    MEZAN_LICENCE_CHECKIN_CHANNEL,
    async (_event, sessionToken: unknown): Promise<LicenceCheckinResult> => {
      if (typeof sessionToken !== "string" || !(await deps.sessions.find(sessionToken))) {
        return { reachedServer: false, revoked: false, daysSince: 0, messageAr: UNAUTHORIZED.message };
      }

      const before = deps.guard.read();
      const attempt = await attemptCheckin({
        endpoint: deps.endpoint,
        licenseId: deps.licenseId,
        fingerprint: deps.fingerprint,
        publicKey: deps.publicKey,
        lastVerifiedAt: before.record.lastVerifiedAt,
      });
      if (attempt.reachedServer) {
        try {
          applyCheckinAttempt(deps.guard, attempt, new Date());
        } catch (err) {
          (deps.log ?? console.error)(
            `[licence] could not record the check-in: ${err instanceof Error ? err.message : String(err)}`,
          );
        }
      } else if (attempt.detail) {
        // English detail goes to the LOG. It never reaches the Arabic copy.
        (deps.log ?? console.warn)(`[licence] check-in failed: ${attempt.detail}`);
      }

      const after = deps.guard.read();
      const verdict = decideCheckin({
        record: after.record,
        integrity: after.integrity,
        installedAtFallback: deps.installedAtFallback,
        now: new Date(),
      });

      if (attempt.revoked) {
        return {
          reachedServer: true,
          revoked: true,
          daysSince: verdict.daysSince,
          messageAr: checkinMessageAr("revoked", 0),
        };
      }
      if (!attempt.reachedServer) {
        return {
          reachedServer: false,
          revoked: false,
          daysSince: verdict.daysSince,
          messageAr:
            `${checkinFailureMessageAr(attempt.failure ?? "UNREACHABLE")} ` +
            checkinMessageAr(verdict.verdict, verdict.daysSince),
        };
      }
      return {
        reachedServer: true,
        revoked: false,
        daysSince: verdict.daysSince,
        messageAr: "تم التحقق من الترخيص بنجاح.",
      };
    },
  );
}
