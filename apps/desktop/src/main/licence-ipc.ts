import { ipcMain } from "electron";
import type { SessionRegistry } from "@mezan/api";
import {
  MEZAN_LICENCE_CHECKIN_CHANNEL,
  MEZAN_LICENCE_STATUS_CHANNEL,
  type LicenceCheckinResult,
  type LicenceStatusFailure,
  type LicenceStatusResult,
} from "../shared/ipc-contract.js";
import type { DesktopEntitlementsDiagnosis } from "./entitlements.js";
import type { LanHostHandle } from "./lan-host.js";
import {
  attemptCheckin,
  checkinMessageAr,
  decideCheckin,
  readCheckinState,
  recordSuccessfulCheckin,
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
  /** The diagnosis main/index.ts already resolved at startup — read, not re-derived. */
  readonly diagnosis: () => DesktopEntitlementsDiagnosis;
  /**
   * The live LAN handle, through a getter: `startLanHost` runs after this is
   * registered, and the socket's address is not known until `ready` resolves.
   */
  readonly lanHost: () => LanHostHandle | undefined;
  /** Reads the caller's grant from the live session registry (api/session-auth.ts). */
  readonly sessions: SessionRegistry;
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
  ipcMain.handle(MEZAN_LICENCE_STATUS_CHANNEL, (): LicenceStatusResult => {
    return {
      ok: true,
      code: "LIC-OK",
      messageAr: `هذا الجهاز يعمل كمحطة متصلة بالجهاز الرئيسي على ${config.hostUrl}. الترخيص وعدد المقاعد يُداران من الجهاز الرئيسي.`,
      plan: "CLIENT",
      seats: 0,
      expiresAt: null,
      lan: {
        listening: false,
        url: config.hostUrl,
        fingerprintSha256: config.fingerprintSha256,
      },
    };
  });
}

export function registerLicenceStatusOverIpc(deps: LicenceIpcDeps): void {
  ipcMain.handle(
    MEZAN_LICENCE_STATUS_CHANNEL,
    (_event, sessionToken: unknown): LicenceStatusResult => {
      if (typeof sessionToken !== "string" || sessionToken === "") return UNAUTHORIZED;
      if (!deps.sessions.find(sessionToken)) return UNAUTHORIZED;

      let diagnosis: DesktopEntitlementsDiagnosis;
      try {
        diagnosis = deps.diagnosis();
      } catch (err) {
        console.error("[licence] could not read the entitlements diagnosis", err);
        return UNAVAILABLE;
      }

      const host = deps.lanHost();
      return {
        ok: true,
        code: diagnosis.code,
        messageAr: diagnosis.detailAr,
        plan: diagnosis.entitlements.plan,
        seats: diagnosis.entitlements.seats,
        expiresAt: diagnosis.entitlements.expiresAt,
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
        },
      };
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
  readonly dbPath: string;
  readonly installedAt: string;
  readonly endpoint: string | undefined;
  readonly licenseId: string;
  readonly fingerprint: string;
  readonly sessions: SessionRegistry;
}): void {
  ipcMain.handle(
    MEZAN_LICENCE_CHECKIN_CHANNEL,
    async (_event, sessionToken: unknown): Promise<LicenceCheckinResult> => {
      if (typeof sessionToken !== "string" || !deps.sessions.find(sessionToken)) {
        return { reachedServer: false, revoked: false, daysSince: 0, messageAr: UNAUTHORIZED.message };
      }

      const attempt = await attemptCheckin({
        endpoint: deps.endpoint,
        licenseId: deps.licenseId,
        fingerprint: deps.fingerprint,
      });
      if (attempt.reachedServer && !attempt.revoked) {
        await recordSuccessfulCheckin(deps.dbPath, new Date()).catch((err: unknown) =>
          console.error("[licence] could not record the check-in", err),
        );
      }

      const state = await readCheckinState(deps.dbPath);
      const verdict = decideCheckin({ ...state, installedAt: deps.installedAt, now: new Date() });

      if (attempt.revoked) {
        return {
          reachedServer: true,
          revoked: true,
          daysSince: verdict.daysSince,
          messageAr: "هذا الترخيص مُلغى. تواصل مع الدعم.",
        };
      }
      if (!attempt.reachedServer) {
        return {
          reachedServer: false,
          revoked: false,
          daysSince: verdict.daysSince,
          messageAr:
            `تعذّر الوصول إلى خدمة التراخيص (${attempt.error ?? "سبب غير معروف"}). ` +
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
