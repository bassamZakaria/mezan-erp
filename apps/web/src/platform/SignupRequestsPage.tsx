import { useState } from "react";
import { Button, ConfirmDialog, DocumentList, Select, SidePanel, useFormat, type DocumentListColumn } from "@mezan/ui";
import { SignupModeCode, type BillingCycleDTO, type ProvisionResultDTO, type SignupRequestDTO } from "@mezan/contracts";
import { useAppTranslation, type AppTranslationKey } from "../i18n";
import { FormError, SelectField, ToggleField } from "../settings/form-controls";
import { PlatformApiError, usePlatformApi } from "./api";
import { usePlansQuery } from "./hooks";
import { ProvisionResultPanel } from "./NewTenantDialog";
import {
  useApproveSignupMutation,
  useRejectSignupMutation,
  useSetSignupModeMutation,
  useSignupModeQuery,
  useSignupRequestsQuery,
} from "./signup-request-hooks";

const MODE_LABEL: Readonly<Record<SignupModeCode, AppTranslationKey>> = {
  [SignupModeCode.Approval]: "platform.signupRequests.mode.approval",
  [SignupModeCode.Open]: "platform.signupRequests.mode.open",
  [SignupModeCode.Closed]: "platform.signupRequests.mode.closed",
};

const MODE_HINT: Readonly<Record<SignupModeCode, AppTranslationKey>> = {
  [SignupModeCode.Approval]: "platform.signupRequests.mode.approvalHint",
  [SignupModeCode.Open]: "platform.signupRequests.mode.openHint",
  [SignupModeCode.Closed]: "platform.signupRequests.mode.closedHint",
};

const errorText = (err: unknown, fallback: string): string => (err instanceof PlatformApiError ? err.message : fallback);

/** «طلبات التسجيل» — verified sign-ups waiting for the platform owner, and the switch that decides whether sign-up needs approval at all. */
export function SignupRequestsPage() {
  const { t } = useAppTranslation();
  const format = useFormat();
  const { session } = usePlatformApi();
  const isOwner = session?.user.role === "owner";
  const requests = useSignupRequestsQuery();
  const plans = usePlansQuery();
  const mode = useSignupModeQuery();
  const setMode = useSetSignupModeMutation();
  const reject = useRejectSignupMutation();
  const [pendingMode, setPendingMode] = useState<SignupModeCode | null>(null);
  const [approving, setApproving] = useState<SignupRequestDTO | null>(null);
  const [rejecting, setRejecting] = useState<SignupRequestDTO | null>(null);
  const [rejectingId, setRejectingId] = useState<string | null>(null);
  const [pageError, setPageError] = useState<string | null>(null);

  const planName = (id: string | null) => (id ? (plans.data?.find((p) => p.id === id)?.nameAr ?? "—") : "—");
  const currentMode = mode.data?.mode;

  function confirmReject() {
    const target = rejecting;
    setRejecting(null);
    if (!target || rejectingId) return;
    setRejectingId(target.id);
    setPageError(null);
    reject.mutate(target.id, {
      onError: (err) => setPageError(errorText(err, t("platform.signupRequests.rejectFailed"))),
      onSettled: () => setRejectingId(null),
    });
  }

  function confirmMode() {
    const next = pendingMode;
    setPendingMode(null);
    if (!next) return;
    setPageError(null);
    setMode.mutate(next, { onError: (err) => setPageError(errorText(err, t("platform.signupRequests.modeFailed"))) });
  }

  const columns: DocumentListColumn<SignupRequestDTO>[] = [
    {
      key: "company",
      header: t("platform.signupRequests.col.company"),
      render: (row) => (
        <div>
          <div className="font-semibold text-ink">{row.nameAr}</div>
          <div className="mz-lat font-mono text-[11px] text-ink-faint">{row.code}</div>
        </div>
      ),
    },
    {
      key: "owner",
      header: t("platform.signupRequests.col.owner"),
      render: (row) => (
        <div>
          <div className="text-ink">{row.ownerNameAr}</div>
          <div className="mz-lat text-[11.5px] text-ink-faint">{row.ownerEmail}</div>
        </div>
      ),
    },
    { key: "plan", header: t("platform.signupRequests.col.plan"), render: (row) => planName(row.intendedPlanId) },
    {
      key: "verifiedAt",
      header: t("platform.signupRequests.col.verifiedAt"),
      render: (row) => <span className="mz-num">{format.date(row.verifiedAt ?? row.createdAt)}</span>,
    },
    {
      key: "actions",
      header: "",
      align: "end",
      render: (row) =>
        isOwner ? (
          <div className="flex justify-end gap-[6px]">
            <Button size="sm" variant="primary" onClick={() => setApproving(row)}>
              {t("platform.signupRequests.approve")}
            </Button>
            <Button size="sm" variant="danger-outline" disabled={rejectingId === row.id} onClick={() => setRejecting(row)}>
              {rejectingId === row.id ? t("platform.signupRequests.rejecting") : t("platform.signupRequests.reject")}
            </Button>
          </div>
        ) : null,
    },
  ];

  const rows = requests.data ?? [];

  return (
    <>
      <DocumentList<SignupRequestDTO>
        title={t("platform.signupRequests.title")}
        description={currentMode ? t(MODE_HINT[currentMode]) : t("platform.signupRequests.description")}
        actions={
          currentMode ? (
            isOwner ? (
              <Select
                value={currentMode}
                onChange={(v) => v !== currentMode && setPendingMode(v as SignupModeCode)}
                options={Object.values(SignupModeCode).map((m) => ({ value: m, label: t(MODE_LABEL[m]) }))}
                aria-label={t("platform.signupRequests.mode.label")}
                size="sm"
              />
            ) : (
              <span className="text-[12.5px] font-semibold text-ink">{t(MODE_LABEL[currentMode])}</span>
            )
          ) : undefined
        }
        columns={columns}
        rows={rows}
        rowKey={(row) => row.id}
        page={1}
        pageCount={1}
        pageSummary={<>{t("common.show")} <span className="mz-num">{rows.length}</span></>}
        loading={requests.isLoading}
        loadFailed={requests.isError}
        emptyState={<div className="p-8 text-center text-sm text-ink-muted">{t("platform.signupRequests.empty")}</div>}
        filterBarExtra={
          pageError ? (
            <div role="alert" className="rounded-md border border-danger bg-danger-soft px-[12px] py-[7px] text-[12px] text-danger-ink">
              {pageError}
            </div>
          ) : undefined
        }
      />
      <ConfirmDialog
        open={rejecting !== null}
        title={t("platform.signupRequests.rejectConfirm.title")}
        consequence={t("platform.signupRequests.rejectConfirm.consequence", { name: rejecting?.nameAr ?? "" })}
        confirmLabel={t("platform.signupRequests.reject")}
        tone="danger"
        onConfirm={confirmReject}
        onCancel={() => setRejecting(null)}
      />
      <ConfirmDialog
        open={pendingMode !== null}
        title={t("platform.signupRequests.modeConfirm.title")}
        consequence={pendingMode ? t(MODE_HINT[pendingMode]) : ""}
        confirmLabel={pendingMode ? t(MODE_LABEL[pendingMode]) : ""}
        tone={pendingMode === SignupModeCode.Open ? "danger" : undefined}
        onConfirm={confirmMode}
        onCancel={() => setPendingMode(null)}
      />
      <ApprovePanel request={approving} onClose={() => setApproving(null)} />
    </>
  );
}

