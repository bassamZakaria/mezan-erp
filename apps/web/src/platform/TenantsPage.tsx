import { useState } from "react";
import { Link, useNavigate } from "react-router";
import { Button, Card, DocumentList, useFormat, type DocumentListColumn } from "@mezan/ui";
import type { TenantSummaryDTO } from "@mezan/contracts";
import { useAppTranslation } from "../i18n";
import { BillingDayReviewChip, OwnerContactChip, TenantLicenceChip, TenantStatusChip } from "./chips";
import { usePlatformApi } from "./api";
import { NewTenantDialog } from "./NewTenantDialog";
import { usePlansQuery, useTenantsQuery } from "./hooks";
import { useMediaQuery } from "../lib/use-media-query";

export const NARROW_TENANT_LIST_QUERY = "(max-width: 639px)";

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
  const narrow = useMediaQuery(NARROW_TENANT_LIST_QUERY);
  const newTenantButton = isOwner ? (
    <Button variant="primary" onClick={() => setDialogOpen(true)}>
      {t("platform.tenants.new")}
    </Button>
  ) : undefined;

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
          <OwnerContactChip verified={row.tenant.ownerContactVerified} />
          <BillingDayReviewChip needsReview={row.subscription?.billingAnchorNeedsReview === true} />
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
      render: (row) => <TenantLicenceChip state={row.licenseState.state} subscriptionStatus={row.subscription?.status ?? null} />,
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
      {narrow ? (
        <div className="flex flex-col gap-[14px]">
          <div className="flex flex-wrap items-center justify-between gap-[10px]">
            <h1 className="font-display text-2xl font-bold text-ink">{t("platform.nav.tenants")}</h1>
            {newTenantButton}
          </div>
          {tenantsQuery.isLoading ? <p className="text-sm text-ink-muted">{t("common.loading")}</p> : null}
          {!tenantsQuery.isLoading && !tenantsQuery.isError && tenants.length === 0 ? (
            <Card className="p-8 text-center text-sm text-ink-muted">{t("platform.tenants.empty")}</Card>
          ) : null}
          <ul className="flex flex-col gap-[10px]">
            {tenants.map((row) => (
              <li key={row.tenant.id}>
                <Card className="flex flex-col gap-[10px] p-[14px]">
                  <div className="flex items-start justify-between gap-[10px]">
                    <div className="min-w-0">
                      <div className="break-words font-semibold text-ink">{row.tenant.nameAr}</div>
                      <div className="mz-lat break-all text-[12px] text-ink-faint">{row.tenant.code}</div>
                    </div>
                    <span className="flex-none">
                      <TenantStatusChip status={row.tenant.status} />
                    </span>
                  </div>
                  <div className="flex flex-wrap items-center gap-[8px]">
                    <TenantLicenceChip state={row.licenseState.state} subscriptionStatus={row.subscription?.status ?? null} />
                    <OwnerContactChip verified={row.tenant.ownerContactVerified} />
                    <BillingDayReviewChip needsReview={row.subscription?.billingAnchorNeedsReview === true} />
                  </div>
                  <dl className="grid grid-cols-2 gap-[8px] text-[12px] text-ink-muted">
                    <div>
                      <dt>{t("platform.tenants.plan")}</dt>
                      <dd className="font-semibold text-ink">{row.plan?.nameAr ?? "—"}</dd>
                    </div>
                    <div>
                      <dt>{t("platform.tenants.periodEnd")}</dt>
                      <dd className="mz-num font-semibold text-ink">{row.subscription ? format.date(row.subscription.currentPeriodEnd) : "—"}</dd>
                    </div>
                  </dl>
                  <Link
                    to={`/platform/tenants/${row.tenant.id}`}
                    aria-label={`${t("platform.tenants.view")} ${row.tenant.nameAr}`}
                    className="flex min-h-[var(--h-btn)] items-center justify-center rounded-md border border-border bg-surface-2 px-[12px] text-[13px] font-semibold text-ink hover:bg-surface-3"
                  >
                    {t("platform.tenants.view")}
                  </Link>
                </Card>
              </li>
            ))}
          </ul>
        </div>
      ) : (
        <DocumentList<TenantSummaryDTO>
          title={t("platform.nav.tenants")}
          actions={newTenantButton}
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
      )}
      {isOwner ? <NewTenantDialog open={dialogOpen} onClose={() => setDialogOpen(false)} plans={plansQuery.data ?? []} /> : null}
    </>
  );
}
