import { useState } from "react";
import { useNavigate } from "react-router";
import { Button, Card, DocumentList, useFormat, type DocumentListColumn } from "@mezan/ui";
import type { TenantSummaryDTO } from "@mezan/contracts";
import { useAppTranslation } from "../i18n";
import { LicenseStateChip, TenantStatusChip } from "./chips";
import { usePlatformApi } from "./api";
import { NewTenantDialog } from "./NewTenantDialog";
import { usePlansQuery, useTenantsQuery } from "./hooks";

/** «المنشآت» — every tenant the platform has provisioned, with its plan, status and licence at a glance. Row click drills into `TenantDetailPage`; only an owner (never `support`) can provision a new one. */
export function TenantsPage() {
  const { t } = useAppTranslation();
  const format = useFormat();
  const navigate = useNavigate();
  const { session } = usePlatformApi();
  const isOwner = session?.user.role === "owner";
  const [dialogOpen, setDialogOpen] = useState(false);

  const tenantsQuery = useTenantsQuery();
  const plansQuery = usePlansQuery();
  const tenants = tenantsQuery.data ?? [];

  const columns: DocumentListColumn<TenantSummaryDTO>[] = [
    {
      key: "code",
      header: t("platform.tenants.code"),
      render: (row) => <span className="mz-lat font-semibold text-ink">{row.tenant.code}</span>,
    },
    {
      key: "name",
      header: t("platform.tenants.name"),
      render: (row) => (
        <div>
          <div className="font-semibold text-ink">{row.tenant.nameAr}</div>
          {row.tenant.nameEn ? <div className="mz-lat text-[11px] text-ink-faint">{row.tenant.nameEn}</div> : null}
        </div>
      ),
    },
    {
      key: "plan",
      header: t("platform.tenants.plan"),
      render: (row) => row.plan?.nameAr ?? "—",
    },
    {
      key: "status",
      header: t("common.status"),
      render: (row) => <TenantStatusChip status={row.tenant.status} />,
    },
    {
      key: "licence",
      header: t("platform.tenants.licence"),
      render: (row) => <LicenseStateChip state={row.licenseState.state} />,
    },
    {
      key: "periodEnd",
      header: t("platform.tenants.periodEnd"),
      render: (row) => (row.subscription ? <span className="mz-num">{format.date(row.subscription.currentPeriodEnd)}</span> : "—"),
    },
  ];

  return (
    <>
      {tenantsQuery.isError ? (
        <Card className="mb-[14px] p-[14px_16px]">
          <p role="alert" className="text-[13px] font-semibold text-danger-ink">
            {tenantsQuery.error.message}
          </p>
          <Button size="sm" className="mt-[8px]" onClick={() => tenantsQuery.refetch()}>
            {t("common.retry")}
          </Button>
        </Card>
      ) : null}
      <DocumentList<TenantSummaryDTO>
        title={t("platform.nav.tenants")}
        actions={
          isOwner ? (
            <Button variant="primary" onClick={() => setDialogOpen(true)}>
              {t("platform.tenants.new")}
            </Button>
          ) : undefined
        }
        columns={columns}
        rows={tenants}
        rowKey={(row) => row.tenant.id}
        onRowClick={(row) => navigate(`/platform/tenants/${row.tenant.id}`)}
        page={1}
        pageCount={1}
        loading={tenantsQuery.isLoading}
        loadFailed={tenantsQuery.isError}
        emptyState={<div className="p-8 text-center text-sm text-ink-muted">{t("platform.tenants.empty")}</div>}
      />
      {isOwner ? <NewTenantDialog open={dialogOpen} onClose={() => setDialogOpen(false)} plans={plansQuery.data ?? []} /> : null}
    </>
  );
}