function ApprovePanel({ request, onClose }: { request: SignupRequestDTO | null; onClose: () => void }) {
  const { t } = useAppTranslation();
  const plans = usePlansQuery();
  const approve = useApproveSignupMutation();
  const [planId, setPlanId] = useState<string | null>(null);
  const [billingCycle, setBillingCycle] = useState<BillingCycleDTO | null>(null);
  const [trial, setTrial] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<ProvisionResultDTO | null>(null);

  function close() {
    setPlanId(null);
    setBillingCycle(null);
    setTrial(false);
    setError(null);
    setResult(null);
    approve.reset();
    onClose();
  }

  const activePlans = (plans.data ?? []).filter((p) => p.status === "active");
  const chosenPlan = planId ?? (activePlans.some((p) => p.id === request?.intendedPlanId) ? (request?.intendedPlanId ?? "") : "");
  const chosenCycle = billingCycle ?? request?.billingCycle ?? "monthly";
  const plan = activePlans.find((p) => p.id === chosenPlan);
  const paidWithoutTrial = plan !== undefined && Number(plan.priceMonthly) > 0 && !trial;

  function submit() {
    if (!request || approve.isPending) return;
    if (chosenPlan === "") {
      setError(t("platform.signupRequests.approvePanel.planRequired"));
      return;
    }
    setError(null);
    approve.mutate(
      { id: request.id, body: { planId: chosenPlan, billingCycle: chosenCycle, trial } },
      { onSuccess: setResult, onError: (err) => setError(errorText(err, t("platform.signupRequests.approveFailed"))) },
    );
  }

  return (
    <SidePanel
      open={request !== null}
      onClose={close}
      title={t("platform.signupRequests.approvePanel.title")}
      description={request ? `${request.nameAr} — ${request.ownerEmail}` : undefined}
    >
      {result ? (
        <ProvisionResultPanel result={result} onClose={close} />
      ) : (
        <div className="flex flex-col gap-[14px]">
          <FormError message={error} />
          <SelectField
            label={t("platform.newTenant.plan")}
            value={chosenPlan}
            onChange={setPlanId}
            options={activePlans.map((p) => ({ value: p.id, label: `${p.nameAr} — ${p.code}` }))}
          />
          <SelectField
            label={t("platform.newTenant.billingCycle")}
            value={chosenCycle}
            onChange={(v) => setBillingCycle(v as BillingCycleDTO)}
            options={[
              { value: "monthly", label: t("platform.billingCycle.monthly") },
              { value: "yearly", label: t("platform.billingCycle.yearly") },
            ]}
          />
          <ToggleField label={t("platform.newTenant.trial")} checked={trial} onChange={setTrial} />
          {paidWithoutTrial ? <p className="text-[12px] text-warning-ink">{t("platform.signupRequests.approvePanel.paidHint")}</p> : null}
          <div className="flex justify-end gap-[9px] border-t border-border pt-[14px]">
            <Button variant="ghost" onClick={close}>
              {t("common.cancel")}
            </Button>
            <Button variant="primary" disabled={approve.isPending} onClick={submit}>
              {approve.isPending ? t("platform.signupRequests.approving") : t("platform.signupRequests.approveSubmit")}
            </Button>
          </div>
        </div>
      )}
    </SidePanel>
  );
}
