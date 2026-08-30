import { useQuery, type UseQueryResult } from "@tanstack/react-query";
import { useApi } from "./ApiContext";
import { ApiError } from "./hooks";
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
    | "UNLICENSED";
  readonly canWrite: boolean;
  readonly usable: boolean;
  readonly licensee?: string;
  readonly expiresAt?: string;
  readonly graceEndsAt?: string;
  readonly reason?: string;
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
      if (!res.ok) throw new ApiError(res.status, t("license.loadFailed"));
      return res.json<LicenseStateDTO>();
    },
  });
}
