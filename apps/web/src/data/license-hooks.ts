import { useMutation, useQuery, useQueryClient, type UseQueryResult } from "@tanstack/react-query";
import { useApi } from "./ApiContext";
import { ApiError, readError, isDesktopHost, type DesktopLicenceStatusDTO } from "./hooks";
import { useAppTranslation } from "../i18n";

/**
 * The license state the server operates under (`GET /license/state`), mirroring
 * `LicenseStateView` in @mezan/api. Drives the read-only banner; the actual
 * enforcement is server-side (the license write-gate), never these fields.
 */
export interface LicenseStateDTO {
  readonly state:
    | "ACTIVE"
    | "GRACE"
    | "READ_ONLY"
    | "INVALID"
    | "TAMPERED"
    | "NOT_YET_VALID"
    | "FINGERPRINT_MISMATCH"
    /** The licensing service says this licence was withdrawn. Read-only. */
    | "REVOKED"
    | "UNLICENSED";
  readonly canWrite: boolean;
  readonly usable: boolean;
  readonly licensee?: string;
  readonly expiresAt?: string;
  readonly graceEndsAt?: string;
  /**
   * The MACHINE reason, and the field every banner branch now turns on.
   *
   * The banner used to branch on `state` alone, so a valid licence whose only
   * fault was an overdue online check-in («CHECKIN_OVERDUE») was told to renew —
   * while the correct sentence, "connect to the internet", went to a
   * `console.warn` nobody in a shop opens.
   */
  readonly reason?: string;
  /**
   * Arabic, ready to render, supplied only where the generic copy for `state`
   * would be WRONG for this reason. Absent means the banner's own copy is right.
   */
  readonly messageAr?: string;
  /** Days since the last successful online check-in, when `reason` is CHECKIN_OVERDUE. */
  readonly daysSince?: number;
}

/**
 * The check-in the operator asked for, from the banner's «تحقّق الآن» button.
 *
 * It returns the STRUCTURED outcome, not the main process's sentence: that
 * sentence interpolates the raw transport error into Arabic prose («تعذّر
 * الوصول إلى خدمة التراخيص (fetch failed)…»), and on a shipped install that is
 * the only variant possible. The renderer picks its own Arabic from
 * `reachedServer`/`revoked` and never renders an `Error` message.
 */
export type LicenceCheckinOutcome = "confirmed" | "revoked" | "unreachable" | "unavailable";

export interface LicenceCheckinAttempt {
  readonly outcome: LicenceCheckinOutcome;
  readonly daysSince: number | null;
}

interface CheckinBridgeResult {
  readonly reachedServer: boolean;
  readonly revoked: boolean;
  readonly daysSince: number;
}

interface LicenceBridge {
  checkin?(sessionToken: string): Promise<CheckinBridgeResult>;
  import?(sessionToken: string): Promise<LicenceImportResultDTO>;
}

export type LicenceImportResultDTO =
  | { readonly ok: true; readonly status: DesktopLicenceStatusDTO; readonly accepted: boolean }
  | { readonly ok: false; readonly code: string; readonly message: string };

function licenceBridge(): LicenceBridge | undefined {
  return (globalThis as { mezan?: { licence?: LicenceBridge } }).mezan?.licence;
}

export function useLicenceCheckin() {
  const { session } = useApi();
  const queryClient = useQueryClient();
  return useMutation<LicenceCheckinAttempt, ApiError, void>({
    mutationFn: async () => {
      const bridge = licenceBridge();
      const token = session?.token ?? null;
      if (!bridge?.checkin || !token) return { outcome: "unavailable", daysSince: null };
      try {
        const result = await bridge.checkin(token);
        if (result.revoked) return { outcome: "revoked", daysSince: result.daysSince };
        if (!result.reachedServer) return { outcome: "unreachable", daysSince: result.daysSince };
        return { outcome: "confirmed", daysSince: result.daysSince };
      } catch {
        // An `ipcMain.handle` rejection reaches here as
        // "Error invoking remote method …", in English. It is a failure to
        // reach the service like any other, and is reported as one.
        return { outcome: "unreachable", daysSince: null };
      }
    },
    onSettled: () => {
      void queryClient.invalidateQueries({ queryKey: ["licence", "status"] });
      void queryClient.invalidateQueries({ queryKey: ["license-state"] });
    },
  });
}

/**
 * Installing a licence FILE, which is what this product has always used — there
 * has never been an activation key, despite the wizard asking for one.
 *
 * The result is the verification's own verdict. `accepted` is the verified
 * `canWrite`, never "a file was copied".
 */
export function useLicenceImport() {
  const { t } = useAppTranslation();
  const { session } = useApi();
  const queryClient = useQueryClient();
  return useMutation<LicenceImportResultDTO, ApiError, void>({
    mutationFn: async () => {
      const bridge = licenceBridge();
      if (!bridge?.import || !isDesktopHost()) {
        return { ok: false, code: "UNAVAILABLE", message: t("licenceUi.importDesktopOnly") };
      }
      try {
        // Deliberately sent even when there is no session: the first-run
        // wizard's activation step runs before any account exists, and the main
        // process falls back to "is this install unclaimed?" for exactly that
        // case (main/licence-ipc.ts). An empty token is a token it refuses.
        return await bridge.import(session?.token ?? "");
      } catch {
        return { ok: false, code: "FAILED", message: t("licenceUi.importFailed") };
      }
    },
    onSettled: () => {
      void queryClient.invalidateQueries({ queryKey: ["licence", "status"] });
      void queryClient.invalidateQueries({ queryKey: ["license-state"] });
    },
  });
}

/**
 * Polls the license state so a GRACE→READ_ONLY transition (grace window
 * lapsing while the app is open) surfaces without a reload, and a fresh
 * activation clears the banner. Cheap: one tiny JSON read a minute.
 */
export function useLicenseState(): UseQueryResult<LicenseStateDTO, ApiError> {
  const { t } = useAppTranslation();
  const { request, session } = useApi();
  return useQuery<LicenseStateDTO, ApiError>({
    queryKey: ["license-state"],
    enabled: session !== null,
    refetchInterval: 60_000,
    refetchOnWindowFocus: true,
    queryFn: async () => {
      const res = await request("/license/state");
      if (!res.ok) throw new ApiError(res.status, await readError(res, t("license.loadFailed"), t));
      return res.json<LicenseStateDTO>();
    },
  });
}
