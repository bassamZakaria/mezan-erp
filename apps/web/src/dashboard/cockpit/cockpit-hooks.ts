import { useEffect, useRef } from "react";
import { useQuery, useQueryClient, type UseQueryResult } from "@tanstack/react-query";
import type { CockpitDTO, CockpitVersionDTO } from "@mezan/contracts";
import { useApi } from "../../data/ApiContext";
import { ApiError, loaderError } from "../../data/hooks";
import { useAppTranslation } from "../../i18n";

export const COCKPIT_POLL_MS = 15_000;

const COCKPIT_KEY = "cockpit";

/**
 * Every react-query family a dashboard panel reads. A family missing here is a
 * panel that never refreshes when the books move — which is the whole point of
 * the watch.
 */
const LIVE_FAMILIES = new Set([
  COCKPIT_KEY,
  "dashboard",
  "cash-forecast",
  "reports",
  "financial-reports",
  "sales-invoices",
  "treasury-accounts",
]);

export function useCockpit(branchId: string, enabled: boolean): UseQueryResult<CockpitDTO, ApiError> {
  const { t } = useAppTranslation();
  const { request, session } = useApi();
  return useQuery<CockpitDTO, ApiError>({
    queryKey: [COCKPIT_KEY, branchId],
    enabled: enabled && session !== null,
    queryFn: async () => {
      const qs = branchId ? `?branchId=${encodeURIComponent(branchId)}` : "";
      const res = await request(`/dashboard/cockpit${qs}`);
      if (!res.ok) throw await loaderError(res, t("cockpit.loadFailed"), t);
      return res.json<CockpitDTO>();
    },
  });
}

/**
 * Polls the book version and refetches every dashboard figure on screen when it
 * moves. A poll rather than a push: the desktop shell talks to the backend over
 * IPC, where a server-sent stream has nowhere to land.
 *
 * Mounted by the DASHBOARD, not by the cockpit section: the cockpit renders
 * only for a user who holds `accounting.cockpit.view` and has cockpit widgets
 * configured, so mounting it there left the classic panels frozen for everyone
 * else until they reloaded the page.
 */
export function useBookVersionWatch(enabled: boolean, baseline: string | null): UseQueryResult<CockpitVersionDTO, ApiError> {
  const { t } = useAppTranslation();
  const { request, session } = useApi();
  const queryClient = useQueryClient();
  const seen = useRef<string | null>(null);
  const version = useQuery<CockpitVersionDTO, ApiError>({
    queryKey: [COCKPIT_KEY, "version"],
    enabled: enabled && session !== null,
    refetchInterval: COCKPIT_POLL_MS,
    refetchIntervalInBackground: false,
    queryFn: async () => {
      const res = await request("/dashboard/version");
      if (!res.ok) throw await loaderError(res, t("cockpit.loadFailed"), t);
      return res.json<CockpitVersionDTO>();
    },
  });
  const current = version.data?.bookVersion ?? null;
  useEffect(() => {
    if (current === null) return;
    const previous = seen.current ?? baseline;
    if (previous !== null && previous !== current) {
      void queryClient.invalidateQueries({
        predicate: (query) => {
          const [family, second] = query.queryKey;
          if (family === COCKPIT_KEY && second === "version") return false;
          return typeof family === "string" && LIVE_FAMILIES.has(family);
        },
      });
    }
    seen.current = current;
  }, [current, baseline, queryClient]);
  return version;
}
