import { useState } from "react";
import { useNavigate } from "react-router";
import { useMutation, useQuery, useQueryClient, type UseQueryResult } from "@tanstack/react-query";
import { Button, DocumentList, Money, StatusPill, type DocumentListColumn, type PillTone } from "@mezan/ui";
import { TenantWireStatus, type PlanDTO, type PlanStatusDTO } from "@mezan/contracts";
import { useAppTranslation, type AppTranslationKey } from "../i18n";
import { PlatformApiError, readPlatformErrorMessage, usePlatformApi } from "./api";
import { useTenantsQuery } from "./hooks";

const STATUS_KEY: Record<PlanStatusDTO, AppTranslationKey> = {
  active: "platform.plans.status.active",
  retired: "platform.plans.status.retired",
};
const STATUS_TONE: Record<PlanStatusDTO, PillTone> = { active: "success", retired: "neutral" };

export const PLANS_QUERY_KEY = ["platform", "plans"] as const;

/** GET /plans — shared between the list and the editor, which resolves its plan from this same cache. */
export function usePlansQuery(): UseQueryResult<PlanDTO[], PlatformApiError> {
  const { t } = useAppTranslation();
  const { request, session } = usePlatformApi();
  return useQuery<PlanDTO[], PlatformApiError>({
    queryKey: PLANS_QUERY_KEY,
    enabled: session !== null,
    queryFn: async () => {
      const res = await request("/plans");
      if (!res.ok) throw new PlatformApiError(res.status, await readPlatformErrorMessage(res, t, "platform.plans.loadFailed"));
      return res.json<PlanDTO[]>();
    },
  });
}

export function useRetirePlan() {
  const { t } = useAppTranslation();
  const { request } = usePlatformApi();
  const queryClient = useQueryClient();
  return useMutation<PlanDTO, PlatformApiError, string>({
    mutationFn: async (id) => {
      const res = await request(`/plans/${encodeURIComponent(id)}/retire`, { method: "POST" });
      if (!res.ok) {
        throw new PlatformApiError(res.status, await readPlatformErrorMessage(res, t, "platform.plans.retireFailed"));
      }
      return res.json<PlanDTO>();
    },
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: PLANS_QUERY_KEY });
    },
  });
}

export function PlansPage() {
  const { t } = useAppTranslation();
  const navigate = useNavigate();
  const { session } = usePlatformApi();
  const isOwner = session?.user.role === "owner";
  const query = usePlansQuery();
  const retire = useRetirePlan();
  const tenantsQuery = useTenantsQuery();
  const tenantsByPlan = new Map<string, number>();
  for (const summary of tenantsQuery.data ?? []) {
    if (summary.subscription && summary.tenant.status !== TenantWireStatus.Archived) tenantsByPlan.set(summary.subscription.planId, (tenantsByPlan.get(summary.subscription.planId) ?? 0) + 1);
  }
  const [retiringId, setRetiringId] = useState<string | null>(null);
  const [rowError, setRowError] = useState<string | null>(null);
  const plans = query.data ?? [];

  async function handleRetire(plan: PlanDTO) {
    if (retiringId) return;
    setRetiringId(plan.id);
    setRowError(null);
    try {
      await retire.mutateAsync(plan.id);
    } catch (err) {
      setRowError(err instanceof PlatformApiError ? err.message : t("platform.plans.retireFailed"));
    } finally {
      setRetiringId(null);
    }
  }

  const columns: DocumentListColumn<PlanDTO>[] = [
    {
      key: "name",
      header: t("platform.plans.col.name"),
      render: (row) => (
        <div>
          <div className="font-semibold text-ink">{row.nameAr}</div>
          <div className="mz-lat text-[11.5px] text-ink-faint">{row.nameEn}</div>
          <div className="mz-lat font-mono text-[11px] text-ink-faint">{row.code}</div>
        </div>
      ),
    },
    { key: "modules", header: t("platform.plans.col.modules"), align: "end", render: (row) => <span className="mz-num">{row.modules.length}</span> },
    { key: "seats", header: t("platform.plans.col.seats"), align: "end", render: (row) => <span className="mz-num">{row.seatsIncluded}</span> },
    {
      key: "tenants",
      header: t("platform.plans.col.tenants"),
      align: "end",
      render: (row) => <span className="mz-num">{tenantsQuery.data ? (tenantsByPlan.get(row.id) ?? 0) : "—"}</span>,
    },
    {
      key: "priceMonthly",
      header: t("platform.plans.col.priceMonthly"),
      align: "end",
      render: (row) => <Money value={Number(row.priceMonthly)} />,
    },
    {
      key: "priceYearly",
      header: t("platform.plans.col.priceYearly"),
      align: "end",
      render: (row) => <Money value={Number(row.priceYearly)} />,
    },
    {
      key: "status",
      header: t("common.status"),
      render: (row) => <StatusPill label={t(STATUS_KEY[row.status])} tone={STATUS_TONE[row.status]} />,
    },
    {
      key: "actions",
      header: "",
      align: "end",
      render: (row) =>
        isOwner ? (
          <div className="flex justify-end gap-[6px]">
            <Button
              size="sm"
              variant="ghost"
              onClick={(e) => {
                e.stopPropagation();
                navigate(row.id);
              }}
            >
              {t("common.edit")}
            </Button>
            <Button
              size="sm"
              variant="ghost"
              onClick={(e) => {
                e.stopPropagation();
                navigate(`new?from=${encodeURIComponent(row.id)}`);
              }}
            >
              {t("platform.plans.duplicate")}
            </Button>
            {row.status === "active" ? (
              <Button
                size="sm"
                variant="danger-outline"
                disabled={retiringId === row.id}
                onClick={(e) => {
                  e.stopPropagation();
                  void handleRetire(row);
                }}
              >
                {retiringId === row.id ? t("platform.plans.retiring") : t("platform.plans.retire")}
              </Button>
            ) : null}
          </div>
        ) : null,
    },
  ];

  return (
    <DocumentList<PlanDTO>
      title={t("platform.plans.title")}
      description={t("platform.plans.description")}
      actions={isOwner ? <Button variant="primary" onClick={() => navigate("new")}>{t("platform.plans.new")}</Button> : undefined}
      columns={columns}
      rows={plans}
      rowKey={(row) => row.id}
      onRowClick={isOwner ? (row) => navigate(row.id) : undefined}
      page={1}
      pageCount={1}
      pageSummary={<>{t("common.show")} <span className="mz-num">{plans.length}</span></>}
      loading={query.isLoading}
      loadFailed={query.isError}
      emptyState={<div className="p-8 text-center text-sm text-ink-muted">{t("platform.plans.empty")}</div>}
      filterBarExtra={
        rowError ? (
          <div className="rounded-md border border-danger bg-danger-soft px-[12px] py-[7px] text-[12px] text-danger-ink">{rowError}</div>
        ) : undefined
      }
    />
  );
}
